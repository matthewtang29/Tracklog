-- Top genres by hours listened
SELECT COALESCE(genre, 'Unknown') AS genre,
       ROUND(SUM(hours_listened), 1) AS hours
FROM v_tracks
GROUP BY 1
HAVING hours > 0
ORDER BY hours DESC
LIMIT 8;
