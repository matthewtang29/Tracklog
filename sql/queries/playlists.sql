-- Each playlist's total plays and its most-played song (window functions)
WITH ranked AS (
  SELECT p.name AS playlist,
         v.title AS top_title,
         v.artist AS top_artist,
         v.album AS top_album,
         ROW_NUMBER() OVER (PARTITION BY p.playlist_id
                            ORDER BY v.play_count DESC) AS rn,
         SUM(v.play_count) OVER (PARTITION BY p.playlist_id) AS plays,
         COUNT(*) OVER (PARTITION BY p.playlist_id) AS songs
  FROM playlists p
  JOIN playlist_tracks pt ON pt.playlist_id = p.playlist_id
  JOIN v_tracks v ON v.track_id = pt.track_id
)
SELECT playlist, songs, plays, top_title, top_artist, top_album
FROM ranked
WHERE rn = 1
ORDER BY plays DESC;
