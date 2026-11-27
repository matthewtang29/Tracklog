-- Pick me a song: the quiz answers fill in the parameters, this returns the
-- 20 best matches, and the page picks one of them at random (top ranks more often).
-- :mode     'favourite' (played a lot), 'forgotten' (loved once, not lately)
--           or 'barely' (by artists you play a lot, but this song hardly ever)
-- :playlist a playlist_id to stay inside, or '' for any
-- :genre    a genre to stay inside, or '' for any
-- :risk     'safe' leaves out songs you skip more than 1 time in 4; 'brave' doesn't
-- :exclude  comma-separated track_ids already suggested, so they don't repeat
-- :export_date is the date the Library.xml file was exported
WITH artist_plays AS (
  SELECT artist_id, SUM(play_count) AS artist_plays
  FROM tracks
  GROUP BY artist_id
),
songs AS (
  SELECT v.track_id, v.title, v.artist, v.album, v.genre, v.loved,
         v.play_count AS plays,
         DATE(v.last_played) AS last_played,
         a.artist_plays,
         COALESCE(1.0 * v.skip_count / NULLIF(v.play_count + v.skip_count, 0), 0) AS skip_rate,
         julianday(:export_date) - julianday(v.last_played) AS days_since
  FROM v_tracks v
  JOIN artist_plays a ON a.artist_id = v.artist_id
  WHERE (:playlist = '' OR v.track_id IN (
          SELECT track_id FROM playlist_tracks WHERE playlist_id = :playlist))
    AND (:genre = '' OR v.genre = :genre)
    AND (:risk = 'brave' OR COALESCE(1.0 * v.skip_count / NULLIF(v.play_count + v.skip_count, 0), 0) <= 0.25)
    AND instr(',' || :exclude || ',', ',' || v.track_id || ',') = 0
),
scored AS (
  SELECT *,
         CASE :mode
           -- lots of plays, few skips, loved songs count double
           WHEN 'favourite' THEN plays * (1 - skip_rate) * (1 + loved)
           -- played a lot, and the longer ago the better (capped at two years)
           WHEN 'forgotten' THEN plays * MIN(days_since, 730) / 30.0 * (1 + loved)
           -- artists you love, songs of theirs you've barely touched
           WHEN 'barely'    THEN artist_plays / (1.0 + plays)
         END AS score
  FROM songs
  WHERE CASE :mode
          WHEN 'favourite' THEN plays >= 5
          WHEN 'forgotten' THEN (plays >= 10 OR loved = 1) AND days_since >= 90
          WHEN 'barely'    THEN plays <= 3
        END
)
SELECT track_id, title, artist, album, genre, plays, last_played, loved,
       artist_plays, skip_rate, ROUND(score, 1) AS score
FROM scored
ORDER BY score DESC, title
LIMIT 20;
