-- Loved songs
SELECT title, artist, play_count
FROM v_tracks
WHERE loved = 1
ORDER BY play_count DESC;
