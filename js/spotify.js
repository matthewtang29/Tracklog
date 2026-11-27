// spotify.js: reads the .json files in a Spotify data download, and makes the
// song keys that match the same song across Apple Music and Spotify.
// Loaded by worker.js with importScripts, so it's a plain script, not a module.
//
// A Spotify download is a ZIP of many .json files. The ones used here:
//   Streaming_History_Audio_*.json   "Extended streaming history" (whole account):
//       [{ ts, ms_played, master_metadata_track_name,
//          master_metadata_album_artist_name, master_metadata_album_album_name,
//          spotify_track_uri, reason_end, skipped, ... }]
//   StreamingHistory_music_*.json    "Account data" (past year):
//       [{ endTime, artistName, trackName, msPlayed }]
//   YourLibrary.json                 Liked Songs: { tracks: [{ artist, album, track, uri }] }
//   Playlist*.json                   { playlists: [{ name, items: [{ track: { trackName,
//                                       artistName, albumName, trackUri }, addedDate }] }] }
// Every other file (search history, payments, etc.) is ignored. Files are
// recognised by what's inside them, not by their names.
//
// Spotify has no play or skip counts, only a list of streams. Like Spotify's own
// charts, a stream of 30 seconds or more counts as a play; a shorter one counts
// as a skip. Listening time is the real time played.

/* ---------- Matching songs across services ---------- */

const normText = (s) => String(s || "").toLowerCase().normalize("NFKD")
  .replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// "Get You (feat. Kali Uchis)" and "Get You - Remastered 2011" -> "get you"
const coreTitle = (s) => normText(String(s || "")
  .replace(/\s*[(\[].*?[)\]]/g, "")
  .replace(/\s+(feat|ft|featuring)\.?\s.*$/i, "")
  .replace(/\s+-\s+.*$/, "")) || normText(s);

// "Daniel Caesar & H.E.R." and "Daniel Caesar, H.E.R." -> "daniel caesar"
const mainArtist = (s) => normText(String(s || "")
  .split(/\s*(?:,|&|\+|;|\/|\s(?:feat|ft|featuring)\.?\s|\sx\s|\swith\s)\s*/i)[0]) || normText(s);

/** The same song on Apple Music and Spotify gets the same key. */
const songKey = (title, artist) => coreTitle(title) + "|" + mainArtist(artist);
/** Artists are shared across everyone by this key; the first spelling seen is shown. */
const artistKey = (name) => normText(name);

/* ---------- Reading the files ---------- */

const str = (v) => typeof v === "string" && v.trim() ? v.trim() : null;
const num = (v) => {
  const n = typeof v === "number" ? v : (typeof v === "string" ? Number(v) : NaN);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
// "2024-03-01T18:04:11Z" or "2024-03-01 18:04" -> "2024-03-01 18:04:11"
function spDate(v) {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(v)) return null;
  const s = v.replace("T", " ").replace(/Z$/, "").slice(0, 19);
  return s.length === 16 ? s + ":00" : s.length === 10 ? s + " 00:00:00" : s;
}

const PLAY_MS = 30000;

/** What kind of Spotify file this is, from its contents. */
function spotifyKind(data) {
  if (Array.isArray(data)) {
    const first = data.find((x) => x && typeof x === "object");
    if (!first) return data.length ? null : "empty";
    if ("ts" in first && "ms_played" in first) return "extended";
    if ("endTime" in first && "msPlayed" in first) return "basic";
    return null;
  }
  if (data && typeof data === "object") {
    if (Array.isArray(data.playlists)) return "playlists";
    if (Array.isArray(data.tracks)) return "library";
  }
  return null;
}

/**
 * Turn one person's Spotify files into songs.
 * files: [{ name, data }] with data already JSON-parsed.
 * Returns { songs: Map(songKey -> song), playlists, used, ignored, streams, latest }.
 */
function readSpotify(files) {
  const songs = new Map();
  const playlists = [];
  const seenStreams = new Set();
  let used = 0;
  let ignored = 0;
  let streams = 0;
  let latest = null;

  const song = (title, artist, album, uri) => {
    const key = songKey(title, artist);
    let s = songs.get(key);
    if (!s) {
      s = { key, title, artist, album: album || null, uri: uri || null, plays: 0, skips: 0,
        listenedMs: 0, durationMs: 0, first: null, last: null, loved: false };
      songs.set(key, s);
    }
    if (!s.album && album) s.album = album;
    if (!s.uri && uri) s.uri = uri;
    return s;
  };
  const seen = (s, when) => {
    if (!when) return;
    if (!s.first || when < s.first) s.first = when;
  };

  const addStream = (title, artist, album, uri, ms, when) => {
    title = str(title); artist = str(artist);
    if (!title || !artist || ms == null || !when) return;   // podcasts, videos, damaged rows
    // The past-year and lifetime histories overlap; count each stream once.
    // (The past-year file only has the minute, so compare to the minute.)
    const id = when.slice(0, 16) + "\u0000" + songKey(title, artist) + "\u0000" + Math.round(ms / 1000);
    if (seenStreams.has(id)) return;
    seenStreams.add(id);
    streams++;
    const s = song(title, artist, str(album), str(uri));
    if (ms >= PLAY_MS) s.plays++; else s.skips++;
    s.listenedMs += ms;
    if (ms > s.durationMs) s.durationMs = ms;
    seen(s, when);
    if (!s.last || when > s.last) s.last = when;
    if (!latest || when > latest) latest = when;
  };

  for (const { data } of files) {
    const kind = spotifyKind(data);
    if (!kind) { ignored++; continue; }
    used++;
    if (kind === "extended") {
      for (const r of data) {
        if (!r || typeof r !== "object") continue;
        addStream(r.master_metadata_track_name, r.master_metadata_album_artist_name,
          r.master_metadata_album_album_name, r.spotify_track_uri, num(r.ms_played), spDate(r.ts));
      }
    } else if (kind === "basic") {
      for (const r of data) {
        if (!r || typeof r !== "object") continue;
        addStream(r.trackName, r.artistName, null, null, num(r.msPlayed), spDate(r.endTime));
      }
    } else if (kind === "library") {
      for (const t of data.tracks) {
        if (!t || typeof t !== "object" || !str(t.track) || !str(t.artist)) continue;
        song(str(t.track), str(t.artist), str(t.album), str(t.uri)).loved = true;
      }
    } else if (kind === "playlists") {
      for (const pl of data.playlists) {
        if (!pl || typeof pl !== "object" || !Array.isArray(pl.items)) continue;
        const keys = [];
        for (const item of pl.items) {
          const t = item && item.track;
          if (!t || typeof t !== "object" || !str(t.trackName) || !str(t.artistName)) continue;
          const s = song(str(t.trackName), str(t.artistName), str(t.albumName), str(t.trackUri));
          seen(s, spDate(item.addedDate));
          keys.push(s.key);
        }
        playlists.push({ name: str(pl.name) || "Untitled", keys });
      }
    }
  }
  return { songs, playlists, used, ignored, streams, latest };
}
