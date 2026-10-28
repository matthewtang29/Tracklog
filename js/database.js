// database.js: loads the .sql files, parses Apple's Library.xml, and builds
// an in-browser SQLite database with sql.js.

export const QUERY_NAMES = [
  "summary", "top_artists", "top_songs", "playlists",
  "genres", "forgotten", "most_skipped", "added_by_month",
];

export const EXAMPLE_FILES = [
  "01-loved-songs.sql",
  "02-albums-you-play-front-to-back.sql",
  "03-rank-songs-within-each-artist.sql",
  "04-never-played-by-artist.sql",
  "05-longest-songs-you-love.sql",
  "06-songs-in-the-most-playlists.sql",
];

const SKIP_PLAYLISTS = new Set([
  "Library", "Downloaded", "Music", "Music Videos", "Movies",
  "TV Shows", "Podcasts", "Audiobooks", "Purchased",
]);

async function fetchText(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Couldn't load ${path} (${res.status})`);
  return res.text();
}

/** Load schema.sql, every card query, and the example queries. */
export async function loadSqlFiles() {
  const schema = await fetchText("sql/schema.sql");
  const queries = Object.fromEntries(await Promise.all(
    QUERY_NAMES.map(async (name) => [name, await fetchText(`sql/queries/${name}.sql`)])
  ));
  const examples = await Promise.all(EXAMPLE_FILES.map(async (file) => {
    const sql = await fetchText(`sql/examples/${file}`);
    const firstLine = sql.split("\n")[0];
    const label = firstLine.startsWith("--") ? firstLine.slice(2).trim() : file;
    return { label, sql: sql.split("\n").slice(1).join("\n").trim() };
  }));
  return { schema, queries, examples };
}

/* ---------- Parse Apple's plist XML ---------- */

function plistValue(el) {
  switch (el.tagName) {
    case "dict": {
      const obj = {};
      const kids = el.children;
      for (let i = 0; i < kids.length; i += 2) {
        obj[kids[i].textContent] = kids[i + 1] ? plistValue(kids[i + 1]) : null;
      }
      return obj;
    }
    case "array": return Array.from(el.children, plistValue);
    case "integer": return parseInt(el.textContent, 10);
    case "real": return parseFloat(el.textContent);
    case "true": return true;
    case "false": return false;
    case "date": return el.textContent.replace("T", " ").replace("Z", "");
    default: return el.textContent;
  }
}

export function parseLibrary(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("This file isn't valid XML. Export it again with File → Library → Export Library.");
  }
  const root = doc.querySelector("plist > dict");
  if (!root) throw new Error("This doesn't look like an Apple Music library export.");
  const lib = plistValue(root);
  if (!lib.Tracks) throw new Error("No songs found. Make sure you used Export Library, not Export Playlist.");
  return lib;
}

/* ---------- Build the SQLite database ---------- */

export function buildDatabase(SQL, schema, lib) {
  const db = new SQL.Database();
  db.run(schema);
  db.run("BEGIN");

  const artistIds = new Map();
  const albumIds = new Map();
  const trackIds = new Map(); // Apple's per-file Track ID -> stable Persistent ID

  const insArtist = db.prepare("INSERT INTO artists(name) VALUES (?)");
  const insAlbum = db.prepare("INSERT INTO albums(name, artist_id, year) VALUES (?, ?, ?)");
  const insTrack = db.prepare("INSERT OR IGNORE INTO tracks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const lastId = () => db.exec("SELECT last_insert_rowid()")[0].values[0][0];

  let count = 0;
  for (const t of Object.values(lib.Tracks)) {
    if (!t || !t.Name) continue;
    const kind = String(t.Kind || "");
    if (t.Podcast || t["Music Video"] || t.Movie || t["TV Show"] || /video|podcast|book/i.test(kind)) continue;

    const trackId = t["Persistent ID"] || String(t["Track ID"]);
    trackIds.set(t["Track ID"], trackId);

    const artist = t["Album Artist"] || t.Artist || "Unknown artist";
    let artistId = artistIds.get(artist);
    if (artistId == null) {
      insArtist.run([artist]);
      artistId = lastId();
      artistIds.set(artist, artistId);
    }

    let albumId = null;
    if (t.Album) {
      const key = artistId + "\u0000" + t.Album;
      albumId = albumIds.get(key);
      if (albumId == null) {
        insAlbum.run([t.Album, artistId, t.Year || null]);
        albumId = lastId();
        albumIds.set(key, albumId);
      }
    }

    insTrack.run([
      trackId, t.Name, artistId, albumId, t.Genre || null, t["Total Time"] || 0,
      t["Date Added"] || null, t["Play Count"] || 0, t["Skip Count"] || 0,
      t["Play Date UTC"] || null, (t.Loved || t.Favorited) ? 1 : 0,
    ]);
    count++;
  }
  insArtist.free(); insAlbum.free(); insTrack.free();

  const insPlaylist = db.prepare("INSERT OR REPLACE INTO playlists VALUES (?, ?)");
  const insPlaylistTrack = db.prepare("INSERT OR IGNORE INTO playlist_tracks VALUES (?, ?, ?)");
  for (const pl of lib.Playlists || []) {
    if (!pl || pl.Master || pl["Distinguished Kind"] != null || pl.Folder || SKIP_PLAYLISTS.has(pl.Name)) continue;
    const playlistId = pl["Playlist Persistent ID"] || String(pl["Playlist ID"]);
    insPlaylist.run([playlistId, pl.Name || "Untitled"]);
    (pl["Playlist Items"] || []).forEach((item, i) => {
      const trackId = trackIds.get(item["Track ID"]);
      if (trackId) insPlaylistTrack.run([playlistId, trackId, i + 1]);
    });
  }
  insPlaylist.free(); insPlaylistTrack.free();

  db.run("COMMIT");
  if (!count) throw new Error("No songs found in this file.");
  return db;
}

/** Run SQL and return { columns, rows } with each row as an object. */
export function runQuery(db, sql, params) {
  const res = db.exec(sql, params || {});
  if (!res.length) return { columns: [], rows: [] };
  const { columns, values } = res[res.length - 1];
  return {
    columns,
    rows: values.map((v) => Object.fromEntries(columns.map((c, i) => [c, v[i]]))),
  };
}
