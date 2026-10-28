-- Tracklog database schema
-- Built in the browser from an Apple Music Library.xml export.

CREATE TABLE artists (
  artist_id INTEGER PRIMARY KEY,
  name      TEXT NOT NULL UNIQUE
);
CREATE TABLE albums (
  album_id  INTEGER PRIMARY KEY,
  name      TEXT NOT NULL,
  artist_id INTEGER REFERENCES artists(artist_id),
  year      INTEGER,
  UNIQUE (name, artist_id)
);
CREATE TABLE tracks (
  track_id    TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  artist_id   INTEGER REFERENCES artists(artist_id),
  album_id    INTEGER REFERENCES albums(album_id),
  genre       TEXT,
  duration_ms INTEGER,
  date_added  TEXT,
  play_count  INTEGER NOT NULL DEFAULT 0,
  skip_count  INTEGER NOT NULL DEFAULT 0,
  last_played TEXT,
  loved       INTEGER DEFAULT 0
);
CREATE TABLE playlists (
  playlist_id TEXT PRIMARY KEY,
  name        TEXT NOT NULL
);
CREATE TABLE playlist_tracks (
  playlist_id TEXT REFERENCES playlists(playlist_id),
  track_id    TEXT REFERENCES tracks(track_id),
  position    INTEGER,
  PRIMARY KEY (playlist_id, track_id)
);
CREATE VIEW v_tracks AS
SELECT t.*, ar.name AS artist, al.name AS album,
       t.play_count * t.duration_ms / 3600000.0 AS hours_listened
FROM tracks t
LEFT JOIN artists ar ON ar.artist_id = t.artist_id
LEFT JOIN albums  al ON al.album_id  = t.album_id;
