// main.js: wires the page together. Loads the SQL files, asks the worker to
// build the database, runs each panel's query, and handles uploads, the cover
// art choice, navigation and the SQL console.

import { loadSqlFiles, Library, Cancelled } from "./database.js";
import { nf, pct, fmtDate, el, renderSongList, renderArtists, renderPlaylists, renderGenres, renderTable, renderMonths, addSqlToggle } from "./render.js";
import { artChoice, artEnabled, setArtChoice, clearSavedData, cancelPending, setProgressListener } from "./artwork.js";
import { sampleLibrary, sampleCover } from "./sample-library.js";

const $ = (id) => document.getElementById(id);
const SAMPLE_NOTE = "Real songs, invented play counts. Upload yours to see your own.";
const MAX_FILE_MB = 500;        // far bigger than a real export; stops a wrong file early
const CONSOLE_TIMEOUT_MS = 10000;
const CONSOLE_MAX_ROWS = 200;

const state = { sql: null, db: null, kind: "sample", cancelBuild: null };
const params = () => ({ ":export_date": state.db.stats.exportDate });
let renderGeneration = 0;
const plural = (n, one, many = one + "s") => `${nf.format(n)} ${n === 1 ? one : many}`;

function setMessage(text, isError = false) {
  $("msg").textContent = text;
  $("msg").className = isError ? "err" : "";
}

/* ---------- Progress while a library loads ---------- */

function showProgress(text, fraction) {
  $("progress").hidden = false;
  $("progress-text").textContent = text;
  const bar = $("progress-bar");
  bar.hidden = fraction == null;
  if (fraction != null) bar.value = fraction;
}
const hideProgress = () => { $("progress").hidden = true; };
const setBusy = (on) => $("results").classList.toggle("loading", on);

/* ---------- Draw every panel from its query ---------- */

async function renderAll() {
  const gen = ++renderGeneration;
  const db = state.db;
  const Q = state.sql.queries;

  // Run every query first (in the worker), then draw everything at once.
  let summary = {};
  const results = new Map();
  try {
    summary = (await db.query(Q.summary)).rows[0] || {};
    for (const panel of document.querySelectorAll("[data-q]")) {
      const key = panel.dataset.q;
      try {
        results.set(key, (await db.query(Q[key], params())).rows);
      } catch (e) {
        if (e instanceof Cancelled) throw e;
        results.set(key, e);
      }
    }
  } catch (e) {
    if (e instanceof Cancelled) return;   // a newer library replaced this one
    summary = {};
  }
  if (gen !== renderGeneration) return;

  const s = summary;
  $("t-plays").textContent = nf.format(s.plays || 0);
  $("t-hours").textContent = nf.format(Math.round(s.hours || 0));
  $("t-songs").textContent = nf.format(s.songs || 0);
  $("t-artists").textContent = nf.format(s.artists || 0);
  $("t-skip").textContent = pct(s.skip_rate);
  $("t-never").textContent = nf.format(s.never_played || 0);

  // `art` is false (no covers) or how to find them. The sample library ships
  // its own cover URLs; an uploaded one only searches Apple once allowed.
  const art = artEnabled() && {
    coverFor: state.kind === "sample" ? sampleCover : null,
    lookup: state.kind === "user" && artChoice() === "on",
  };
  document.querySelectorAll("[data-q]").forEach((panel) => {
    const key = panel.dataset.q;
    const out = panel.querySelector("[data-out]");
    const rows = results.get(key);
    if (!Array.isArray(rows)) {
      out.replaceChildren(el("p", "empty", "This query failed: " + (rows?.message || "unknown error")));
      return;
    }
    switch (key) {
      case "top_songs": renderSongList(out, rows, { ranked: true, art, value: (r) => [nf.format(r.plays)] }); break;
      case "top_artists": renderArtists(out, rows, { art }); break;
      case "playlists": renderPlaylists(out, rows, { art }); break;
      case "genres": renderGenres(out, rows); break;
      case "forgotten":
        renderSongList(out, rows, { art, value: (r) => [nf.format(r.plays), `last ${fmtDate(r.last_played)}`] });
        break;
      case "most_skipped": renderSongList(out, rows, { art, value: (r) => [pct(r.skip_rate), `${nf.format(r.skips)} skips`] }); break;
      case "added_by_month": renderMonths(out, rows, db.stats.exportDate); break;
    }
    addSqlToggle(panel, Q[key]);
  });

  // Hero: big hours number + one sentence
  const topArtist = results.get("top_artists")?.[0];
  const topPlaylist = results.get("playlists")?.[0];
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
}

function renderSchemaList() {
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
}

/* ---------- SQL console ---------- */

let consoleRun = 0;
async function runUserQuery() {
  const out = $("run-out");
  const msg = $("run-msg");
  if (!state.db) return;
  const sql = $("sql").value.trim();
  if (!sql) { msg.textContent = "Write a query first."; msg.className = "run-msg err"; return; }
  const run = ++consoleRun;
  msg.textContent = "Running…";
  msg.className = "run-msg";
  $("run").disabled = true;
  try {
    const t0 = performance.now();
    const { columns, rows, total } = await state.db.query(sql, sql.includes(":export_date") ? params() : undefined,
      { timeoutMs: CONSOLE_TIMEOUT_MS, maxRows: CONSOLE_MAX_ROWS });
    if (run !== consoleRun) return;
    const ms = Math.round(performance.now() - t0);
    out.replaceChildren();
    if (!columns.length) { msg.textContent = `Ran in ${ms} ms. No rows returned.`; return; }
    renderTable(out, rows, columns.map((c) => ({
      key: c,
      label: c,
      num: rows.length && typeof rows[0][c] === "number",
      fmt: (v) => typeof v === "number" && !Number.isInteger(v) ? v.toFixed(2) : (v ?? "NULL"),
    })));
    msg.textContent = `${plural(total, "row")} in ${ms} ms` +
      (total > rows.length ? ` (showing the first ${rows.length})` : "");
  } catch (e) {
    if (e instanceof Cancelled || run !== consoleRun) return;
    out.replaceChildren();
    msg.textContent = "SQL error: " + e.message;
    msg.className = "run-msg err";
  } finally {
    if (run === consoleRun) $("run").disabled = false;
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

/* ---------- Privacy notes + cover art choice ---------- */

function updatePrivacyNotes() {
  const user = state.kind === "user";
  const lookups = user && artChoice() === "on";
  $("intro-note").textContent = !user
    ? "You're looking at a sample library. Upload your own Library.xml to see your stats. The file is read in your browser and never uploaded."
    : "You're looking at your own library. It's read in this tab and never uploaded, and it's gone when you reload or close the tab." +
      (lookups ? " Cover lookups send song titles and artists to Apple's iTunes Search." : "");
  $("art-ask").hidden = !(user && artChoice() === null);
  $("art-toggle").checked = artEnabled();
}

function chooseArt(value) {
  setArtChoice(value);
  if (value === "off") cancelPending();
  updatePrivacyNotes();
  if (state.db) renderAll();
}

/* ---------- Loading a library ---------- */

function setSource(kind, label) {
  $("source-title").textContent = kind === "sample" ? "Sample library" : "Your library";
  setMessage(label);
  $("load-sample").hidden = kind === "sample";
  document.querySelectorAll("[data-upload-label]").forEach((b) => {
    b.textContent = kind === "sample" ? b.dataset.uploadLabel : "Upload a different file";
  });
  updatePrivacyNotes();
}

/** Build a library in a new worker and swap it in only once it fully works. */
async function load(source, kind, describe, progressName) {
  state.cancelBuild?.();                          // a newer upload wins
  const { library, cancel } = Library.build(state.sql.schema, source, progressName && ((p, phase) =>
    phase === "building"
      ? showProgress("Building the database…", null)
      : showProgress(`Reading ${progressName}… ${Math.round(p * 100)}%`, p)));
  state.cancelBuild = cancel;
  setBusy(true);
  if (progressName) showProgress(`Reading ${progressName}…`, 0);
  try {
    const next = await library;
    if (state.cancelBuild !== cancel) { next.close(); return; }
    const previous = state.db;
    cancelPending();
    state.db = next;
    state.kind = kind;
    await renderAll();
    setSource(kind, describe(next.stats));
    previous?.close();
    runUserQuery();
    return true;
  } finally {
    if (state.cancelBuild === cancel) {
      state.cancelBuild = null;
      setBusy(false);
      hideProgress();
    }
  }
}

function fail(text) {
  setMessage(text, true);
  $("msg").scrollIntoView({ block: "center", behavior: "smooth" });
}

async function handleFile(file) {
  if (!file) return;
  if (!state.sql) { setMessage("Still starting up. Try again in a moment."); return; }
  if (!/\.xml$/i.test(file.name)) return fail(`${file.name} isn't an XML file. Upload the Library.xml you exported from Music or iTunes.`);
  if (!file.size) return fail(`${file.name} is empty. Export your library again.`);
  if (file.size > MAX_FILE_MB * 1024 * 1024) return fail(`${file.name} is over ${MAX_FILE_MB} MB, which is too big to be a library export.`);
  if ($("help").open) $("help").close();
  setMessage(`Reading ${file.name}…`);
  try {
    const done = await load({ file }, "user", (stats) =>
      `${file.name} · ${plural(stats.songs, "song")} · exported ${fmtDate(stats.exportDate)}` +
      (stats.skipped ? ` · ${plural(stats.skipped, "damaged entry", "damaged entries")} skipped` : ""), file.name);
    if (done) window.scrollTo({ top: 0 });
  } catch (e) {
    if (e instanceof Cancelled) return;
    fail(e.message || "This file couldn't be read.");
  }
}

function loadSample() {
  return load({ lib: sampleLibrary() }, "sample", () => SAMPLE_NOTE)
    .catch((e) => { if (!(e instanceof Cancelled)) fail("Couldn't load the sample library: " + e.message); });
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
document.querySelectorAll("[data-help]").forEach((b) => b.addEventListener("click", () => $("help").showModal()));
$("close-help").addEventListener("click", () => $("help").close());

// Upload: real buttons (reachable with Tab) open the hidden file picker,
// or drop a file anywhere on the page.
document.querySelectorAll("[data-upload]").forEach((b) => b.addEventListener("click", () => $("file").click()));
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

$("load-sample").addEventListener("click", loadSample);
$("run").addEventListener("click", runUserQuery);
$("sql").addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); runUserQuery(); }
});

// Cover art: the toggle, the one-time question for uploaded libraries, and clearing.
$("art-toggle").checked = artEnabled();
$("art-toggle").addEventListener("change", (e) => chooseArt(e.target.checked ? "on" : "off"));
$("art-yes").addEventListener("click", () => chooseArt("on"));
$("art-no").addEventListener("click", () => chooseArt("off"));
$("clear-data").addEventListener("click", () => {
  clearSavedData();
  updatePrivacyNotes();
  if (state.db) renderAll();
  setMessage("Saved covers and settings cleared from this browser.");
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

// Phones: keep an upload button on screen once the top ones have scrolled away
const topCtas = [document.querySelector(".side-card"), document.querySelector(".intro")];
const onScreen = new Set();
const ctaObserver = new IntersectionObserver((entries) => {
  entries.forEach((e) => e.isIntersecting ? onScreen.add(e.target) : onScreen.delete(e.target));
  $("sticky-cta").hidden = onScreen.size > 0;
});
topCtas.forEach((t) => ctaObserver.observe(t));

/* ---------- Start up ---------- */

async function start() {
  try {
    state.sql = await loadSqlFiles();
  } catch (e) {
    setMessage(location.protocol === "file:"
      ? "Open this through a web server, not by double-clicking the file. See the README."
      : "Couldn't start: " + e.message, true);
    return;
  }
  renderSchemaList();
  buildChips(state.sql.examples);
  await loadSample();
}

start();
