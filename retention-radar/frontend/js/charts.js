// Small SVG chart kit. Sizes are measured from the container so text stays at a true 12px.
import { esc } from "./util.js";

const NS = "http://www.w3.org/2000/svg";
let tipEl;
function tooltip() {
  if (!tipEl) { tipEl = document.createElement("div"); tipEl.className = "chart-tooltip"; tipEl.setAttribute("role", "presentation"); document.body.appendChild(tipEl); }
  return tipEl;
}
function showTip(html, x, y) {
  const t = tooltip(); t.innerHTML = html; t.style.display = "block";
  const w = t.offsetWidth, h = t.offsetHeight;
  let left = x + 14, top = y - h - 10;
  if (left + w > innerWidth - 8) left = x - w - 14;
  if (top < 8) top = y + 16;
  t.style.left = `${Math.max(8, left)}px`; t.style.top = `${top}px`;
}
const hideTip = () => { if (tipEl) tipEl.style.display = "none"; };

function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
function mount(el, draw) {
  el.classList.add("chart");
  let last = 0;
  const run = () => { const w = Math.floor(el.clientWidth); if (w && w !== last) { last = w; draw(w); } };
  draw(el.clientWidth || 600); last = el.clientWidth;
  if (window.ResizeObserver) { const ro = new ResizeObserver(() => { if (!el.isConnected) { ro.disconnect(); return; } run(); }); ro.observe(el); }
}
const svgOpen = (w, h, label) => `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">`;

export function legendHtml(items) {
  return `<div class="legend">${items.map((s, i) => `<button type="button" class="item" data-series="${i}" aria-pressed="true"><span class="sw" style="background:${s.color}"></span>${esc(s.name)}</button>`).join("")}</div>`;
}

// Line chart with hover guide. opts: labels, series[{name,values,color,dash}], fmt, yMin, yMax, height, label, legend
export function lineChart(el, o) {
  const hidden = new Set();
  const height = o.height || 260;
  const fmt = o.fmt || ((v) => v);
  const svgHost = document.createElement("div");
  el.innerHTML = ""; el.appendChild(svgHost);
  if (o.series.length > 1 || o.legend) {
    const lg = document.createElement("div"); lg.innerHTML = legendHtml(o.series); el.appendChild(lg);
    lg.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { const i = +b.dataset.series; hidden.has(i) ? hidden.delete(i) : hidden.add(i); b.setAttribute("aria-pressed", String(!hidden.has(i))); draw(svgHost.clientWidth); }));
  }
  function draw(w) {
    w = w || svgHost.clientWidth || 600;
    const m = { l: 72, r: 28, t: 12, b: 28 }, iw = w - m.l - m.r, ih = height - m.t - m.b;
    const vis = o.series.filter((_, i) => !hidden.has(i));
    const all = vis.flatMap((s) => s.values).filter((v) => v != null);
    let ymax = o.yMax != null ? o.yMax : niceMax(Math.max(...all, 0.0001) * 1.05);
    let ymin = o.yMin != null ? o.yMin : 0;
    if (o.yMin == null && all.length && Math.min(...all) < 0) ymin = -niceMax(-Math.min(...all));
    const n = o.labels.length;
    const x = (i) => m.l + (n === 1 ? iw / 2 : (iw * i) / (n - 1));
    const y = (v) => m.t + ih - ((v - ymin) / (ymax - ymin || 1)) * ih;
    let s = svgOpen(w, height, o.label || "Line chart");
    for (let t = 0; t <= 4; t++) {
      const v = ymin + ((ymax - ymin) * t) / 4, yy = y(v);
      s += `<line class="grid-line" x1="${m.l}" x2="${w - m.r}" y1="${yy}" y2="${yy}"/><text x="${m.l - 8}" y="${yy + 4}" text-anchor="end">${esc(fmt(v, true))}</text>`;
    }
    const step = Math.ceil(n / Math.max(1, Math.floor(iw / 84)));
    o.labels.forEach((l, i) => { if ((i % step === 0 && (i < n - 1 - Math.floor(step / 2) || i === n - 1)) || i === n - 1) s += `<text x="${x(i)}" y="${height - 8}" text-anchor="${i === n - 1 && n > 1 ? "end" : i === 0 ? "start" : "middle"}">${esc(l)}</text>`; });
    o.series.forEach((se, si) => {
      if (hidden.has(si)) return;
      const pts = se.values.map((v, i) => (v == null ? null : [x(i), y(v)]));
      let d = "", pen = false;
      pts.forEach((p) => { if (!p) { pen = false; return; } d += `${pen ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)} `; pen = true; });
      s += `<path d="${d}" fill="none" stroke="${se.color}" stroke-width="2" ${se.dash ? 'stroke-dasharray="5 4"' : ""} stroke-linejoin="round" stroke-linecap="round"/>`;
      if (n <= 16) pts.forEach((p) => { if (p) s += `<circle cx="${p[0]}" cy="${p[1]}" r="3" fill="var(--surface)" stroke="${se.color}" stroke-width="2"/>`; });
    });
    s += `<line id="guide" class="axis-line" y1="${m.t}" y2="${m.t + ih}" x1="0" x2="0" style="display:none"/><rect class="hit" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent"/></svg>`;
    svgHost.innerHTML = s;
    const svg = svgHost.querySelector("svg"), guide = svg.querySelector("#guide"), hit = svg.querySelector(".hit");
    const move = (e) => {
      const r = svg.getBoundingClientRect(), cx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
      const i = Math.max(0, Math.min(n - 1, Math.round(((cx - m.l) / iw) * (n - 1))));
      guide.setAttribute("x1", x(i)); guide.setAttribute("x2", x(i)); guide.style.display = "";
      const rows = o.series.map((se, si) => (hidden.has(si) || se.values[i] == null ? "" : `<div class="tt-row"><span><span class="sw" style="display:inline-block;background:${se.color};margin-right:6px"></span>${esc(se.name)}</span><strong>${esc(fmt(se.values[i]))}</strong></div>`)).join("");
      showTip(`<div class="tt-title">${esc(o.labels[i])}</div>${rows}`, (e.touches ? e.touches[0].clientX : e.clientX), (e.touches ? e.touches[0].clientY : e.clientY));
    };
    hit.addEventListener("mousemove", move); hit.addEventListener("touchstart", move, { passive: true }); hit.addEventListener("touchmove", move, { passive: true });
    hit.addEventListener("mouseleave", () => { guide.style.display = "none"; hideTip(); });
    hit.addEventListener("touchend", () => { guide.style.display = "none"; hideTip(); });
  }
  mount(svgHost, draw);
  svgHost.classList.remove("chart");
}

// Vertical (optionally grouped) bars. opts: labels, series[{name,values,color}], fmt, height
export function barChart(el, o) {
  const height = o.height || 260, fmt = o.fmt || ((v) => v);
  const host = document.createElement("div"); el.innerHTML = ""; el.appendChild(host);
  if (o.series.length > 1) { const lg = document.createElement("div"); lg.innerHTML = legendHtml(o.series).replace(/button type="button" class="item"[^>]*>/g, (m) => m.replace("button", "span").replace('type="button" ', "")).replace(/<\/button>/g, "</span>"); el.appendChild(lg); }
  function draw(w) {
    w = w || host.clientWidth || 600;
    const m = { l: 68, r: 12, t: 12, b: 36 }, iw = w - m.l - m.r, ih = height - m.t - m.b;
    const ymax = niceMax(Math.max(...o.series.flatMap((s) => s.values), 0.0001) * 1.05);
    const y = (v) => m.t + ih - (v / ymax) * ih;
    const n = o.labels.length, gw = iw / n, k = o.series.length, bw = Math.min(40, (gw * 0.7) / k);
    let s = svgOpen(w, height, o.label || "Bar chart");
    for (let t = 0; t <= 4; t++) { const v = (ymax * t) / 4, yy = y(v); s += `<line class="grid-line" x1="${m.l}" x2="${w - m.r}" y1="${yy}" y2="${yy}"/><text x="${m.l - 8}" y="${yy + 4}" text-anchor="end">${esc(fmt(v, true))}</text>`; }
    const maxLen = Math.max(...o.labels.map((l) => String(l).length), 1);
    const lblStep = Math.max(1, Math.ceil((maxLen * 7.5 + 12) / gw));
    o.labels.forEach((l, i) => {
      const cx = m.l + gw * i + gw / 2;
      if (i % lblStep === 0) s += `<text x="${cx}" y="${height - 12}" text-anchor="middle">${esc(l)}</text>`;
      o.series.forEach((se, si) => {
        const bx = cx - (bw * k) / 2 + si * bw, v = se.values[i] || 0;
        s += `<rect class="bar" data-i="${i}" data-s="${si}" x="${bx + 1}" y="${y(v)}" width="${bw - 2}" height="${Math.max(0, m.t + ih - y(v))}" fill="${se.color}" rx="2"/>`;
      });
    });
    s += "</svg>"; host.innerHTML = s;
    host.querySelectorAll(".bar").forEach((b) => {
      const show = (e) => { const i = +b.dataset.i; const rows = o.series.map((se) => `<div class="tt-row"><span><span class="sw" style="display:inline-block;background:${se.color};margin-right:6px"></span>${esc(se.name)}</span><strong>${esc(fmt(se.values[i]))}</strong></div>`).join(""); showTip(`<div class="tt-title">${esc(o.labels[i])}</div>${rows}`, e.clientX, e.clientY); };
      b.addEventListener("mousemove", show); b.addEventListener("click", show); b.addEventListener("mouseleave", hideTip);
    });
  }
  mount(host, draw); host.classList.remove("chart");
}

// Horizontal bars as accessible rows. items: [{label,value,detail,color}]
export function hbars(el, items, { fmt = (v) => v, max, color = "var(--chart-1)" } = {}) {
  const mx = max != null ? max : niceMax(Math.max(...items.map((i) => i.value), 0.0001));
  el.innerHTML = `<div class="stack" style="gap:12px" role="list">${items.map((i) => `<div role="listitem" title="${esc(i.detail || "")}" style="display:grid;grid-template-columns:minmax(96px,160px) minmax(0,1fr) 56px;gap:12px;align-items:center;font-size:var(--t-secondary)"><span class="trunc">${esc(i.label)}</span><span class="bar-cell"><span class="track" style="height:10px"><span class="fill" style="display:block;width:${Math.min(100, (i.value / mx) * 100)}%;background:${i.color || color}"></span></span></span><span class="num">${esc(fmt(i.value))}</span></div>${i.detail ? `<div class="meta" style="margin:-8px 0 0 172px">${esc(i.detail)}</div>` : ""}`).join("")}</div>`;
}

export function donut(el, items, { total, center = "customers", fmt = (v) => v.toLocaleString("en-IN") } = {}) {
  const sum = items.reduce((a, b) => a + b.value, 0) || 1, size = 168, r = 64, sw = 24, c = 2 * Math.PI * r;
  let off = 0, arcs = "";
  items.forEach((it, i) => {
    const len = (it.value / sum) * c;
    arcs += `<circle class="arc" data-i="${i}" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${it.color}" stroke-width="${sw}" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-off}" transform="rotate(-90 ${size / 2} ${size / 2})"/>`;
    off += len;
  });
  el.innerHTML = `<div class="donut-wrap"><svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Distribution: ${esc(items.map((i) => `${i.name} ${fmt(i.value)}`).join(", "))}">${arcs}<text x="${size / 2}" y="${size / 2 - 2}" text-anchor="middle" style="font-size:20px;font-weight:600;fill:var(--text)">${esc(fmt(total ?? sum))}</text><text x="${size / 2}" y="${size / 2 + 16}" text-anchor="middle">${esc(center)}</text></svg>
  <div class="donut-legend">${items.map((i) => `<div class="line"><span class="item" style="display:inline-flex;align-items:center;gap:8px"><span class="sw" style="width:10px;height:10px;border-radius:2px;background:${i.color}"></span>${esc(i.name)}</span><span><strong style="font-weight:500">${esc(fmt(i.value))}</strong> <span class="meta">${((i.value / sum) * 100).toFixed(1)}%</span></span></div>`).join("")}</div></div>`;
  el.querySelectorAll(".arc").forEach((a) => {
    const show = (e) => { const it = items[+a.dataset.i]; showTip(`<div class="tt-title">${esc(it.name)}</div><div>${esc(fmt(it.value))} (${((it.value / sum) * 100).toFixed(1)}%)</div>`, e.clientX, e.clientY); };
    a.addEventListener("mousemove", show); a.addEventListener("click", show); a.addEventListener("mouseleave", hideTip);
  });
}

export function sparkline(values, color = "var(--chart-1)") {
  const v = values.filter((x) => x != null); if (v.length < 2) return "";
  const w = 120, h = 28, mn = Math.min(...v), mx = Math.max(...v), rng = mx - mn || 1;
  const pts = v.map((x, i) => `${((i / (v.length - 1)) * (w - 4) + 2).toFixed(1)},${(h - 3 - ((x - mn) / rng) * (h - 6)).toFixed(1)}`).join(" ");
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
}

// Heat colour: single-hue ramp from tint to accent. Text flips to white when dark.
export function heatStyle(v, lo = 0, hi = 1) {
  const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo || 1)));
  const l = 96 - t * 52, s = 70 + t * 10;
  return `background:hsl(222 ${s}% ${l}%);color:${l < 62 ? "#fff" : "var(--text)"}`;
}
