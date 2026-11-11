// artwork.js: finds cover art for songs.
//
// Library.xml has no pictures in it, so each song is looked up by name with
// Apple's public iTunes Search API (no key needed). How a cover is chosen:
//   1. a result with the same title and artist (preferring the same album), or
//   2. any result by the same artist from the same album (same cover), or
//   3. nothing: the tile keeps its plain placeholder rather than a wrong cover.
// Every album cover seen in any search is remembered, so other songs from that
// album never need a lookup. iTunes allows about 20 searches a minute, so
// lookups are spaced out and pause when Apple asks us to slow down.
//
// Privacy: a lookup sends a song's title, artist and album to Apple. The sample
// library ships its own covers, so it never searches. For an uploaded library,
// main.js asks first and nothing is searched until the person says yes.

const CACHE_KEY = "tracklog-covers-v2";
const SPACING_MS = 1600;     // stays under ~20 searches a minute with bursts
const BACKOFF_MS = 30000;    // pause after Apple rate-limits us
const MAX_TRIES = 3;

/* ---------- Text matching ---------- */

const norm = (s) => String(s || "").toLowerCase().normalize("NFKD")
  .replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// "Get You (feat. Kali Uchis)" -> "get you", "Blonde - EP" -> "blonde"
const core = (s) => norm(String(s || "")
  .replace(/\s*[(\[].*?[)\]]/g, "")
  .replace(/\s+(feat|ft|featuring)\.?\s.*$/i, "")
  .replace(/\s+-\s+.*$/, ""));

const sameArtist = (found, wanted) => {
  const f = norm(found), w = norm(wanted);
  return f === w || f.startsWith(w + " ") || f.includes(w);
};
const isVariant = (s) => /\b(live|remix|acoustic|instrumental|sped up|slowed|demo|karaoke|cover|reprise)\b/i.test(s);

/* ---------- Cache (songs + albums) ---------- */

let cache = { songs: {}, albums: {} };
try {
  const saved = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
  if (saved?.songs && saved?.albums) cache = saved;
} catch { /* storage blocked or corrupt */ }

let saveTimer = null;
function saveCache() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* full or blocked */ }
  }, 500);
}

const songKey = (title, artist) => `${core(title)}|${norm(artist)}`;
const albumKey = (album, artist) => `${core(album)}|${norm(artist)}`;
const bigger = (url) => url ? url.replace(/\/\d+x\d+bb\./, "/300x300bb.") : null;

function rememberAlbums(results) {
  for (const r of results) {
    if (r.collectionName && r.artworkUrl100 && !isVariant(r.collectionName)) {
      const key = albumKey(r.collectionName, r.artistName);
      if (!cache.albums[key]) cache.albums[key] = bigger(r.artworkUrl100);
    }
  }
}

/* ---------- The person's choice ----------
   "on": show covers and look them up. "off": no covers at all.
   null: not asked yet. Sample covers show, nothing is searched. */

const CHOICE_KEY = "tracklog-art";
let choice = null;
try { choice = localStorage.getItem(CHOICE_KEY); } catch { /* storage blocked */ }
if (choice !== "on" && choice !== "off") choice = null;

export const artChoice = () => choice;
export const artEnabled = () => choice !== "off";
export function setArtChoice(value) {
  choice = value;
  try { localStorage.setItem(CHOICE_KEY, value); } catch { /* storage blocked */ }
}

/** Forget every cover and the cover setting saved in this browser. */
export function clearSavedData() {
  cancelPending();
  cache = { songs: {}, albums: {} };
  choice = null;
  clearTimeout(saveTimer);
  try {
    Object.keys(localStorage).filter((k) => k.startsWith("tracklog-")).forEach((k) => localStorage.removeItem(k));
  } catch { /* storage blocked */ }
}

/* ---------- Network ---------- */

class RateLimited extends Error {}

async function searchSongs(term) {
  const url = `https://itunes.apple.com/search?media=music&entity=song&limit=25&term=${encodeURIComponent(term)}`;
  let res;
  try {
    res = await fetch(url, { referrerPolicy: "no-referrer", credentials: "omit" });
  } catch {
    // A rate-limited response has no CORS header, so fetch throws a TypeError.
    throw new RateLimited("blocked");
  }
  if (res.status === 403 || res.status === 429) throw new RateLimited(String(res.status));
  if (!res.ok) return [];
  const data = await res.json().catch(() => null);
  const results = Array.isArray(data?.results) ? data.results : [];
  rememberAlbums(results);
  return results;
}

function pick(results, title, artist, album) {
  const want = core(title);
  const wantAlbum = core(album);
  const byArtist = results.filter((r) => sameArtist(r.artistName, artist));

  // 1. Same song
  const songs = byArtist.filter((r) => {
    const t = core(r.trackName);
    return t === want || (want.length > 3 && (t.startsWith(want) || want.startsWith(t)));
  });
  const score = (r) =>
    (core(r.trackName) === want ? 2 : 0) +
    (wantAlbum && core(r.collectionName) === wantAlbum ? 4 : 0) +
    (isVariant(r.trackName) || isVariant(r.collectionName) ? -5 : 0) +
    (/\b(single|ep)\b/i.test(r.collectionName) ? -1 : 0);
  songs.sort((a, b) => score(b) - score(a));
  if (songs[0] && score(songs[0]) >= 0) return bigger(songs[0].artworkUrl100);

  // 2. Same album, different song: same cover
  if (wantAlbum) {
    const sameAlbum = byArtist.find((r) => core(r.collectionName) === wantAlbum);
    if (sameAlbum) return bigger(sameAlbum.artworkUrl100);
  }
  return null;
}

async function findCover({ title, artist, album }) {
  let results = await searchSongs(`${core(title)} ${artist}`);
  let url = pick(results, title, artist, album);
  if (url || !album) return url;
  // Second try: search with the album name instead of the artist.
  const known = cache.albums[albumKey(album, artist)];
  if (known) return known;
  await wait(SPACING_MS);
  results = await searchSongs(`${core(title)} ${core(album)}`);
  return pick(results, title, artist, album);
}

/* ---------- Queue ---------- */

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const queue = [];
const waiting = new Map();
let activeGeneration = -1;   // which generation's loop is running, if any
let generation = 0;
let onProgress = () => {};
let done = 0;
let total = 0;

export function setProgressListener(fn) { onProgress = fn; }

function cached({ title, artist, album }) {
  const s = cache.songs[songKey(title, artist)];
  if (s !== undefined) return s;
  if (album) {
    const a = cache.albums[albumKey(album, artist)];
    if (a) return a;
  }
  return undefined;
}

function settle(job, url) {
  waiting.get(job.key)?.forEach((fn) => fn(url));
  waiting.delete(job.key);
  done++;
  onProgress(done, total);
}

// One loop at a time works through the queue. When a new library is loaded,
// cancelPending() bumps `generation`: the old loop stops at its next check
// (without touching the new progress count) and a new loop can start at once.
async function pump() {
  if (activeGeneration === generation) return;
  const gen = activeGeneration = generation;
  const current = () => gen === generation;
  while (queue.length && current()) {
    const job = queue.shift();
    const hit = cached(job);            // an earlier search may have found this album
    if (hit !== undefined) { settle(job, hit); continue; }
    try {
      const url = await findCover(job);
      cache.songs[job.key] = url;       // null = searched, nothing reliable found
      saveCache();
      if (!current()) break;
      settle(job, url);
    } catch (e) {
      if (!current()) break;
      if (e instanceof RateLimited && ++job.tries < MAX_TRIES) {
        queue.unshift(job);
        onProgress(done, total, "paused");
        await wait(BACKOFF_MS);
        continue;
      }
      settle(job, null);                // give up for now; not cached, so retried next visit
    }
    await wait(SPACING_MS);
  }
  if (activeGeneration === gen) activeGeneration = -1;
}

function find(song) {
  const hit = cached(song);
  if (hit !== undefined) return Promise.resolve(hit);
  const key = songKey(song.title, song.artist);
  return new Promise((resolve) => {
    if (!waiting.has(key)) {
      waiting.set(key, []);
      queue.push({ ...song, key, tries: 0 });
      total++;
      onProgress(done, total);
    }
    waiting.get(key).push(resolve);
    pump();
  });
}

/** Show a cover in a placeholder tile once it's found. */
export function attachArtwork(tile, { title, artist, album, url, lookup }) {
  if (!artEnabled() || !artist || artist === "Unknown artist") return;
  const show = (src) => {
    if (!src || !tile.isConnected) return;
    const img = new Image();
    img.alt = "";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    img.onload = () => {
      tile.textContent = "";
      tile.append(img);
      requestAnimationFrame(() => img.classList.add("ready"));
    };
    img.src = src;
  };
  // Wait a tick so the tile is on the page before the cover is added.
  if (url) return queueMicrotask(() => show(url));   // the sample library ships its covers
  if (!lookup || !title) return;
  find({ title, artist, album: album || "" }).then(show);
}

/** Drop queued lookups, e.g. when a different library is loaded. */
export function cancelPending() {
  generation++;
  queue.length = 0;
  waiting.clear();
  done = 0;
  total = 0;
  onProgress(0, 0);
}
