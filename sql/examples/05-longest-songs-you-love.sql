-- Longest songs you love
SELECT title, artist,
       ROUND(duration_ms / 60000.0, 1) AS minutes, play_count
FROM v_tracks
WHERE play_count >= 10
ORDER BY duration_ms DESC
LIMIT 10;
