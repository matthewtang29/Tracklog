-- Choices for the "What's the vibe?" question: your playlists (5+ songs),
-- then your six biggest genres (5+ songs each).
SELECT kind, id, label, songs FROM (
  SELECT 'playlist' AS kind, p.playlist_id AS id, p.name AS label, COUNT(*) AS songs, 0 AS grp
  FROM playlists p
  JOIN playlist_tracks pt ON pt.playlist_id = p.playlist_id
  GROUP BY p.playlist_id
  HAVING COUNT(*) >= 5
  UNION ALL
  SELECT * FROM (
    SELECT 'genre', genre, genre, COUNT(*), 1
    FROM tracks
    WHERE genre IS NOT NULL AND genre <> ''
    GROUP BY genre
    HAVING COUNT(*) >= 5
    ORDER BY COUNT(*) DESC
    LIMIT 6
  )
)
ORDER BY grp, songs DESC;
