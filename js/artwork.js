// artwork.js: finds cover art for songs and artists.
//
// Library.xml has no pictures in it, so we look each song up by name with
// Apple's public iTunes Search API (no key needed) and use the album artwork
// it returns. Requests go one at a time, results are cached in the browser,
// and anything not found keeps its plain placeholder tile.

const CACHE_KEY = "tracklog-artwork-v1";
const SPACING_MS = 300; // iTunes Search allows roughly 20 requests a minute

let cache = {};
try { cache = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"); } catch { cache = {}; }

let enabled = true;
try { enabled = localStorage.getItem("tracklog-art") !== "off"; } catch { /* storage blocked */ }

const queue = [];
const pending = new Map();
let running = false;
let jsonpId = 0;

export const artEnabled = () => enabled;
export function setArtEnabled(on) {
  enabled = on;
  try { localStorage.setItem("tracklog-art", on ? "on" : "off"); } catch { /* ignore */ }
}

function saveCache() {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* full or blocked */ }
}

/* JSONP works from any page, including GitHub Pages, without CORS setup. */
function jsonp(url, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const name = `__tracklogArt${++jsonpId}`;
    const script = document.createElement("script");
    const timer = setTimeout(() => finish(new Error("timeout")), timeoutMs);
    function finish(err, data) {
      clearTimeout(timer);
      delete window[name];
      script.remove();
      err ? reject(err) : resolve(data);
    }
    window[name] = (data) => finish(null, data);
    script.onerror = () => finish(new Error("network"));
    script.src = `${url}&callback=${name}`;
    document.head.append(script);
  });
}

const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const bigger = (url) => url ? url.replace(/\/\d+x\d+bb\./, "/300x300bb.") : null;

async function search(kind, title, artist) {
  const base = "https://itunes.apple.com/search?media=music&limit=5";
  if (kind === "artist") {
    const data = await jsonp(`${base}&entity=album&attribute=artistTerm&term=${encodeURIComponent(artist)}`);
    const want = norm(artist);
    const hit = data.results.find((r) => norm(r.artistName) === want) || data.results[0];
    return bigger(hit?.artworkUrl100);
  }
  const data = await jsonp(`${base}&entity=song&term=${encodeURIComponent(`${title} ${artist}`)}`);
  const firstWord = norm(artist).split(" ")[0];
  const hit = data.results.find((r) => norm(r.artistName).includes(firstWord) && norm(r.trackName).startsWith(norm(title).slice(0, 8)))
    || data.results.find((r) => norm(r.artistName).includes(firstWord));
  return bigger(hit?.artworkUrl100);
}

async function pump() {
  if (running) return;
  running = true;
  while (queue.length) {
    const { key, kind, title, artist } = queue.shift();
    let url = null;
    try { url = await search(kind, title, artist); } catch { url = undefined; }
    if (url !== undefined) { cache[key] = url; saveCache(); } // don't cache network failures
    pending.get(key)?.forEach((fn) => fn(url || null));
    pending.delete(key);
    await new Promise((r) => setTimeout(r, SPACING_MS));
  }
  running = false;
}

function lookup(kind, title, artist) {
  const key = `${kind}|${norm(title)}|${norm(artist)}`;
  if (key in cache) return Promise.resolve(cache[key]);
  return new Promise((resolve) => {
    if (!pending.has(key)) {
      pending.set(key, []);
      queue.push({ key, kind, title, artist });
    }
    pending.get(key).push(resolve);
    pump();
  });
}

/** Fill a placeholder tile with real artwork once it's found. */
export function attachArtwork(tile, kind, title, artist) {
  if (!enabled || !artist || artist === "Unknown artist") return;
  lookup(kind, title, artist).then((url) => {
    if (!url || !tile.isConnected) return;
    const img = new Image();
    img.alt = "";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    img.onload = () => { tile.textContent = ""; tile.append(img); requestAnimationFrame(() => img.classList.add("ready")); };
    img.src = url;
  });
}

/** Drop queued lookups, e.g. when a new library is loaded. */
export function cancelPending() {
  queue.length = 0;
  pending.clear();
}
