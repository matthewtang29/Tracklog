// plist.js: a small streaming parser for Apple's plist XML (the Library.xml format).
//
// Why not DOMParser? It needs the whole file as one string plus a full DOM tree,
// which can freeze or crash the tab on a big library, and it isn't available in
// Web Workers. This parser takes the file in chunks, keeps only the values it
// builds, and fails with a clear message instead of a crash when the file is
// damaged. It's a classic script (not a module) so the worker can load it with
// importScripts().

(function (global) {
  "use strict";

  const MAX_DEPTH = 64;                    // real libraries nest about 5 deep
  const MAX_PENDING = 16 * 1024 * 1024;    // one tag or text run can't be bigger than this
  const LEAVES = new Set(["key", "string", "integer", "real", "date", "data", "true", "false"]);
  const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

  class PlistError extends Error {}

  function decode(s) {
    if (s.indexOf("&") < 0) return s;
    return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, e) => {
      if (e[0] === "#") {
        const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : whole;
      }
      return ENTITIES[e] ?? whole;
    });
  }

  class PlistStream {
    constructor() {
      this.buf = "";
      this.stack = [];        // open <dict>/<array> containers
      this.root = undefined;
      this.leaf = null;       // name of the open leaf tag, e.g. "string"
      this.text = "";         // raw text of that leaf so far
      this.inPlist = false;
      this.closedPlist = false;
    }

    /** Feed the next piece of text. */
    write(chunk) {
      this.buf += chunk;
      this.run();
      if (this.buf.length > MAX_PENDING) throw new PlistError("a tag never closes");
    }

    /** Call once the whole file has been written. Returns the top-level value. */
    end() {
      this.run();
      if (this.buf.trim() || this.leaf || this.stack.length || (this.inPlist && !this.closedPlist)) {
        throw new PlistError("the file ends early. It may have been cut off while saving or copying");
      }
      if (this.root === undefined) throw new PlistError("there's no data in it");
      return this.root;
    }

    run() {
      const b = this.buf;
      let i = 0;
      for (;;) {
        const lt = b.indexOf("<", i);
        if (lt < 0) { this.addText(b.slice(i)); i = b.length; break; }
        if (lt > i) this.addText(b.slice(i, lt));
        i = lt;

        let end;
        if (b.startsWith("<!--", lt)) {
          end = b.indexOf("-->", lt + 4);
          if (end < 0) break;
          i = end + 3;
        } else if (b.startsWith("<![CDATA[", lt)) {
          end = b.indexOf("]]>", lt + 9);
          if (end < 0) break;
          // Escape so decode() at the end of the leaf gives the text back unchanged.
          this.addText(b.slice(lt + 9, end).replace(/&/g, "&amp;"));
          i = end + 3;
        } else if (b.startsWith("<?", lt)) {
          end = b.indexOf("?>", lt + 2);
          if (end < 0) break;
          i = end + 2;
        } else if (b.startsWith("<!", lt)) {
          end = b.indexOf(">", lt);
          if (end < 0) break;
          // Apple's exports point at an outside DTD but never embed one. An embedded
          // one could define entities, so refuse it rather than guess.
          if (b.slice(lt, end).includes("[")) throw new PlistError("it contains an embedded DTD, which a library export never has");
          i = end + 1;
        } else {
          end = b.indexOf(">", lt);
          if (end < 0) break;
          this.tag(b.slice(lt + 1, end));
          i = end + 1;
        }
      }
      this.buf = b.slice(i);
    }

    addText(s) {
      if (!s) return;
      if (this.leaf) this.text += s;
      else if (s.trim()) throw new PlistError("it has text outside of any value");
    }

    tag(inner) {
      if (inner[0] === "/") return this.close(inner.slice(1).trim());
      const selfClosing = inner.endsWith("/");
      const name = (selfClosing ? inner.slice(0, -1) : inner).trim().split(/\s/)[0];

      if (this.leaf) throw new PlistError(`there's a <${name}> inside a <${this.leaf}>`);
      if (name === "plist") {
        if (this.inPlist) throw new PlistError("it has a <plist> inside another one");
        this.inPlist = true;
        this.closedPlist = selfClosing;
        return;
      }
      if (!this.inPlist || this.closedPlist) throw new PlistError(`there's a <${name}> outside the <plist>`);

      if (name === "dict" || name === "array") {
        const obj = name === "dict" ? Object.create(null) : [];   // no prototype: a "__proto__" key is just a key
        if (selfClosing) return this.value(obj);
        if (this.stack.length >= MAX_DEPTH) throw new PlistError("it's nested far deeper than a library export");
        this.stack.push({ kind: name, obj, key: undefined });
        return;
      }
      if (!LEAVES.has(name)) throw new PlistError(`it has an unknown <${name}> tag`);
      if (selfClosing) return this.finishLeaf(name, "");
      this.leaf = name;
      this.text = "";
    }

    close(name) {
      if (name === "plist") {
        if (this.leaf || this.stack.length) throw new PlistError("the </plist> comes before everything is closed");
        this.closedPlist = true;
        return;
      }
      if (this.leaf) {
        if (name !== this.leaf) throw new PlistError(`a <${this.leaf}> is closed with </${name}>`);
        const raw = this.text;
        this.leaf = null;
        this.text = "";
        return this.finishLeaf(name, raw);
      }
      const top = this.stack.pop();
      if (!top || top.kind !== name) throw new PlistError(`there's a </${name}> that doesn't match`);
      this.value(top.obj);
    }

    finishLeaf(name, raw) {
      const s = decode(raw);
      switch (name) {
        case "key": {
          const top = this.stack[this.stack.length - 1];
          if (!top || top.kind !== "dict") throw new PlistError("it has a <key> outside a <dict>");
          top.key = s;
          return;
        }
        case "integer": { const n = parseInt(s, 10); return this.value(Number.isFinite(n) ? n : null); }
        case "real": { const n = parseFloat(s); return this.value(Number.isFinite(n) ? n : null); }
        case "true": return this.value(true);
        case "false": return this.value(false);
        case "date": return this.value(s.trim());
        default: return this.value(s);             // string, data
      }
    }

    value(v) {
      const top = this.stack[this.stack.length - 1];
      if (!top) {
        if (this.root !== undefined) throw new PlistError("it has more than one top-level value");
        this.root = v;
      } else if (top.kind === "array") {
        top.obj.push(v);
      } else {
        if (top.key === undefined) throw new PlistError("a value in a <dict> has no <key>");
        top.obj[top.key] = v;
        top.key = undefined;
      }
    }
  }

  global.PlistStream = PlistStream;
  global.PlistError = PlistError;
})(typeof self !== "undefined" ? self : globalThis);
