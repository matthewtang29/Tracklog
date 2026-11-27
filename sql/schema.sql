-- Tracklog database schema
-- Built in the browser from Apple Music Library.xml exports and Spotify data
-- downloads (.json). Several people can be loaded at once for a Blend.
--
-- The dashboard shows one person at a time: `tracks`, `v_tracks` and
-- `playlists` are views that only show the person picked in `viewing`.
-- `all_tracks`, `v_all_tracks` and `all_playlists` hold everyone.

CREATE TABLE listeners (
  listener_id INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  sources     TEXT,            -- 'Apple Music', 'Spotify' or 'Apple Music + Spotify'
  export_date TEXT             -- newest date in their files
);
CREATE TABLE viewing (listener_id INTEGER);   -- one row: who the dashboard shows
INSERT INTO viewing VALUES (1);

CREATE TABLE artists (
  artist_id INTEGER PRIMARY KEY,
  name      TEXT NOT NULL UNIQUE  -- shared by everyone, so Blend can compare
);
CREATE TABLE albums (
  album_id  INTEGER PRIMARY KEY,
  name      TEXT NOT NULL,
  artist_id INTEGER REFERENCES artists(artist_id),
  year      INTEGER,
  UNIQUE (name, artist_id)
);
CREATE TABLE all_tracks (
  track_id    TEXT PRIMARY KEY,
  listener_id INTEGER REFERENCES listeners(listener_id),
  song_key    TEXT NOT NULL,     -- cleaned "title|main artist", matches a song across Apple and Spotify
  title       TEXT NOT NULL,
  artist_id   INTEGER REFERENCES artists(artist_id),
  album_id    INTEGER REFERENCES albums(album_id),
  genre       TEXT,
  duration_ms INTEGER,
  date_added  TEXT,              -- Spotify songs: the first time it was played or saved
  play_count  INTEGER NOT NULL DEFAULT 0,
  skip_count  INTEGER NOT NULL DEFAULT 0,
  last_played TEXT,
  loved       INTEGER DEFAULT 0, -- Apple: Loved/Favorited. Spotify: Liked Songs
  listened_ms INTEGER NOT NULL DEFAULT 0,
  source      TEXT               -- 'apple', 'spotify' or 'both'
);
CREATE INDEX all_tracks_listener ON all_tracks(listener_id, listened_ms);
CREATE INDEX all_tracks_song ON all_tracks(song_key);

CREATE TABLE all_playlists (
  playlist_id TEXT PRIMARY KEY,
  listener_id INTEGER REFERENCES listeners(listener_id),
  name        TEXT NOT NULL
);
CREATE TABLE playlist_tracks (
  playlist_id TEXT REFERENCES all_playlists(playlist_id),
  track_id    TEXT REFERENCES all_tracks(track_id),
  position    INTEGER,
  PRIMARY KEY (playlist_id, track_id)
);

CREATE VIEW v_all_tracks AS
SELECT t.*, ar.name AS artist, al.name AS album,
       t.listened_ms / 3600000.0 AS hours_listened
FROM all_tracks t
LEFT JOIN artists ar ON ar.artist_id = t.artist_id
LEFT JOIN albums  al ON al.album_id  = t.album_id;

-- The person the dashboard is showing
CREATE VIEW tracks AS
SELECT * FROM all_tracks WHERE listener_id = (SELECT listener_id FROM viewing);
CREATE VIEW v_tracks AS
SELECT * FROM v_all_tracks WHERE listener_id = (SELECT listener_id FROM viewing);
CREATE VIEW playlists AS
SELECT playlist_id, name FROM all_playlists WHERE listener_id = (SELECT listener_id FROM viewing);
