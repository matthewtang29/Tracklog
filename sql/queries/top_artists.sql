-- Top artists by hours listened (play count x song length),
-- with each artist's most-played song, used for their picture
WITH per_artist AS (
  SELECT artist,
         SUM(hours_listened) AS hours,
         ROW_NUMBER() OVER (PARTITION BY artist ORDER BY play_count DESC) AS rn,
         title, album
  FROM v_tracks
  GROUP BY artist, track_id
)
SELECT a.artist,
       ROUND(SUM(a.hours), 1) AS hours,
       MAX(CASE WHEN a.rn = 1 THEN a.title END) AS top_title,
       MAX(CASE WHEN a.rn = 1 THEN a.album END) AS top_album
FROM per_artist a
GROUP BY a.artist
HAVING hours > 0
ORDER BY hours DESC
LIMIT 10;
