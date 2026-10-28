// main.js: wires the page together. Loads the SQL files, builds the database,
// runs each card's query, and handles uploads and the SQL editor.

import { loadSqlFiles, parseLibrary, buildDatabase, runQuery } from "./database.js";
import { nf, pct, fmtDate, el, renderBars, renderSongList, renderTable, twoLine, renderMonths, addSqlToggle } from "./render.js";
import { artEnabled, setArtEnabled, cancelPending } from "./artwork.js";
import { sampleLibrary } from "./sample-library.js";

const $ = (id) => document.getElementById(id);
const SAMPLE_NOTE = "Invented artists and play counts. Upload your own Library.xml to see yours.";

const state = { SQL: null, sql: null, db: null, exportDate: null, kind: "sample" };
const params = () => ({ ":export_date": state.exportDate });
const query = (sql, p) => runQuery(state.db, sql, p);

function showError(text) {
  $("msg").textContent = text;
  $("msg").className = "msg err";
}

/* ---------- Draw every card from its query ---------- */

function renderAll() {
  const Q = state.sql.queries;
  const s = query(Q.summary).rows[0];
  $("t-plays").textContent = nf.format(s.plays || 0);
  $("t-hours").textContent = nf.format(Math.round(s.hours || 0));
  $("t-songs").textContent = nf.format(s.songs || 0);
  $("t-artists").textContent = nf.format(s.artists || 0);
  $("t-skip").textContent = pct(s.skip_rate);
  $("t-never").textContent = nf.format(s.never_played || 0);

  const results = {};
  document.querySelectorAll(".card[data-q]").forEach((card) => {
    const key = card.dataset.q;
    const out = card.querySelector("[data-out]");
    let rows;
    try {
      rows = query(Q[key], params()).rows;
    } catch (e) {
      out.replaceChildren(el("p", "empty", "This query failed: " + e.message));
      return;
    }
    results[key] = rows;
    // Real cover art only for real libraries; the sample's artists are invented.
    const art = state.kind === "user" && artEnabled();
    switch (key) {
      case "top_artists": renderBars(out, rows, "artist", "hours", "hours", { avatars: true, art }); break;
      case "genres": renderBars(out, rows, "genre", "hours", "hours"); break;
      case "top_songs":
        renderSongList(out, rows, { ranked: true, art, value: (r) => [nf.format(r.plays)] });
        break;
      case "playlists":
        renderTable(out, rows, [
          { key: "playlist", label: "Playlist" },
          { key: "top_title", label: "Most played", render: (r) => twoLine(r.top_title, r.top_artist) },
          { key: "songs", label: "Songs", num: true, muted: true, hideSm: true, fmt: (v) => nf.format(v) },
          { key: "plays", label: "Plays", num: true, fmt: (v) => nf.format(v) },
        ]);
        break;
      case "forgotten":
        renderSongList(out, rows, { art, value: (r) => [`${nf.format(r.plays)} plays`, `last ${fmtDate(r.last_played)}`] });
        break;
      case "most_skipped":
        renderSongList(out, rows, { art, value: (r) => [pct(r.skip_rate)] });
        break;
      case "added_by_month": renderMonths(out, rows, state.exportDate); break;
    }
    addSqlToggle(card, Q[key]);
  });

  // Headline sentence in the banner
  const takeaway = $("takeaway");
  takeaway.replaceChildren();
  const topArtist = results.top_artists?.[0];
  const topPlaylist = results.playlists?.[0];
  if (topArtist) {
    takeaway.append("You've spent ", el("b", null, nf.format(Math.round(topArtist.hours)) + " hours"), " with ", el("b", null, topArtist.artist));
    if (topPlaylist && s.plays && topPlaylist.plays > 0) {
      takeaway.append(", and ", el("b", null, topPlaylist.playlist), " holds ",
        el("b", null, Math.round(100 * topPlaylist.plays / s.plays) + "%"), " of all your plays.");
    } else {
      takeaway.append(".");
    }
  } else {
    takeaway.textContent = "This library has no plays recorded yet.";
  }

  // Table reference under the SQL editor
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

/* ---------- SQL editor ---------- */

function runUserQuery() {
  const out = $("run-out");
  const msg = $("run-msg");
  if (!state.db) return;
  const sql = $("sql").value.trim();
  if (!sql) { msg.textContent = "Write a query first."; msg.className = "msg err"; return; }
  try {
    const t0 = performance.now();
    const { columns, rows } = query(sql, sql.includes(":export_date") ? params() : undefined);
    const ms = Math.round(performance.now() - t0);
    out.replaceChildren();
    if (!columns.length) { msg.textContent = `Ran in ${ms} ms. No rows returned.`; msg.className = "msg"; return; }
    const shown = rows.slice(0, 200);
    renderTable(out, shown, columns.map((c) => ({
      key: c,
      label: c,
      num: shown.length && typeof shown[0][c] === "number",
      fmt: (v) => typeof v === "number" && !Number.isInteger(v) ? v.toFixed(2) : (v ?? "NULL"),
    })));
    msg.textContent = `${nf.format(rows.length)} row${rows.length === 1 ? "" : "s"} in ${ms} ms` +
      (rows.length > 200 ? " (showing the first 200)" : "");
    msg.className = "msg";
  } catch (e) {
    out.replaceChildren();
    msg.textContent = "SQL error: " + e.message;
    msg.className = "msg err";
  }
}

/* ---------- Loading a library ---------- */

function setSource(kind, label) {
  const pill = $("source-pill");
  pill.textContent = kind === "sample" ? "Sample library" : "Your library";
  pill.className = "pill" + (kind === "sample" ? "" : " mine");
  $("msg").textContent = label;
  $("msg").className = "msg";
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
  if (!state.db) { $("msg").textContent = "Still loading the database engine. Try again in a moment."; return; }
  $("msg").textContent = `Reading ${file.name}…`;
  $("msg").className = "msg";
  $("results").classList.add("loading");
  try {
    const lib = parseLibrary(await file.text());
    const items = Object.keys(lib.Tracks).length;
    loadLibrary(lib, "user", `${file.name} · ${nf.format(items)} items · exported ${fmtDate(lib.Date)}`);
  } catch (e) {
    $("results").classList.remove("loading");
    showError(e.message);
  }
}

/* ---------- Page controls ---------- */

const tabs = [["tab-mac", "steps-mac"], ["tab-win", "steps-win"]];
tabs.forEach(([tab]) => $(tab).addEventListener("click", () => tabs.forEach(([t, panel]) => {
  const on = t === tab;
  $(t).setAttribute("aria-selected", String(on));
  $(panel).hidden = !on;
})));
if (/Win/i.test(navigator.platform || navigator.userAgent)) $("tab-win").click();

$("file").addEventListener("change", (e) => handleFile(e.target.files[0]));
const drop = $("drop");
["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => handleFile(e.dataTransfer.files[0]));
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => {
  e.preventDefault();
  if (!e.target.closest?.("#drop") && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});

$("load-sample").addEventListener("click", () => loadLibrary(sampleLibrary(), "sample", SAMPLE_NOTE));
$("run").addEventListener("click", runUserQuery);
$("art-toggle").checked = artEnabled();
$("art-toggle").addEventListener("change", (e) => {
  setArtEnabled(e.target.checked);
  if (!e.target.checked) cancelPending();
  if (state.db) renderAll();
});
$("sql").addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); runUserQuery(); }
});

/* ---------- Start up ---------- */

async function start() {
  if (typeof initSqlJs !== "function") {
    showError("The database engine couldn't load. Check your connection and reload the page.");
    return;
  }
  try {
    const [SQL, sqlFiles] = await Promise.all([initSqlJs(), loadSqlFiles()]);
    state.SQL = SQL;
    state.sql = sqlFiles;
  } catch (e) {
    showError(location.protocol === "file:"
      ? "Open this through a web server, not by double-clicking the file. See the README."
      : "Couldn't start: " + e.message);
    return;
  }

  sqlFilesToChips(state.sql.examples);
  loadLibrary(sampleLibrary(), "sample", SAMPLE_NOTE);
}

function sqlFilesToChips(examples) {
  const chips = $("chips");
  examples.forEach(({ label, sql }) => {
    const b = el("button", "chip", label);
    b.type = "button";
    b.addEventListener("click", () => { $("sql").value = sql; runUserQuery(); });
    chips.append(b);
  });
  $("sql").value = examples[2]?.sql || "SELECT * FROM v_tracks LIMIT 10;";
}

start();
