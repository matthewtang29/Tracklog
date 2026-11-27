// blend.js: the Blend card. Like Spotify Blend, but it works across Apple Music
// and Spotify: a taste match for each pair of people, the artists you share,
// and a mixed playlist. All three come from SQL (sql/queries/blend_*.sql),
// run against everyone in the database, not just the person being viewed.

import { Cancelled } from "./database.js";
import { nf, el, renderSongList, addSqlToggle } from "./render.js";

const $ = (id) => document.getElementById(id);

let ctx = null;          // { db, queries, art, names, addFriend }
let members = new Set(); // listener_ids in the blend
let lastSongs = [];
let run = 0;

const plural = (n, one, many = one + "s") => `${nf.format(n)} ${n === 1 ? one : many}`;
const nameOf = (id) => ctx.names()[id - 1] || `Person ${id}`;
const listOf = (names) => names.length <= 2 ? names.join(" and ") : names.slice(0, -1).join(", ") + " and " + names.at(-1);

function emptyState(out) {
  const box = el("div", "blend-empty");
  box.append(el("p", null, "A Blend needs two people. Add a friend's Apple Music Library.xml or Spotify .json files " +
    "(or another library of your own) and Tracklog will compare your taste and make a playlist for both of you."));
  const b = el("button", "btn quiet", "Add a friend's files");
  b.type = "button";
  b.addEventListener("click", () => ctx.addFriend());
  box.append(b);
  out.replaceChildren(box);
}

function renderMembers(total) {
  const box = el("div", "chips blend-members");
  box.setAttribute("role", "group");
  box.setAttribute("aria-label", "Who's in the blend");
  for (let id = 1; id <= total; id++) {
    const on = members.has(id);
    const b = el("button", "chip" + (on ? " on" : ""), nameOf(id));
    b.type = "button";
    b.setAttribute("aria-pressed", String(on));
    b.addEventListener("click", () => {
      if (members.has(id)) {
        if (members.size <= 2) return;     // a blend needs two people
        members.delete(id);
      } else members.add(id);
      draw();
    });
    box.append(b);
  }
  return box;
}

function renderMatch(pairs) {
  const box = el("div", "blend-match");
  if (pairs.length === 1) {
    const p = pairs[0];
    const big = el("div", "blend-score");
    big.append(el("span", "big", `${p.match_pct}%`), el("span", "unit", "taste match"));
    const line = el("p", "blend-line");
    line.append(el("b", null, nameOf(p.a_id)), " and ", el("b", null, nameOf(p.b_id)), ` share ${plural(p.shared_artists, "artist")} and ${plural(p.shared_songs, "song")}.`);
    box.append(big, line);
  } else {
    pairs.forEach((p) => {
      const row = el("div", "blend-pair");
      row.append(el("span", "name", `${nameOf(p.a_id)} + ${nameOf(p.b_id)}`), el("span", "val", `${p.match_pct}%`));
      const bar = el("div", "bar");
      const fill = el("i");
      fill.style.width = p.match_pct + "%";
      bar.append(fill);
      row.append(bar);
      row.title = `${plural(p.shared_artists, "artist")} and ${plural(p.shared_songs, "song")} in common`;
      box.append(row);
    });
  }
  box.append(el("p", "fine", "Taste match compares how each of you splits your listening time across artists. 100% would be the same artists in the same amounts."));
  return box;
}

function renderArtists(rows, size) {
  const box = el("div", "chips");
  if (!rows.length) {
    box.append(el("p", "empty", "No artists in common yet. The playlist below mixes each of your favourites."));
    return box;
  }
  rows.forEach((r) => {
    const chip = el("span", "genre", r.artist);
    chip.append(el("small", null, size > 2 ? `${r.fans} of ${size}` : `${nf.format(Math.round(r.hours))} h`));
    box.append(chip);
  });
  return box;
}

function songLabel(r, size) {
  if (r.from_id == null) return [r.fans >= size ? (size === 2 ? "Both of you" : `All ${size} of you`) : `${r.fans} of you`, "shared"];
  return [`From ${nameOf(r.from_id)}`, "their pick"];
}

async function draw() {
  if (!ctx) return;
  const mine = ++run;
  const out = $("blend-out");
  const total = ctx.db.stats.people.length;
  if (total < 2) { lastSongs = []; emptyState(out); return; }
  const ids = [...members].sort((a, b) => a - b).join(",");
  const p = { ":members": ids };
  try {
    const [match, artists, songs] = [
      (await ctx.db.query(ctx.queries.blend_match, p)).rows,
      (await ctx.db.query(ctx.queries.blend_artists, p)).rows,
      (await ctx.db.query(ctx.queries.blend_playlist, p)).rows,
    ];
    if (mine !== run) return;
    lastSongs = songs;
    const parts = [];
    if (total > 2) parts.push(renderMembers(total));
    parts.push(renderMatch(match));

    const shared = el("div", "blend-section");
    shared.append(el("h3", null, "Artists you share"), renderArtists(artists, members.size));
    parts.push(shared);

    const mix = el("div", "blend-section");
    const head = el("div", "blend-head");
    head.append(el("h3", null, `Your Blend · ${plural(songs.length, "song")}`));
    const copy = el("button", "btn quiet small", "Copy song list");
    copy.type = "button";
    copy.addEventListener("click", () => copyList(copy));
    head.append(copy);
    const list = el("div", "list");
    if (songs.length) {
      renderSongList(list, songs, { ranked: true, art: ctx.art(), value: (r) => songLabel(r, members.size) });
    } else list.append(el("p", "empty", "No played songs to mix yet."));
    mix.append(head, el("p", "fine", "Takes turns: a song more than one of you plays, then a pick from each person. " +
      "Songs are matched across Apple Music and Spotify by title and main artist."), list);
    parts.push(mix);
    out.replaceChildren(...parts);
  } catch (e) {
    if (e instanceof Cancelled || mine !== run) return;
    out.replaceChildren(el("p", "empty", "This query failed: " + e.message));
  }
}

async function copyList(button) {
  const names = listOf([...members].sort((a, b) => a - b).map(nameOf));
  const text = [`Blend for ${names} (Tracklog)`, ...lastSongs.map((r, i) => `${i + 1}. ${r.title} – ${r.artist}`)].join("\n");
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Copied";
  } catch {
    button.textContent = "Couldn't copy";
  }
  setTimeout(() => { button.textContent = "Copy song list"; }, 2000);
}

/** Call after a database loads: everyone starts in the blend. */
export async function resetBlend(next) {
  ctx = next;
  members = new Set(next.db.stats.people.map((p) => p.id));
  addSqlToggle($("blend"), [next.queries.blend_match, next.queries.blend_artists, next.queries.blend_playlist].join("\n\n"));
  await draw();
}

/** A person was renamed: redraw so their new name shows. */
export function renameInBlend() {
  if (ctx) draw();
}
