-- Most skipped songs: skips / (plays + skips)
SELECT title, artist, album, play_count AS plays, skip_count AS skips,
       1.0 * skip_count / (play_count + skip_count) AS skip_rate
FROM v_tracks
WHERE play_count + skip_count >= 15
ORDER BY skip_rate DESC
LIMIT 10;
