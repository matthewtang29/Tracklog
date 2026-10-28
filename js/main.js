// main.js: wires the page together. Loads the SQL files, builds the database,
// runs each panel's query, and handles uploads, navigation and the SQL console.

import { loadSqlFiles, parseLibrary, buildDatabase, runQuery } from "./database.js";
import { nf, pct, fmtDate, el, renderSongList, renderArtists, renderPlaylists, renderGenres, renderTable, renderMonths, addSqlToggle } from "./render.js";
import { artEnabled, setArtEnabled, cancelPending, setProgressListener } from "./artwork.js";
import { sampleLibrary, sampleCover } from "./sample-library.js";

const $ = (id) => document.getElementById(id);
const SAMPLE_NOTE = "Real songs, invented play counts. Upload yours to see your own.";

const state = { SQL: null, sql: null, db: null, exportDate: null, kind: "sample" };
const params = () => ({ ":export_date": state.exportDate });
const query = (sql, p) => runQuery(state.db, sql, p);

function setMessage(text, isError = false) {
  $("msg").textContent = text;
  $("msg").className = isError ? "err" : "";
}

/* ---------- Draw every panel from its query ---------- */

function renderAll() {
  const Q = state.sql.queries;
  const s = query(Q.summary).rows[0];
  $("t-plays").textContent = nf.format(s.plays || 0);
  $("t-hours").textContent = nf.format(Math.round(s.hours || 0));
  $("t-songs").textContent = nf.format(s.songs || 0);
  $("t-artists").textContent = nf.format(s.artists || 0);
  $("t-skip").textContent = pct(s.skip_rate);
  $("t-never").textContent = nf.format(s.never_played || 0);

  // `art` is false (no covers) or an object; the sample library ships its own cover URLs.
  const art = artEnabled() && { coverFor: state.kind === "sample" ? sampleCover : null };
  const results = {};
  document.querySelectorAll("[data-q]").forEach((panel) => {
    const key = panel.dataset.q;
    const out = panel.querySelector("[data-out]");
    let rows;
    try {
      rows = query(Q[key], params()).rows;
    } catch (e) {
      out.replaceChildren(el("p", "empty", "This query failed: " + e.message));
      return;
    }
    results[key] = rows;
    switch (key) {
      case "top_songs": renderSongList(out, rows, { ranked: true, art, value: (r) => [nf.format(r.plays)] }); break;
      case "top_artists": renderArtists(out, rows, { art }); break;
      case "playlists": renderPlaylists(out, rows, { art }); break;
      case "genres": renderGenres(out, rows); break;
      case "forgotten":
        renderSongList(out, rows, { art, value: (r) => [nf.format(r.plays), `last ${fmtDate(r.last_played)}`] });
        break;
      case "most_skipped": renderSongList(out, rows, { art, value: (r) => [pct(r.skip_rate), `${nf.format(r.skips)} skips`] }); break;
      case "added_by_month": renderMonths(out, rows, state.exportDate); break;
    }
    addSqlToggle(panel, Q[key]);
  });

  // Hero: big hours number + one sentence
  const topArtist = results.top_artists?.[0];
  const topPlaylist = results.playlists?.[0];
  const line = $("takeaway");
  line.replaceChildren();
  if (topArtist) {
    $("hero-num").textContent = nf.format(Math.round(topArtist.hours));
    line.append("spent with ", el("b", null, topArtist.artist), ".");
    if (topPlaylist && s.plays && topPlaylist.plays > 0) {
      line.append(" Your ", el("b", null, topPlaylist.playlist), " playlist holds ",
        el("b", null, Math.round(100 * topPlaylist.plays / s.plays) + "%"), " of your plays.");
    }
  } else {
    $("hero-num").textContent = "0";
    line.textContent = "No plays recorded in this library yet.";
  }

  // Table reference under the SQL console
  const schemaList = $("schema");
  schemaList.replaceChildren();
  [
    ["v_tracks", "every column of tracks + artist, album, hours_listened"],
    ["tracks", "track_id, title, artist_id, album_id, genre, duration_ms, date_added, play_count, skip_count, last_played, loved"],
    ["artists", "artist_id, name"],
    ["albums", "album_id, name, artist_id, year"],
    ["playlists", "playlist_id, name"],
    ["playlist_tracks", "playlist_id, track_id, position"],
  ].forEach(([table, columns]) => {
    const row = el("div");
    row.append(el("b", null, table), ` (${columns})`);
    schemaList.append(row);
  });
  $("results").classList.remove("loading");
}

/* ---------- SQL console ---------- */

function runUserQuery() {
  const out = $("run-out");
  const msg = $("run-msg");
  if (!state.db) return;
  const sql = $("sql").value.trim();
  if (!sql) { msg.textContent = "Write a query first."; msg.className = "run-msg err"; return; }
  try {
    const t0 = performance.now();
    const { columns, rows } = query(sql, sql.includes(":export_date") ? params() : undefined);
    const ms = Math.round(performance.now() - t0);
    out.replaceChildren();
    msg.className = "run-msg";
    if (!columns.length) { msg.textContent = `Ran in ${ms} ms. No rows returned.`; return; }
    const shown = rows.slice(0, 200);
    renderTable(out, shown, columns.map((c) => ({
      key: c,
      label: c,
      num: shown.length && typeof shown[0][c] === "number",
      fmt: (v) => typeof v === "number" && !Number.isInteger(v) ? v.toFixed(2) : (v ?? "NULL"),
    })));
    msg.textContent = `${nf.format(rows.length)} row${rows.length === 1 ? "" : "s"} in ${ms} ms` +
      (rows.length > 200 ? " (showing the first 200)" : "");
  } catch (e) {
    out.replaceChildren();
    msg.textContent = "SQL error: " + e.message;
    msg.className = "run-msg err";
  }
}

function buildChips(examples) {
  const chips = $("chips");
  const pick = (button, ex) => {
    chips.querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", c === button));
    $("sql").value = ex.sql;
    $("explain").textContent = ex.about;
    $("explain").hidden = !ex.about;
    runUserQuery();
  };
  examples.forEach((ex) => {
    const b = el("button", "chip", ex.label);
    b.type = "button";
    b.addEventListener("click", () => pick(b, ex));
    chips.append(b);
  });
  const first = examples[2] || examples[0];
  if (first) {
    $("sql").value = first.sql;
    $("explain").textContent = first.about;
    $("explain").hidden = !first.about;
    chips.children[examples.indexOf(first)]?.classList.add("on");
  }
}
$("sql").addEventListener("input", () => {
  $("explain").hidden = true;
  $("chips").querySelectorAll(".chip").forEach((c) => c.classList.remove("on"));
});

/* ---------- Loading a library ---------- */

function setSource(kind, label) {
  $("source-title").textContent = kind === "sample" ? "Sample library" : "Your library";
  setMessage(label);
  $("load-sample").hidden = kind === "sample";
}

function loadLibrary(lib, kind, label) {
  const next = buildDatabase(state.SQL, state.sql.schema, lib);
  if (state.db) state.db.close();
  cancelPending();
  state.db = next;
  state.kind = kind;
  state.exportDate = (lib.Date || new Date().toISOString()).slice(0, 10);
  renderAll();
  setSource(kind, label);
  runUserQuery();
}

async function handleFile(file) {
  if (!file) return;
  if (!state.db) { setMessage("Still loading the database engine. Try again in a moment."); return; }
  if ($("help").open) $("help").close();
  setMessage(`Reading ${file.name}…`);
  $("results").classList.add("loading");
  try {
    const lib = parseLibrary(await file.text());
    const items = Object.keys(lib.Tracks).length;
    loadLibrary(lib, "user", `${file.name} · ${nf.format(items)} items · exported ${fmtDate(lib.Date)}`);
    window.scrollTo({ top: 0 });
  } catch (e) {
    $("results").classList.remove("loading");
    setMessage(e.message, true);
  }
}

/* ---------- Cover art progress in the sidebar ---------- */

setProgressListener((done, total, paused) => {
  const p = $("art-progress");
  if (!total || done >= total) { p.hidden = true; return; }
  p.hidden = false;
  p.textContent = paused
    ? `Apple asked us to slow down. Covers resume in a moment (${done} of ${total}).`
    : `Finding covers… ${done} of ${total}`;
});

/* ---------- Page controls ---------- */

// Help dialog with Mac / Windows steps
const tabs = [["tab-mac", "steps-mac"], ["tab-win", "steps-win"]];
tabs.forEach(([tab]) => $(tab).addEventListener("click", () => tabs.forEach(([t, panel]) => {
  const on = t === tab;
  $(t).setAttribute("aria-selected", String(on));
  $(panel).hidden = !on;
})));
if (/Win/i.test(navigator.platform || navigator.userAgent)) $("tab-win").click();
$("open-help").addEventListener("click", () => $("help").showModal());
$("close-help").addEventListener("click", () => $("help").close());

// Upload: button, or drop a file anywhere on the page
$("file").addEventListener("change", (e) => { handleFile(e.target.files[0]); e.target.value = ""; });
let dragDepth = 0;
const hasFile = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
document.addEventListener("dragenter", (e) => { if (hasFile(e)) { dragDepth++; $("drop-overlay").hidden = false; } });
document.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; $("drop-overlay").hidden = true; } });
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  $("drop-overlay").hidden = true;
  if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});

$("load-sample").addEventListener("click", () => loadLibrary(sampleLibrary(), "sample", SAMPLE_NOTE));
$("run").addEventListener("click", runUserQuery);
$("sql").addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); runUserQuery(); }
});
$("art-toggle").checked = artEnabled();
$("art-toggle").addEventListener("change", (e) => {
  setArtEnabled(e.target.checked);
  if (!e.target.checked) cancelPending();
  if (state.db) renderAll();
});

// Sidebar: highlight the section currently on screen
const navLinks = [...document.querySelectorAll("#nav a")];
const sections = navLinks.map((a) => document.querySelector(a.getAttribute("href"))).filter(Boolean);
const observer = new IntersectionObserver((entries) => {
  const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
  if (!visible) return;
  navLinks.forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#" + visible.target.id));
}, { rootMargin: "0px 0px -65% 0px" });
sections.forEach((s) => observer.observe(s));

/* ---------- Start up ---------- */

async function start() {
  if (typeof initSqlJs !== "function") {
    setMessage("The database engine couldn't load. Check your connection and reload the page.", true);
    return;
  }
  try {
    const [SQL, sqlFiles] = await Promise.all([initSqlJs(), loadSqlFiles()]);
    state.SQL = SQL;
    state.sql = sqlFiles;
  } catch (e) {
    setMessage(location.protocol === "file:"
      ? "Open this through a web server, not by double-clicking the file. See the README."
      : "Couldn't start: " + e.message, true);
    return;
  }
  buildChips(state.sql.examples);
  loadLibrary(sampleLibrary(), "sample", SAMPLE_NOTE);
}

start();
