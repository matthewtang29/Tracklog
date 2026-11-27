-- Blend: artists more than one person in the blend listens to.
-- :members  comma-separated listener_ids in the blend
-- Ranked by how many people play them, then by the smallest share of anyone's
-- listening (an artist everyone plays a lot beats one only a single person loves).
WITH m AS (
  SELECT listener_id FROM listeners
  WHERE instr(',' || :members || ',', ',' || listener_id || ',') > 0
),
artist_time AS (
  SELECT t.listener_id, t.artist_id, SUM(t.listened_ms) AS ms
  FROM all_tracks t JOIN m ON m.listener_id = t.listener_id
  WHERE t.listened_ms > 0
  GROUP BY 1, 2
),
shares AS (
  SELECT listener_id, artist_id, ms, 1.0 * ms / SUM(ms) OVER (PARTITION BY listener_id) AS share
  FROM artist_time
)
SELECT ar.name AS artist,
       COUNT(*) AS fans,
       ROUND(SUM(s.ms) / 3600000.0, 1) AS hours,
       MIN(s.share) AS min_share
FROM shares s
JOIN artists ar ON ar.artist_id = s.artist_id
GROUP BY s.artist_id
HAVING COUNT(*) >= 2
ORDER BY fans DESC, min_share DESC
LIMIT 12;
