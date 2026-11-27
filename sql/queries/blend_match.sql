-- Blend: how alike each pair of people listens, across Apple Music and Spotify.
-- :members  comma-separated listener_ids in the blend
-- Each person's listening time is split by artist (shares add up to 1).
-- The match is the Bhattacharyya coefficient of the two splits,
-- SUM(sqrt(share_a * share_b)): 100% means the same artists in the same amounts,
-- 0% means no artist in common.
WITH m AS (
  SELECT listener_id, name FROM listeners
  WHERE instr(',' || :members || ',', ',' || listener_id || ',') > 0
),
artist_time AS (
  SELECT t.listener_id, t.artist_id, SUM(t.listened_ms) AS ms
  FROM all_tracks t JOIN m ON m.listener_id = t.listener_id
  WHERE t.listened_ms > 0
  GROUP BY 1, 2
),
shares AS (
  SELECT listener_id, artist_id, 1.0 * ms / SUM(ms) OVER (PARTITION BY listener_id) AS share
  FROM artist_time
),
pairs AS (
  SELECT a.listener_id AS a_id, b.listener_id AS b_id,
         SUM(sqrt(a.share * b.share)) AS match,
         COUNT(*) AS shared_artists
  FROM shares a
  JOIN shares b ON b.artist_id = a.artist_id AND b.listener_id > a.listener_id
  GROUP BY 1, 2
),
songs AS (
  SELECT a.listener_id AS a_id, b.listener_id AS b_id, COUNT(DISTINCT a.song_key) AS shared_songs
  FROM all_tracks a
  JOIN all_tracks b ON b.song_key = a.song_key AND b.listener_id > a.listener_id
  WHERE a.play_count > 0 AND b.play_count > 0
    AND a.listener_id IN (SELECT listener_id FROM m) AND b.listener_id IN (SELECT listener_id FROM m)
  GROUP BY 1, 2
)
SELECT ma.listener_id AS a_id, ma.name AS a_name, mb.listener_id AS b_id, mb.name AS b_name,
       ROUND(100 * COALESCE(p.match, 0)) AS match_pct,
       COALESCE(p.shared_artists, 0) AS shared_artists,
       COALESCE(s.shared_songs, 0) AS shared_songs
FROM m ma
JOIN m mb ON mb.listener_id > ma.listener_id
LEFT JOIN pairs p ON p.a_id = ma.listener_id AND p.b_id = mb.listener_id
LEFT JOIN songs s ON s.a_id = ma.listener_id AND s.b_id = mb.listener_id
ORDER BY match_pct DESC;
