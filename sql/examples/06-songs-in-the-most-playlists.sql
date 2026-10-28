-- Songs in the most playlists
SELECT v.title, v.artist, COUNT(*) AS playlists
FROM playlist_tracks pt
JOIN v_tracks v ON v.track_id = pt.track_id
GROUP BY pt.track_id
ORDER BY playlists DESC, v.play_count DESC
LIMIT 10;
