// suggest.js: the Pick Me a Song card. The three answers fill in the named
// parameters of sql/queries/suggest.sql. The query returns its 20 best matches
// and this picks one at random, with higher-ranked songs more likely.

import { Cancelled } from "./database.js";
import { nf, fmtDate, el, renderSongList, addSqlToggle } from "./render.js";

const $ = (id) => document.getElementById(id);
const MODES = ["favourite", "forgotten", "barely"];
const MODE_NAMES = { favourite: "old favourites", forgotten: "forgotten songs", barely: "songs you barely play" };
const RECENT_MAX = 10;   // how many past picks to avoid repeating
const ANY = { kind: "", value: "", label: "Anything" };

let ctx = null;          // { db, queries, params, art } for the loaded library
let vibes = [ANY];
let recent = [];         // track_ids suggested lately; kept in memory only
let pickRun = 0;

const plural = (n, one) => `${nf.format(n)} ${n === 1 ? one : one + "s"}`;

/* ---------- The answer chips ---------- */

function select(button) {
  button.parentElement.querySelectorAll(".chip").forEach((c) => {
    const on = c === button;
    c.classList.toggle("on", on);
    c.setAttribute("aria-pressed", String(on));
  });
}

const chosen = (question) => document.querySelector(`[data-question="${question}"] .chip.on`);
const chooseValue = (question, value) => {
  const b = [...document.querySelectorAll(`[data-question="${question}"] .chip`)].find((c) => c.dataset.value === value);
  if (b) select(b);
};

document.querySelectorAll("[data-question]").forEach((group) => group.addEventListener("click", (e) => {
  const b = e.target.closest(".chip");
  if (b) select(b);
}));

function renderVibes() {
  const box = $("vibe-chips");
  box.replaceChildren();
  vibes.forEach((v, i) => {
    const b = el("button", "chip" + (i === 0 ? " on" : ""), v.label);
    b.type = "button";
    b.dataset.value = String(i);
    b.setAttribute("aria-pressed", String(i === 0));
    if (v.kind) b.title = `${v.kind === "playlist" ? "Playlist" : "Genre"} · ${plural(v.songs, "song")}`;
    box.append(b);
  });
}

/* ---------- Finding a song ---------- */

function query(mode, vibe, risk, exclude) {
  return ctx.db.query(ctx.queries.suggest, {
    ...ctx.params(),
    ":mode": mode,
    ":playlist": vibe.kind === "playlist" ? vibe.value : "",
    ":genre": vibe.kind === "genre" ? vibe.value : "",
    ":risk": risk,
    ":exclude": exclude,
  });
}

/** Try the exact answers first, then loosen one thing at a time:
 *  include skipped songs, then another kind of song in the same vibe,
 *  then the whole library. A repeat that fits the answers beats a new song
 *  that doesn't, so past picks are only allowed back before loosening. */
async function find(mode, vibe, risk) {
  const tries = [];
  const modes = [mode, ...MODES.filter((m) => m !== mode)];
  const risks = risk === "safe" ? ["safe", "brave"] : ["brave"];
  for (const m of modes) for (const r of risks) tries.push({ mode: m, vibe, risk: r });
  if (vibe.kind) for (const r of risks) tries.push({ mode, vibe: ANY, risk: r });
  for (const t of tries) {
    // Avoid recent picks, then just the last one, then allow anything.
    for (const exclude of [recent.join(","), recent[0] || "", ""]) {
      const { rows } = await query(t.mode, t.vibe, t.risk, exclude);
      if (rows.length) return { ...t, rows };
    }
  }
  return null;
}

/** Weighted pick: rank 1 of 20 is 20× as likely as rank 20. */
function weightedPick(rows) {
  const n = rows.length;
  let r = Math.random() * (n * (n + 1) / 2);
  for (let i = 0; i < n; i++) {
    r -= n - i;
    if (r < 0) return rows[i];
  }
  return rows[0];
}

function why(song, mode) {
  if (mode === "favourite") return `You've played it ${plural(song.plays, "time")}${song.loved ? " and loved it" : ""}.`;
  if (mode === "forgotten") return `You played it ${plural(song.plays, "time")}, but not since ${fmtDate(song.last_played)}.`;
  // Nothing else by this artist has been played either.
  if (song.artist_plays <= song.plays) {
    return song.plays === 0 ? "You've never played it. Here's your chance." : `Only ${plural(song.plays, "play")} so far.`;
  }
  const artistPlays = `you've played ${song.artist} ${plural(song.artist_plays, "time")}`;
  return song.plays === 0
    ? `You've never played it, but ${artistPlays}.`
    : `Only ${plural(song.plays, "play")}, but ${artistPlays}.`;
}

async function pick(asked) {
  if (!ctx) return;
  const run = ++pickRun;
  const out = $("pick-out");
  const { db } = ctx;
  try {
    const found = await find(asked.mode, asked.vibe, asked.risk);
    if (run !== pickRun || db !== ctx?.db) return;
    if (!found) {
      out.replaceChildren(el("p", "empty", "This library has no songs to suggest yet."));
      return;
    }
    const song = weightedPick(found.rows);
    recent = [song.track_id, ...recent.filter((id) => id !== song.track_id)].slice(0, RECENT_MAX);

    const notes = [];
    if (found.vibe !== asked.vibe) notes.push(`Nothing in ${asked.vibe.label} matched, so this is from your whole library.`);
    else if (found.mode !== asked.mode) notes.push(`No ${MODE_NAMES[asked.mode]} in ${asked.vibe.kind ? asked.vibe.label : "your library"} matched, so this is one of your ${MODE_NAMES[found.mode]}.`);
    if (found.risk !== asked.risk) notes.push("It's one you sometimes skip.");

    const row = el("div", "list");
    renderSongList(row, [song], {
      art: ctx.art(),
      value: (r) => [plural(r.plays, "play"), r.last_played ? `last ${fmtDate(r.last_played)}` : "never played"],
    });
    const reason = el("p", "explain", why(song, found.mode));
    if (notes.length) reason.append(" ", el("span", "fallback", notes.join(" ")));
    out.replaceChildren(row, reason);
  } catch (e) {
    if (e instanceof Cancelled || run !== pickRun) return;
    out.replaceChildren(el("p", "empty", "This query failed: " + e.message));
  }
}

function askedAnswers() {
  return {
    mode: chosen("mode")?.dataset.value || "favourite",
    vibe: vibes[Number(chosen("vibe")?.dataset.value) || 0] || ANY,
    risk: chosen("risk")?.dataset.value || "safe",
  };
}

$("pick-go").addEventListener("click", () => pick(askedAnswers()));
$("pick-surprise").addEventListener("click", () => {
  // Surprise me: a random kind of song from anywhere, safe bets only.
  // The chips update so you can see what it chose.
  chooseValue("mode", MODES[Math.floor(Math.random() * MODES.length)]);
  chooseValue("vibe", "0");
  chooseValue("risk", "safe");
  pick(askedAnswers());
});

/** Call after a library loads: rebuild the vibe choices and clear the last pick. */
export async function resetSuggest(next) {
  ctx = next;
  recent = [];
  pickRun++;
  $("pick-out").replaceChildren(el("p", "empty", "Answer the questions and press Pick a song."));
  addSqlToggle($("pick"), next.queries.suggest);
  try {
    const { rows } = await next.db.query(next.queries.suggest_vibes);
    if (ctx !== next) return;
    vibes = [ANY, ...rows.map((r) => ({ kind: r.kind, value: r.id, label: r.label, songs: r.songs }))];
  } catch (e) {
    if (e instanceof Cancelled) return;
    vibes = [ANY];
  }
  renderVibes();
}
