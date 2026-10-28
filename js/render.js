// render.js: turns query results into bars, song lists, tables and the monthly chart.

import { attachArtwork } from "./artwork.js";

export const nf = new Intl.NumberFormat("en");

export const pct = (x) => (x == null || isNaN(x)) ? "—" : (x * 100).toFixed(1) + "%";

export function fmtDate(s) {
  if (!s) return "—";
  const d = new Date(String(s).slice(0, 10) + "T00:00:00Z");
  return isNaN(d) ? "—" : d.toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/* Placeholder tile: a quiet, low-saturation colour picked from the name,
   replaced by real cover art when artwork.js finds it. */
function hashHue(str) {
  let h = 0;
  for (const ch of String(str)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h % 360;
}

const initials = (name) =>
  String(name).replace(/[^\p{L}\p{N} ]/gu, "").split(/\s+/).filter(Boolean)
    .slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "♪";

function tile({ kind, title, artist, avatar, art }) {
  const seed = avatar ? artist : `${artist}${title}`;
  const t = el("span", "art" + (avatar ? " avatar" : ""), avatar ? initials(artist) : null);
  t.style.background = `hsl(${hashHue(seed)} 12% 22%)`;
  t.setAttribute("aria-hidden", "true");
  if (art) attachArtwork(t, kind, title, artist);
  return t;
}

export function renderBars(out, rows, labelKey, valKey, unit, opts = {}) {
  out.replaceChildren();
  if (!rows.length) { out.append(el("p", "empty", "Nothing to show for this library.")); return; }
  const max = Math.max(...rows.map((r) => r[valKey]));
  rows.forEach((r) => {
    const row = el("div", "bar-row");
    const lab = el("span", "lab");
    lab.title = r[labelKey];
    if (opts.avatars) lab.append(tile({ kind: "artist", artist: r[labelKey], avatar: true, art: opts.art }));
    lab.append(el("span", null, r[labelKey]));
    const track = el("div", "bar-track");
    const fill = el("div", "bar-fill");
    fill.style.width = (100 * r[valKey] / max) + "%";
    track.append(fill);
    const value = nf.format(Math.round(r[valKey]));
    row.setAttribute("aria-label", `${r[labelKey]}: ${value} ${unit}`);
    row.append(lab, track, el("span", "val", value));
    out.append(row);
  });
}

/** Song rows with cover art: [rank] [art] title/artist [value]. */
export function renderSongList(out, rows, { ranked = false, art = false, value }) {
  out.replaceChildren();
  if (!rows.length) { out.append(el("p", "empty", "Nothing matches in this library.")); return; }
  rows.forEach((r, i) => {
    const item = el("div", "item" + (ranked ? "" : " no-rank"));
    if (ranked) item.append(el("span", "rank", String(i + 1)));
    item.append(tile({ kind: "song", title: r.title, artist: r.artist, art }));
    const who = el("span", "who");
    who.append(el("b", null, r.title), el("span", null, r.artist));
    who.title = `${r.title} – ${r.artist}`;
    const num = el("span", "num");
    const [main, sub] = value(r);
    num.append(main);
    if (sub) num.append(el("small", null, sub));
    item.append(who, num);
    out.append(item);
  });
}

export function renderTable(out, rows, cols) {
  out.replaceChildren();
  if (!rows.length) { out.append(el("p", "empty", "Nothing matches in this library.")); return; }
  const table = el("table");
  const thead = el("thead");
  const headRow = el("tr");
  cols.forEach((c) => headRow.append(el("th", [c.num && "num", c.hideSm && "hide-sm"].filter(Boolean).join(" "), c.label)));
  thead.append(headRow);
  table.append(thead);

  const tbody = el("tbody");
  rows.forEach((r) => {
    const tr = el("tr");
    cols.forEach((c) => {
      const td = el("td", [c.num && "num", c.muted && "muted", c.hideSm && "hide-sm"].filter(Boolean).join(" "));
      if (c.render) td.append(c.render(r));
      else td.textContent = c.fmt ? c.fmt(r[c.key]) : (r[c.key] ?? "—");
      tr.append(td);
    });
    tbody.append(tr);
  });
  table.append(tbody);
  out.append(table);
}

export function twoLine(top, bottom) {
  const d = el("div", "two");
  d.append(el("b", null, top ?? "—"), el("span", null, bottom ?? ""));
  return d;
}

export function renderMonths(out, rows, exportDate) {
  out.replaceChildren();
  if (!rows.length) { out.append(el("p", "empty", "No songs added in the last 24 months.")); return; }

  // Fill gaps so every month appears, even with zero songs added.
  const byMonth = new Map(rows.map((r) => [r.month, r.added]));
  const [y0, m0] = rows[0].month.split("-").map(Number);
  const last = exportDate.slice(0, 7);
  const months = [];
  for (let y = y0, m = m0; ;) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    months.push(key);
    if (key >= last || months.length > 30) break;
    m++;
    if (m > 12) { m = 1; y++; }
  }

  const values = months.map((k) => byMonth.get(k) || 0);
  const max = Math.max(...values, 1);
  const peak = values.indexOf(max);
  const label = (k, style) => new Date(k + "-01T00:00:00Z").toLocaleDateString("en", { month: style, year: style === "long" ? "numeric" : undefined, timeZone: "UTC" });
  const cols = el("div", "cols");

  months.forEach((k, i) => {
    const v = values[i];
    const col = el("div", "col" + (i === peak ? " peak" : ""));
    col.tabIndex = 0;
    col.title = `${label(k, "long")}: ${v} songs added`;
    col.setAttribute("aria-label", col.title);
    const h = (v ? Math.max(2, 100 * v / max) : 0) + "%";
    const bar = el("i");
    bar.style.height = h;
    const num = el("b", null, String(v));
    num.style.bottom = h;
    col.append(num, bar);
    cols.append(col);
  });

  // Five evenly spaced labels, like "Nov '24 … Oct '26"
  const labels = el("div", "col-labels");
  const n = months.length;
  const picks = [...new Set([0, Math.round(n * 0.25), Math.round(n * 0.5), Math.round(n * 0.75), n - 1])].filter((i) => i < n);
  picks.forEach((i) => {
    const k = months[i];
    labels.append(el("span", null, `${label(k, "short")} '${k.slice(2, 4)}`));
  });
  out.append(cols, labels);
}

export function addSqlToggle(card, sql) {
  let details = card.querySelector("details.sql");
  if (!details) {
    details = el("details", "sql");
    details.append(el("summary", null, "Show SQL →"), el("pre"));
    card.append(details);
  }
  details.querySelector("pre").textContent = sql;
}
