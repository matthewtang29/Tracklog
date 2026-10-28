// render.js: turns query results into bars, tables and the monthly chart.

export const nf = new Intl.NumberFormat("en");

export const pct = (x) => (x == null || isNaN(x)) ? "—" : (x * 100).toFixed(1) + "%";

export function fmtDate(s) {
  if (!s) return "—";
  const d = new Date(String(s).slice(0, 10) + "T00:00:00Z");
  return isNaN(d) ? "—" : d.toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/* Generated "album art": a gradient picked from a hash of the text. */
function hashHue(str) {
  let h = 0;
  for (const ch of String(str)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h % 360;
}

function artwork(seed, cls, letter) {
  const h = hashHue(seed);
  const a = el("span", "art" + (cls ? " " + cls : ""), letter || null);
  a.style.background = `linear-gradient(140deg, hsl(${h} 72% 58%), hsl(${(h + 48) % 360} 66% 34%))`;
  a.setAttribute("aria-hidden", "true");
  return a;
}

const initials = (name) =>
  String(name).replace(/[^\p{L}\p{N} ]/gu, "").split(/\s+/).filter(Boolean)
    .slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "♪";

export function renderBars(out, rows, labelKey, valKey, unit, avatars) {
  out.replaceChildren();
  if (!rows.length) { out.append(el("p", "empty", "Nothing to show for this library.")); return; }
  const max = Math.max(...rows.map((r) => r[valKey]));
  rows.forEach((r) => {
    const row = el("div", "bar-row");
    const lab = el("span", "lab");
    lab.title = r[labelKey];
    if (avatars) lab.append(artwork(r[labelKey], "avatar", initials(r[labelKey])));
    lab.append(el("span", null, r[labelKey]));
    const track = el("div", "bar-track");
    const fill = el("div", "bar-fill");
    fill.style.width = (100 * r[valKey] / max) + "%";
    track.append(fill);
    const value = nf.format(Math.round(r[valKey]));
    row.setAttribute("aria-label", `${r[labelKey]}: ${value} ${unit}`);
    row.append(lab, track, el("span", "val", value));
    out.append(row);
  });
}

export function renderTable(out, rows, cols) {
  out.replaceChildren();
  if (!rows.length) { out.append(el("p", "empty", "Nothing matches in this library.")); return; }
  const table = el("table");
  const thead = el("thead");
  const headRow = el("tr");
  cols.forEach((c) => headRow.append(el("th", (c.num ? "num " : "") + (c.hideSm ? "hide-sm" : ""), c.label)));
  thead.append(headRow);
  table.append(thead);

  const tbody = el("tbody");
  rows.forEach((r, i) => {
    const tr = el("tr");
    cols.forEach((c) => {
      const td = el("td", (c.num ? "num " : "") + (c.hideSm ? "hide-sm" : ""));
      if (c.rank) {
        td.className = "rank";
        td.textContent = String(i + 1);
      } else if (c.song) {
        const wrap = el("div", "song");
        const text = el("span");
        text.append(el("span", null, r.title), el("span", "sub", r.artist));
        wrap.append(artwork((r.album || "") + r.artist + r.title), text);
        td.append(wrap);
      } else {
        td.textContent = c.fmt ? c.fmt(r[c.key]) : (r[c.key] ?? "—");
      }
      tr.append(td);
    });
    tbody.append(tr);
  });
  table.append(tbody);
  out.append(table);
}

export function renderMonths(out, rows, exportDate) {
  out.replaceChildren();
  if (!rows.length) { out.append(el("p", "empty", "No dates added in the last 24 months.")); return; }

  // Fill gaps so every month appears, even with zero songs added.
  const byMonth = new Map(rows.map((r) => [r.month, r.added]));
  const [y0, m0] = rows[0].month.split("-").map(Number);
  const last = exportDate.slice(0, 7);
  const months = [];
  for (let y = y0, m = m0; ;) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    months.push(key);
    if (key >= last || months.length > 30) break;
    m++;
    if (m > 12) { m = 1; y++; }
  }

  const max = Math.max(...months.map((k) => byMonth.get(k) || 0), 1);
  const cols = el("div", "cols");
  const labels = el("div", "col-labels");
  const short = (k) => new Date(k + "-01T00:00:00Z").toLocaleDateString("en", { month: "short", timeZone: "UTC" });
  const step = Math.ceil(months.length / Math.max(4, Math.floor(out.clientWidth / 52) || 8));

  months.forEach((k, i) => {
    const v = byMonth.get(k) || 0;
    const full = new Date(k + "-01T00:00:00Z").toLocaleDateString("en", { month: "long", year: "numeric", timeZone: "UTC" });
    const col = el("div", "col");
    col.tabIndex = 0;
    col.title = `${full}: ${v} songs added`;
    col.setAttribute("aria-label", col.title);
    const h = (v ? Math.max(2, 100 * v / max) : 0) + "%";
    const bar = el("i");
    bar.style.height = h;
    const num = el("b", null, String(v));
    num.style.bottom = h;
    col.append(num, bar);
    cols.append(col);

    const isJan = k.endsWith("-01");
    const text = (i % step === 0 || isJan) ? (isJan || i === 0 ? `${short(k)} ${k.slice(2, 4)}` : short(k)) : "";
    labels.append(el("span", null, text));
  });
  out.append(cols, labels);
}

export function addSqlToggle(card, sql) {
  let details = card.querySelector("details.sql");
  if (!details) {
    details = el("details", "sql");
    details.append(el("summary", null, "Show SQL"), el("pre"));
    card.append(details);
  }
  details.querySelector("pre").textContent = sql;
}
