-- Most played songs
SELECT title, artist, album, play_count AS plays
FROM v_tracks
WHERE play_count > 0
ORDER BY play_count DESC
LIMIT 10;
