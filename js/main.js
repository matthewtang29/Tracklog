// main.js: wires the page together. Loads the SQL files, asks the worker to
// build the database, runs each panel's query, and handles uploads (Apple Music
// and Spotify, for one person or several), switching between people, the cover
// art choice, navigation and the SQL console.

import { loadSqlFiles, Library, Cancelled } from "./database.js";
import { nf, pct, fmtDate, el, renderSongList, renderArtists, renderPlaylists, renderGenres, renderTable, renderMonths, addSqlToggle } from "./render.js";
import { artChoice, artEnabled, setArtChoice, clearSavedData, cancelPending, setProgressListener } from "./artwork.js";
import { sampleLibrary, sampleFriend, sampleCover } from "./sample-library.js";
import { resetSuggest } from "./suggest.js";
import { resetBlend, renameInBlend } from "./blend.js";

const $ = (id) => document.getElementById(id);
const SAMPLE_NOTE = "Alex (Apple Music) and Sam (Spotify): real songs, invented play counts. Upload yours to see your own.";
const MAX_FILE_MB = 500;        // far bigger than a real export; stops a wrong file early
const CONSOLE_TIMEOUT_MS = 10000;
const CONSOLE_MAX_ROWS = 200;

// people: who's loaded, in listener_id order (index + 1). Each is
// { name, files: [File] } for an upload, or { name, apple, spotify } for the sample.
const state = { sql: null, db: null, kind: "sample", cancelBuild: null, people: [], view: 0 };
const viewed = () => state.db.stats.people[state.view];
const params = () => ({ ":export_date": viewed().exportDate });
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

// `art` is false (no covers) or how to find them. The sample library ships
// its own cover URLs; an uploaded one only searches Apple once allowed.
const currentArt = () => artEnabled() && {
  coverFor: state.kind === "sample" ? sampleCover : null,
  lookup: state.kind === "user" && artChoice() === "on",
};

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
  const who = viewed();
  $("hero-eyebrow").textContent = state.people.length > 1 ? `${who.name}'s listening, by the numbers` : "Your listening, by the numbers";
  $("t-plays").textContent = nf.format(s.plays || 0);
  $("t-hours").textContent = nf.format(Math.round(s.hours || 0));
  $("t-songs").textContent = nf.format(s.songs || 0);
  $("t-artists").textContent = nf.format(s.artists || 0);
  $("t-skip").textContent = pct(s.skip_rate);
  $("t-never").textContent = nf.format(s.never_played || 0);

  const art = currentArt();
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
      case "genres": renderGenres(out, rows, "No genres here. Spotify downloads don't include them."); break;
      case "forgotten":
        renderSongList(out, rows, { art, value: (r) => [nf.format(r.plays), `last ${fmtDate(r.last_played)}`] });
        break;
      case "most_skipped": renderSongList(out, rows, { art, value: (r) => [pct(r.skip_rate), `${nf.format(r.skips)} skips`] }); break;
      case "added_by_month": renderMonths(out, rows, viewed().exportDate); break;
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
    ["v_tracks", "every column of tracks + artist, album, hours_listened (the person you're viewing)"],
    ["tracks", "track_id, title, artist_id, album_id, genre, duration_ms, date_added, play_count, skip_count, last_played, loved"],
    ["artists", "artist_id, name"],
    ["albums", "album_id, name, artist_id, year"],
    ["playlists", "playlist_id, name"],
    ["playlist_tracks", "playlist_id, track_id, position"],
    ["listeners", "listener_id, name, sources, export_date"],
    ["all_tracks, v_all_tracks", "everyone's songs: the same columns + listener_id, song_key, listened_ms, source"],
    ["all_playlists", "playlist_id, listener_id, name"],
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
    ? "You're looking at two sample listeners. Upload your Apple Music Library.xml or your Spotify data (.json files) to see your own. Files are read in your browser and never uploaded."
    : "Your files are read in this tab and never uploaded, and they're gone when you reload or close the tab. " +
      "Add a friend's files to blend your libraries." +
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

/* ---------- People: who's loaded and who the dashboard shows ---------- */

const sourceNote = (p) => [
  p.sources,
  plural(p.songs, "song"),
  p.streams ? plural(p.streams, "Spotify stream") : null,
  `up to ${fmtDate(p.exportDate)}`,
  p.skipped ? plural(p.skipped, "damaged entry", "damaged entries") + " skipped" : null,
  p.ignoredFiles ? plural(p.ignoredFiles, "other Spotify file") + " ignored" : null,
].filter(Boolean).join(" · ");

/** Small Apple Music / Spotify marks for a person's chip, from their sources text. */
function serviceIcons(sources = "") {
  const box = el("span", "svc");
  for (const [name, file] of [["Apple Music", "apple-music"], ["Spotify", "spotify"]]) {
    if (!sources.includes(name)) continue;
    const img = el("img");
    img.src = `img/${file}.svg`;
    img.alt = "";
    img.width = img.height = 22;
    box.append(img);
  }
  return box;
}

function renderPeople() {
  const bar = $("people");
  const list = $("people-list");
  list.replaceChildren();
  const people = state.db.stats.people;
  people.forEach((p, i) => {
    const b = el("button", "person" + (i === state.view ? " on" : ""));
    b.type = "button";
    b.setAttribute("aria-pressed", String(i === state.view));
    b.append(serviceIcons(p.sources), el("b", null, state.people[i].name), el("span", null, p.sources));
    b.title = sourceNote(p);
    b.addEventListener("click", () => viewPerson(i));
    list.append(b);
  });
  const user = state.kind === "user";
  $("person-actions").hidden = !user;
  $("add-person").textContent = user ? "+ Add a friend" : "Upload your own";
  $("person-note").textContent = sourceNote(people[state.view]);
  bar.hidden = false;
}

async function viewPerson(index) {
  if (index === state.view || !state.db) return;
  state.view = index;
  const db = state.db;
  setBusy(true);
  try {
    await db.view(index + 1);
    if (db !== state.db) return;
    renderPeople();
    await renderAll();
    await resetSuggest({ db, queries: state.sql.queries, params, art: currentArt });
    runUserQuery();
  } catch (e) {
    if (!(e instanceof Cancelled)) setMessage("Couldn't switch: " + e.message, true);
  } finally {
    if (db === state.db) setBusy(false);
  }
}

function startRename() {
  const i = state.view;
  const input = el("input", "rename");
  input.value = state.people[i].name;
  input.maxLength = 40;
  input.setAttribute("aria-label", "Name");
  const chip = $("people-list").children[i];
  chip.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    const name = input.value.trim().replace(/\s+/g, " ");
    if (save && name && name !== state.people[i].name) {
      state.people[i].name = name;
      state.db.stats.people[i].name = name;
      try { await state.db.rename(i + 1, name); } catch { /* the page still shows the new name */ }
      renameInBlend(i + 1, name);
      $("hero-eyebrow").textContent = `${name}'s listening, by the numbers`;
    }
    renderPeople();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") finish(true);
    if (e.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
}

/* ---------- Loading libraries ---------- */

function setSource(kind) {
  const people = state.db.stats.people;
  $("source-title").textContent = kind === "sample" ? "Sample listeners" : people.length > 1 ? `${people.length} people loaded` : "Your library";
  setMessage(kind === "sample" ? SAMPLE_NOTE : people.map((p) => `${p.name}: ${p.sources}`).join(" · "));
  $("load-sample").hidden = kind === "sample";
  document.querySelectorAll("[data-upload-label]").forEach((b) => {
    b.textContent = kind === "sample" ? b.dataset.uploadLabel : "Add more files";
  });
  updatePrivacyNotes();
}

/** Build everyone into a new worker and swap it in only once it fully works.
 *  If it fails, the people and library already on screen stay as they were. */
async function load(people, kind, view = 0, showProgressBar = false) {
  state.cancelBuild?.();                          // a newer upload wins
  const fileCount = people.reduce((n, x) => n + (x.files?.length || 0), 0);
  const { library, cancel } = Library.build(state.sql.schema, people, showProgressBar ? (p, phase) =>
    phase === "building"
      ? showProgress("Building the database…", null)
      : showProgress(`Reading ${plural(fileCount, "file")}… ${Math.round(p * 100)}%`, p) : null);
  state.cancelBuild = cancel;
  setBusy(true);
  if (showProgressBar) showProgress("Reading your files…", 0);
  try {
    const next = await library;
    if (state.cancelBuild !== cancel) { next.close(); return false; }
    view = Math.min(view, people.length - 1);
    await next.view(view + 1);
    const previous = state.db;
    cancelPending();
    state.db = next;
    state.kind = kind;
    state.people = people;
    state.view = view;
    renderPeople();
    await renderAll();
    await resetSuggest({ db: next, queries: state.sql.queries, params, art: currentArt });
    await resetBlend({ db: next, queries: state.sql.queries, art: currentArt, names: () => state.people.map((p) => p.name),
      addFriend: () => pickFiles("new") });
    setSource(kind);
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

const isApple = (f) => /\.xml$/i.test(f.name);
const isSpotify = (f) => /\.json$/i.test(f.name);

function uniqueName(base, taken) {
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) if (!taken.includes(`${base} ${n}`)) return `${base} ${n}`;
}

/** Check the files, then add them to a person.
 *  target: a person's index, "new" for someone new, or null to ask
 *  (an upload over the sample replaces it). */
async function handleFiles(files, target) {
  if (!files.length) return;
  if (!state.sql) { setMessage("Still starting up. Try again in a moment."); return; }
  const zip = files.find((f) => /\.zip$/i.test(f.name));
  const usable = files.filter((f) => isApple(f) || isSpotify(f));
  if (!usable.length) {
    return fail(zip
      ? `${zip.name} is a ZIP file. Unzip it first, then upload the .json files inside (select them all at once).`
      : `${files[0].name} isn't a library file. Upload Apple Music's Library.xml or the .json files from your Spotify download.`);
  }
  for (const f of usable) {
    if (!f.size) return fail(`${f.name} is empty. Export it again.`);
    if (f.size > MAX_FILE_MB * 1024 * 1024) return fail(`${f.name} is over ${MAX_FILE_MB} MB, which is too big to be a library export.`);
  }
  if (state.kind === "user" && target == null) {
    target = await askWhose(usable);
    if (target == null) return;
  }
  if ($("help").open) $("help").close();

  // Work out who gets which files. Each Library.xml is a whole library, so a
  // second one is someone else; Spotify files are pieces of one download.
  const people = state.kind === "user" ? state.people.map((p) => ({ ...p, files: [...p.files] })) : [];
  const taken = () => people.map((p) => p.name);
  const xmls = usable.filter(isApple);
  const jsons = usable.filter(isSpotify);
  let into = typeof target === "number" ? people[target] : null;
  const added = [];
  const newPerson = () => {
    const p = { name: uniqueName(people.length ? "Friend" : "You", taken()), files: [] };
    people.push(p);
    added.push(p);
    return p;
  };
  if (!into) into = newPerson();
  into.files.push(...jsons);
  xmls.forEach((f) => {
    const p = into.files.some(isApple) ? newPerson() : into;
    p.files.push(f);
  });
  const view = people.indexOf(into);
  const extra = added.filter((p) => p !== into).length;

  setMessage(`Reading ${plural(usable.length, "file")}…`);
  try {
    const done = await load(people, "user", view, true);
    if (!done) return;
    window.scrollTo({ top: 0 });
    if (extra) setMessage(`Each Library.xml is a whole library, so ${plural(extra, "extra one")} became ${extra === 1 ? "a new person" : "new people"}. Rename anyone with Rename.`);
    else if (files.length > usable.length) {
      const left = files.length - usable.length;
      setMessage(`Loaded. Left out ${plural(left, "file")} that ${left === 1 ? "isn't" : "aren't"} .xml or .json.`);
    }
  } catch (e) {
    if (e instanceof Cancelled) return;
    fail(e.message || "These files couldn't be read.");
  }
}

// Which button opened the file picker decides whose files they are.
let pickTarget = null;
function pickFiles(target) {
  pickTarget = target;
  $("file").click();
}

/** Ask whether dropped or picked files belong to someone loaded or someone new. */
function askWhose(files) {
  const dialog = $("whose");
  const box = $("whose-choices");
  box.replaceChildren();
  $("whose-files").textContent = files.length === 1 ? files[0].name : plural(files.length, "file");
  return new Promise((resolve) => {
    let answer = null;
    const choose = (value) => { answer = value; dialog.close(); };
    state.people.forEach((p, i) => {
      const b = el("button", "btn quiet", p.name);
      b.type = "button";
      b.addEventListener("click", () => choose(i));
      box.append(b);
    });
    const someone = el("button", "btn quiet", "Someone new");
    someone.type = "button";
    someone.addEventListener("click", () => choose("new"));
    box.append(someone);
    dialog.addEventListener("close", () => resolve(answer), { once: true });
    dialog.showModal();
  });
}

async function removePerson() {
  const i = state.view;
  const name = state.people[i].name;
  if (!confirm(`Remove ${name} from Tracklog? Their files stay on your computer.`)) return;
  const people = state.people.filter((_, j) => j !== i);
  if (!people.length) return loadSample();
  try {
    await load(people, "user", Math.max(0, i - 1));
    setMessage(`Removed ${name}.`);
  } catch (e) {
    if (!(e instanceof Cancelled)) fail(e.message);
  }
}

function loadSample() {
  const people = [
    { name: "Alex", apple: sampleLibrary() },
    { name: "Sam", spotify: sampleFriend() },
  ];
  return load(people, "sample")
    .catch((e) => { if (!(e instanceof Cancelled)) fail("Couldn't load the sample library: " + e.message); });
}

$("add-person").addEventListener("click", () => pickFiles(state.kind === "user" ? "new" : null));
$("add-files").addEventListener("click", () => pickFiles(state.view));
$("rename").addEventListener("click", startRename);
$("remove-person").addEventListener("click", removePerson);
$("whose-cancel").addEventListener("click", () => $("whose").close());

/* ---------- Cover art progress in the settings strip ---------- */

setProgressListener((done, total, paused) => {
  const p = $("art-progress");
  if (!total || done >= total) { p.hidden = true; return; }
  p.hidden = false;
  p.textContent = paused
    ? `Apple asked us to slow down. Covers resume in a moment (${done} of ${total}).`
    : `Finding covers… ${done} of ${total}`;
});

/* ---------- Page controls ---------- */

// Help dialog with Mac / Windows / Spotify steps
const tabs = [["tab-mac", "steps-mac"], ["tab-win", "steps-win"], ["tab-spotify", "steps-spotify"]];
tabs.forEach(([tab]) => $(tab).addEventListener("click", () => tabs.forEach(([t, panel]) => {
  const on = t === tab;
  $(t).setAttribute("aria-selected", String(on));
  $(panel).hidden = !on;
})));
if (/Win/i.test(navigator.platform || navigator.userAgent)) $("tab-win").click();
document.querySelectorAll("[data-help]").forEach((b) => b.addEventListener("click", () => $("help").showModal()));
$("close-help").addEventListener("click", () => $("help").close());

// Upload: real buttons (reachable with Tab) open the hidden file picker,
// or drop files anywhere on the page.
document.querySelectorAll("[data-upload]").forEach((b) => b.addEventListener("click", () => pickFiles(null)));
$("file").addEventListener("change", (e) => { const files = [...e.target.files]; e.target.value = ""; handleFiles(files, pickTarget); });
let dragDepth = 0;
const hasFile = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
document.addEventListener("dragenter", (e) => { if (hasFile(e)) { dragDepth++; $("drop-overlay").hidden = false; } });
document.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; $("drop-overlay").hidden = true; } });
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  $("drop-overlay").hidden = true;
  if (e.dataTransfer.files.length) handleFiles([...e.dataTransfer.files], null);
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

// Top bar: highlight the section currently on screen
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
