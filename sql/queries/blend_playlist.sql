-- Blend playlist: a mix for everyone in the blend, like Spotify Blend but
-- across Apple Music and Spotify. Songs are matched by song_key (cleaned
-- title + main artist), so the same song on both services counts once.
-- :members  comma-separated listener_ids in the blend
--
-- Each person's songs are scored 0..1 by their own listening time (their top
-- song is 1), so a heavy listener doesn't drown everyone else out. Only each
-- person's 2,000 most-listened songs take part, which keeps it fast.
-- Then the list takes turns: a song more than one of you plays, then each
-- person's pick. Picks by an artist the others also play rank higher.
WITH m AS (
  SELECT listener_id FROM listeners
  WHERE instr(',' || :members || ',', ',' || listener_id || ',') > 0
),
cutoff AS MATERIALIZED (   -- each person's 2,000th-most-listened song (uses the listener_id, listened_ms index)
  SELECT listener_id,
         COALESCE((SELECT listened_ms FROM all_tracks x WHERE x.listener_id = m.listener_id
                   ORDER BY listened_ms DESC LIMIT 1 OFFSET 1999), 0) AS floor
  FROM m
),
played AS (
  SELECT t.listener_id, t.song_key, t.title, t.artist, t.album, t.artist_id, t.listened_ms
  FROM v_all_tracks t JOIN cutoff c ON c.listener_id = t.listener_id
  WHERE t.play_count > 0 AND t.listened_ms > 0 AND t.listened_ms >= c.floor
),
scored AS (
  SELECT *, PERCENT_RANK() OVER (PARTITION BY listener_id ORDER BY listened_ms) AS s
  FROM played
),
best AS MATERIALIZED (   -- one row per person per song (an Apple library can hold a song twice)
  SELECT * FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY listener_id, song_key ORDER BY s DESC) AS dup
    FROM scored
  ) WHERE dup = 1
),
songs AS MATERIALIZED (  -- how many of you play each song, and whose copy to show
  SELECT *,
         COUNT(*) OVER (PARTITION BY song_key) AS fans,
         SUM(s) OVER (PARTITION BY song_key) AS score,
         ROW_NUMBER() OVER (PARTITION BY song_key ORDER BY s DESC) AS shown
  FROM best
),
artist_fans AS (
  SELECT artist_id, COUNT(DISTINCT listener_id) AS fans FROM best GROUP BY artist_id
),
shared AS (
  SELECT song_key, title, artist, album, NULL AS from_id, fans,
         ROW_NUMBER() OVER (ORDER BY fans DESC, score DESC) AS turn
  FROM songs
  WHERE fans >= 2 AND shown = 1
),
picks AS (
  SELECT sg.song_key, sg.title, sg.artist, sg.album, sg.listener_id AS from_id, 1 AS fans,
         ROW_NUMBER() OVER (PARTITION BY sg.listener_id
                            ORDER BY sg.s * (1 + (af.fans > 1)) DESC, sg.listened_ms DESC) AS turn
  FROM songs sg
  JOIN artist_fans af ON af.artist_id = sg.artist_id
  WHERE sg.fans = 1
)
SELECT song_key, title, artist, album, from_id, fans, turn
FROM (SELECT * FROM shared UNION ALL SELECT * FROM picks)
ORDER BY turn, from_id IS NOT NULL, from_id
LIMIT 30;
