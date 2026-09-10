/**
 * Genera il report HTML: un singolo file autoconsistente, senza CDN né
 * dipendenze, apribile offline con un doppio clic. I grafici sono SVG disegnati
 * a mano dallo script incluso, che legge i colori dalle CSS custom properties —
 * così il tema chiaro/scuro funziona senza ridisegnare la palette.
 */
import type { ReportData } from './reportData'

export function renderReportHtml(data: ReportData): string {
  const runLabels = data.runs.map((r) => r.label).join(' · ')
  const totalGames = data.runs.reduce((n, r) => n + r.games, 0)
  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FOMO &amp; FUD — Report (${escapeHtml(runLabels)})</title>
<style>${CSS}</style>
</head>
<body>
<header class="topbar">
  <div>
    <h1>📈 FOMO &amp; FUD — Report di bilanciamento</h1>
    <p class="sub" id="subtitle">${totalGames.toLocaleString('it-IT')} partite · ${escapeHtml(runLabels)}</p>
  </div>
  <div class="controls">
    <button id="tableToggle" type="button">Vista tabella</button>
    <button id="themeToggle" type="button" title="Tema chiaro / scuro / automatico">Tema: auto</button>
  </div>
</header>
<main id="app"></main>
<footer class="foot">Generato il <span id="genAt"></span> · i dati grezzi restano nel file JSONL di origine</footer>
<script id="report-data" type="application/json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>
<script>${SCRIPT}</script>
</body>
</html>
`
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)
}

const CSS = `
:root {
  color-scheme: light;
  --plane: #f9f9f7;
  --surface: #fcfcfb;
  --text-primary: #0b0b0b;
  --text-secondary: #52514e;
  --text-muted: #898781;
  --grid: #e1e0d9;
  --baseline: #c3c2b7;
  --border: rgba(11,11,11,0.10);
  --series-1: #2a78d6;
  --series-2: #eb6834;
  --series-3: #1baf7a;
  --good: #0ca30c;
  --critical: #d03b3b;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --plane: #0d0d0d;
    --surface: #1a1a19;
    --text-primary: #ffffff;
    --text-secondary: #c3c2b7;
    --text-muted: #898781;
    --grid: #2c2c2a;
    --baseline: #383835;
    --border: rgba(255,255,255,0.10);
    --series-1: #3987e5;
    --series-2: #d95926;
    --series-3: #199e70;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --plane: #0d0d0d;
  --surface: #1a1a19;
  --text-primary: #ffffff;
  --text-secondary: #c3c2b7;
  --text-muted: #898781;
  --grid: #2c2c2a;
  --baseline: #383835;
  --border: rgba(255,255,255,0.10);
  --series-1: #3987e5;
  --series-2: #d95926;
  --series-3: #199e70;
}

* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--plane);
  color: var(--text-primary);
  font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
}
.topbar {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap;
  padding: 20px 24px 12px;
  max-width: 1440px; margin: 0 auto;
}
h1 { font-size: 19px; margin: 0; font-weight: 650; letter-spacing: -0.01em; }
.sub { margin: 4px 0 0; color: var(--text-secondary); font-size: 13px; }
.controls { display: flex; gap: 8px; }
button {
  font: inherit; font-size: 13px; padding: 6px 12px; border-radius: 7px;
  border: 1px solid var(--border); background: var(--surface); color: var(--text-primary); cursor: pointer;
}
button:hover { border-color: var(--baseline); }
main { max-width: 1440px; margin: 0 auto; padding: 4px 24px 40px; }

.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 18px; }
.tile {
  background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px;
}
.tile .label { color: var(--text-secondary); font-size: 12px; }
.tile .value { font-size: 24px; font-weight: 600; margin-top: 2px; letter-spacing: -0.02em; }
.tile .note { color: var(--text-muted); font-size: 11.5px; margin-top: 2px; }
.tile .value.good { color: var(--good); }
.tile .value.bad { color: var(--critical); }

.runhead {
  margin: 24px 0 10px; font-size: 13px; font-weight: 600; color: var(--text-secondary);
  text-transform: uppercase; letter-spacing: 0.06em;
}
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(390px, 1fr)); gap: 14px; }
.card {
  background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px 12px;
  min-width: 0;
}
.card.wide { grid-column: 1 / -1; }
.card h2 { font-size: 14px; margin: 0; font-weight: 600; }
.card .hint { color: var(--text-secondary); font-size: 12px; margin: 3px 0 10px; }
.legend { display: flex; flex-wrap: wrap; gap: 12px; margin: 0 0 8px; }
.legend span { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); }
.swatch { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
.facets { display: grid; gap: 10px; }
.facet-title { font-size: 12px; color: var(--text-secondary); margin-bottom: 2px; }
svg { display: block; width: 100%; overflow: visible; }
.tick { fill: var(--text-muted); font-size: 11px; }
.datalabel { fill: var(--text-secondary); font-size: 11px; font-variant-numeric: tabular-nums; }
.reflabel { fill: var(--text-muted); font-size: 10.5px; }

#tooltip {
  position: fixed; pointer-events: none; z-index: 20; opacity: 0; transition: opacity .08s;
  background: var(--surface); color: var(--text-primary);
  border: 1px solid var(--baseline); border-radius: 8px; padding: 7px 10px;
  font-size: 12px; box-shadow: 0 6px 20px rgba(0,0,0,.16); max-width: 260px;
}
#tooltip .tt-title { font-weight: 600; margin-bottom: 3px; }
#tooltip .tt-row { display: flex; align-items: center; gap: 6px; color: var(--text-secondary); }
#tooltip .tt-row b { color: var(--text-primary); font-weight: 600; font-variant-numeric: tabular-nums; margin-left: auto; }

.tablewrap { overflow-x: auto; margin-top: 6px; }
table { border-collapse: collapse; font-size: 12.5px; width: 100%; min-width: 720px; }
th, td { text-align: right; padding: 6px 10px; border-bottom: 1px solid var(--grid); white-space: nowrap; font-variant-numeric: tabular-nums; }
th:first-child, td:first-child { text-align: left; font-variant-numeric: normal; }
th { color: var(--text-secondary); font-weight: 600; }
tbody tr:hover { background: color-mix(in srgb, var(--grid) 45%, transparent); }
[hidden] { display: none !important; }
.foot { max-width: 1440px; margin: 0 auto; padding: 0 24px 28px; color: var(--text-muted); font-size: 12px; }
`

const SCRIPT = String.raw`
var D = JSON.parse(document.getElementById('report-data').textContent);
var MULTI = D.runs.length > 1;
var NS = 'http://www.w3.org/2000/svg';
var tooltip = document.createElement('div');
tooltip.id = 'tooltip';
document.body.appendChild(tooltip);

function svgEl(tag, attrs, parent) {
  var n = document.createElementNS(NS, tag);
  for (var k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
}
function h(tag, cls, text, parent) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== null && text !== undefined) n.textContent = text;
  if (parent) parent.appendChild(n);
  return n;
}
function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function seriesColor(i) { return cssVar('--series-' + (i % 3 + 1)); }
function pct(v, d) { return (v * 100).toFixed(d === undefined ? 1 : d) + '%'; }
function num(v, d) { return v.toFixed(d === undefined ? 1 : d); }

function showTip(evt, title, rows) {
  var html = '<div class="tt-title">' + title + '</div>';
  for (var i = 0; i < rows.length; i++) {
    var sw = rows[i].color ? '<span class="swatch" style="background:' + rows[i].color + '"></span>' : '';
    html += '<div class="tt-row">' + sw + rows[i].label + '<b>' + rows[i].value + '</b></div>';
  }
  tooltip.innerHTML = html;
  tooltip.style.opacity = '1';
  moveTip(evt);
}
function moveTip(evt) {
  var pad = 14;
  var w = tooltip.offsetWidth, ht = tooltip.offsetHeight;
  var x = evt.clientX + pad, y = evt.clientY + pad;
  if (x + w > window.innerWidth - 8) x = evt.clientX - w - pad;
  if (y + ht > window.innerHeight - 8) y = evt.clientY - ht - pad;
  tooltip.style.left = x + 'px';
  tooltip.style.top = y + 'px';
}
function hideTip() { tooltip.style.opacity = '0'; }
function hover(node, title, rows) {
  node.addEventListener('pointerenter', function (e) { showTip(e, title, rows); });
  node.addEventListener('pointermove', moveTip);
  node.addEventListener('pointerleave', hideTip);
}

// --- estremi asse -----------------------------------------------------------
var LADDER = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
function niceMax(v) {
  if (v <= 0) return 1;
  var mag = Math.pow(10, Math.floor(Math.log10(v)));
  var norm = v / mag;
  for (var i = 0; i < LADDER.length; i++) if (norm <= LADDER[i] + 1e-9) return LADDER[i] * mag;
  return 10 * mag;
}
function roundedRect(x, y, w, ht, r, side) {
  // side: 'top' | 'right' — arrotonda solo l'estremità del dato, mai la base.
  var rr = Math.max(0, Math.min(r, side === 'top' ? Math.min(w / 2, ht) : Math.min(ht / 2, w)));
  if (side === 'top') {
    return 'M' + x + ',' + (y + ht) + 'V' + (y + rr) + 'a' + rr + ',' + rr + ' 0 0 1 ' + rr + ',' + -rr +
      'h' + (w - 2 * rr) + 'a' + rr + ',' + rr + ' 0 0 1 ' + rr + ',' + rr + 'V' + (y + ht) + 'Z';
  }
  return 'M' + x + ',' + y + 'h' + (w - rr) + 'a' + rr + ',' + rr + ' 0 0 1 ' + rr + ',' + rr +
    'v' + (ht - 2 * rr) + 'a' + rr + ',' + rr + ' 0 0 1 ' + -rr + ',' + rr + 'H' + x + 'Z';
}

// --- grafico a barre --------------------------------------------------------
// spec: { categories, series:[{name,color,values}], mode:'single'|'grouped'|'stacked',
//         horizontal, refLine:{value,label}, format, height, labelValues }
function barChart(host, spec) {
  host.innerHTML = '';
  var width = host.clientWidth || 380;
  var fmt = spec.format || function (v) { return num(v); };
  var horizontal = !!spec.horizontal;
  var cats = spec.categories;
  var stacked = spec.mode === 'stacked';

  var totals = cats.map(function (_, i) {
    if (stacked) return spec.series.reduce(function (a, s) { return a + s.values[i]; }, 0);
    return Math.max.apply(null, spec.series.map(function (s) { return s.values[i]; }));
  });
  var maxValue = spec.yMax !== undefined
    ? spec.yMax
    : niceMax(Math.max.apply(null, totals.concat(spec.refLine ? [spec.refLine.value] : [])));

  var labelWidth = horizontal ? Math.min(150, 8 + Math.max.apply(null, cats.map(function (c) { return c.length * 6.6; }))) : 46;
  var groups = spec.mode === 'grouped' ? spec.series.length : 1;
  var m = horizontal
    ? { t: spec.refLine ? 18 : 6, r: 52, b: 24, l: labelWidth }
    : { t: 16, r: 10, b: 34, l: labelWidth };
  var plotW = Math.max(60, width - m.l - m.r);
  var band = horizontal ? 18 + groups * 9 : 0;
  var height = spec.height || (horizontal ? m.t + m.b + cats.length * band : 210);
  var plotH = Math.max(60, height - m.t - m.b);

  var svg = svgEl('svg', { viewBox: '0 0 ' + width + ' ' + height, height: height }, host);
  var scale = function (v) { return (v / maxValue) * (horizontal ? plotW : plotH); };

  // griglia + tick: nei pannelli stretti 5 etichette numeriche si sovrappongono
  var ticks = (horizontal ? plotW : plotH) < 230 ? 2 : 4;
  for (var t = 0; t <= ticks; t++) {
    var value = (maxValue / ticks) * t;
    if (horizontal) {
      var gx = m.l + scale(value);
      svgEl('line', { x1: gx, y1: m.t, x2: gx, y2: m.t + plotH, stroke: cssVar('--grid'), 'stroke-width': 1 }, svg);
      svgEl('text', { x: gx, y: height - 8, 'text-anchor': 'middle', class: 'tick' }, svg).textContent = fmt(value);
    } else {
      var gy = m.t + plotH - scale(value);
      svgEl('line', { x1: m.l, y1: gy, x2: m.l + plotW, y2: gy, stroke: cssVar('--grid'), 'stroke-width': 1 }, svg);
      svgEl('text', { x: m.l - 8, y: gy + 4, 'text-anchor': 'end', class: 'tick' }, svg).textContent = fmt(value);
    }
  }

  var slot = (horizontal ? plotH : plotW) / cats.length;
  var groupCount = groups;
  // Con molti bin le etichette si sovrappongono: ne mostro una ogni k.
  var labelEvery = horizontal ? 1 : Math.max(1, Math.ceil(26 / slot));
  var thickness = Math.max(4, (slot * 0.66) / groupCount - (groupCount > 1 ? 2 : 0));

  cats.forEach(function (cat, i) {
    var center = i * slot + slot / 2;
    var stackAcc = 0;
    spec.series.forEach(function (s, si) {
      var v = s.values[i];
      var len = scale(v);
      var offset = stacked || spec.mode === 'single'
        ? -thickness / 2
        : (si - (groupCount - 1) / 2) * (thickness + 2) - thickness / 2;
      var node;
      if (horizontal) {
        var y = m.t + center + offset;
        var x = m.l + (stacked ? scale(stackAcc) : 0);
        var w = Math.max(stacked ? 0 : 1, len - (stacked ? 2 : 0));
        node = svgEl('path', { d: roundedRect(x, y, Math.max(0.5, w), thickness, 4, 'right'), fill: s.color }, svg);
      } else {
        var bx = m.l + center + offset;
        var base = stacked ? scale(stackAcc) : 0;
        var by = m.t + plotH - base - len + (stacked ? 2 : 0);
        node = svgEl('path', {
          d: roundedRect(bx, by, thickness, Math.max(0.5, len - (stacked ? 2 : 0)), 4, 'top'),
          fill: s.color,
        }, svg);
      }
      hover(node, cat, [{ color: s.color, label: s.name, value: fmt(v) }]);
      if (stacked) stackAcc += v;
    });

    // etichetta di categoria
    if (horizontal) {
      svgEl('text', { x: m.l - 8, y: m.t + center + 4, 'text-anchor': 'end', class: 'tick' }, svg).textContent = cat;
    } else if (i % labelEvery === 0) {
      svgEl('text', { x: m.l + center, y: height - 12, 'text-anchor': 'middle', class: 'tick' }, svg).textContent = cat;
    }

    // etichetta diretta del valore: solo quando c'è una sola serie e c'è spazio
    if (spec.labelValues !== false && (spec.mode === 'single' || spec.series.length === 1) && cats.length <= 14) {
      var total = spec.series[0].values[i];
      if (horizontal) {
        svgEl('text', { x: m.l + scale(total) + 7, y: m.t + center + 4, class: 'datalabel' }, svg).textContent = fmt(total);
      } else {
        svgEl('text', { x: m.l + center, y: m.t + plotH - scale(total) - 6, 'text-anchor': 'middle', class: 'datalabel' }, svg).textContent = fmt(total);
      }
    }
  });

  // linea di riferimento (una soglia: tratteggiata di proposito)
  if (spec.refLine) {
    var rv = scale(spec.refLine.value);
    if (horizontal) {
      svgEl('line', { x1: m.l + rv, y1: m.t, x2: m.l + rv, y2: m.t + plotH, stroke: cssVar('--text-muted'), 'stroke-width': 1, 'stroke-dasharray': '3 3' }, svg);
      svgEl('text', { x: m.l + rv, y: m.t - 6, 'text-anchor': 'middle', class: 'reflabel' }, svg).textContent = spec.refLine.label;
    } else {
      var ry = m.t + plotH - rv;
      svgEl('line', { x1: m.l, y1: ry, x2: m.l + plotW, y2: ry, stroke: cssVar('--text-muted'), 'stroke-width': 1, 'stroke-dasharray': '3 3' }, svg);
      svgEl('text', { x: m.l + plotW, y: ry - 5, 'text-anchor': 'end', class: 'reflabel' }, svg).textContent = spec.refLine.label;
    }
  }

  // asse di base
  if (horizontal) svgEl('line', { x1: m.l, y1: m.t, x2: m.l, y2: m.t + plotH, stroke: cssVar('--baseline'), 'stroke-width': 1 }, svg);
  else svgEl('line', { x1: m.l, y1: m.t + plotH, x2: m.l + plotW, y2: m.t + plotH, stroke: cssVar('--baseline'), 'stroke-width': 1 }, svg);
}

// --- grafico a linee --------------------------------------------------------
// spec: { x:[labels], series:[{name,color,values}], format, yMin, yMax }
function lineChart(host, spec) {
  host.innerHTML = '';
  var width = host.clientWidth || 380;
  var height = spec.height || 220;
  var fmt = spec.format || function (v) { return num(v, 2); };
  var m = { t: 12, r: 54, b: 30, l: 44 };
  var plotW = Math.max(60, width - m.l - m.r);
  var plotH = height - m.t - m.b;

  var flat = [];
  spec.series.forEach(function (s) { flat = flat.concat(s.values); });
  var lo, hi;
  if (spec.yMin !== undefined && spec.yMax !== undefined) {
    lo = spec.yMin; hi = spec.yMax;
  } else {
    lo = spec.yMin !== undefined ? spec.yMin : Math.min.apply(null, flat);
    hi = spec.yMax !== undefined ? spec.yMax : Math.max.apply(null, flat);
    var pad = (hi - lo) * 0.2 || 0.5;
    lo = lo - pad; hi = hi + pad;
    var step = niceMax((hi - lo) / 4);
    lo = Math.floor(lo / step) * step;
    hi = lo + step * 4;
  }

  var svg = svgEl('svg', { viewBox: '0 0 ' + width + ' ' + height, height: height }, host);
  var X = function (i) { return m.l + (spec.x.length === 1 ? plotW / 2 : (i / (spec.x.length - 1)) * plotW); };
  var Y = function (v) { return m.t + plotH - ((v - lo) / (hi - lo)) * plotH; };

  for (var t = 0; t <= 4; t++) {
    var value = lo + ((hi - lo) / 4) * t;
    var gy = Y(value);
    svgEl('line', { x1: m.l, y1: gy, x2: m.l + plotW, y2: gy, stroke: cssVar('--grid'), 'stroke-width': 1 }, svg);
    svgEl('text', { x: m.l - 8, y: gy + 4, 'text-anchor': 'end', class: 'tick' }, svg).textContent = fmt(value);
  }
  spec.x.forEach(function (label, i) {
    svgEl('text', { x: X(i), y: height - 10, 'text-anchor': 'middle', class: 'tick' }, svg).textContent = label;
  });
  if (spec.refValue !== undefined) {
    svgEl('line', { x1: m.l, y1: Y(spec.refValue), x2: m.l + plotW, y2: Y(spec.refValue), stroke: cssVar('--text-muted'), 'stroke-width': 1, 'stroke-dasharray': '3 3' }, svg);
    svgEl('text', { x: m.l + 4, y: Y(spec.refValue) - 5, class: 'reflabel' }, svg).textContent = spec.refLabel || '';
  }

  var endLabels = [];
  spec.series.forEach(function (s) {
    var d = s.values.map(function (v, i) { return (i ? 'L' : 'M') + X(i) + ',' + Y(v); }).join('');
    svgEl('path', { d: d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
    s.values.forEach(function (v, i) {
      svgEl('circle', { cx: X(i), cy: Y(v), r: 4, fill: s.color, stroke: cssVar('--surface'), 'stroke-width': 2 }, svg);
    });
    var last = s.values.length - 1;
    endLabels.push({ y: Y(s.values[last]), name: s.name, x: X(last) + 9 });
  });
  // etichetta diretta all'ultimo punto, separata di 12px quando le linee convergono
  endLabels.sort(function (a, b) { return a.y - b.y; });
  for (var li = 1; li < endLabels.length; li++) {
    if (endLabels[li].y - endLabels[li - 1].y < 12) endLabels[li].y = endLabels[li - 1].y + 12;
  }
  // In un pannello stretto le etichette sborderebbero: lì basta la legenda.
  if (plotW >= 190) {
    endLabels.forEach(function (l) {
      svgEl('text', { x: l.x, y: l.y + 4, class: 'datalabel', fill: cssVar('--text-secondary') }, svg).textContent = l.name;
    });
  }

  // crosshair su tutta la colonna
  var crosshair = svgEl('line', { y1: m.t, y2: m.t + plotH, stroke: cssVar('--baseline'), 'stroke-width': 1, opacity: 0 }, svg);
  var overlay = svgEl('rect', { x: m.l, y: m.t, width: plotW, height: plotH, fill: 'transparent' }, svg);
  overlay.addEventListener('pointermove', function (e) {
    var box = svg.getBoundingClientRect();
    var rel = ((e.clientX - box.left) / box.width) * width;
    var i = Math.max(0, Math.min(spec.x.length - 1, Math.round(((rel - m.l) / plotW) * (spec.x.length - 1))));
    crosshair.setAttribute('x1', X(i)); crosshair.setAttribute('x2', X(i)); crosshair.setAttribute('opacity', 1);
    showTip(e, spec.xTitle ? spec.xTitle + ' ' + spec.x[i] : spec.x[i], spec.series.map(function (s) {
      return { color: s.color, label: s.name, value: fmt(s.values[i]) };
    }));
  });
  overlay.addEventListener('pointerleave', function () { crosshair.setAttribute('opacity', 0); hideTip(); });
  svgEl('line', { x1: m.l, y1: m.t + plotH, x2: m.l + plotW, y2: m.t + plotH, stroke: cssVar('--baseline'), 'stroke-width': 1 }, svg);
}

// --- impalcatura ------------------------------------------------------------
var charts = [];
function card(parent, title, hint, wide) {
  var c = h('div', 'card' + (wide ? ' wide' : ''), null, parent);
  h('h2', null, title, c);
  if (hint) h('p', 'hint', hint, c);
  return c;
}
function legend(parent, entries) {
  var l = h('div', 'legend', null, parent);
  entries.forEach(function (e) {
    var s = h('span', null, null, l);
    var sw = h('span', 'swatch', null, s);
    sw.style.background = e.color;
    h('span', null, e.name, s);
  });
}
function plot(parent, spec, renderer) {
  var host = h('div', null, null, parent);
  charts.push(function () { renderer(host, spec); });
  return host;
}
function specMax(spec) {
  if (!spec.categories) return 0;
  return Math.max.apply(null, spec.categories.map(function (_, i) {
    if (spec.mode === 'stacked') return spec.series.reduce(function (a, s) { return a + s.values[i]; }, 0);
    return Math.max.apply(null, spec.series.map(function (s) { return s.values[i]; }));
  }));
}
function facets(parent, items) {
  var wrap = h('div', 'facets', null, parent);
  wrap.style.gridTemplateColumns = 'repeat(auto-fit, minmax(' + (items.length > 2 ? 200 : 260) + 'px, 1fr))';
  // Pannelli affiancati devono condividere la scala, altrimenti il confronto mente.
  var bars = items.filter(function (it) { return !it.renderer; });
  var sharedBar = bars.length ? niceMax(Math.max.apply(null, bars.map(function (it) { return specMax(it.spec); }))) : 0;
  var lineValues = [];
  items.forEach(function (it) {
    if (it.renderer === lineChart) it.spec.series.forEach(function (se) { lineValues = lineValues.concat(se.values); });
  });
  var lineLo, lineHi;
  if (lineValues.length) {
    lineLo = Math.min.apply(null, lineValues);
    lineHi = Math.max.apply(null, lineValues);
    var span = (lineHi - lineLo) * 0.15 || 0.5;
    var lineStep = niceMax((lineHi - lineLo + 2 * span) / 4);
    lineLo = Math.floor((lineLo - span) / lineStep) * lineStep;
    lineHi = lineLo + lineStep * 4;
  }
  items.forEach(function (item) {
    if (!item.renderer && sharedBar > 0) item.spec.yMax = sharedBar;
    if (item.renderer === lineChart && lineValues.length) { item.spec.yMin = lineLo; item.spec.yMax = lineHi; }
    var box = h('div', null, null, wrap);
    h('div', 'facet-title', item.title, box);
    plot(box, item.spec, item.renderer || barChart);
  });
}

function runSeries(pick) {
  return D.runs.map(function (run, i) {
    return { name: run.label, color: seriesColor(i), values: pick(run) };
  });
}

function build() {
  var app = document.getElementById('app');
  app.innerHTML = '';
  charts = [];
  document.getElementById('genAt').textContent = new Date(D.generatedAt).toLocaleString('it-IT');

  // --- riquadri di sintesi, uno per run ---
  D.runs.forEach(function (run) {
    if (MULTI) h('div', 'runhead', run.label, app);
    var tiles = h('div', 'tiles', null, app);
    tile(tiles, 'Partite', run.games.toLocaleString('it-IT'), run.playerCount + ' giocatori · ' + run.rounds + ' Round');
    var spread = run.agents[0].winRate - run.agents[run.agents.length - 1].winRate;
    tile(tiles, 'Scarto win rate', pct(spread), 'fra il migliore e il peggiore', spread > 0.15 ? 'bad' : 'good');
    var seatSpread = Math.max.apply(null, run.winRateBySeat) - Math.min.apply(null, run.winRateBySeat);
    tile(tiles, 'Squilibrio dei posti', pct(seatSpread), 'atteso 0% se il tavolo è equo', seatSpread > 0.05 ? 'bad' : 'good');
    tile(tiles, 'Eventi estremi', num(run.squeezesPerGame + run.crashesPerGame, 2), 'squeeze + crash per partita');
    tile(tiles, 'Scarto 1°–2°', run.medianMargin + ' PV', 'mediano: quanto sono tirate');
    tile(tiles, 'Gioco morto', pct(run.forcedDecisionRate), 'turni con una sola scelta', run.forcedDecisionRate > 0.1 ? 'bad' : 'good');
  });

  var grid = h('div', 'grid', null, app);
  var run0 = D.runs[0];
  var agentNames = run0.agents.map(function (a) { return a.agent; });
  var baseline = 1 / run0.playerCount;

  // 1. Win rate — la domanda principale
  var c1 = card(grid, 'Win rate per agente', 'La linea tratteggiata è la parità (' + pct(baseline, 0) + '). Barre sistematicamente sopra = strategia dominante.', MULTI);
  if (MULTI) legend(c1, D.runs.map(function (r, i) { return { name: r.label, color: seriesColor(i) }; }));
  plot(c1, {
    categories: agentNames,
    series: runSeries(function (run) {
      return agentNames.map(function (n) { var a = find(run, n); return a ? a.winRate : 0; });
    }),
    mode: MULTI ? 'grouped' : 'single',
    horizontal: true,
    refLine: { value: baseline, label: 'parità' },
    format: function (v) { return pct(v, 0); },
    labelValues: !MULTI,
  }, barChart);
  ci(c1, run0);

  // 2. Da dove arrivano i punti
  var c2 = card(grid, 'Da dove arrivano i PV', 'Patrimonio contro ETF. Se una fonte domina, l\'altra è decorativa.');
  legend(c2, [{ name: 'Patrimonio', color: seriesColor(0) }, { name: 'ETF', color: seriesColor(1) }]);
  if (MULTI) {
    facets(c2, D.runs.map(function (run) {
      return { title: run.label, spec: pvCompositionSpec(run, agentNames) };
    }));
  } else {
    plot(c2, pvCompositionSpec(run0, agentNames), barChart);
  }

  // 3. Prezzi
  var c3 = card(grid, 'Prezzo medio a fine Round', 'Se i tre indicatori restano incollati al valore di partenza, le carte Rumor non stanno muovendo il mercato.');
  var rounds = [];
  for (var r = 1; r <= run0.rounds; r++) rounds.push('R' + r);
  if (MULTI || run0.sectors.length > 3) {
    facets(c3, run0.sectors.map(function (sector, si) {
      return {
        title: run0.sectorLabels[si],
        renderer: lineChart,
        spec: {
          x: rounds, xTitle: 'Round', height: 170,
          series: MULTI ? runSeries(function (run) { return run.pricesByRound[si] || []; })
                        : [{ name: run0.sectorLabels[si], color: seriesColor(0), values: run0.pricesByRound[si] }],
        },
      };
    }));
  } else {
    legend(c3, run0.sectorLabels.map(function (l, i) { return { name: l, color: seriesColor(i) }; }));
    plot(c3, {
      x: rounds, xTitle: 'Round',
      series: run0.sectors.map(function (_, si) {
        return { name: run0.sectorLabels[si], color: seriesColor(si), values: run0.pricesByRound[si] };
      }),
    }, lineChart);
  }

  // 4. Commissioni del Mercato
  var positions = run0.buysByPosition.map(function (_, i) { return (i + 1) + 'ª'; });
  var c4 = card(grid, 'Acquisti per posizione del Mercato', 'Una posizione quasi mai comprata ha una commissione troppo cara. La linea è la quota uniforme.');
  if (MULTI) legend(c4, D.runs.map(function (r, i) { return { name: r.label, color: seriesColor(i) }; }));
  plot(c4, {
    categories: positions,
    series: runSeries(function (run) { return run.buysByPosition; }),
    mode: MULTI ? 'grouped' : 'single',
    refLine: { value: 1 / positions.length, label: 'uniforme' },
    format: function (v) { return pct(v, 0); },
  }, barChart);

  // 5. Ruoli
  var c5 = card(grid, 'Ruolo scelto, Round per Round', 'Se un ruolo sta sempre sopra l\'80%, l\'altro non è una scelta.');
  if (MULTI) {
    legend(c5, D.runs.map(function (r, i) { return { name: r.label, color: seriesColor(i) }; }));
    plot(c5, {
      x: rounds, xTitle: 'Round', yMin: 0, yMax: 1,
      series: runSeries(function (run) { return run.roleByRound.map(function (x) { return x.valueInvestor; }); }),
      format: function (v) { return pct(v, 0); },
      refValue: 0.5, refLabel: 'metà',
    }, lineChart);
    h('p', 'hint', 'Quota di Value Investor; il resto sono Trader.', c5);
  } else {
    legend(c5, [{ name: 'Value Investor', color: seriesColor(0) }, { name: 'Trader', color: seriesColor(1) }]);
    plot(c5, {
      categories: rounds,
      mode: 'stacked',
      series: [
        { name: 'Value Investor', color: seriesColor(0), values: run0.roleByRound.map(function (x) { return x.valueInvestor; }) },
        { name: 'Trader', color: seriesColor(1), values: run0.roleByRound.map(function (x) { return x.trader; }) },
      ],
      format: function (v) { return pct(v, 0); },
    }, barChart);
  }

  // 6. ETF
  var etfNames = run0.etfStats.map(function (e) { return e.label; });
  var c6 = card(grid, 'ETF completati sui tenuti a fine partita', 'Un ETF vicino a 0% è una carta morta; vicino a 100% è un regalo.', true);
  if (MULTI) legend(c6, D.runs.map(function (r, i) { return { name: r.label, color: seriesColor(i) }; }));
  plot(c6, {
    categories: etfNames,
    series: runSeries(function (run) {
      return etfNames.map(function (n) {
        var e = run.etfStats.filter(function (x) { return x.label === n; })[0];
        return e ? e.rate : 0;
      });
    }),
    mode: MULTI ? 'grouped' : 'single',
    horizontal: true,
    format: function (v) { return pct(v, 0); },
    labelValues: !MULTI,
  }, barChart);

  // 7. Posti
  var seats = run0.winRateBySeat.map(function (_, i) { return 'Posto ' + i; });
  var c7 = card(grid, 'Equità dei posti al tavolo', 'Chi siede dove non deve contare: tutte le barre sulla linea.');
  if (MULTI) legend(c7, D.runs.map(function (r, i) { return { name: r.label, color: seriesColor(i) }; }));
  plot(c7, {
    categories: seats,
    series: runSeries(function (run) { return run.winRateBySeat; }),
    mode: MULTI ? 'grouped' : 'single',
    refLine: { value: baseline, label: 'parità' },
    format: function (v) { return pct(v, 0); },
  }, barChart);

  // 8. Bluff
  var c8 = card(grid, 'Bluff e coerenza', 'Quante dichiarazioni sono senza carta in mano, e quante vengono poi davvero eseguite.');
  legend(c8, [{ name: 'Dichiarazioni a vuoto', color: seriesColor(0) }, { name: 'Poi eseguite', color: seriesColor(1) }]);
  if (MULTI) {
    facets(c8, D.runs.map(function (run) { return { title: run.label, spec: bluffSpec(run, agentNames) }; }));
  } else {
    plot(c8, bluffSpec(run0, agentNames), barChart);
  }

  // 9. Eventi estremi
  var c9 = card(grid, 'Short Squeeze e Crash per settore', 'Per partita. Un settore che esplode molto più degli altri è sbilanciato nelle carte.');
  legend(c9, [{ name: 'Short Squeeze', color: seriesColor(0) }, { name: 'Crash', color: seriesColor(1) }]);
  if (MULTI) {
    facets(c9, D.runs.map(function (run) { return { title: run.label, spec: closingSpec(run) }; }));
  } else {
    plot(c9, closingSpec(run0), barChart);
  }

  // 10. Distribuzione dei PV
  var c10 = card(grid, 'Distribuzione dei PV finali', 'Un agente forte sposta tutta la sua curva a destra, non solo la media.', true);
  if (MULTI) legend(c10, D.runs.map(function (r, i) { return { name: r.label, color: seriesColor(i) }; }));
  facets(c10, agentNames.map(function (name) {
    return {
      title: name,
      spec: {
        categories: binLabels(D.pvBinEdges),
        series: runSeries(function (run) {
          var a = find(run, name);
          return a ? a.pvBins.map(function (v) { return v / a.games; }) : [];
        }),
        mode: MULTI ? 'grouped' : 'single',
        height: 150,
        format: function (v) { return pct(v, 0); },
        labelValues: false,
      },
    };
  }));

  // 11. Quanto sono tirate le partite
  var c11 = card(grid, 'Scarto di PV fra 1° e 2°', 'Molte partite a 0–1 PV = finali emozionanti. Coda lunga a destra = partite già decise.');
  if (MULTI) legend(c11, D.runs.map(function (r, i) { return { name: r.label, color: seriesColor(i) }; }));
  plot(c11, {
    categories: binLabels(D.marginBinEdges),
    series: runSeries(function (run) { return run.marginBins.map(function (v) { return v / run.games; }); }),
    mode: MULTI ? 'grouped' : 'single',
    format: function (v) { return pct(v, 0); },
    labelValues: false,
  }, barChart);

  buildTable(app);
  renderAll();
}

function pvCompositionSpec(run, agentNames) {
  return {
    categories: agentNames,
    mode: 'stacked',
    horizontal: true,
    series: [
      { name: 'Patrimonio', color: seriesColor(0), values: agentNames.map(function (n) { var a = find(run, n); return a ? a.avgWealthPV : 0; }) },
      { name: 'ETF', color: seriesColor(1), values: agentNames.map(function (n) { var a = find(run, n); return a ? a.avgEtfPV : 0; }) },
    ],
    format: function (v) { return num(v, 0); },
  };
}
function bluffSpec(run, agentNames) {
  return {
    categories: agentNames,
    mode: 'grouped',
    horizontal: true,
    series: [
      { name: 'Dichiarazioni a vuoto', color: seriesColor(0), values: agentNames.map(function (n) { var a = find(run, n); return a ? a.bluffRate : 0; }) },
      { name: 'Poi eseguite', color: seriesColor(1), values: agentNames.map(function (n) { var a = find(run, n); return a ? a.followThroughRate : 0; }) },
    ],
    format: function (v) { return pct(v, 0); },
  };
}
function closingSpec(run) {
  return {
    categories: run.closingBySector.map(function (c) { return c.label; }),
    mode: 'grouped',
    series: [
      { name: 'Short Squeeze', color: seriesColor(0), values: run.closingBySector.map(function (c) { return c.squeeze; }) },
      { name: 'Crash', color: seriesColor(1), values: run.closingBySector.map(function (c) { return c.crash; }) },
    ],
    format: function (v) { return num(v, 2); },
  };
}
function binLabels(edges) {
  var out = [];
  for (var i = 0; i < edges.length - 1; i++) out.push(String(edges[i]));
  return out;
}
function find(run, agent) {
  var hits = run.agents.filter(function (a) { return a.agent === agent; });
  return hits.length ? hits[0] : null;
}
function tile(parent, label, value, note, tone) {
  var t = h('div', 'tile', null, parent);
  h('div', 'label', label, t);
  h('div', 'value' + (tone ? ' ' + tone : ''), value, t);
  if (note) h('div', 'note', note, t);
}
function ci(parent, run) {
  var worst = Math.max.apply(null, run.agents.map(function (a) { return a.winRateCi; }));
  h('p', 'hint', 'Margine di errore al 95%: ±' + pct(worst) + ' con ' + run.games.toLocaleString('it-IT') +
    ' partite. Differenze più piccole sono rumore.', parent);
}

// --- vista tabella (obbligatoria: il colore non è mai l'unico canale) --------
function buildTable(app) {
  var wrap = h('div', 'card wide', null, app);
  wrap.id = 'tableCard';
  wrap.hidden = true;
  h('h2', null, 'Tutti i numeri', wrap);
  h('p', 'hint', 'Gli stessi dati dei grafici, in forma leggibile e copiabile.', wrap);
  D.runs.forEach(function (run) {
    if (MULTI) h('div', 'runhead', run.label, wrap);
    var box = h('div', 'tablewrap', null, wrap);
    var table = h('table', null, null, box);
    var head = h('tr', null, null, h('thead', null, null, table));
    ['Agente', 'Partite', 'Win rate', 'Score', 'PV', 'Patrimonio', 'ETF', '% da ETF', 'Cash', 'Acquisti', 'Bluff', 'Eseguite', '% Value Inv.']
      .forEach(function (label) { h('th', null, label, head); });
    var body = h('tbody', null, null, table);
    run.agents.forEach(function (a) {
      var tr = h('tr', null, null, body);
      [a.agent, a.games.toLocaleString('it-IT'), pct(a.winRate) + ' ±' + pct(a.winRateCi), num(a.score, 3),
       num(a.avgPV), num(a.avgWealthPV), num(a.avgEtfPV), pct(a.etfShare), num(a.avgCash), num(a.avgBuys, 1),
       pct(a.bluffRate), pct(a.followThroughRate), pct(a.roleValueInvestor)]
        .forEach(function (v) { h('td', null, v, tr); });
    });
  });
}

function renderAll() { charts.forEach(function (draw) { draw(); }); }

// --- controlli --------------------------------------------------------------
document.getElementById('tableToggle').addEventListener('click', function () {
  var card = document.getElementById('tableCard');
  card.hidden = !card.hidden;
  this.textContent = card.hidden ? 'Vista tabella' : 'Nascondi tabella';
});
var themes = ['auto', 'light', 'dark'];
var themeIndex = 0;
document.getElementById('themeToggle').addEventListener('click', function () {
  themeIndex = (themeIndex + 1) % themes.length;
  var mode = themes[themeIndex];
  if (mode === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', mode);
  this.textContent = 'Tema: ' + mode;
  renderAll();
});
var resizeTimer;
window.addEventListener('resize', function () {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(renderAll, 120);
});
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderAll);
}
build();
`
