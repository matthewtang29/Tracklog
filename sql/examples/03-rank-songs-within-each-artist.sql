-- Rank songs within each artist
-- Ranks each artist's songs against each other with a window function, so you can see every artist's #1, #2, #3.
SELECT artist, title, play_count,
       RANK() OVER (PARTITION BY artist ORDER BY play_count DESC) AS rank_for_artist
FROM v_tracks
WHERE play_count > 0
ORDER BY artist, rank_for_artist
LIMIT 50;
