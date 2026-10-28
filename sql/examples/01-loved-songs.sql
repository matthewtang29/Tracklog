-- Loved songs
-- Every song you've marked as loved (or favourited), most played first.
SELECT title, artist, play_count
FROM v_tracks
WHERE loved = 1
ORDER BY play_count DESC;
