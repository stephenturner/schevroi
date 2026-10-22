"use strict";

const DATA_URL = "data/schev_roi_all_institutions.csv";
const SCHEV_URL = "https://collegeoutcomes.schev.edu/rdPage.aspx?rdReport=ROI.ROI_Dashboard";
// Programs below this share of graduates with wage data are drawn hollow and flagged.
const THIN = 30;

const PUBLIC = new Set([
  "Christopher Newport University",
  "George Mason University",
  "James Madison University",
  "Longwood University",
  "Norfolk State University",
  "Old Dominion University",
  "Radford University",
  "University of Mary Washington",
  "University of Virginia",
  "University of Virginia's College at Wise",
  "Virginia Commonwealth University",
  "Virginia Military Institute",
  "Virginia State University",
  "Virginia Tech",
  "William & Mary",
]);

// Two-digit CIP families (CIP 2020 titles, shortened).
const FIELDS = {
  "01": "Agriculture",
  "03": "Natural resources and conservation",
  "05": "Area, ethnic, cultural, and gender studies",
  "09": "Communication and journalism",
  "10": "Communications technologies",
  "11": "Computer and information sciences",
  "13": "Education",
  "14": "Engineering",
  "15": "Engineering technologies",
  "16": "Foreign languages and linguistics",
  "19": "Family and consumer sciences",
  "22": "Legal professions and studies",
  "23": "English language and literature",
  "24": "Liberal arts and general studies",
  "26": "Biological and biomedical sciences",
  "27": "Mathematics and statistics",
  "30": "Multi/interdisciplinary studies",
  "31": "Parks, recreation, and kinesiology",
  "38": "Philosophy and religious studies",
  "40": "Physical sciences",
  "42": "Psychology",
  "43": "Homeland security, law enforcement, and firefighting",
  "44": "Public administration and social service",
  "45": "Social sciences",
  "50": "Visual and performing arts",
  "51": "Health professions",
  "52": "Business, management, and marketing",
  "54": "History",
};

const METRICS = {
  net: {
    label: "Net lifetime difference",
    get: (d) => d.net,
    tick: moneyShort,
    full: money,
    base: 0,
  },
  ratio: {
    label: "ROI ratio",
    get: (d) => d.ratio,
    tick: (v) => v.toFixed(1),
    full: (v) => v.toFixed(2),
    base: 1,
  },
};

const DEFAULTS = {
  tab: "overview",
  metric: "net",
  sector: "public",
  cov: 0,
  cip: "420101",
  inst: "University of Virginia",
  q: "",
  field: "",
  tinst: "",
  sort: "inst",
  dir: 1,
};
const state = { ...DEFAULTS };
let ALL = [];

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/* ---------- Formatting ---------- */

function money(v) {
  const s = Math.abs(Math.round(v)).toLocaleString("en-US");
  // Word joiner keeps the minus sign on the same line as the number.
  return (v < 0 ? "−⁠$" : "$") + s;
}
function moneyShort(v) {
  const a = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (a >= 1e3) return `${sign}$${Math.round(a / 1e3)}K`;
  return `${sign}$${Math.round(a)}`;
}
const pct = (v) => `${Math.round(v)}%`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- Data ---------- */

function parseCSV(text) {
  const rows = [];
  let row = [];
  let f = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { f += '"'; i++; } else quoted = false;
      } else f += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(f); rows.push(row); row = []; f = "";
    } else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => r.length > 1);
}

const toNum = (s) => Number(String(s).replace(/[$,%\s]/g, ""));

function toRecords(rows) {
  const [head, ...body] = rows;
  const col = (name) => head.indexOf(name);
  const ci = {
    inst: col("Institution"),
    cip: col("CIP"),
    program: col("Program"),
    cov: col("Pct Graduates with Wage Data"),
    net: col("Net Lifetime Difference"),
    ratio: col("ROI Ratio"),
  };
  return body.map((r) => {
    const cip = r[ci.cip].padStart(6, "0");
    const field = cip.slice(0, 2);
    const cov = toNum(r[ci.cov]);
    return {
      inst: r[ci.inst],
      cip,
      program: r[ci.program],
      field,
      fieldName: FIELDS[field] || `CIP ${field}`,
      cov,
      net: toNum(r[ci.net]),
      ratio: toNum(r[ci.ratio]),
      sector: PUBLIC.has(r[ci.inst]) ? "public" : "private",
      thin: cov < THIN,
    };
  }).filter((d) => Number.isFinite(d.net) && Number.isFinite(d.ratio) && Number.isFinite(d.cov));
}

function filtered() {
  return ALL.filter((d) =>
    (state.sector === "all" || d.sector === state.sector) && d.cov >= state.cov);
}

function median(values) {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function groupBy(arr, key) {
  const m = new Map();
  for (const d of arr) {
    const k = key(d);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(d);
  }
  return m;
}

// Share of the variance in `get` explained by grouping on `key` (eta squared).
function varianceShare(rows, key, get) {
  const all = rows.map(get);
  const mean = all.reduce((a, b) => a + b, 0) / all.length;
  const total = all.reduce((a, v) => a + (v - mean) ** 2, 0);
  if (!total) return NaN;
  let between = 0;
  for (const g of groupBy(rows, key).values()) {
    const gm = g.reduce((a, d) => a + get(d), 0) / g.length;
    between += g.length * (gm - mean) ** 2;
  }
  return between / total;
}

const isLoss = (d) => METRICS[state.metric].get(d) < METRICS[state.metric].base;

/* ---------- URL state ---------- */

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  for (const k of Object.keys(DEFAULTS)) {
    if (!p.has(k)) { state[k] = DEFAULTS[k]; continue; }
    const v = p.get(k);
    state[k] = typeof DEFAULTS[k] === "number" ? Number(v) || 0 : v;
  }
  if (!METRICS[state.metric]) state.metric = DEFAULTS.metric;
  if (!["overview", "program", "institution", "table"].includes(state.tab)) state.tab = DEFAULTS.tab;
  state.dir = state.dir < 0 ? -1 : 1;
}

function writeHash() {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(state)) if (v !== DEFAULTS[k]) p.set(k, v);
  const h = p.toString();
  history.replaceState(null, "", h ? `#${h}` : location.pathname + location.search);
}

function update(patch) {
  Object.assign(state, patch);
  writeHash();
  render();
}

/* ---------- Tooltip ---------- */

const tip = $("#tooltip");

function tipHTML(d, extra = "") {
  return `<b>${esc(d.program)}</b><span class="sub">${esc(d.inst)} · CIP ${d.cip}</span>
    <dl>
      <dt>With wage data</dt><dd>${pct(d.cov)}</dd>
      <dt>Net lifetime difference</dt><dd>${money(d.net)}</dd>
      <dt>ROI ratio</dt><dd>${d.ratio.toFixed(2)}</dd>
      ${extra}
    </dl>
    ${d.thin ? `<span class="warn">Fewer than ${THIN}% of graduates have wage data, so this estimate is rough.</span>` : ""}`;
}

function showTip(html, x, y) {
  tip.innerHTML = html;
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  let left = x + 14;
  let top = y + 14;
  if (left + r.width > window.innerWidth - 8) left = Math.max(8, x - r.width - 14);
  if (top + r.height > window.innerHeight - 8) top = Math.max(8, y - r.height - 14);
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}
function hideTip() { tip.hidden = true; }
document.addEventListener("scroll", hideTip, { passive: true });

/* ---------- Scales and SVG helpers ---------- */

function niceStep(span, count) {
  const raw = span / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
}

function linear(domain, range, count) {
  let [d0, d1] = domain;
  if (d0 === d1) { d0 -= 1; d1 += 1; }
  const step = niceStep(d1 - d0, count);
  d0 = Math.floor(d0 / step) * step;
  d1 = Math.ceil(d1 / step) * step;
  const [r0, r1] = range;
  const s = (v) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
  s.ticks = [];
  for (let v = d0; v <= d1 + step / 2; v += step) s.ticks.push(Math.abs(v) < step / 1e6 ? 0 : v);
  return s;
}

const NS = "http://www.w3.org/2000/svg";
function svgEl(tag, attrs = {}, parent) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (parent) parent.appendChild(el);
  return el;
}

function truncate(text, px, charPx = 6.9) {
  const max = Math.floor(px / charPx);
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
}

function dotClass(d, many) {
  return `dot ${isLoss(d) ? "neg" : "pos"}${d.thin ? " thin" : ""}${many ? " many" : ""}`;
}

function legendHTML(items) {
  const sw = {
    pos: `<svg viewBox="0 0 14 14"><circle cx="7" cy="7" r="5" fill="var(--pos)"/></svg>`,
    neg: `<svg viewBox="0 0 14 14"><circle cx="7" cy="7" r="5" fill="var(--neg)"/></svg>`,
    thin: `<svg viewBox="0 0 14 14"><circle cx="7" cy="7" r="5" fill="none" stroke="var(--ink-2)" stroke-width="1.5"/></svg>`,
    median: `<svg viewBox="0 0 14 14"><line x1="7" y1="1" x2="7" y2="13" stroke="var(--ink)" stroke-width="2.5" stroke-linecap="round"/></svg>`,
    ref: `<svg viewBox="0 0 14 14"><line x1="7" y1="1" x2="7" y2="13" stroke="var(--ref)" stroke-width="2" opacity="0.55" stroke-linecap="round"/></svg>`,
    refline: `<svg viewBox="0 0 14 14"><line x1="7" y1="0" x2="7" y2="14" stroke="var(--ref)" stroke-width="1.5" stroke-dasharray="4 3"/></svg>`,
  };
  return `<div class="legend">${items.map(([k, label]) => `<span>${sw[k]}${esc(label)}</span>`).join("")}</div>`;
}

function standardLegend(extra = []) {
  const gain = state.metric === "net" ? "Estimated net gain" : "Ratio of 1 or more";
  const loss = state.metric === "net" ? "Estimated net loss" : "Ratio below 1";
  return legendHTML([["pos", gain], ["neg", loss], ["thin", `Under ${THIN}% with wage data`], ...extra]);
}

/*
 * Horizontal dot plot. rows: [{ label, sub, title, points: [record], median, ref }]
 * Each row shares one x scale for the selected measure.
 */
function dotPlot(el, rows, opts = {}) {
  el.innerHTML = "";
  if (!rows.length) { el.innerHTML = `<p class="empty">No programs match the current filters.</p>`; return; }
  const m = METRICS[state.metric];
  const W = Math.max(280, el.clientWidth);
  const narrow = W < 600;
  const many = !!opts.many;
  const labelW = narrow ? 0 : Math.min(280, Math.round(W * 0.34));
  const rowH = narrow ? 46 : many ? 32 : 30;
  const top = 26;
  const bottom = 26;
  const H = top + rows.length * rowH + bottom;
  const x0 = labelW + (narrow ? 8 : 16);
  const x1 = W - 12;

  const values = [m.base];
  for (const r of rows) {
    for (const d of r.points) values.push(m.get(d));
    if (Number.isFinite(r.ref)) values.push(r.ref);
  }
  if (Number.isFinite(opts.refLine)) values.push(opts.refLine);
  const x = linear([Math.min(...values), Math.max(...values)], [x0, x1], narrow ? 4 : 7);

  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-label": m.label });
  const grid = svgEl("g", { class: "grid" }, svg);
  for (const t of x.ticks) {
    const gx = x(t);
    svgEl("line", { x1: gx, x2: gx, y1: top - 6, y2: H - bottom + 4 }, grid);
    for (const ty of rows.length > 10 ? [top - 10, H - bottom + 18] : [H - bottom + 18]) {
      const tg = svgEl("g", { class: "tick" }, svg);
      const tx = svgEl("text", { x: gx, y: ty, "text-anchor": "middle" }, tg);
      tx.textContent = m.tick(t);
    }
  }
  const bx = x(m.base);
  svgEl("line", { class: "zero", x1: bx, x2: bx, y1: top - 6, y2: H - bottom + 4 }, svg);

  rows.forEach((r, i) => {
    const y = top + i * rowH;
    const cy = narrow ? y + 31 : y + rowH / 2;
    const g = svgEl("g", { class: "row" }, svg);
    svgEl("rect", { class: "row-hover", x: 0, y, width: W, height: rowH, rx: 4 }, g);
    svgEl("line", { class: "row-line", x1: x0, x2: x1, y1: cy, y2: cy }, g);
    const subW = r.sub ? r.sub.length * 6 + 16 : 0;
    const labelText = narrow ? truncate(r.label, W - 4 - subW) : truncate(r.label, labelW - 4);
    const lt = svgEl("text", { class: "row-label", x: narrow ? 0 : labelW, y: narrow ? y + 14 : cy - (r.sub ? 3 : -4), "text-anchor": narrow ? "start" : "end" }, g);
    lt.textContent = labelText;
    if (r.sub) {
      const st = svgEl("text", { class: "row-sub", x: narrow ? W - 4 : labelW, y: narrow ? y + 14 : cy + 11, "text-anchor": "end" }, g);
      st.textContent = r.sub;
    }
    const title = svgEl("title", {}, g);
    title.textContent = r.title || r.label;
    if (Number.isFinite(r.ref)) svgEl("line", { class: "ref", x1: x(r.ref), x2: x(r.ref), y1: cy - 9, y2: cy + 9 }, g);
    if (Number.isFinite(r.median)) svgEl("line", { class: "median", x1: x(r.median), x2: x(r.median), y1: cy - 10, y2: cy + 10 }, g);
    const dots = r.points.map((d) => {
      const c = svgEl("circle", { class: dotClass(d, many), cx: x(m.get(d)), cy, r: many ? 4.5 : 6 }, g);
      return { d, c, px: x(m.get(d)) };
    });
    // Whole-row hit area: the nearest dot to the pointer gets the tooltip.
    const hit = svgEl("rect", { class: "hit", x: 0, y, width: W, height: rowH }, g);
    let active = null;
    const onMove = (ev) => {
      const box = svg.getBoundingClientRect();
      const px = ((ev.clientX - box.left) / box.width) * W;
      let best = null;
      for (const p of dots) if (!best || Math.abs(p.px - px) < Math.abs(best.px - px)) best = p;
      if (!best || Math.abs(best.px - px) > (many ? 24 : 48)) { clear(); return; }
      if (active !== best) { clear(); active = best; best.c.classList.add("active"); }
      showTip(opts.tip ? opts.tip(best.d, r) : tipHTML(best.d), ev.clientX, ev.clientY);
    };
    const clear = () => { if (active) active.c.classList.remove("active"); active = null; hideTip(); };
    hit.addEventListener("pointermove", onMove);
    hit.addEventListener("pointerdown", onMove);
    hit.addEventListener("pointerleave", clear);
  });

  if (Number.isFinite(opts.refLine)) {
    const rx = x(opts.refLine);
    svgEl("line", { class: "ref-line", x1: rx, x2: rx, y1: top - 6, y2: H - bottom + 4 }, svg);
  }
  el.appendChild(svg);
  el.insertAdjacentHTML("beforeend", standardLegend(opts.legend || []));
}

function scatter(el, rows) {
  el.innerHTML = "";
  if (!rows.length) { el.innerHTML = `<p class="empty">No programs match the current filters.</p>`; return; }
  const m = METRICS[state.metric];
  const W = Math.max(280, el.clientWidth);
  const H = Math.round(Math.min(440, Math.max(260, W * 0.55)));
  const pad = { l: W < 500 ? 44 : 60, r: 12, t: 12, b: 40 };
  const x = linear([0, Math.max(...rows.map((d) => d.cov))], [pad.l, W - pad.r], W < 500 ? 5 : 9);
  const vals = rows.map(m.get).concat(m.base);
  const y = linear([Math.min(...vals), Math.max(...vals)], [H - pad.b, pad.t], 6);
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-label": `${m.label} by share of graduates with wage data` });
  const grid = svgEl("g", { class: "grid" }, svg);
  for (const t of y.ticks) {
    svgEl("line", { x1: pad.l, x2: W - pad.r, y1: y(t), y2: y(t) }, grid);
    const tg = svgEl("g", { class: "tick" }, svg);
    svgEl("text", { x: pad.l - 6, y: y(t) + 4, "text-anchor": "end" }, tg).textContent = m.tick(t);
  }
  for (const t of x.ticks) {
    const tg = svgEl("g", { class: "tick" }, svg);
    svgEl("text", { x: x(t), y: H - pad.b + 16, "text-anchor": "middle" }, tg).textContent = pct(t);
  }
  svgEl("text", { x: (pad.l + W - pad.r) / 2, y: H - 4, "text-anchor": "middle" }, svg).textContent = "Share of graduates with wage data";
  svgEl("line", { class: "zero", x1: pad.l, x2: W - pad.r, y1: y(m.base), y2: y(m.base) }, svg);
  svgEl("line", { class: "ref-line", x1: x(THIN), x2: x(THIN), y1: pad.t, y2: H - pad.b }, svg);
  svgEl("text", { class: "ref-label", x: x(THIN) + 4, y: pad.t + 10 }, svg).textContent = `${THIN}%`;
  const pts = rows.map((d) => {
    const px = x(d.cov);
    const py = y(m.get(d));
    const c = svgEl("circle", { class: dotClass(d, true), cx: px, cy: py, r: 4 }, svg);
    return { d, c, px, py };
  });
  const hit = svgEl("rect", { class: "hit", x: 0, y: 0, width: W, height: H }, svg);
  let active = null;
  const clear = () => { if (active) active.c.classList.remove("active"); active = null; hideTip(); };
  const onMove = (ev) => {
    const box = svg.getBoundingClientRect();
    const px = ((ev.clientX - box.left) / box.width) * W;
    const py = ((ev.clientY - box.top) / box.height) * H;
    let best = null;
    let bd = Infinity;
    for (const p of pts) {
      const dd = (p.px - px) ** 2 + (p.py - py) ** 2;
      if (dd < bd) { bd = dd; best = p; }
    }
    if (!best || bd > 20 * 20) { clear(); return; }
    if (active !== best) { clear(); active = best; best.c.classList.add("active"); }
    showTip(tipHTML(best.d), ev.clientX, ev.clientY);
  };
  hit.addEventListener("pointermove", onMove);
  hit.addEventListener("pointerdown", onMove);
  hit.addEventListener("pointerleave", clear);
  el.appendChild(svg);
  el.insertAdjacentHTML("beforeend", standardLegend());
}

function tiles(el, items) {
  el.innerHTML = items.map(([v, k]) => `<div class="tile"><div class="v">${v}</div><div class="k">${k}</div></div>`).join("");
}

/* ---------- Views ---------- */

function renderOverview() {
  const rows = filtered();
  const m = METRICS[state.metric];
  const nInst = new Set(rows.map((d) => d.inst)).size;
  const losses = rows.filter(isLoss);
  const thin = rows.filter((d) => d.thin);
  tiles($("#ov-tiles"), [
    [rows.length.toLocaleString(), "programs shown"],
    [nInst, "institutions"],
    [rows.filter((d) => d.net >= 1e6).length, "programs with a net lifetime difference of $1 million or more"],
    [losses.length, state.metric === "net" ? "programs with an estimated net loss" : "programs with an ROI ratio below 1"],
    [rows.length ? pct(median(rows.map((d) => d.cov))) : "n/a", "median share of graduates with wage data"],
  ]);

  const ins = [];
  if (rows.length > 20) {
    const byField = varianceShare(rows, (d) => d.field, m.get);
    const byInst = varianceShare(rows, (d) => d.inst, m.get);
    ins.push(`Field of study accounts for about ${pct(byField * 100)} of the variation in ${m.label.toLowerCase()} across these programs, and the institution for about ${pct(byInst * 100)}.${byField > byInst ? " What a student studies matters more in this data than where." : ""}`);
    if (losses.length) {
      const top = [...groupBy(losses, (d) => d.fieldName)].sort((a, b) => b[1].length - a[1].length).slice(0, 2);
      ins.push(`${losses.length} of ${rows.length} programs (${pct((losses.length / rows.length) * 100)}) fall below break-even. The largest share are in ${top.map(([f, g]) => `${f.toLowerCase()} (${g.length})`).join(" and ")}.`);
    }
    const common = [...groupBy(rows, (d) => d.cip)].sort((a, b) => b[1].length - a[1].length)[0];
    if (common && common[1].length > 2) {
      const v = common[1].map(m.get);
      ins.push(`The same degree varies a lot by school. ${common[1][0].program}, the most widely reported program here, runs from ${m.full(Math.min(...v))} to ${m.full(Math.max(...v))} across ${common[1].length} institutions. <a href="#" data-goto-cip="${common[0]}">Compare it</a>.`);
    }
    if (thin.length) ins.push(`${thin.length} programs have wage data for fewer than ${THIN}% of graduates. Use the slider above to hide them.`);
  }
  $("#ov-insights").innerHTML = ins.length ? `<ul>${ins.map((s) => `<li>${s}</li>`).join("")}</ul>` : "";

  const fieldRows = [...groupBy(rows, (d) => d.field)].map(([f, g]) => ({
    label: FIELDS[f] || `CIP ${f}`,
    sub: `${g.length} program${g.length === 1 ? "" : "s"}`,
    points: g,
    median: median(g.map(m.get)),
  })).sort((a, b) => b.median - a.median);
  dotPlot($("#ov-fields"), fieldRows, { many: true, legend: [["median", "Field median"]] });
  scatter($("#ov-scatter"), rows);
}

// Replace a select's options only when they change, so an open dropdown is not reset needlessly.
function setOptions(sel, options) {
  const html = options.map(([value, label]) => `<option value="${esc(value)}">${esc(label)}</option>`).join("");
  if (sel.dataset.html !== html) {
    sel.innerHTML = html;
    sel.dataset.html = html;
  }
}

// Pick `value` if the select offers it, otherwise its first option.
function choose(sel, value) {
  const ok = [...sel.options].some((o) => o.value === value);
  const v = ok ? value : sel.options.length ? sel.options[0].value : "";
  sel.value = v;
  return v;
}

function instOptions(rows) {
  return [...new Set(rows.map((d) => d.inst))].sort((a, b) => a.localeCompare(b))
    .map((i) => [i, state.sector === "all" && !PUBLIC.has(i) ? `${i} (private)` : i]);
}

function renderProgram() {
  const sel = $("#p-program");
  const programs = [...groupBy(filtered(), (d) => d.cip)].filter(([, g]) => g.length >= 2)
    .map(([cip, g]) => [cip, `${g[0].program} (${cip}), ${g.length} institutions`])
    .sort((a, b) => a[1].localeCompare(b[1]));
  setOptions(sel, programs);
  state.cip = choose(sel, state.cip) || state.cip;
  if (!programs.length) {
    $("#p-title").textContent = "Program across institutions";
    $("#p-summary").innerHTML = "<p>No program is reported by two or more institutions under the current filters.</p>";
    dotPlot($("#p-chart"), []);
    return;
  }
  const m = METRICS[state.metric];
  const all = ALL.filter((d) => d.cip === state.cip);
  const rows = filtered().filter((d) => d.cip === state.cip).sort((a, b) => a.inst.localeCompare(b.inst));
  const name = all[0] ? all[0].program : "";
  $("#p-title").textContent = `${name} across institutions`;
  const med = median(rows.map(m.get));
  const summary = [];
  if (rows.length) {
    const v = rows.map(m.get);
    const losses = rows.filter(isLoss).length;
    summary.push(`Reported at ${rows.length} institution${rows.length === 1 ? "" : "s"}${rows.length < all.length ? ` (${all.length - rows.length} hidden by filters)` : ""}. Estimates run from ${m.full(Math.min(...v))} to ${m.full(Math.max(...v))}, with a median of ${m.full(med)}.`);
    summary.push(losses ? `${losses} fall${losses === 1 ? "s" : ""} below break-even.` : "None fall below break-even.");
    const nThin = rows.filter((d) => d.thin).length;
    summary.push(`A median of ${pct(median(rows.map((d) => d.cov)))} of graduates have wage data${nThin ? `, and ${nThin} ${nThin === 1 ? "program has" : "programs have"} under ${THIN}%` : ""}.`);
    const fieldRows = filtered().filter((d) => d.field === state.cip.slice(0, 2));
    const fieldMed = median(fieldRows.map(m.get));
    if (fieldRows.length > rows.length) summary.push(`For comparison, the median across all ${rows[0].fieldName.toLowerCase()} programs is ${m.full(fieldMed)}.`);
  }
  $("#p-summary").innerHTML = summary.length ? `<p>${summary.join(" ")}</p>` : "";
  dotPlot($("#p-chart"), rows.map((d) => ({
    label: d.inst,
    sub: `${pct(d.cov)} with wage data`,
    points: [d],
  })), { refLine: rows.length > 1 ? med : NaN, legend: rows.length > 1 ? [["refline", "Median of institutions shown"]] : [] });
}

function renderInstitution() {
  const sel = $("#i-inst");
  const pool = filtered();
  setOptions(sel, instOptions(pool));
  state.inst = choose(sel, state.inst) || state.inst;
  const m = METRICS[state.metric];
  const rows = pool.filter((d) => d.inst === state.inst).sort((a, b) => m.get(b) - m.get(a));
  const hidden = ALL.filter((d) => d.inst === state.inst).length - rows.length;
  $("#i-title").textContent = `Programs at ${state.inst}`;
  tiles($("#i-tiles"), [
    [rows.length, `programs reported${hidden ? ` (${hidden} hidden by filters)` : ""}`],
    [rows.filter((d) => d.net >= 1e6).length, "with a net lifetime difference of $1 million or more"],
    [rows.filter(isLoss).length, state.metric === "net" ? "with an estimated net loss" : "with an ROI ratio below 1"],
    [rows.length ? median(rows.map((d) => d.ratio)).toFixed(2) : "n/a", "median ROI ratio"],
    [rows.length ? pct(median(rows.map((d) => d.cov))) : "n/a", "median share with wage data"],
  ]);
  const others = groupBy(pool.filter((d) => d.inst !== state.inst), (d) => d.cip);
  dotPlot($("#i-chart"), rows.map((d) => {
    const o = others.get(d.cip) || [];
    return {
      label: d.program,
      sub: `${pct(d.cov)} with wage data`,
      title: `${d.program} (CIP ${d.cip})`,
      points: [d],
      ref: o.length ? median(o.map(m.get)) : NaN,
      nOthers: o.length,
    };
  }), {
    legend: [["ref", "Median for this program at other institutions"]],
    tip: (d, r) => tipHTML(d, r.nOthers ? `<dt>Median at ${r.nOthers} other${r.nOthers === 1 ? "" : "s"}</dt><dd>${m.full(r.ref)}</dd>` : ""),
  });
}

function tableRows() {
  const q = state.q.trim().toLowerCase();
  const rows = filtered().filter((d) =>
    (!state.field || d.field === state.field) &&
    (!state.tinst || d.inst === state.tinst) &&
    (!q || `${d.inst} ${d.program} ${d.cip} ${d.fieldName}`.toLowerCase().includes(q)));
  const key = {
    inst: (d) => d.inst,
    program: (d) => d.program,
    field: (d) => d.fieldName,
    cov: (d) => d.cov,
    net: (d) => d.net,
    ratio: (d) => d.ratio,
  }[state.sort] || ((d) => d.inst);
  const dir = state.dir;
  return rows.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    const c = typeof ka === "string" ? ka.localeCompare(kb) : ka - kb;
    return c * dir || a.inst.localeCompare(b.inst) || a.program.localeCompare(b.program);
  });
}

function renderTable() {
  const pool = filtered();
  const fields = [...new Set(pool.map((d) => d.field))].sort((a, b) => (FIELDS[a] || a).localeCompare(FIELDS[b] || b));
  setOptions($("#t-field"), [["", "All fields"], ...fields.map((f) => [f, FIELDS[f] || `CIP ${f}`])]);
  setOptions($("#t-inst"), [["", "All institutions"], ...instOptions(pool)]);
  state.field = choose($("#t-field"), state.field);
  state.tinst = choose($("#t-inst"), state.tinst);
  if ($("#t-q").value !== state.q) $("#t-q").value = state.q;
  for (const th of $$(".data-table th")) {
    const k = th.querySelector("button").dataset.sort;
    if (k === state.sort) th.setAttribute("aria-sort", state.dir > 0 ? "ascending" : "descending");
    else th.removeAttribute("aria-sort");
  }
  const rows = tableRows();
  $("#t-count").textContent = `${rows.length.toLocaleString()} of ${ALL.length.toLocaleString()} programs. Sorting by a column orders the rows; it does not rank programs.`;
  $("#t-body").innerHTML = rows.map((d) => `<tr>
      <td data-label="Institution">${esc(d.inst)}</td>
      <td data-label="Program">${esc(d.program)}<span class="cip">CIP ${d.cip}</span></td>
      <td data-label="Field">${esc(d.fieldName)}</td>
      <td class="num" data-label="With wage data"><span><span class="bar" aria-hidden="true"><i style="width:${Math.min(100, d.cov)}%"></i></span>${pct(d.cov)}${d.thin ? `<span class="flag" title="Fewer than ${THIN}% of graduates have wage data">thin data</span>` : ""}</span></td>
      <td class="num${d.net < 0 ? " neg-val" : ""}" data-label="Net lifetime difference">${money(d.net)}</td>
      <td class="num${d.ratio < 1 ? " neg-val" : ""}" data-label="ROI ratio">${d.ratio.toFixed(2)}</td>
    </tr>`).join("") || `<tr><td colspan="6" class="empty">No programs match.</td></tr>`;
}

function downloadCSV() {
  const rows = tableRows();
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const lines = [["Institution", "Sector", "CIP", "Program", "Field", "Pct Graduates with Wage Data", "Net Lifetime Difference", "ROI Ratio"].map(q).join(",")];
  for (const d of rows) lines.push([d.inst, d.sector, d.cip, d.program, d.fieldName, d.cov, d.net, d.ratio].map(q).join(","));
  lines.push(q(`Source: SCHEV College Outcomes ROI dashboard, ${SCHEV_URL}`));
  saveBlob(new Blob([lines.join("\n")], { type: "text/csv" }), "schev_roi_filtered.csv");
}

function saveBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------- PNG export ---------- */

const STYLE_PROPS = ["fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity", "stroke-dasharray", "stroke-linecap",
  "opacity", "font-family", "font-size", "font-weight", "font-variant-numeric"];

// Copy computed styles onto a cloned SVG tree so it renders without the page's stylesheet or CSS variables.
function inlineStyles(src, dst) {
  const cs = getComputedStyle(src);
  dst.setAttribute("style", STYLE_PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(";"));
  for (let i = 0; i < src.children.length; i++) inlineStyles(src.children[i], dst.children[i]);
}

function svgText(parent, text, x, y, style) {
  const t = svgEl("text", { x, y, style }, parent);
  t.textContent = text;
  return t;
}

function filterLabel() {
  const parts = [METRICS[state.metric].label, { all: "All institutions", public: "Public institutions", private: "Private institutions" }[state.sector]];
  if (state.cov) parts.push(`At least ${state.cov}% of graduates with wage data`);
  return parts.join(" · ");
}

async function exportPNG(fig) {
  const chart = fig.querySelector(".chart");
  const svg = chart.querySelector("svg");
  if (!svg) return;
  const root = getComputedStyle(document.documentElement);
  const color = (v) => root.getPropertyValue(v).trim();
  const font = `font-family:${getComputedStyle(document.body).fontFamily}`;
  const W = svg.viewBox.baseVal.width;
  const H = svg.viewBox.baseVal.height;
  const pad = 24;
  const top = pad + 52;

  const clone = svg.cloneNode(true);
  inlineStyles(svg, clone);
  clone.querySelectorAll(".hit, .row-hover, title").forEach((el) => el.remove());
  clone.querySelectorAll(".active").forEach((el) => el.classList.remove("active"));
  clone.setAttribute("x", pad);
  clone.setAttribute("y", top);
  clone.setAttribute("overflow", "visible");

  // Legend: each HTML legend item becomes its swatch plus a text label, wrapped to the chart width.
  const legend = svgEl("g", {});
  let lx = 0;
  let ly = 0;
  for (const item of chart.querySelectorAll(".legend span")) {
    const label = item.textContent.trim();
    const w = 20 + label.length * 6.6 + 20;
    if (lx && lx + w > W) { lx = 0; ly += 22; }
    const sw = item.querySelector("svg").cloneNode(true);
    inlineStyles(item.querySelector("svg"), sw);
    sw.setAttribute("x", lx);
    sw.setAttribute("y", ly);
    sw.setAttribute("width", 14);
    sw.setAttribute("height", 14);
    legend.appendChild(sw);
    svgText(legend, label, lx + 20, ly + 11, `${font};font-size:12px;fill:${color("--ink-2")}`);
    lx += w;
  }
  const legendY = top + H + 18;
  legend.setAttribute("transform", `translate(${pad},${legendY})`);
  const sourceY = legendY + ly + 44;
  const totalW = W + pad * 2;
  const totalH = sourceY + pad - 6;

  const out = svgEl("svg", { xmlns: NS, width: totalW, height: totalH, viewBox: `0 0 ${totalW} ${totalH}` });
  svgEl("rect", { width: totalW, height: totalH, fill: color("--surface") }, out);
  svgText(out, fig.querySelector("figcaption h2").textContent, pad, pad + 16, `${font};font-size:18px;font-weight:650;fill:${color("--ink")}`);
  svgText(out, filterLabel(), pad, pad + 38, `${font};font-size:12px;fill:${color("--ink-2")}`);
  out.appendChild(clone);
  out.appendChild(legend);
  svgText(out, "Source: SCHEV College Outcomes ROI dashboard (collegeoutcomes.schev.edu). Estimates for graduates working in Virginia; not program rankings.",
    pad, sourceY, `${font};font-size:11px;fill:${color("--muted")}`);

  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(out))}`;
  await img.decode();
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = totalW * scale;
  canvas.height = totalH * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0, totalW, totalH);
  const slug = fig.querySelector("figcaption h2").textContent.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  canvas.toBlob((blob) => saveBlob(blob, `schev-roi-${slug}.png`), "image/png");
}

function addExportButtons() {
  for (const fig of $$("figure.card")) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "png-btn";
    b.setAttribute("aria-label", "Download this chart as a PNG image");
    b.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v8m0 0L5 7m3 3 3-3M3 13h10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>PNG`;
    b.addEventListener("click", () => exportPNG(fig).catch((err) => console.error("PNG export failed", err)));
    fig.appendChild(b);
  }
}

/* ---------- Render loop ---------- */

const VIEWS = { overview: renderOverview, program: renderProgram, institution: renderInstitution, table: renderTable };

function render() {
  hideTip();
  for (const b of $$(".seg button")) b.setAttribute("aria-checked", String(b.dataset.metric === state.metric));
  $("#f-sector").value = state.sector;
  $("#f-cov").value = state.cov;
  $("#f-cov-out").textContent = pct(state.cov);
  for (const b of $$(".tabs button")) {
    const on = b.dataset.tab === state.tab;
    b.setAttribute("aria-selected", String(on));
    b.tabIndex = on ? 0 : -1;
    $(`#panel-${b.dataset.tab}`).hidden = !on;
  }
  VIEWS[state.tab]();
}

function bind() {
  for (const b of $$(".seg button")) b.addEventListener("click", () => update({ metric: b.dataset.metric }));
  $("#f-sector").addEventListener("change", (e) => update({ sector: e.target.value }));
  $("#f-cov").addEventListener("input", (e) => update({ cov: Number(e.target.value) }));
  const tabs = $$(".tabs button");
  tabs.forEach((b, i) => {
    b.addEventListener("click", () => update({ tab: b.dataset.tab }));
    b.addEventListener("keydown", (e) => {
      const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!step) return;
      const next = tabs[(i + step + tabs.length) % tabs.length];
      next.focus();
      update({ tab: next.dataset.tab });
    });
  });
  $("#p-program").addEventListener("change", (e) => update({ cip: e.target.value }));
  $("#i-inst").addEventListener("change", (e) => update({ inst: e.target.value }));
  $("#t-q").addEventListener("input", (e) => update({ q: e.target.value }));
  $("#t-field").addEventListener("change", (e) => update({ field: e.target.value }));
  $("#t-inst").addEventListener("change", (e) => update({ tinst: e.target.value }));
  $("#t-download").addEventListener("click", downloadCSV);
  addExportButtons();
  for (const btn of $$(".data-table th button")) {
    btn.addEventListener("click", () => {
      const k = btn.dataset.sort;
      const numeric = ["cov", "net", "ratio"].includes(k);
      update(k === state.sort ? { dir: -state.dir } : { sort: k, dir: numeric ? -1 : 1 });
    });
  }
  document.addEventListener("click", (e) => {
    const a = e.target.closest("[data-goto-cip]");
    if (!a) return;
    e.preventDefault();
    update({ tab: "program", cip: a.dataset.gotoCip });
    window.scrollTo({ top: $(".tabs").offsetTop - 8, behavior: "smooth" });
  });
  // In-page anchors scroll without touching the hash, which holds the view state.
  document.addEventListener("click", (e) => {
    const a = e.target.closest('a[href^="#"]:not([data-goto-cip])');
    const target = a && document.getElementById(a.getAttribute("href").slice(1));
    if (!target) return;
    e.preventDefault();
    target.scrollIntoView({ behavior: "smooth" });
  });
  window.addEventListener("hashchange", () => {
    if (!location.hash.includes("=")) return;
    readHash();
    render();
  });

  let lastW = 0;
  let frame = 0;
  new ResizeObserver((entries) => {
    const w = Math.round(entries[0].contentRect.width);
    if (w === lastW) return;
    lastW = w;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => { if (state.tab !== "table") VIEWS[state.tab](); });
  }).observe($("main"));
}

async function init() {
  readHash();
  bind();
  try {
    const res = await fetch(DATA_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    ALL = toRecords(parseCSV(await res.text()));
  } catch (err) {
    $("#status").innerHTML = `Could not load the data (${esc(err.message)}). If you opened this file directly, serve the folder over HTTP instead, for example with <code>python3 -m http.server</code> in the repository folder.`;
    return;
  }
  $("#status").textContent = "";
  for (const el of $$("[data-count]")) {
    el.textContent = el.dataset.count === "inst" ? new Set(ALL.map((d) => d.inst)).size : ALL.length.toLocaleString();
  }
  render();
}

init();
