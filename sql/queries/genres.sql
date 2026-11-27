-- Top genres by hours listened (Spotify exports have no genres)
SELECT genre, ROUND(SUM(hours_listened), 1) AS hours
FROM v_tracks
WHERE genre IS NOT NULL AND genre <> ''
GROUP BY 1
HAVING hours > 0
ORDER BY hours DESC
LIMIT 8;
