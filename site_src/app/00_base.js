/* LIC-Audit site, shared part: data, state, helpers, marks and the board model.
   The build concatenates site_src/app/*.js in name order inside one function scope. */
var L = window.LICAudit;
var DATA = JSON.parse(document.getElementById('lic-data').textContent);
var P = DATA.protocol, BOARD = DATA.board, REM = DATA.remeasured, CLAIMS = DATA.claims, EXPLORER = DATA.explorer, CFG = DATA.config || {};
var DS = ['kodak', 'tecnick', 'clic_pv'];
var DS_ALL = ['kodak', 'tecnick', 'clic_pv', 'div2k'];
var DS_LABEL = { kodak: 'Kodak', tecnick: 'Tecnick', clic_pv: 'CLIC Pro', div2k: 'DIV2K' };
var MINUS = '−', NDASH = '–';
var EVIDENCE = { 1: 'Curve only', 2: 'Measurement stated', 3: 'Per-image records', 4: 'Re-measured' };
var EVIDENCE_LONG = {
  1: 'A numeric curve at a pinned public commit. How bits and PSNR were measured is not fully stated.',
  2: 'The curve, and the measurement is stated on the common basis: written bits, 8-bit RGB PSNR, mean over images.',
  3: 'The curve, the stated measurement, and one record per image and operating point that reproduces the curve.',
  4: 'The public checkpoint, measured by LIC-Audit under one set of definitions.'
};
var FAMILY = { E: 'Entropy model', T: 'Transform', R: 'Rate control and efficiency', O: 'Overfitted codec' };
var FAMILY_ORDER = ['E', 'T', 'R', 'O'];
var CONV = { D: 'rate accounting and averaging stated', P: 'one of rate accounting and averaging stated', U: 'not stated' };
var TIER = { A: 'the authors’ repository', B: 'a third-party transcription', C: 'a third-party run' };
var MINE = '__mine__';

var state = {
  view: 'leaderboard', ds: 'kodak', board: 'curves', sigma: 'calibrated', query: '',
  focus: {}, hover: null, open: null, showMine: true, showContext: false,
  remDs: 'kodak', remQ: 'psnr', remFocus: null, remOpen: null,
  claimsDs: 'clic_pv', claimsHover: null,
  cmp: { a: null, b: null },
  mine: { kodak: { text: '' }, tecnick: { text: '' }, clic_pv: { text: '' } },
  form: { name: '', year: String(new Date().getFullYear()), venue: '', family: '', paper: '', repo: '', commit: '', path: '', contact: '', weights: '', code: '',
          rate: 'unknown', psnr: 'unknown', agg: 'unknown' },
  data: { ds: 'all', metric: 'all', role: 'all', tier: 'all', where: 'all', q: '', picked: [], tab: 'curves', limit: 40 },
  guide: null
};

/* ---------------------------------------------------------------- small helpers */
function $(sel, root) { return (root || document).querySelector(sel); }
function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
function append(e, c) {
  if (c === null || c === undefined || c === false) return;
  if (Array.isArray(c)) { c.forEach(function (x) { append(e, x); }); return; }
  e.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
}
function build(e, props, kids) {
  if (props) Object.keys(props).forEach(function (k) {
    var v = props[k];
    if (v === null || v === undefined || v === false) return;
    if (k === 'class') e.setAttribute('class', v);
    else if (k === 'text') e.textContent = v;
    else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  });
  for (var i = 0; i < kids.length; i++) append(e, kids[i]);
  return e;
}
// h('div', {class: 'x'}, child, 'text', [more]); text always goes in as text nodes, never as markup
function h(tag, props) { return build(document.createElement(tag), props, Array.prototype.slice.call(arguments, 2)); }
function sv(tag, props) { return build(document.createElementNS('http://www.w3.org/2000/svg', tag), props, Array.prototype.slice.call(arguments, 2)); }
function clear(e) { while (e.firstChild) e.removeChild(e.firstChild); return e; }

function pct(x, d) {
  if (x === null || x === undefined || !isFinite(x)) return 'n/a';
  var dd = d === undefined ? 2 : d, s = Math.abs(x).toFixed(dd);
  if (Number(s) === 0) return (0).toFixed(dd) + '%';
  return (x < 0 ? MINUS : '+') + s + '%';
}
function unsigned(x, d) { return Math.abs(x).toFixed(d === undefined ? 2 : d) + '%'; }
function num(x, d) { return (x === null || x === undefined || !isFinite(x)) ? 'n/a' : (x < 0 ? MINUS : '') + Math.abs(x).toFixed(d); }
function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
function listNames(names, max) {
  if (names.length <= max) return names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names.join('');
  return names.slice(0, max).join(', ') + ' and ' + (names.length - max) + ' more';
}
function dsLabel(ds) { return DS_LABEL[ds] || ds; }
function sigmaValue() { return P.sigma[state.sigma].value; }
function limitFor(ds) { return L.limit(sigmaValue(), P.datasets[ds].n_images); }
function store(key, val) { try { localStorage.setItem('lic-audit:' + key, JSON.stringify(val)); } catch (e) { /* storage may be unavailable */ } }
function load(key) { try { var v = localStorage.getItem('lic-audit:' + key); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
function fmtInt(n) { return Number(n).toLocaleString('en-US'); }
function ratioToPct(r) { return (Math.pow(10, r) - 1) * 100; }
function pctToRatio(p) { return Math.log10(1 + p / 100); }

var toastTimer = null;
function toast(msg) {
  var t = $('#toast') || document.body.appendChild(h('div', { class: 'toast', id: 'toast', role: 'status' }));
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 2800);
}
function copyText(text, done) {
  var ok = function () { toast(done || 'Copied'); };
  var fallback = function () {
    var ta = h('textarea', { 'aria-hidden': 'true', style: 'position:fixed;left:-999px;top:0' });
    ta.value = text; document.body.appendChild(ta); ta.select();
    var good = false;
    try { good = document.execCommand('copy'); } catch (e) { good = false; }
    document.body.removeChild(ta);
    if (good) ok(); else toast('Copying is blocked here. Select the text and copy it by hand.');
  };
  try { navigator.clipboard.writeText(text).then(ok, fallback); } catch (e) { fallback(); }
}
// Saves a text file. Inside the Claude viewer a page may not start a download itself, so the viewer's own save dialog
// is used when it is offered; everywhere else this is an ordinary browser download.
function saveFile(name, text, type) {
  var direct = function () {
    try {
      var a = h('a', { href: URL.createObjectURL(new Blob([text], { type: type || 'application/json' })), download: name });
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    } catch (e) { toast('Downloads are blocked here. Use the copy button.'); }
  };
  if (window.claude && typeof window.claude.use === 'function') {
    toast('Preparing the file…');
    window.claude.use('downloads').then(function (d) {
      if (!d) { direct(); toast('If no download starts here, use the copy button.'); return; }
      d.save({ filename: name, data: text }).then(function () { toast('Saved'); }, function (err) {
        if (!err || err.code !== 'declined') toast('The file could not be saved here. Use the copy button.');
      });
    }, direct);
  } else direct();
}

/* ---------------------------------------------------------------- tooltip */
var tipEl = $('#tip');
function showTip(evt, content) {
  clear(tipEl); append(tipEl, content); tipEl.hidden = false;
  var pad = 14, r = tipEl.getBoundingClientRect(), x, y;
  if (evt && evt.clientX !== undefined && (evt.clientX || evt.clientY)) { x = evt.clientX + pad; y = evt.clientY + pad; }
  else { var b = evt.target.getBoundingClientRect(); x = b.left + b.width / 2 + pad; y = b.bottom + 6; }
  if (x + r.width > window.innerWidth - 8) x = Math.max(8, x - r.width - 2 * pad);
  if (y + r.height > window.innerHeight - 8) y = Math.max(8, y - r.height - 2 * pad);
  tipEl.style.left = x + 'px'; tipEl.style.top = y + 'px';
}
function hideTip() { tipEl.hidden = true; }

/* ---------------------------------------------------------------- marks: status chips, evidence, families */
function icon(kind) {
  var a = { width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': 'true' };
  if (kind === 'resolved') return sv('svg', a, sv('path', { d: 'M2 6.4l2.6 2.6L10 3.4', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  if (kind === 'within') return sv('svg', a, sv('path', { d: 'M2 4.2h8M2 7.8h8', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round' }));
  if (kind === 'unstable') return sv('svg', a, sv('path', { d: 'M2 4h7M7 2l2 2-2 2M10 8H3M5 6L3 8l2 2', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  return sv('svg', a, sv('path', { d: 'M3 6h6', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round' }));
}
var STATUS_SHORT = { resolved: 'Resolved', within: 'Within margin', unstable: 'Unstable', no_coverage: 'No comparison', unresolved: 'Not resolved' };
var STATUS_TEXT = { resolved: 'Resolved', within: 'Within the margin', unstable: 'Sign depends on the computation', no_coverage: 'No comparison', unresolved: 'Not resolved' };
function chip(status, text) {
  var cls = status === 'unresolved' ? 'within' : (status === 'no_coverage' ? 'none' : status);
  return h('span', { class: 'chip ' + cls }, icon(cls === 'none' ? 'none' : cls), text || STATUS_TEXT[status]);
}
// Evidence: signal-strength bars plus a word, so the level reads without a legend.
function evidenceBars(level, size) {
  var s = size || 1, g = sv('svg', { width: 19 * s, height: 14 * s, viewBox: '0 0 19 14', 'aria-hidden': 'true', class: 'evbars' });
  for (var i = 1; i <= 4; i++) {
    var hgt = 2 + i * 3;
    g.appendChild(sv('rect', { x: (i - 1) * 5, y: 14 - hgt, width: 3.6, height: hgt, rx: 0.9, class: i <= level ? 'on' : 'off' }));
  }
  return g;
}
function evidenceBadge(level) {
  return h('span', { class: 'ev ev' + level, title: EVIDENCE_LONG[level], role: 'img', 'aria-label': 'Evidence level ' + level + ' of 4: ' + EVIDENCE[level] },
           evidenceBars(level), h('span', { text: EVIDENCE[level] }));
}
function famDot(f, big) {
  var known = FAMILY[f] ? f : 'X';
  return h('span', { class: 'fdot f' + known.toLowerCase() + (big ? ' big' : ''), title: FAMILY[f] || 'Not classified', 'aria-hidden': 'true' });
}
function famColor(f) { return { E: 'var(--f-e)', T: 'var(--f-t)', R: 'var(--f-r)' }[f] || 'none'; }
function sourceLink(src) {
  if (!src || !src.repo) return h('span', { class: 'muted', text: 'not submitted' });
  var url = 'https://github.com/' + src.repo + (src.commit && src.path ? '/blob/' + src.commit + '/' + src.path.split('/').map(encodeURIComponent).join('/') : '');
  return h('span', { class: 'srclink' },
    h('a', { class: 'repo', href: url, target: '_blank', rel: 'noopener', title: src.repo + (src.path ? ', ' + src.path : '') + (src.commit ? ', commit ' + src.commit.slice(0, 10) : ''), text: src.repo }),
    src.commit ? h('span', { class: 'muted num', text: ' @' + src.commit.slice(0, 7) }) : null);
}
function licenseText(l) { return { none_found: 'no license found', unclear: 'non-standard license' }[l] || l || 'n/a'; }

function segButtons(box, options, current, onPick) {
  clear(box);
  options.forEach(function (o) {
    box.appendChild(h('button', { type: 'button', 'aria-pressed': String(o.value === current), text: o.label, title: o.title || null, onclick: function () { onPick(o.value); } }));
  });
}
function dsOptions(list) { return (list || DS).map(function (d) { return { value: d, label: dsLabel(d) }; }); }

/* ---------------------------------------------------------------- board model */
function mineEntry(ds) {
  var m = state.mine[ds];
  if (!m || !m.result || !m.result.scored) return null;
  return { key: MINE, name: state.form.name.trim() || 'Your method', mine: true, year: Number(state.form.year) || new Date().getFullYear(),
           venue: null, family: state.form.family || null, canonical: m.result.score, cells: m.result.cells, points: m.result.points,
           evidence: m.result.evidence, conventions: m.result.conventions, source: null, range: null, n_points: m.result.points.length,
           span_db: m.result.span, origin: 'mine', other_curves: [] };
}
function entriesFor(ds, withMine) {
  var rows = BOARD.entries[ds].slice(), me = withMine ? mineEntry(ds) : null;
  if (me) { rows.push(me); rows.sort(function (a, b) { return a.canonical - b.canonical; }); }
  return rows;
}
function findEntry(ds, key) {
  var rows = entriesFor(ds, true);
  for (var i = 0; i < rows.length; i++) if (rows[i].key === key) return rows[i];
  return null;
}
function statusBetween(a, b, ds) { return L.statusAt(L.compare(a.cells, b.cells, P.datasets[ds].n_images), sigmaValue()); }

// Measured releases on a test set and quality, best first; pairs looked up in either direction.
function remBlock(ds, q) {
  if (q === 'msssim') return REM.extra.msssim[ds];
  if (ds === 'div2k') return REM.extra.psnr.div2k;
  var d = REM.datasets[ds];
  return { window: P.datasets[ds].window, n_images: P.datasets[ds].n_images, releases: d.releases, pairs: d.pairs, rank_first: d.rank_first };
}
function remModel(ds, q) {
  var blk = remBlock(ds, q || 'psnr'), byKey = {};
  REM.releases.forEach(function (r) { byKey[r.key] = r; });
  var rel = Object.keys(blk.releases).map(function (k) { return Object.assign({}, byKey[k], { level: blk.releases[k].level, curve: blk.releases[k].curve }); });
  rel.sort(function (a, b) { return a.level - b.level; });
  var pair = {}, inv = function (v) { return (1 / (1 + v / 100) - 1) * 100; };
  blk.pairs.forEach(function (p) {
    pair[p.a + '|' + p.b] = { estimate: p.estimate, ci: p.ci95, method: p.method, resolved: p.resolved };
    pair[p.b + '|' + p.a] = { estimate: inv(p.estimate), ci: [inv(p.ci95[1]), inv(p.ci95[0])], method: p.method, resolved: p.resolved };
  });
  return { releases: rel, pair: function (a, b) { return pair[a + '|' + b] || null; }, n: blk.n_images, window: blk.window,
           rankFirst: blk.rank_first || {}, quality: q || 'psnr', ds: ds };
}

/* ---------------------------------------------------------------- text measurement and label placement */
var measureCtx = null;
function textWidth(text, font) {
  try {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    measureCtx.font = font;
    return measureCtx.measureText(text).width;
  } catch (e) { return text.length * 6.6; }
}
// Greedy placement: items [{x, y, text, bold, priority, r}] sorted by priority; tries right, left, above, below of the
// mark; a label that collides with a placed label, a mark or the bounds is left out (the tooltip still names it).
function placeLabels(items, marks, bounds, fontSize) {
  var placed = [], out = [], fs = fontSize || 11.5;
  var hit = function (b) {
    if (b.x0 < bounds.x0 || b.x1 > bounds.x1 || b.y0 < bounds.y0 || b.y1 > bounds.y1) return true;
    for (var i = 0; i < placed.length; i++) { var p = placed[i]; if (b.x0 < p.x1 && b.x1 > p.x0 && b.y0 < p.y1 && b.y1 > p.y0) return true; }
    for (var j = 0; j < marks.length; j++) {
      var m = marks[j];
      if (m.key === b.key) continue;
      if (m.x + m.r > b.x0 && m.x - m.r < b.x1 && m.y + m.r > b.y0 && m.y - m.r < b.y1) return true;
    }
    return false;
  };
  items.slice().sort(function (a, b) { return a.priority - b.priority; }).forEach(function (it) {
    var w = textWidth(it.text, (it.bold ? '700 ' : '400 ') + fs + 'px "LA Instrument", sans-serif') + 2, hh = fs + 2, r = it.r + 3;
    var tries = [
      { x0: it.x + r, y0: it.y - hh / 2, anchor: 'start', tx: it.x + r },
      { x0: it.x - r - w, y0: it.y - hh / 2, anchor: 'end', tx: it.x - r },
      { x0: it.x - w / 2, y0: it.y - r - hh, anchor: 'middle', tx: it.x },
      { x0: it.x - w / 2, y0: it.y + r, anchor: 'middle', tx: it.x },
      { x0: it.x + r - 2, y0: it.y - r - hh + 3, anchor: 'start', tx: it.x + r - 2 },
      { x0: it.x + r - 2, y0: it.y + r - 3, anchor: 'start', tx: it.x + r - 2 },
      { x0: it.x - r + 2 - w, y0: it.y - r - hh + 3, anchor: 'end', tx: it.x - r + 2 },
      { x0: it.x - r + 2 - w, y0: it.y + r - 3, anchor: 'end', tx: it.x - r + 2 }
    ];
    for (var k = 0; k < tries.length; k++) {
      var t = tries[k], b = { x0: t.x0, x1: t.x0 + w, y0: t.y0, y1: t.y0 + hh, key: it.key };
      if (!hit(b) || it.force && k === tries.length - 1) {
        placed.push(b);
        out.push({ key: it.key, text: it.text, bold: it.bold, x: t.tx, y: t.y0 + hh - 3.5, anchor: t.anchor });
        return;
      }
    }
  });
  return out;
}

function niceTicks(lo, hi, n) {
  var span = hi - lo, step = Math.pow(10, Math.floor(Math.log10(span / n))), err = span / n / step;
  if (err >= 7.5) step *= 10; else if (err >= 3.5) step *= 5; else if (err >= 1.5) step *= 2;
  var out = [], t = Math.ceil(lo / step - 1e-9) * step;
  for (; t <= hi + 1e-9; t += step) out.push(Math.abs(t) < 1e-12 ? 0 : Number(t.toFixed(10)));
  return out;
}
function trim(v) { return String(Number(v.toFixed(3))); }
// Ticks for a BD-rate axis drawn on the ratio scale: round percentages that fit.
function pctTicks(rLo, rHi, pxPerUnit, minGap) {
  var cands = [1, 2, 5, 10, 20, 25, 50, 100], step = 100, c;
  for (c = 0; c < cands.length; c++) { if (pctToRatio(cands[c]) * pxPerUnit >= (minGap || 34)) { step = cands[c]; break; } }
  var out = [], lo = Math.ceil(ratioToPct(rLo) / step) * step, hi = ratioToPct(rHi);
  for (var p = lo; p <= hi + 1e-9; p += step) if (p > -100) out.push(p);
  return out;
}
function pctLabel(p) { return p === 0 ? '0' : (p < 0 ? MINUS : '+') + Math.abs(p) + '%'; }
