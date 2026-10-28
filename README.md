# Tracklog

Turn your Apple Music library into a SQL database and see your listening habits: top artists, forgotten favourites, most-skipped songs, and more. Runs entirely in your browser.

**[Try it live](https://matthewtang29.github.io/tracklog/)**

## How it works

```
Library.xml ──► parse (database.js) ──► SQLite in the browser ──► SQL queries (sql/) ──► charts (render.js)
```

1. You export your library from the Music app (Mac) or iTunes (Windows).
2. `js/database.js` reads Apple's XML format and builds a SQLite database from `sql/schema.sql`, inserting every song, artist, album and playlist.
3. Each card on the page runs one query from `sql/queries/`.
4. `js/render.js` turns the results into bars and tables.

Your file never leaves your computer. SQLite runs in the browser through [sql.js](https://github.com/sql-js/sql.js), so there is no server.

## Project structure

```
tracklog/
├── index.html               page layout
├── css/styles.css           styling
├── js/
│   ├── main.js              starts the app, draws each card, runs the SQL editor
│   ├── database.js          loads the .sql files, parses Library.xml, builds SQLite
│   ├── render.js            bar charts, tables, the monthly chart
│   └── sample-library.js    invented demo library shown before you upload
└── sql/
    ├── schema.sql           tables: artists, albums, tracks, playlists, playlist_tracks + v_tracks view
    ├── queries/             one query per dashboard card
    └── examples/            example queries for the "Ask Your Library in SQL" box
```

## The SQL

The schema is normalized: `artists → albums → tracks`, with a many-to-many `playlist_tracks` table. The `v_tracks` view joins names back in and calculates `hours_listened`.

Queries use joins, aggregation, CTEs, window functions (`ROW_NUMBER`, `RANK`, `SUM() OVER`), date functions and named parameters. For example, each playlist's most-played song:

```sql
WITH ranked AS (
  SELECT p.name AS playlist,
         v.title || ' – ' || v.artist AS top_song,
         ROW_NUMBER() OVER (PARTITION BY p.playlist_id ORDER BY v.play_count DESC) AS rn,
         SUM(v.play_count) OVER (PARTITION BY p.playlist_id) AS plays
  FROM playlists p
  JOIN playlist_tracks pt ON pt.playlist_id = p.playlist_id
  JOIN v_tracks v ON v.track_id = pt.track_id
)
SELECT playlist, plays, top_song FROM ranked WHERE rn = 1 ORDER BY plays DESC;
```

To add a new card, write a query in `sql/queries/`, add its name to `QUERY_NAMES` in `js/database.js`, and add a card for it in `index.html`.

## Get your library file

- **Mac:** Music app → File → Library → Export Library…
- **Windows:** iTunes → File → Library → Export Library…

## Run it locally

The page loads the `.sql` files with `fetch`, which browsers block when you double-click `index.html`. Start a small local server from the project folder instead:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. On GitHub Pages it works with no setup.
