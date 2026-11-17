/* LIC-Audit site: the leaderboard view with its three boards (released curves, measured checkpoints, published claims). */

var lb = null;          // model of the released-curves board on screen
var progress = null;    // progress chart handle
var rowEls = {};        // table rows by key

function boardDatasets() { return state.board === 'remeasured' ? DS_ALL : DS; }
function curDs() { return state.board === 'remeasured' ? state.remDs : state.ds; }

function renderLeaderboard() {
  segButtons($('#seg-ds'), dsOptions(boardDatasets()), curDs(), function (v) {
    if (state.board === 'remeasured') { state.remDs = v; state.remOpen = null; state.remFocus = null; }
    else { state.ds = v; state.open = null; state.hover = null; }
    renderLeaderboard();
  });
  segButtons($('#seg-board'), [
    { value: 'curves', label: 'Released curves', title: 'Every released rate-distortion curve, scored on the fixed window' },
    { value: 'remeasured', label: 'Measured checkpoints', title: 'Eight public checkpoints measured by LIC-Audit under one set of definitions' },
    { value: 'claims', label: 'Published claims', title: 'BD-rates as printed in the papers, next to the fixed-window scores' }
  ], state.board, function (v) { state.board = v; state.open = null; state.hover = null; renderLeaderboard(); });
  $('#sigma-field').hidden = state.board !== 'curves';
  $('#q-field').hidden = state.board === 'claims';
  if (state.board === 'curves') renderCurvesBoard();
  else if (state.board === 'remeasured') renderRemBoard();
  else renderClaimsBoard();
}

/* ================================================================ released curves */
function curvesModel() {
  var ds = state.ds, dp = P.datasets[ds], rows = entriesFor(ds, state.showMine), lim = limitFor(ds), byKey = {};
  rows.forEach(function (e) { byKey[e.key] = e; });
  var ctx = state.showContext ? BOARD.context[ds].filter(function (c) { return c.canonical !== null; }) : [];
  ctx.forEach(function (e) { byKey[e.key] = e; });
  return {
    ds: ds, dp: dp, rows: rows, ctx: ctx, lim: lim, byKey: byKey, n: dp.n_images,
    tiedWith: function (key) {
      var f = byKey[key], t = {};
      if (!f || f.origin === 'context') return t;
      rows.forEach(function (e) { if (e.key !== key && statusBetween(f, e, ds) !== 'resolved') t[e.key] = true; });
      return t;
    },
    band: function (key) {
      var f = byKey[key];
      if (!f || f.origin === 'context') return null;
      var base = 1 + f.canonical / 100;
      return [(base * (1 - lim / 100) - 1) * 100, (base * (1 + lim / 100) - 1) * 100];
    }
  };
}

function activeKey() {
  var k = state.hover || state.focus[state.ds];
  return (k && lb.byKey[k]) ? k : lb.rows[0].key;
}

function applyFocus() {
  var fk = activeKey(), tied = lb.tiedWith(fk), f = lb.byKey[fk];
  var steps = {};
  if (progress) {
    progress.frontier.forEach(function (d, i) { if (i > 0) steps[d.key] = statusBetween(lb.byKey[progress.frontier[i - 1].key], lb.byKey[d.key], lb.ds); });
    progress.update({ selected: fk, tied: tied, band: lb.band(fk), steps: steps });
  }
  var b = lb.band(fk), tbl = $('#board table.board');
  if (tbl && b && lb.strip) {
    tbl.style.setProperty('--bl', lb.strip.pos(b[0]) + '%');
    tbl.style.setProperty('--bw', Math.max(0, lb.strip.pos(b[1]) - lb.strip.pos(b[0])) + '%');
    tbl.classList.add('has-band');
  } else if (tbl) tbl.classList.remove('has-band');
  Object.keys(rowEls).forEach(function (k) {
    rowEls[k].classList.toggle('focus', k === fk);
    rowEls[k].classList.toggle('tied', k !== fk && !!tied[k]);
  });
  var cap = $('#sel-caption');
  if (!cap || !f) return;
  clear(cap);
  var names = lb.rows.filter(function (e) { return tied[e.key]; }).map(function (e) { return e.name; });
  if (f.origin === 'context') {
    append(cap, [h('b', { text: f.name }), ' (' + f.year + ') scores ', h('b', { class: 'num', text: pct(f.canonical) }), ' against the VTM reference on ' + dsLabel(lb.ds) + '. Earlier methods are shown for context and are not ranked.']);
    return;
  }
  append(cap, [h('span', { class: 'selmark', 'aria-hidden': 'true' }), h('b', { text: f.name }), ' scores ', h('b', { class: 'num', text: pct(f.canonical) }), ' against the VTM reference on ' + dsLabel(lb.ds) + '. ']);
  append(cap, names.length
    ? ['Average curves cannot separate it from ', h('span', { class: 'hl-inline', text: plural(names.length, 'method') }), ': ' + listNames(names, 6) + ' (margin ±' + lb.lim.toFixed(2) + '%).']
    : 'Its gap to every other method exceeds the ±' + lb.lim.toFixed(2) + '% margin.');
}
function pinFocus(key) { state.focus[state.ds] = key; state.hover = null; applyFocus(); }
function hoverFocus(key) { if (state.hover === key) return; state.hover = key; applyFocus(); }

function renderCurvesBoard() {
  lb = curvesModel();
  var ds = lb.ds, dp = lb.dp, main = clear($('#board-main'));
  // explanation of this board, one sentence
  $('#board-intro').textContent = 'Every released curve that spans the fixed window of ' + dsLabel(ds) + ' (' + dp.window[0] + NDASH + dp.window[1] +
    ' dB, ' + dp.n_images + ' images), scored as a direct BD-rate against the mean of ' + dp.anchors.length + ' released VTM runs. Negative means less rate than VTM at equal PSNR.';
  // ---- chart panel
  var chartBox = h('div', { class: 'chart', id: 'progress' });
  var ctxToggle = h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'ctx-toggle', checked: state.showContext ? true : null, onchange: function (e) { state.showContext = e.target.checked; state.hover = null; renderCurvesBoard(); } }),
    'Show 2017' + NDASH + '2019 methods');
  var hasCtx = BOARD.context[ds].some(function (c) { return c.canonical !== null; });
  main.appendChild(h('div', { class: 'sheet panel' },
    h('div', { class: 'panel-head' },
      h('div', {}, h('h2', { text: 'Progress over time' }),
        h('p', { class: 'sub', text: 'Each dot is a method: its year of publication and its score. Click a dot to see which methods it cannot be separated from.' })),
      h('div', { class: 'panel-tools' }, hasCtx ? ctxToggle : null)),
    h('div', { class: 'legend legend-top' },
      FAMILY_ORDER.filter(function (f) { return lb.rows.some(function (e) { return e.family === f; }); }).map(function (f) { return h('span', {}, famDot(f), FAMILY[f]); }),
      state.showContext ? h('span', {}, h('i', { class: 'fdot fctx' }), 'earlier method, not ranked') : null,
      mineEntry(ds) && state.showMine ? h('span', {}, h('i', { class: 'star-key', text: '★' }), 'your method') : null,
      h('span', {}, h('i', { class: 'key band' }), 'margin around the selected method'),
      h('span', {}, h('i', { class: 'key run' }), 'best so far'),
      h('span', {}, h('i', { class: 'key run weak' }), 'new best within the margin')),
    chartBox,
    h('p', { class: 'caption', id: 'sel-caption', 'aria-live': 'polite' }),
    h('div', { class: 'steps-line', id: 'steps-line' })));
  var items = lb.rows.map(function (e) { return { key: e.key, name: e.name, year: e.year, score: e.canonical, family: e.family, mine: !!e.mine, venue: e.venue }; })
    .concat(lb.ctx.map(function (e) { return { key: e.key, name: e.name, year: e.year, score: e.canonical, family: e.family, context: true, venue: e.venue }; }));
  progress = progressChart(chartBox, items, { refs: dp.anchors.map(function (a) { return a.score; }), onSelect: pinFocus, onHover: hoverFocus });
  // ---- table panel
  main.appendChild(h('div', { class: 'sheet panel flush' },
    h('div', { class: 'panel-head padded' },
      h('div', {}, h('h2', { text: 'Ranking' }),
        h('p', { class: 'sub', text: 'Sorted by score. Click a row for its curve, its source and its other released curves.' })),
      h('div', { class: 'panel-tools' }, mineEntry(ds) ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: state.showMine ? true : null, onchange: function (e) { state.showMine = e.target.checked; state.hover = null; renderCurvesBoard(); } }), 'Show your method') : null)),
    evidenceLegend(),
    h('div', { class: 'tablewrap', id: 'board' })));
  main.appendChild(h('p', { class: 'note-small', id: 'board-note' }));
  curvesTable();
  stepsLine();
  applyFocus();
}

function evidenceLegend() {
  return h('div', { class: 'evlegend' },
    h('span', { class: 'evlegend-t', text: 'Evidence, what was released:' }),
    [1, 2, 3, 4].map(function (l) { return h('span', { class: 'evlegend-i', title: EVIDENCE_LONG[l] }, evidenceBars(l), h('span', { text: EVIDENCE[l] })); }));
}

function stepsLine() {
  var box = clear($('#steps-line'));
  if (!progress || progress.frontier.length < 2) return;
  box.appendChild(h('span', { class: 'steps-t', text: 'New bests on ' + dsLabel(lb.ds) + ':' }));
  progress.frontier.forEach(function (d, i) {
    var st = i ? statusBetween(lb.byKey[progress.frontier[i - 1].key], lb.byKey[d.key], lb.ds) : null;
    box.appendChild(h('span', { class: 'stepchip' + (st && st !== 'resolved' ? ' weak' : ''),
      title: i ? (st === 'resolved' ? 'The gain over ' + progress.frontier[i - 1].name + ' exceeds the margin.' : 'The gain over ' + progress.frontier[i - 1].name + ' is within the margin or depends on how BD-rate is computed.') : 'First method in the corpus' },
      h('span', { class: 'num yr', text: String(d.year) }), ' ' + d.name + ' ', h('span', { class: 'num', text: pct(d.score, 1) }),
      i ? (st === 'resolved' ? h('span', { class: 'mk', text: ' ✓' }) : h('span', { class: 'mk', text: ' ≈' })) : null));
  });
}

function matches(e, q) { return (e.name + ' ' + (e.venue || '') + ' ' + (e.year || '')).toLowerCase().indexOf(q) >= 0; }

function rowEvents(tr, key, toggle) {
  tr.addEventListener('mouseenter', function () { hoverFocus(key); });
  tr.addEventListener('mouseleave', function () { hoverFocus(null); });
  tr.addEventListener('click', function (e) { if (e.target.closest('a,button,input')) return; state.focus[state.ds] = key; toggle(); });
  tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); state.focus[state.ds] = key; toggle(); } });
}

// Shared horizontal scale of the "where it sits" column.
function stripScale(rows) {
  var vals = [0];
  rows.forEach(function (e) { vals.push(e.canonical); if (e.range) vals.push(e.range[0], e.range[1]); });
  var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), pad = (hi - lo) * 0.04 || 1;
  lo -= pad; hi += pad;
  return { lo: lo, hi: hi, pos: function (v) { return Math.max(0, Math.min(100, (v - lo) / (hi - lo) * 100)); } };
}
function stripCell(e, sc) {
  var cell = h('div', { class: 'strip' }, h('i', { class: 'szero', style: 'left:' + sc.pos(0) + '%' }), h('i', { class: 'sband' }));
  if (e.range) cell.appendChild(h('i', { class: 'swhisk', style: 'left:' + sc.pos(e.range[0]) + '%;width:' + Math.max(0.6, sc.pos(e.range[1]) - sc.pos(e.range[0])) + '%' }));
  cell.appendChild(h('i', { class: 'sdot f' + (FAMILY[e.family] ? e.family.toLowerCase() : 'x') + (e.mine ? ' mine' : ''), style: 'left:' + sc.pos(e.canonical) + '%' }));
  return cell;
}
function stripHeader(sc) {
  var ax = h('div', { class: 'strip-axis' });
  niceTicks(sc.lo, sc.hi, 4).forEach(function (t) { ax.appendChild(h('span', { style: 'left:' + sc.pos(t) + '%', text: pctLabel(t) })); });
  return h('div', {}, h('span', { class: 'th-t', text: 'Where it sits' }), ax);
}

function curvesTable() {
  var ds = lb.ds, n = lb.n, bands = L.rankBands(lb.rows, n, sigmaValue()), q = state.query.trim().toLowerCase(), sc = stripScale(lb.rows);
  lb.strip = sc;
  var box = clear($('#board')), tbody = h('tbody');
  rowEls = {};
  var NCOL = 7;
  var table = h('table', { class: 'board' },
    h('thead', {}, h('tr', {},
      h('th', { class: 'c-rank', text: '#' }), h('th', { text: 'Method' }), h('th', { class: 'r', title: 'Direct BD-rate against the VTM reference on the fixed window', text: 'BD-rate vs VTM' }),
      h('th', { class: 'c-strip' }, stripHeader(sc)),
      h('th', { class: 'c-pos', title: 'The positions of the entries this one cannot be separated from at the assumed variability', text: 'Possible positions' }),
      h('th', { class: 'c-ev', title: 'What was released for this entry', text: 'Evidence' }), h('th', { class: 'c-src', text: 'Source of the numbers' }))),
    tbody);
  var shown = 0;
  lb.rows.forEach(function (e, i) {
    if (q && !matches(e, q)) return;
    shown++;
    var b = bands[i], alone = b.tied.length === 0, open = state.open === e.key;
    var tr = h('tr', { class: 'row' + (e.mine ? ' mine' : '') + (open ? ' open' : ''), tabindex: 0, 'data-key': e.key, 'aria-expanded': String(open) },
      h('td', { class: 'rank num c-rank', text: String(i + 1) }),
      h('td', {}, h('div', { class: 'mcell' }, h('span', { class: 'caret', 'aria-hidden': 'true', text: '›' }), famDot(e.family),
        h('div', {}, h('div', { class: 'name', text: e.name }), h('div', { class: 'meta-line', text: e.mine ? 'your method, not submitted' : [e.venue, e.year].filter(Boolean).join(' ') })))),
      h('td', { class: 'r num' }, h('span', { class: 'score', text: pct(e.canonical) })),
      h('td', { class: 'c-strip' }, stripCell(e, sc)),
      h('td', { class: 'num' }, alone ? h('span', { class: 'muted', text: 'only ' + (i + 1) }) : h('span', { class: 'bandtxt on', text: (b.lo + 1) + NDASH + (b.hi + 1) })),
      h('td', { class: 'nowrap c-ev' }, evidenceBadge(e.evidence), e.remeasured ? h('div', {}, h('span', { class: 'mtag', title: 'The public checkpoint was also measured by LIC-Audit', text: 'checkpoint measured' })) : null),
      h('td', { class: 'src c-src' }, sourceLink(e.source)));
    rowEls[e.key] = tr;
    rowEvents(tr, e.key, function () { state.open = state.open === e.key ? null : e.key; curvesTable(); applyFocus(); });
    tbody.appendChild(tr);
    if (open) tbody.appendChild(h('tr', { class: 'detail' }, h('td', { colspan: NCOL }, curveDetail(e, i))));
  });
  if (!shown) tbody.appendChild(h('tr', {}, h('td', { colspan: NCOL, class: 'muted', text: 'No method matches "' + state.query + '".' })));
  // listed but not ranked
  var un = BOARD.unranked[ds] || [];
  if (un.length && !q) {
    tbody.appendChild(h('tr', { class: 'subhead' }, h('td', { colspan: NCOL }, 'Listed, not ranked: the released curve does not reach both ends of the fixed window ' + lb.dp.window[0] + NDASH + lb.dp.window[1] + ' dB')));
    un.forEach(function (u) {
      var cov = h('div', { class: 'covcell chart' });
      var tr = h('tr', { class: 'row unranked' },
        h('td', { class: 'rank c-rank muted', text: NDASH }),
        h('td', {}, h('div', { class: 'mcell' }, h('span', { class: 'caret blank' }), famDot(u.family), h('div', {}, h('div', { class: 'name', text: u.name }), h('div', { class: 'meta-line', text: [u.venue, u.year].filter(Boolean).join(' ') })))),
        h('td', { class: 'r muted', text: 'no score' }),
        h('td', { class: 'c-strip' }, cov),
        h('td', { class: 'muted small' }, 'covers', h('br'), u.span_db[0].toFixed(1) + NDASH + u.span_db[1].toFixed(1) + ' dB'),
        h('td', { class: 'nowrap c-ev' }, evidenceBadge(1)),
        h('td', { class: 'src c-src' }, sourceLink(u.source)));
      tbody.appendChild(tr);
      setTimeout(function () { coverageBar(cov, [u.span_db[0], u.span_db[1]], lb.dp.window); }, 0);
    });
  }
  // earlier methods for context
  if (state.showContext && !q) {
    var ctxAll = BOARD.context[ds];
    tbody.appendChild(h('tr', { class: 'subhead' }, h('td', { colspan: NCOL }, 'Earlier methods (2017' + NDASH + '2019), scored for context; the ranked corpus starts in 2020')));
    ctxAll.forEach(function (c) {
      var tr = h('tr', { class: 'row context', 'data-key': c.key },
        h('td', { class: 'rank c-rank muted', text: NDASH }),
        h('td', {}, h('div', { class: 'mcell' }, h('span', { class: 'caret blank' }), h('i', { class: 'fdot fctx' }), h('div', {}, h('div', { class: 'name', text: c.name }), h('div', { class: 'meta-line', text: [c.venue, c.year].filter(Boolean).join(' ') })))),
        h('td', { class: 'r num' }, c.canonical === null ? h('span', { class: 'muted', text: 'no score' }) : h('span', { class: 'score', text: pct(c.canonical, 1) })),
        c.canonical !== null && c.canonical <= sc.hi ? h('td', { class: 'c-strip' }, h('div', { class: 'strip' }, h('i', { class: 'szero', style: 'left:' + sc.pos(0) + '%' }), h('i', { class: 'sdot fctx', style: 'left:' + sc.pos(c.canonical) + '%' })))
          : h('td', { class: 'c-strip muted small', text: c.canonical === null ? 'covers ' + c.span_db[0].toFixed(1) + NDASH + c.span_db[1].toFixed(1) + ' dB' : 'beyond the scale →' }),
        h('td', { class: 'muted', text: 'not ranked' }),
        h('td', { class: 'nowrap c-ev' }, evidenceBadge(c.evidence)),
        h('td', { class: 'src c-src' }, sourceLink(c.source)));
      if (c.canonical !== null) {
        tr.addEventListener('mouseenter', function () { hoverFocus(c.key); });
        tr.addEventListener('mouseleave', function () { hoverFocus(null); });
      }
      tbody.appendChild(tr);
    });
  }
  box.appendChild(table);
  var note = clear($('#board-note'));
  append(note, 'The score is a direct BD-rate against the mean log-rate of the released VTM runs, on the fixed window, with PCHIP interpolation. ' +
    'The whisker in “Where it sits” spans the other valid ways of computing it (interpolation, point subset, window rule). ' +
    'A yellow range under “Possible positions” means average curves cannot order the entries in that range at the assumed variability; it is not a tie.');
}

function curveDetail(e, i) {
  var ds = lb.ds, dp = lb.dp, chartBox = h('div', { class: 'chart' }), left = h('div', {}, chartBox);
  var oi = i > 0 ? i - 1 : 1, other = lb.rows[oi] && lb.rows[oi].key !== e.key ? lb.rows[oi] : null;
  var series = [];
  if (other && other.points && e.points) series.push({ name: other.name + ' (ranked ' + (oi + 1) + ')', color: 'var(--ink-3)', dash: true, points: other.points });
  if (e.points) series.push({ name: e.name, color: 'var(--c1)', points: e.points });
  setTimeout(function () {
    if (!e.points || !rdChart(chartBox, series, dp.window)) {
      clear(left).appendChild(h('div', { class: 'chart-empty' },
        'The curve of ' + e.name + ' is not copied here: its source repository carries no license. The score is computed from the released values, which stay at the source. ',
        e.source && e.source.repo ? sourceLink(e.source) : null));
    }
  }, 0);
  var dl = h('dl', { class: 'kv' });
  var add = function (k, v) { if (v !== null && v !== undefined && v !== '') { dl.appendChild(h('dt', { text: k })); dl.appendChild(h('dd', {}, v)); } };
  add('Published', [e.venue, e.year].filter(Boolean).join(' '));
  add('Main contribution', FAMILY[e.family] ? [famDot(e.family), ' ' + FAMILY[e.family]] : null);
  add('Evidence', [evidenceBadge(e.evidence), h('div', { class: 'muted small', text: EVIDENCE_LONG[e.evidence] })]);
  add('Released curve', e.n_points + ' points, ' + e.span_db[0].toFixed(2) + ' to ' + e.span_db[1].toFixed(2) + ' dB' + (e.variant ? ' (' + e.variant + ')' : ''));
  if (e.tier) add('The curve comes from', TIER[e.tier]);
  if (e.range) add('Other ways to compute it', h('span', { class: 'num', text: pct(e.range[0], 1) + ' to ' + pct(e.range[1], 1) + ' over ' + e.variants_valid[0] + ' valid of ' + e.variants_valid[1] + ' variants' }));
  if (e.regime) add('Low, middle and high third of the window', h('span', { class: 'num', text: e.regime.map(function (v) { return pct(v, 1); }).join(' / ') }));
  if (e.source && e.source.repo) add('Source file', [sourceLink(e.source), h('div', { class: 'muted small', text: (e.source.path || '') + ' — ' + licenseText(e.source.license) })]);
  if (e.mine) add('Status', 'Computed in your browser. Not submitted.');
  var oc = e.other_curves || [];
  var ocBox = null;
  if (oc.length) {
    var tb = h('tbody');
    oc.forEach(function (c) {
      tb.appendChild(h('tr', {}, h('td', { text: c.variant || 'main' }), h('td', { class: 'r num', text: c.score === null ? 'no score' : pct(c.score) }),
        h('td', { class: 'num muted', text: c.span_db[0].toFixed(1) + NDASH + c.span_db[1].toFixed(1) + ' dB' }), h('td', { class: 'src' }, sourceLink(c.source))));
    });
    ocBox = h('div', { style: 'margin-top:14px' }, h('div', { class: 'small strong', text: 'Other released curves of ' + e.name + ' on ' + dsLabel(ds) + ' (not ranked; the board uses one curve per method)' }),
      h('div', { class: 'tablewrap' }, h('table', { class: 'compact mini' }, h('thead', {}, h('tr', {}, h('th', { text: 'Model or setting' }), h('th', { class: 'r', text: 'Score' }), h('th', { text: 'Range' }), h('th', { text: 'Source' }))), tb)));
  }
  var base = other || (lb.rows[0].key !== e.key ? lb.rows[0] : lb.rows[1]);
  var btns = h('div', { class: 'btnrow', style: 'margin-top:14px' },
    h('button', { class: 'btn ghost sm', type: 'button', text: 'Compare with ' + base.name, onclick: function () { state.cmp = { a: base.key, b: e.key }; go('compare'); } }),
    e.remeasured ? h('button', { class: 'btn ghost sm', type: 'button', text: 'See the measured checkpoint',
      onclick: function () { state.board = 'remeasured'; state.remDs = ds; state.remFocus = e.remeasured; state.remOpen = e.remeasured; renderLeaderboard(); } }) : null);
  return h('div', { class: 'detail-grid' }, left, h('div', {}, dl, ocBox, btns));
}

/* ================================================================ measured checkpoints */
function paddingText(p) {
  var m = /^(zero|repl\.) (c|rb) (\d+)$/.exec(p || '');
  if (!m) return p;
  return (m[1] === 'zero' ? 'zeros' : 'edge replication') + (m[2] === 'c' ? ', centred' : ' at the right and bottom') + ', to a multiple of ' + m[3];
}

function renderRemBoard() {
  var ds = state.remDs, q = state.remQ, main = clear($('#board-main'));
  if (q === 'msssim' || ds === 'div2k') { /* both exist for these */ }
  var rm = remModel(ds, q), best = rm.releases[0], frozen = DS.indexOf(ds) >= 0 && q === 'psnr';
  $('#board-intro').textContent = 'Public checkpoints measured by LIC-Audit under one set of definitions: written bits over the original image area, quality of the 8-bit RGB reconstruction cropped to the original size, mean over the ' + rm.n + ' images. Intervals are paired over the test images.';
  var qSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Quality measure' });
  segButtons(qSeg, [{ value: 'psnr', label: 'PSNR' }, { value: 'msssim', label: 'MS-SSIM (sensitivity)' }], q, function (v) { state.remQ = v; state.remOpen = null; renderRemBoard(); });
  var notes = [];
  if (ds === 'div2k' || q === 'msssim') notes.push('LALIC was not part of the batch that measured DIV2K and MS-SSIM, so seven releases are compared here.');
  if (q === 'msssim') notes.push('MS-SSIM is a sensitivity analysis, not part of the frozen protocol: the window ' + rm.window[0] + NDASH + rm.window[1] + ' dB (MS-SSIM in dB) follows the same rule as DIV2K. An order under PSNR need not hold under MS-SSIM.');
  if (ds === 'div2k') notes.push('DIV2K is an additional test set; some releases may have trained on DIV2K images. Window ' + rm.window[0] + NDASH + rm.window[1] + ' dB.');
  var chartBox = h('div', { class: 'chart' });
  main.appendChild(h('div', { class: 'sheet panel' },
    h('div', { class: 'panel-head' },
      h('div', {}, h('h2', { text: 'Rate against the best release on ' + dsLabel(ds) }),
        h('p', { class: 'sub', text: 'Dot: direct BD-rate of the measured curves on a fixed window. Bar: paired 95% interval over the images; a yellow bar includes zero.' + (frozen ? ' Diamond: what the released curves of the same two methods give.' : '') })),
      h('div', { class: 'panel-tools' }, h('div', { class: 'field' }, h('span', { text: 'Quality measure' }), qSeg))),
    notes.length ? h('div', { class: 'notes' }, notes.map(function (t) { return h('p', { class: 'note warn', text: t }); })) : null,
    chartBox,
    h('p', { class: 'caption', id: 'rem-caption' })));
  var curveOf = function (r) { return r.board_key ? BOARD.entries[ds] && BOARD.entries[ds].filter(function (e) { return e.key === r.board_key; })[0] : null; };
  var bestCurve = frozen ? curveOf(best) : null;
  var rows = rm.releases.map(function (r, i) {
    var p = i === 0 ? null : rm.pair(best.key, r.key), rc = frozen ? curveOf(r) : null;
    return { key: r.key, name: r.name, est: p ? p.estimate : 0, ci: p ? p.ci : null, resolved: p ? p.resolved : true, best: i === 0,
             said: (rc && bestCurve && i > 0) ? L.pct(rc.cells[0] - bestCurve.cells[0]) : null };
  });
  forestChart(chartBox, rows, { onSelect: function (k) { state.remOpen = state.remOpen === k ? null : k; remTable(rm, rows); }, selected: state.remOpen });
  var cap = $('#rem-caption'), second = rows[1];
  append(cap, [h('b', { text: best.name }), ' needs the least rate on ' + dsLabel(ds) + (q === 'msssim' ? ' under MS-SSIM' : '') + '. ',
    second ? [second.name + ' needs ', h('b', { class: 'num', text: unsigned(second.est) }), ' more (95% interval ', h('span', { class: 'num', text: pct(second.ci[0]) + ' to ' + pct(second.ci[1]) }), '). '] : null,
    rm.rankFirst[best.key] !== undefined ? best.name + ' ranks first in ' + Math.round(rm.rankFirst[best.key] * 100) + '% of resampled test sets.' : null]);
  main.appendChild(h('div', { class: 'sheet panel flush' },
    h('div', { class: 'panel-head padded' }, h('div', {}, h('h2', { text: 'Measured releases' }), h('p', { class: 'sub', text: 'Click a release for every pairwise comparison and its curves.' }))),
    h('div', { class: 'tablewrap', id: 'board' })));
  main.appendChild(h('p', { class: 'note-small', id: 'board-note' }));
  remTable(rm, rows);
}

function remTable(rm, rows) {
  var ds = rm.ds, q = rm.quality, frozen = DS.indexOf(ds) >= 0 && q === 'psnr', box = clear($('#board')), tbody = h('tbody'), qry = state.query.trim().toLowerCase();
  var FOLLOW = { written: 'written bits', estimate: 'estimated bits', 'none; weights beat curve': 'no tested rule; the weights beat the curve', 'none matches': 'no tested rule' };
  var head = [h('th', { class: 'c-rank', text: '#' }), h('th', { text: 'Release' }), h('th', { class: 'r', text: 'Rate vs best' }), h('th', { text: 'Paired 95% interval' }), h('th', { text: 'Decision' }),
              h('th', { class: 'r', title: 'Share of resampled test sets in which this release needs the least rate', text: 'Ranks first' })];
  if (frozen) head.push(h('th', { class: 'r', title: 'Direct BD-rate between the released curves of the same two methods', text: 'Released curves gave' }), h('th', { title: 'The measurement rules that best reproduce the released curve from the checkpoint', text: 'Released numbers follow' }));
  var table = h('table', { class: 'board' }, h('thead', {}, h('tr', {}, head)), tbody), NCOL = head.length;
  rm.releases.forEach(function (r, i) {
    if (qry && r.name.toLowerCase().indexOf(qry) < 0) return;
    var row = rows[i], open = state.remOpen === r.key;
    var cells = [h('td', { class: 'rank num c-rank', text: String(i + 1) }),
      h('td', {}, h('div', { class: 'mcell' }, h('span', { class: 'caret', 'aria-hidden': 'true', text: '›' }), h('div', {}, h('div', { class: 'name', text: r.name }), h('div', { class: 'meta-line', text: String(r.year) })))),
      h('td', { class: 'r num' }, h('span', { class: 'score', text: i ? pct(row.est) : 'least rate' })),
      h('td', { class: 'num nowrap' }, row.ci ? pct(row.ci[0]) + ' to ' + pct(row.ci[1]) : h('span', { class: 'muted', text: NDASH })),
      h('td', {}, i ? chip(row.resolved ? 'resolved' : 'unresolved', STATUS_SHORT[row.resolved ? 'resolved' : 'unresolved']) : null),
      h('td', { class: 'r num', text: rm.rankFirst[r.key] !== undefined ? Math.round(rm.rankFirst[r.key] * 100) + '%' : 'n/a' })];
    if (frozen) {
      var follows = [FOLLOW[r.released_bits] || r.released_bits, r.released_psnr ? ({ '8-bit': '8-bit PSNR', unrounded: 'unrounded PSNR' }[r.released_psnr] || r.released_psnr) : null].filter(Boolean).join(', ');
      cells.push(h('td', { class: 'r num' }, row.said === null ? h('span', { class: 'muted', text: i ? 'n/a' : NDASH }) : pct(row.said)), h('td', { text: follows }));
    }
    var tr = h('tr', { class: 'row' + (open ? ' open' : ''), tabindex: 0, 'data-key': r.key, 'aria-expanded': String(open) }, cells);
    var toggle = function () { state.remOpen = state.remOpen === r.key ? null : r.key; remTable(rm, rows); };
    tr.addEventListener('click', function (e) { if (e.target.closest('a,button')) return; toggle(); });
    tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    tbody.appendChild(tr);
    if (open) tbody.appendChild(h('tr', { class: 'detail' }, h('td', { colspan: NCOL }, remDetail(rm, r))));
  });
  box.appendChild(table);
  clear($('#board-note')).textContent = REM.definition + ' Intervals: percentile bootstrap over the images, or the delete-one jackknife where more than 1% of resamples lose coverage of the window. They describe the choice of test images, not training seeds.';
}

function remDetail(rm, r) {
  var ds = rm.ds, q = rm.quality, inner = h('tbody'), chartBox = h('div', { class: 'chart' });
  rm.releases.forEach(function (o) {
    if (o.key === r.key) return;
    var pp = rm.pair(o.key, r.key);
    inner.appendChild(h('tr', {}, h('td', { text: o.name }), h('td', { class: 'r num', text: pct(pp.estimate) }), h('td', { class: 'num nowrap', text: pct(pp.ci[0]) + ' to ' + pct(pp.ci[1]) }),
      h('td', {}, chip(pp.resolved ? 'resolved' : 'unresolved', STATUS_SHORT[pp.resolved ? 'resolved' : 'unresolved']))));
  });
  var rc = (q === 'psnr' && r.board_key && BOARD.entries[ds]) ? BOARD.entries[ds].filter(function (e) { return e.key === r.board_key; })[0] : null;
  var series = [{ name: r.name + ', measured', color: 'var(--s1)', points: r.curve }];
  if (rc && rc.points) series.push({ name: r.name + ', released curve', color: 'var(--s2)', points: rc.points, dash: true });
  setTimeout(function () { rdChart(chartBox, series, rm.window, { qLabel: q === 'msssim' ? 'MS-SSIM (dB)' : 'PSNR (dB)', height: 280 }); }, 0);
  var dl = h('dl', { class: 'kv' });
  [['Evidence', evidenceBadge(4)], ['Parameters', r.parameters_m ? r.parameters_m + ' million' : 'not reported'],
   ['Decoding time', r.decode_s_clic.toFixed(2) + ' s for a CLIC Pro image (median, one GPU type)'], ['Padding of its own script', paddingText(r.padding)]
  ].forEach(function (kv) { dl.appendChild(h('dt', { text: kv[0] })); dl.appendChild(h('dd', {}, kv[1])); });
  return h('div', { class: 'detail-grid' },
    h('div', {}, chartBox, rc && !rc.points ? h('p', { class: 'muted small', text: 'The released curve is not copied here (no license at its source).' }) : null),
    h('div', {}, h('p', { class: 'small', style: 'margin-bottom:6px', text: 'Rate of ' + r.name + ' against each other release (negative: ' + r.name + ' needs less rate).' }),
      h('div', { class: 'tablewrap' }, h('table', { class: 'compact mini' }, h('thead', {}, h('tr', {}, h('th', { text: 'Against' }), h('th', { class: 'r', text: 'BD-rate' }), h('th', { text: 'Paired 95% interval' }), h('th', { text: 'Decision' }))), inner)),
      h('div', { style: 'margin-top:12px' }, dl)));
}

/* ================================================================ published claims */
function renderClaimsBoard() {
  var ds = state.ds, main = clear($('#board-main')), rows = CLAIMS.rows.filter(function (r) { return r.dataset === ds; }), sm = CLAIMS.summary[ds], V = CLAIMS.vtm_versions;
  $('#board-intro').textContent = 'BD-rates as printed in each paper or README against the VTM run that paper used, next to the score of the same method’s released curve on the fixed window.';
  var chartBox = h('div', { class: 'chart' });
  main.appendChild(h('div', { class: 'sheet panel' },
    h('div', { class: 'panel-head' },
      h('div', {}, h('h2', { text: 'Reported against the fixed window on ' + dsLabel(ds) }),
        h('p', { class: 'sub', text: 'Each line joins what a paper reports (left) to the fixed-window score (right). Crossing lines mark pairs of methods whose order changes. Point at a line to see which.' }))),
    h('div', { class: 'factrow' },
      h('div', { class: 'fact' }, h('div', { class: 'v num', text: sm.pair_reversals + ' of ' + sm.n_pairs }), h('div', { class: 'k', text: 'pairs of methods change order' })),
      h('div', { class: 'fact' }, h('div', { class: 'v num', text: sm.median_abs_gap.toFixed(2) }), h('div', { class: 'k', text: 'median gap in BD-rate points' })),
      h('div', { class: 'fact' }, h('div', { class: 'v num', text: sm.max_abs_gap.toFixed(2) }), h('div', { class: 'k', text: 'largest gap in BD-rate points' })),
      h('div', { class: 'fact' }, h('div', { class: 'v num', text: V.vtmVersionsN }), h('div', { class: 'k', text: 'VTM versions named across the claims we audit' }))),
    chartBox));
  rows.sort(function (a, b) { return a.canonical - b.canonical; });
  slopeChart(chartBox, rows.map(function (r) { return { key: r.method, name: r.name, family: r.family, claim: r.claim, canonical: r.canonical, anchor: r.anchor }; }), {});
  var tb = h('tbody');
  rows.forEach(function (r) {
    tb.appendChild(h('tr', {},
      h('td', {}, h('div', { class: 'mcell' }, famDot(r.family), h('div', {}, h('div', { class: 'name', text: r.name }), h('div', { class: 'meta-line', text: String(r.year || '') })))),
      h('td', { class: 'r num' }, h('b', { text: pct(r.claim) })), h('td', { text: r.anchor }),
      h('td', { class: 'r num', text: pct(r.canonical) }), h('td', { class: 'r num' + (Math.abs(r.gap) >= 1 ? ' strong' : ''), text: (r.gap > 0 ? '+' : (r.gap < 0 ? MINUS : '')) + Math.abs(r.gap).toFixed(2) }),
      h('td', { class: 'muted small', text: r.location })));
  });
  main.appendChild(h('div', { class: 'sheet panel flush' },
    h('div', { class: 'panel-head padded' }, h('div', {}, h('h2', { text: 'The claims' }), h('p', { class: 'sub', text: 'Difference = reported minus fixed window, in BD-rate points. Negative: the paper reports a larger saving than the fixed window gives; positive: a smaller one.' }))),
    h('div', { class: 'tablewrap' }, h('table', { class: 'board' }, h('thead', {}, h('tr', {}, h('th', { text: 'Method' }), h('th', { class: 'r', text: 'Reported' }), h('th', { text: 'Against' }), h('th', { class: 'r', text: 'Fixed window' }), h('th', { class: 'r', text: 'Difference' }), h('th', { text: 'Where the paper states it' }))), tb))));
  main.appendChild(h('p', { class: 'note-small' }, 'Only claims against VTM or VVC for the flagship model on this test set are compared. The full record of ' + CLAIMS.record.length + ' published claims, with links, is under ',
    h('a', { href: '#data', text: 'Data' }), '. The claims that name a version name ' + V.vtmVersionsN + ' different VTM versions (' + V.vtmVersionsList + ', as stated), ' + V.vtmVersionsYearN + ' of them in ' + V.vtmVersionsYear + ' papers alone.'));
}
