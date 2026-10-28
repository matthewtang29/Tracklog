-- Top artists by hours listened (play count x song length)
SELECT artist, ROUND(SUM(hours_listened), 1) AS hours
FROM v_tracks
GROUP BY artist
HAVING hours > 0
ORDER BY hours DESC
LIMIT 10;
