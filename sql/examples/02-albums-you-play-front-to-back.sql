-- Albums you play front to back
-- Albums with 5+ songs in your library, ranked by their least-played song. A high number means you play the whole album, not just the singles.
SELECT album, artist, COUNT(*) AS songs,
       MIN(play_count) AS least_played_song
FROM v_tracks
WHERE album IS NOT NULL
GROUP BY album, artist
HAVING songs >= 5
ORDER BY least_played_song DESC
LIMIT 10;
