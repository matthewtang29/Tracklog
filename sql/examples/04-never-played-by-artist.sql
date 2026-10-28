-- Never played, by artist
-- Which artists have the most songs you added but never played.
SELECT artist, COUNT(*) AS unplayed
FROM v_tracks
WHERE play_count = 0
GROUP BY artist
ORDER BY unplayed DESC
LIMIT 10;
