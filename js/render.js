// render.js: turns query results into the song lists, artist bars, playlist
// cards, genre chips and the monthly chart.

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

const empty = (out, text = "Nothing matches in this library.") => out.replaceChildren(el("p", "empty", text));

/* Placeholder tile: a quiet colour picked from the name. artwork.js swaps in
   the real cover when it finds one. */
function hashHue(str) {
  let h = 0;
  for (const ch of String(str)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h % 360;
}

const initials = (name) =>
  String(name).replace(/[^\p{L}\p{N} ]/gu, "").split(/\s+/).filter(Boolean)
    .slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "♪";

function tile({ title, artist, album, avatar, art, label }) {
  const seed = avatar ? artist : `${artist}${title}`;
  const t = el("span", "art" + (avatar ? " avatar" : ""), label ?? (avatar ? initials(artist) : null));
  t.style.background = `hsl(${hashHue(seed)} 10% 20%)`;
  t.setAttribute("aria-hidden", "true");
  if (art) attachArtwork(t, { title, artist, album, url: art.coverFor?.(album, artist) });
  return t;
}

/** Song rows: [rank] [cover] title/artist [value]. */
export function renderSongList(out, rows, { ranked = false, art = false, value }) {
  if (!rows.length) return empty(out);
  out.replaceChildren();
  rows.forEach((r, i) => {
    const item = el("div", "item" + (ranked ? "" : " no-rank"));
    if (ranked) item.append(el("span", "rank", String(i + 1)));
    item.append(tile({ title: r.title, artist: r.artist, album: r.album, art }));
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

/** Artist rows: avatar, name, hours, and a thin bar underneath. */
export function renderArtists(out, rows, { art = false } = {}) {
  if (!rows.length) return empty(out);
  out.replaceChildren();
  const max = Math.max(...rows.map((r) => r.hours));
  rows.forEach((r) => {
    const row = el("div", "artist");
    const bar = el("div", "bar");
    const fill = el("i");
    fill.style.width = (100 * r.hours / max) + "%";
    bar.append(fill);
    row.append(
      // The artist's picture is the cover of their most-played song.
      tile({ title: r.top_title, artist: r.artist, album: r.top_album, avatar: true, art }),
      el("span", "name", r.artist),
      el("span", "val", `${nf.format(Math.round(r.hours))} h`),
      bar,
    );
    row.setAttribute("aria-label", `${r.artist}: ${nf.format(Math.round(r.hours))} hours`);
    out.append(row);
  });
}

/** Playlist cards, each covered with its most-played song's artwork. */
export function renderPlaylists(out, rows, { art = false } = {}) {
  if (!rows.length) return empty(out, "No playlists in this library.");
  out.replaceChildren();
  rows.forEach((r) => {
    const card = el("div", "pl");
    const meta = el("div", "meta");
    meta.append(
      el("b", null, r.playlist),
      el("span", null, `${nf.format(r.songs)} songs · ${nf.format(r.plays)} plays`),
      el("span", null, `Top: ${r.top_title}`),
    );
    card.title = `${r.playlist}: most played is ${r.top_title} – ${r.top_artist}`;
    card.append(tile({ title: r.top_title, artist: r.top_artist, album: r.top_album, art, label: "♪" }), meta);
    out.append(card);
  });
}

/** Genre chips with hours. */
export function renderGenres(out, rows) {
  if (!rows.length) return empty(out);
  out.replaceChildren();
  rows.forEach((r) => {
    const chip = el("span", "genre", r.genre);
    chip.append(el("small", null, `${nf.format(Math.round(r.hours))} h`));
    out.append(chip);
  });
}

export function renderTable(out, rows, cols) {
  if (!rows.length) return empty(out);
  out.replaceChildren();
  const table = el("table");
  const thead = el("thead");
  const headRow = el("tr");
  cols.forEach((c) => headRow.append(el("th", c.num ? "num" : null, c.label)));
  thead.append(headRow);
  table.append(thead);
  const tbody = el("tbody");
  rows.forEach((r) => {
    const tr = el("tr");
    cols.forEach((c) => tr.append(el("td", c.num ? "num" : null, c.fmt ? c.fmt(r[c.key]) : (r[c.key] ?? "—"))));
    tbody.append(tr);
  });
  table.append(tbody);
  out.append(table);
}

export function renderMonths(out, rows, exportDate) {
  if (!rows.length) return empty(out, "No songs added in the last 24 months.");
  out.replaceChildren();

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
  const name = (k, style) => new Date(k + "-01T00:00:00Z").toLocaleDateString("en", { month: style, year: style === "long" ? "numeric" : undefined, timeZone: "UTC" });
  const bars = el("div", "months");
  months.forEach((k, i) => {
    const v = values[i];
    const col = el("div", "month" + (i === peak ? " peak" : ""));
    col.tabIndex = 0;
    col.title = `${name(k, "long")}: ${v} songs added`;
    col.setAttribute("aria-label", col.title);
    const h = (v ? Math.max(2, 100 * v / max) : 0) + "%";
    const bar = el("i");
    bar.style.height = h;
    const num = el("b", null, String(v));
    num.style.bottom = h;
    col.append(num, bar);
    bars.append(col);
  });

  const labels = el("div", "month-labels");
  const n = months.length;
  [...new Set([0, Math.round((n - 1) / 2), n - 1])].forEach((i) => {
    labels.append(el("span", null, `${name(months[i], "short")} '${months[i].slice(2, 4)}`));
  });
  out.append(bars, labels);
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
