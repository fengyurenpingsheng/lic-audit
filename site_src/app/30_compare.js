/* LIC-Audit site: comparing two entries of the released-curves board. */
function renderCompare() {
  var ds = state.ds, rows = entriesFor(ds, true), dp = P.datasets[ds], n = dp.n_images, lim = limitFor(ds), sigma = sigmaValue();
  var has = function (k) { return rows.some(function (r) { return r.key === k; }); };
  if (!has(state.cmp.b)) state.cmp.b = rows[0].key;
  if (!has(state.cmp.a) || state.cmp.a === state.cmp.b) state.cmp.a = (rows[0].key === state.cmp.b ? rows[1] : rows[0]).key;
  segButtons($('#cmp-ds'), dsOptions(), ds, function (v) { state.ds = v; render(); });
  [['#cmp-a', 'a'], ['#cmp-b', 'b']].forEach(function (pair) {
    var sel = clear($(pair[0]));
    rows.forEach(function (r, i) { sel.appendChild(h('option', { value: r.key, text: (i + 1) + '. ' + r.name + (r.year ? ' (' + r.year + ')' : '') + '   ' + pct(r.canonical) })); });
    sel.value = state.cmp[pair[1]];
  });
  var A = findEntry(ds, state.cmp.a), B = findEntry(ds, state.cmp.b), dec = L.compare(A.cells, B.cells, n), st = L.statusAt(dec, sigma), c = dec.canonical;
  var out = clear($('#cmp-out')), hl = function (t) { return h('span', { class: 'hl', text: t }); }, where = ' on ' + dsLabel(ds);
  var verdict, sub;
  if (st === 'resolved') {
    verdict = [B.name + ' needs ', hl(unsigned(c) + (c < 0 ? ' less rate' : ' more rate')), ' than ' + A.name + where + '.'];
    sub = 'The gap exceeds the ±' + lim.toFixed(2) + '% margin in every valid way of computing it; the smallest value is ' + pct(dec.least) + '. Average curves support this ordering at the assumed variability.';
  } else if (st === 'within') {
    verdict = [B.name + ' and ' + A.name + ' are ', hl(unsigned(c) + ' apart'), where + ', inside the ±' + lim.toFixed(2) + '% margin.'];
    sub = 'Average curves cannot show which of the two needs less rate. Per-image records for both would give a paired interval over the test images.';
  } else if (st === 'unstable') {
    verdict = ['Which of ' + B.name + ' and ' + A.name + ' needs less rate' + where + ' ', hl('depends on how BD-rate is computed'), '.'];
    sub = 'Across the valid variants (interpolation, point subset, window rule) the difference runs from ' + pct(dec.min) + ' to ' + pct(dec.max) + '.';
  } else {
    verdict = ['No comparison' + where + ': one of the curves does not span the fixed window.'];
    sub = '';
  }
  var facts = h('div', { class: 'facts' });
  var fact = function (k, v, note) { facts.appendChild(h('div', { class: 'fact' }, h('div', { class: 'k', text: k }), h('div', { class: 'v num', text: v }), h('div', { class: 'n', text: note }))); };
  fact('Direct BD-rate', pct(c), B.name + ' against ' + A.name);
  fact('Other ways to compute it', dec.min === null ? 'n/a' : pct(dec.min, 1) + ' to ' + pct(dec.max, 1), dec.nValid + ' valid of ' + dec.attempted + ' variants');
  fact('Margin' + where, '±' + lim.toFixed(2) + '%', n + ' images, variability ' + sigma.toFixed(2));
  fact('Beyond the margin', dec.least === null ? 'n/a' : pct(L.conditionalMargin(dec.least, n, sigma)), 'the part of the gap that remains');
  fact('Break-even variability', dec.sigmaStar === null ? 'n/a' : dec.sigmaStar.toFixed(2), 'resolved while the true value is below this');
  out.appendChild(h('div', { class: 'sheet pad' }, h('p', { class: 'verdict' }, verdict), sub ? h('p', { class: 'verdict-sub', text: sub }) : null,
    h('div', { style: 'margin-top:12px' }, chip(st)), facts));

  var c1 = h('div', { class: 'chart' }), c2 = h('div', { class: 'chart' });
  out.appendChild(h('div', { class: 'two', style: 'margin-top:22px' },
    h('div', { class: 'sheet pad' }, h('h3', { style: 'margin-bottom:10px', text: 'Rate–distortion curves' }), c1),
    h('div', { class: 'sheet pad' }, h('h3', { style: 'margin-bottom:10px', text: 'Where the difference comes from' }), c2)));
  var missing = [A, B].filter(function (e) { return !e.points; });
  var series = [A, B].filter(function (e) { return e.points; }).map(function (e) { return { name: e.name, color: e === A ? 'var(--s1)' : 'var(--s2)', points: e.points }; });
  var emptyNote = function () {
    return h('div', { class: 'chart-empty' }, 'The curve of ' + listNames(missing.map(function (e) { return e.name; }), 2) + ' is not copied here: the source repository carries no license. The numbers above are computed from the released values. ',
      missing.map(function (e) { return [sourceLink(e.source), ' ']; }));
  };
  if (!rdChart(c1, series, dp.window)) c1.appendChild(emptyNote());
  else if (missing.length) c1.appendChild(h('p', { class: 'muted', style: 'font-size:13px;margin-top:8px' }, 'The curve of ' + missing[0].name + ' is not copied here (no license at its source). ', sourceLink(missing[0].source)));
  if (missing.length || !profileChart(c2, A, B, dp.window)) c2.appendChild(missing.length ? emptyNote() : h('div', { class: 'chart-empty', text: 'The two curves share too little PSNR range to draw this.' }));
  else c2.appendChild(h('p', { class: 'muted', style: 'font-size:13px;margin-top:8px', text: 'The BD-rate is the average of this curve over the fixed window. A line that crosses zero means the order changes with the rate.' }));

  if (A.remeasured && B.remeasured) {
    var rm = remModel(ds, 'psnr'), p = rm.pair(A.remeasured, B.remeasured), nameOf = function (k) { return rm.releases.filter(function (r) { return r.key === k; })[0].name; };
    if (p) {
      out.appendChild(h('div', { class: 'sheet pad', style: 'margin-top:22px' },
        h('h3', { style: 'margin-bottom:8px' }, 'Measured from the public checkpoints  ', evidenceBadge(4)),
        h('p', { style: 'max-width:46em' }, 'Under one set of measurement definitions, ' + nameOf(B.remeasured) + ' needs ', h('b', { class: 'num', text: unsigned(p.estimate) + (p.estimate < 0 ? ' less' : ' more') }),
          ' rate than ' + nameOf(A.remeasured) + where + '. The paired 95% interval over ' + n + ' images is ', h('span', { class: 'num', text: pct(p.ci[0]) + ' to ' + pct(p.ci[1]) }),
          ' (' + (p.method === 'jackknife' ? 'delete-one jackknife' : 'paired bootstrap') + '). The released curves gave ', h('span', { class: 'num', text: pct(c) }), '.'),
        h('div', { style: 'margin-top:10px' }, chip(p.resolved ? 'resolved' : 'unresolved', p.resolved ? 'Resolved by per-image records' : 'Interval includes zero'))));
    }
  }
}

