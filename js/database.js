// database.js: the page's side of the database. Loads the .sql files and talks
// to worker.js, which reads Library.xml, builds SQLite and runs the queries off
// the main thread so a big library (or a slow query) can't freeze the page.

export const QUERY_NAMES = [
  "summary", "top_artists", "top_songs", "playlists",
  "genres", "forgotten", "most_skipped", "added_by_month",
];

export const EXAMPLE_FILES = [
  "01-loved-songs.sql",
  "02-albums-you-play-front-to-back.sql",
  "03-rank-songs-within-each-artist.sql",
  "04-never-played-by-artist.sql",
  "05-longest-songs-you-love.sql",
  "06-songs-in-the-most-playlists.sql",
];

async function fetchText(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Couldn't load ${path} (${res.status})`);
  return res.text();
}

/** Load schema.sql, every card query, and the example queries. */
export async function loadSqlFiles() {
  const schema = await fetchText("sql/schema.sql");
  const queries = Object.fromEntries(await Promise.all(
    QUERY_NAMES.map(async (name) => [name, await fetchText(`sql/queries/${name}.sql`)])
  ));
  const examples = await Promise.all(EXAMPLE_FILES.map(async (file) => {
    // File format: "-- Title", "-- What it does", then the query.
    const lines = (await fetchText(`sql/examples/${file}`)).split("\n");
    const comments = [];
    while (lines.length && lines[0].startsWith("--")) comments.push(lines.shift().slice(2).trim());
    return { label: comments[0] || file, about: comments.slice(1).join(" "), sql: lines.join("\n").trim() };
  }));
  return { schema, queries, examples };
}

/* ---------- Worker connection ---------- */

const WORKER_URL = new URL("./worker.js", import.meta.url);

/** Thrown when a request is dropped on purpose (a newer upload replaced it). */
export class Cancelled extends Error {}

class Connection {
  constructor() {
    this.worker = new Worker(WORKER_URL);
    this.nextId = 1;
    this.pending = new Map();
    this.worker.onmessage = ({ data }) => {
      const job = this.pending.get(data.id);
      if (!job) return;
      if ("progress" in data) { job.onProgress?.(data.progress, data.phase); return; }
      this.pending.delete(data.id);
      clearTimeout(job.timer);
      data.ok ? job.resolve(data.result) : job.reject(new Error(data.error));
    };
    // Fires if the worker script can't load or the worker runs out of memory.
    this.worker.onerror = (e) => {
      e.preventDefault?.();
      this.failAll(new Error("The database engine stopped" + (e.message ? `: ${e.message}` : ".") +
        " Reload the page and try again."));
    };
  }

  call(msg, { onProgress, timeoutMs, transfer } = {}) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const job = { resolve, reject, onProgress };
      if (timeoutMs) job.timer = setTimeout(() => { this.pending.delete(id); reject(Object.assign(new Error("timeout"), { timedOut: true })); }, timeoutMs);
      this.pending.set(id, job);
      this.worker.postMessage({ ...msg, id }, transfer || []);
    });
  }

  failAll(err) {
    this.pending.forEach((job) => { clearTimeout(job.timer); job.reject(err); });
    this.pending.clear();
  }

  close() {
    this.worker.terminate();
    this.failAll(new Cancelled("cancelled"));
  }
}

/** A library loaded into its own worker. */
export class Library {
  /**
   * Build from an uploaded File or a plain library object (the sample).
   * Returns { library, cancel } at once; `library` is a promise.
   */
  static build(schema, source, onProgress) {
    const conn = new Connection();
    const library = conn.call({ type: "build", schema, ...source }, { onProgress })
      .then(({ bytes, stats }) => new Library(conn, schema, bytes, stats))
      .catch((e) => { conn.close(); throw e; });
    return { library, cancel: () => conn.close() };
  }

  constructor(conn, schema, bytes, stats) {
    this.conn = conn;
    this.bytes = bytes;   // kept so a stopped query can restart the worker
    this.stats = stats;
  }

  /** Run SQL; resolves to { columns, rows, total } with each row as an object.
   *  maxRows caps how many rows come back (total is the full count). */
  async query(sql, params, { timeoutMs, maxRows } = {}) {
    try {
      return await this.conn.call({ type: "query", sql, params, maxRows }, { timeoutMs });
    } catch (e) {
      if (!e.timedOut) throw e;
      // sql.js can't interrupt a running query, so replace the worker.
      this.conn.close();
      this.conn = new Connection();
      await this.conn.call({ type: "open", bytes: this.bytes });
      throw new Error(`Stopped after ${timeoutMs / 1000} seconds. The query may loop forever or join too many rows.`);
    }
  }

  close() { this.conn.close(); }
}
