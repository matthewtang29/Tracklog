-- Forgotten favourites: 30+ plays, not played in the 6 months before the export
-- :export_date is the date the Library.xml file was exported
SELECT title, artist, album, play_count AS plays, DATE(last_played) AS last_played
FROM v_tracks
WHERE play_count >= 30
  AND last_played < DATE(:export_date, '-6 months')
ORDER BY play_count DESC
LIMIT 10;
