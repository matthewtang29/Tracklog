// worker.js: everything heavy runs here, off the page's main thread, so the
// page stays responsive. It reads Library.xml in chunks, builds the SQLite
// database, and answers SQL queries. db-client.js is the page's side of it.
//
// Messages in:  { id, type: "build", schema, file | lib }  -> { bytes, stats }
//               { id, type: "open", bytes }                  (reload after a stopped query)
//               { id, type: "query", sql, params }          -> { columns, rows }
// Progress out: { id, progress: 0..1 } while reading a file.

importScripts("../vendor/sql.js/sql-asm-memory-growth.js", "plist.js");

const sqlReady = initSqlJs();
let db = null;

// Errors meant for the person using the page (everything else gets wrapped).
class UserError extends Error {}

const REEXPORT = "Export it again from the Music app (Mac) or iTunes (Windows) with File → Library → Export Library.";

const SKIP_PLAYLISTS = new Set([
  "Library", "Downloaded", "Music", "Music Videos", "Movies",
  "TV Shows", "Podcasts", "Audiobooks", "Purchased",
]);

/* ---------- Reading the file ---------- */

async function readLibrary(file, onProgress) {
  const parser = new PlistStream();
  const decoder = new TextDecoder("utf-8");
  const reader = file.stream().getReader();
  let read = 0;
  let lastReport = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      read += value.byteLength;
      parser.write(decoder.decode(value, { stream: true }));
      const now = Date.now();
      if (now - lastReport > 100) { lastReport = now; onProgress(read / (file.size || 1)); }
    }
    parser.write(decoder.decode());
    const root = parser.end();
    if (!isDict(root)) throw new UserError("This doesn't look like an Apple Music library export. " + REEXPORT);
    if (!isDict(root.Tracks)) throw new UserError("No songs found. Make sure you used Export Library, not Export Playlist.");
    return root;
  } catch (e) {
    if (e instanceof PlistError) throw new UserError(`This file can't be read: ${e.message}. ${REEXPORT}`);
    throw e;
  } finally {
    reader.cancel().catch(() => {});
  }
}

/* ---------- Turning plist values into clean rows ----------
   A real export has the right types, but a damaged or hand-edited file might
   have a dict where a name should be, text where a number should be, and so on.
   Every field is checked so one bad song is skipped instead of failing the file. */

const isDict = (v) => v != null && typeof v === "object" && !Array.isArray(v);
const text = (v) => typeof v === "string" ? v : (typeof v === "number" && Number.isFinite(v) ? String(v) : null);
function count(v) {
  const n = typeof v === "number" ? v : (typeof v === "string" ? Number(v) : NaN);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), Number.MAX_SAFE_INTEGER) : 0;
}
function year(v) {
  const n = count(v);
  return n >= 1000 && n <= 3000 ? n : null;
}
// Apple writes dates as 2026-10-23T18:04:11Z; SQLite's date functions want "2026-10-23 18:04:11".
function date(v) {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(v)) return null;
  return v.slice(0, 19).replace("T", " ");
}

function trackRow(t) {
  const title = text(t.Name);
  if (!title) return null;
  const kind = text(t.Kind) || "";
  if (t.Podcast === true || t["Music Video"] === true || t.Movie === true || t["TV Show"] === true ||
      /video|podcast|book/i.test(kind)) return "skip";
  const appleId = text(t["Track ID"]);
  return {
    appleId,
    id: text(t["Persistent ID"]) || appleId,
    title,
    artist: text(t["Album Artist"]) || text(t.Artist) || "Unknown artist",
    album: text(t.Album),
    year: year(t.Year),
    genre: text(t.Genre),
    duration: count(t["Total Time"]),
    added: date(t["Date Added"]),
    plays: count(t["Play Count"]),
    skips: count(t["Skip Count"]),
    lastPlayed: date(t["Play Date UTC"]),
    loved: t.Loved === true || t.Favorited === true ? 1 : 0,
  };
}

/* ---------- Building the database ---------- */

function buildDatabase(SQL, schema, lib) {
  const database = new SQL.Database();
  const statements = [];
  const prepare = (sql) => { const s = database.prepare(sql); statements.push(s); return s; };
  const freeAll = () => statements.splice(0).forEach((s) => { try { s.free(); } catch { /* already freed */ } });
  try {
    database.run(schema);
    database.run("BEGIN");

    const artistIds = new Map();
    const albumIds = new Map();
    const trackIds = new Map(); // Apple's per-file Track ID -> stable Persistent ID

    const insArtist = prepare("INSERT INTO artists(name) VALUES (?)");
    const insAlbum = prepare("INSERT INTO albums(name, artist_id, year) VALUES (?, ?, ?)");
    const insTrack = prepare("INSERT OR IGNORE INTO tracks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    const lastId = () => database.exec("SELECT last_insert_rowid()")[0].values[0][0];

    const entries = Object.values(lib.Tracks);
    let songs = 0;
    let skipped = 0;
    for (const t of entries) {
      const row = isDict(t) ? trackRow(t) : null;
      if (row === "skip") continue;              // podcasts, videos: not an error
      if (!row || !row.id) { skipped++; continue; }
      if (row.appleId) trackIds.set(row.appleId, row.id);

      let artistId = artistIds.get(row.artist);
      if (artistId == null) {
        insArtist.run([row.artist]);
        artistId = lastId();
        artistIds.set(row.artist, artistId);
      }
      let albumId = null;
      if (row.album) {
        const key = artistId + "\u0000" + row.album;
        albumId = albumIds.get(key);
        if (albumId == null) {
          insAlbum.run([row.album, artistId, row.year]);
          albumId = lastId();
          albumIds.set(key, albumId);
        }
      }
      insTrack.run([row.id, row.title, artistId, albumId, row.genre, row.duration,
        row.added, row.plays, row.skips, row.lastPlayed, row.loved]);
      songs++;
    }

    const insPlaylist = prepare("INSERT OR REPLACE INTO playlists VALUES (?, ?)");
    const insPlaylistTrack = prepare("INSERT OR IGNORE INTO playlist_tracks VALUES (?, ?, ?)");
    let playlists = 0;
    for (const pl of Array.isArray(lib.Playlists) ? lib.Playlists : []) {
      if (!isDict(pl) || pl.Master === true || pl["Distinguished Kind"] != null || pl.Folder === true) continue;
      const name = text(pl.Name) || "Untitled";
      if (SKIP_PLAYLISTS.has(name)) continue;
      const playlistId = text(pl["Playlist Persistent ID"]) || text(pl["Playlist ID"]);
      if (!playlistId) continue;
      insPlaylist.run([playlistId, name]);
      playlists++;
      const items = Array.isArray(pl["Playlist Items"]) ? pl["Playlist Items"] : [];
      items.forEach((item, i) => {
        const trackId = isDict(item) && trackIds.get(text(item["Track ID"]));
        if (trackId) insPlaylistTrack.run([playlistId, trackId, i + 1]);
      });
    }

    freeAll();
    database.run("COMMIT");
    if (!songs) {
      throw new UserError(skipped
        ? `None of the songs in this file could be read (${skipped.toLocaleString("en")} damaged). ${REEXPORT}`
        : "No songs found in this file. Make sure you used Export Library, not Export Playlist.");
    }
    const exportDate = date(lib.Date)?.slice(0, 10) || new Date().toISOString().slice(0, 10);
    return { database, stats: { items: entries.length, songs, skipped, playlists, exportDate } };
  } catch (e) {
    freeAll();
    try { database.run("ROLLBACK"); } catch { /* no open transaction */ }
    database.close();
    throw e;
  }
}

/* ---------- Queries ---------- */

function runQuery(sql, params) {
  if (!db) throw new UserError("No library is loaded yet.");
  const res = db.exec(sql, params || {});
  if (!res.length) return { columns: [], rows: [] };
  const { columns, values } = res[res.length - 1];
  return { columns, rows: values.map((v) => Object.fromEntries(columns.map((c, i) => [c, v[i]]))) };
}

/* ---------- Messages ---------- */

// sql.js sometimes throws a bare string or an Error with no message.
function describe(e) {
  if (e instanceof UserError) return e.message;
  const detail = (e && e.message) || (typeof e === "string" ? e : "") || "unknown error";
  return `Something went wrong while reading this file (${detail}). ${REEXPORT}`;
}

self.onmessage = async ({ data: msg }) => {
  const { id } = msg;
  try {
    const SQL = await sqlReady;
    if (msg.type === "build") {
      const lib = msg.file
        ? await readLibrary(msg.file, (p) => self.postMessage({ id, progress: p }))
        : msg.lib;
      self.postMessage({ id, progress: 1, phase: "building" });
      const { database, stats } = buildDatabase(SQL, msg.schema, lib);
      if (db) db.close();
      db = database;
      const bytes = db.export();
      self.postMessage({ id, ok: true, result: { bytes, stats } }, [bytes.buffer]);
    } else if (msg.type === "open") {
      if (db) db.close();
      db = new SQL.Database(msg.bytes);
      self.postMessage({ id, ok: true, result: null });
    } else if (msg.type === "query") {
      // SQL errors from the console are shown as-is ("no such column: x").
      try {
        const result = runQuery(msg.sql, msg.params);
        result.total = result.rows.length;
        if (msg.maxRows && result.rows.length > msg.maxRows) result.rows.length = msg.maxRows;
        self.postMessage({ id, ok: true, result });
      } catch (e) {
        self.postMessage({ id, ok: false, error: (e && e.message) || String(e) || "SQL error" });
      }
    }
  } catch (e) {
    self.postMessage({ id, ok: false, error: describe(e) });
  }
};
