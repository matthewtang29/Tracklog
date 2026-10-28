-- Albums you play front to back
SELECT album, artist, COUNT(*) AS songs,
       MIN(play_count) AS least_played_song
FROM v_tracks
WHERE album IS NOT NULL
GROUP BY album, artist
HAVING songs >= 5
ORDER BY least_played_song DESC
LIMIT 10;
