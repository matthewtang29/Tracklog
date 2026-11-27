// worker.js: everything heavy runs here, off the page's main thread, so the
// page stays responsive. It reads each person's files (Apple Music Library.xml
// in chunks, Spotify .json), builds one SQLite database for everyone, and
// answers SQL queries. database.js is the page's side of it.
//
// Messages in:  { id, type: "build", schema, people }       -> { bytes, stats }
//                 people: [{ name, files: [File] }] or, for the sample,
//                         [{ name, apple: lib, spotify: [{ name, data }] }]
//               { id, type: "open", bytes }                  (reload after a stopped query)
//               { id, type: "query", sql, params }          -> { columns, rows }
// Progress out: { id, progress: 0..1 } while reading files.

importScripts("../vendor/sql.js/sql-asm-memory-growth.js", "plist.js", "spotify.js");

const sqlReady = initSqlJs();
let db = null;

// Errors meant for the person using the page (everything else gets wrapped).
class UserError extends Error {}

const REEXPORT = "Export it again from the Music app (Mac) or iTunes (Windows) with File → Library → Export Library.";

const SKIP_PLAYLISTS = new Set([
  "Library", "Downloaded", "Music", "Music Videos", "Movies",
  "TV Shows", "Podcasts", "Audiobooks", "Purchased",
]);

/* ---------- Reading the files ---------- */

const SPOTIFY_AGAIN = "Download it again from your Spotify account's Privacy page, unzip it, and upload the .json files inside.";

async function readLibrary(file, onBytes) {
  const parser = new PlistStream();
  const decoder = new TextDecoder("utf-8");
  const reader = file.stream().getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      onBytes(value.byteLength);
      parser.write(decoder.decode(value, { stream: true }));
    }
    parser.write(decoder.decode());
    const root = parser.end();
    if (!isDict(root)) throw new UserError(`${file.name} doesn't look like an Apple Music library export. ` + REEXPORT);
    if (!isDict(root.Tracks)) throw new UserError(`No songs found in ${file.name}. Make sure you used Export Library, not Export Playlist.`);
    return root;
  } catch (e) {
    if (e instanceof PlistError) throw new UserError(`${file.name} can't be read: ${e.message}. ${REEXPORT}`);
    throw e;
  } finally {
    reader.cancel().catch(() => {});
  }
}

async function readJson(file, onBytes) {
  const raw = await file.text();
  onBytes(file.size);
  try {
    return JSON.parse(raw);
  } catch {
    throw new UserError(`${file.name} isn't readable JSON. ${SPOTIFY_AGAIN}`);
  }
}

/** Read one person's files into { apple: [lib], spotify: [{ name, data }] }. */
async function readPerson(person, onBytes) {
  const apple = person.apple ? [person.apple] : [];
  const spotify = person.spotify ? [...person.spotify] : [];
  for (const file of person.files || []) {
    if (/\.xml$/i.test(file.name)) apple.push(await readLibrary(file, onBytes));
    else spotify.push({ name: file.name, data: await readJson(file, onBytes) });
  }
  return { apple, spotify };
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
  const artist = text(t["Album Artist"]) || text(t.Artist) || "Unknown artist";
  const plays = count(t["Play Count"]);
  const duration = count(t["Total Time"]);
  return {
    appleId,
    id: text(t["Persistent ID"]) || appleId,
    // Matched on the song's own artist: Album Artist can be "Various Artists".
    key: songKey(title, text(t.Artist) || artist),
    title,
    artist,
    album: text(t.Album),
    year: year(t.Year),
    genre: text(t.Genre),
    duration,
    added: date(t["Date Added"]),
    plays,
    skips: count(t["Skip Count"]),
    lastPlayed: date(t["Play Date UTC"]),
    loved: t.Loved === true || t.Favorited === true ? 1 : 0,
    listenedMs: plays * duration,
    source: "apple",
  };
}

/* ---------- Building the database ---------- */

const later = (a, b) => (!a ? b : !b ? a : a > b ? a : b);
const earlier = (a, b) => (!a ? b : !b ? a : a < b ? a : b);

function buildDatabase(SQL, schema, people) {
  const database = new SQL.Database();
  const statements = [];
  const prepare = (sql) => { const s = database.prepare(sql); statements.push(s); return s; };
  const freeAll = () => statements.splice(0).forEach((s) => { try { s.free(); } catch { /* already freed */ } });
  try {
    database.run(schema);
    database.run("BEGIN");

    const artistIds = new Map();   // artistKey -> artist_id, shared by everyone
    const albumIds = new Map();
    const insListener = prepare("INSERT INTO listeners VALUES (?, ?, ?, ?)");
    const insArtist = prepare("INSERT OR IGNORE INTO artists(name) VALUES (?)");
    const findArtist = prepare("SELECT artist_id FROM artists WHERE name = ?");
    const insAlbum = prepare("INSERT OR IGNORE INTO albums(name, artist_id, year) VALUES (?, ?, ?)");
    const findAlbum = prepare("SELECT album_id FROM albums WHERE name = ? AND artist_id = ?");
    const insTrack = prepare(`INSERT OR IGNORE INTO all_tracks(track_id, listener_id, song_key, title, artist_id,
      album_id, genre, duration_ms, date_added, play_count, skip_count, last_played, loved, listened_ms, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insPlaylist = prepare("INSERT OR REPLACE INTO all_playlists VALUES (?, ?, ?)");
    const insPlaylistTrack = prepare("INSERT OR IGNORE INTO playlist_tracks VALUES (?, ?, ?)");
    const one = (stmt, args) => { stmt.bind(args); const v = stmt.step() ? stmt.get()[0] : null; stmt.reset(); return v; };

    // An artist is matched on their main name, so "Daniel Caesar & H.E.R." on
    // one service and "Daniel Caesar" on the other are the same artist. The name
    // shown is a solo credit when there is one (picked before inserting).
    const artistNames = new Map();   // main-artist key -> name to show
    const noteArtist = (name) => {
      const key = mainArtist(name) || name;
      const shown = artistNames.get(key);
      if (!shown || (artistKey(name) === key && artistKey(shown) !== key)) artistNames.set(key, name);
    };
    const artistId = (name) => {
      const key = mainArtist(name) || name;
      let id = artistIds.get(key);
      if (id == null) {
        const shown = artistNames.get(key) || name;
        insArtist.run([shown]);
        id = one(findArtist, [shown]);
        artistIds.set(key, id);
      }
      return id;
    };
    const albumId = (name, artist, yr) => {
      if (!name) return null;
      const key = artist + "\u0000" + normText(name);
      let id = albumIds.get(key);
      if (id == null) {
        insAlbum.run([name, artist, yr]);
        id = one(findAlbum, [name, artist]);
        albumIds.set(key, id);
      }
      return id;
    };

    const stats = [];
    const ready = [];   // everyone's rows, inserted once every artist's name is known
    people.forEach((person, index) => {
      const lid = index + 1;
      const prefix = `L${lid}:`;
      const rows = new Map();        // track_id -> row
      const byKey = new Map();       // songKey -> row, to merge Spotify into Apple
      const appleIds = new Map();    // Apple Track ID -> track_id
      const lists = [];              // { id, name, trackIds }
      let skipped = 0;
      let items = 0;
      let exportDate = null;

      person.apple.forEach((lib, n) => {
        const entries = isDict(lib.Tracks) ? Object.values(lib.Tracks) : [];
        items += entries.length;
        const tag = n ? `${prefix}a${n}:` : prefix;
        for (const t of entries) {
          const row = isDict(t) ? trackRow(t) : null;
          if (row === "skip") continue;              // podcasts, videos: not an error
          if (!row || !row.id) { skipped++; continue; }
          row.id = tag + row.id;
          if (rows.has(row.id)) continue;
          rows.set(row.id, row);
          if (!byKey.has(row.key)) byKey.set(row.key, row);
          if (row.appleId) appleIds.set(tag + row.appleId, row.id);
        }
        exportDate = later(exportDate, date(lib.Date));
        for (const pl of Array.isArray(lib.Playlists) ? lib.Playlists : []) {
          if (!isDict(pl) || pl.Master === true || pl["Distinguished Kind"] != null || pl.Folder === true) continue;
          const name = text(pl.Name) || "Untitled";
          if (SKIP_PLAYLISTS.has(name)) continue;
          const id = text(pl["Playlist Persistent ID"]) || text(pl["Playlist ID"]);
          if (!id) continue;
          const plItems = Array.isArray(pl["Playlist Items"]) ? pl["Playlist Items"] : [];
          lists.push({ id: tag + id, name, trackIds: plItems.map((item) => isDict(item) && appleIds.get(tag + text(item["Track ID"]))) });
        }
      });

      let spotifyUsed = 0;
      let spotifyIgnored = 0;
      let streams = 0;
      if (person.spotify.length) {
        const sp = readSpotify(person.spotify);
        spotifyUsed = sp.used;
        spotifyIgnored = sp.ignored;
        streams = sp.streams;
        if (!sp.used) {
          throw new UserError(`${person.name}: none of these .json files are Spotify listening history, ` +
            `Liked Songs or playlists. ${SPOTIFY_AGAIN}`);
        }
        exportDate = later(exportDate, sp.latest);
        for (const s of sp.songs.values()) {
          const added = s.first || s.last;
          const match = byKey.get(s.key);
          if (match) {
            // Same song in their Apple library: add the Spotify listening to it.
            match.plays += s.plays;
            match.skips += s.skips;
            match.listenedMs += s.listenedMs;
            match.lastPlayed = later(match.lastPlayed, s.last);
            match.added = earlier(match.added, added);
            match.loved = match.loved || s.loved ? 1 : 0;
            if (match.source === "apple") match.source = "both";
            continue;
          }
          const row = {
            id: prefix + "sp:" + (s.uri || s.key), key: s.key, title: s.title, artist: s.artist, album: s.album,
            year: null, genre: null, duration: s.durationMs, added, plays: s.plays, skips: s.skips,
            lastPlayed: s.last, loved: s.loved ? 1 : 0, listenedMs: s.listenedMs, source: "spotify",
          };
          if (rows.has(row.id)) row.id = prefix + "sp:" + s.key;
          rows.set(row.id, row);
          byKey.set(s.key, row);
        }
        sp.playlists.forEach((pl, i) => {
          lists.push({ id: `${prefix}sp${i + 1}`, name: pl.name, trackIds: pl.keys.map((k) => byKey.get(k)?.id) });
        });
      }

      if (!rows.size) {
        throw new UserError(skipped
          ? `${person.name}: none of the songs could be read (${skipped.toLocaleString("en")} damaged). ${REEXPORT}`
          : `${person.name}: no songs found. For Apple Music, use Export Library, not Export Playlist. ` +
            "For Spotify, include the Streaming_History or StreamingHistory .json files.");
      }

      const sources = [person.apple.length && "Apple Music", spotifyUsed && "Spotify"].filter(Boolean).join(" + ");
      exportDate = (exportDate || new Date().toISOString()).slice(0, 10);
      for (const r of rows.values()) noteArtist(r.artist);
      ready.push({ lid, rows, lists, stat: { id: lid, name: person.name, sources, songs: rows.size, items, skipped,
        streams, spotifyFiles: spotifyUsed, ignoredFiles: spotifyIgnored, exportDate } });
    });

    for (const { lid, rows, lists, stat } of ready) {
      insListener.run([lid, stat.name, stat.sources, stat.exportDate]);
      for (const r of rows.values()) {
        const aid = artistId(r.artist);
        insTrack.run([r.id, lid, r.key, r.title, aid, albumId(r.album, aid, r.year), r.genre, r.duration,
          r.added, r.plays, r.skips, r.lastPlayed, r.loved, r.listenedMs, r.source]);
      }
      let playlists = 0;
      for (const pl of lists) {
        insPlaylist.run([pl.id, lid, pl.name]);
        playlists++;
        pl.trackIds.forEach((trackId, i) => { if (trackId) insPlaylistTrack.run([pl.id, trackId, i + 1]); });
      }
      stats.push({ ...stat, playlists });
    }

    freeAll();
    database.run("COMMIT");
    return { database, stats: { people: stats } };
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
  return `Something went wrong while reading these files (${detail}). Try exporting them again.`;
}

self.onmessage = async ({ data: msg }) => {
  const { id } = msg;
  try {
    const SQL = await sqlReady;
    if (msg.type === "build") {
      const total = msg.people.reduce((n, p) => n + (p.files || []).reduce((m, f) => m + f.size, 0), 0) || 1;
      let read = 0;
      let lastReport = 0;
      const onBytes = (n) => {
        read += n;
        const now = Date.now();
        if (now - lastReport > 100) { lastReport = now; self.postMessage({ id, progress: Math.min(1, read / total) }); }
      };
      const people = [];
      for (const p of msg.people) people.push({ name: p.name, ...(await readPerson(p, onBytes)) });
      self.postMessage({ id, progress: 1, phase: "building" });
      const { database, stats } = buildDatabase(SQL, msg.schema, people);
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
