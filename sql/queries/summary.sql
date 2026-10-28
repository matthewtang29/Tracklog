-- Library totals for the stat tiles
SELECT COUNT(*) AS songs,
       SUM(play_count) AS plays,
       SUM(skip_count) AS skips,
       SUM(hours_listened) AS hours,
       COUNT(DISTINCT artist) AS artists,
       SUM(play_count = 0) AS never_played,
       1.0 * SUM(skip_count) / NULLIF(SUM(play_count) + SUM(skip_count), 0) AS skip_rate
FROM v_tracks;
