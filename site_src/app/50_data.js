/* LIC-Audit site: every curve, claim and measurement behind the board, to filter, plot and download. */

var EX_DS = { kodak: 'Kodak', tecnick: 'Tecnick', clic_pv: 'CLIC Pro', clic2020_pro_cai: 'CLIC 2020 pro (CompressAI)',
              clic2020_mobile: 'CLIC 2020 mobile', ustc_td: 'USTC-TD', clic2022_test: 'CLIC 2022 test', other: 'other or not stated' };
var EX_METRIC = { psnr_rgb: 'PSNR (RGB)', psnr_y: 'PSNR (luma)', msssim_rgb: 'MS-SSIM' };
var EX_WHERE = { ranked: 'ranked on the board', 'not ranked': 'listed, not ranked', 'earlier method': 'earlier method (context)', 'VTM reference': 'VTM reference run' };
var PLOT_COLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)', 'var(--c7)'];

var EX_ORDER = { kodak: 0, tecnick: 1, clic_pv: 2 };
var EX_SORTED = EXPLORER.curves.slice().sort(function (a, b) {
  var da = EX_ORDER[a.dataset] === undefined ? 9 : EX_ORDER[a.dataset], db = EX_ORDER[b.dataset] === undefined ? 9 : EX_ORDER[b.dataset];
  if (da !== db) return da - db;
  if (a.dataset !== b.dataset) return a.dataset < b.dataset ? -1 : 1;
  if (a.metric !== b.metric) return a.metric === 'psnr_rgb' ? -1 : (b.metric === 'psnr_rgb' ? 1 : (a.metric < b.metric ? -1 : 1));
  if (a.role !== b.role) return a.role === 'method' ? -1 : 1;
  var sa = a.score === null ? Infinity : a.score, sb = b.score === null ? Infinity : b.score;
  if (sa !== sb) return sa - sb;
  return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);
});
function exFiltered() {
  var f = state.data, q = f.q.trim().toLowerCase();
  return EX_SORTED.filter(function (c) {
    if (f.ds !== 'all' && c.dataset !== f.ds) return false;
    if (f.metric !== 'all' && c.metric !== f.metric) return false;
    if (f.role !== 'all' && c.role !== f.role) return false;
    if (f.tier !== 'all' && c.tier !== f.tier) return false;
    if (f.where !== 'all' && (f.where === 'none' ? c.board !== null : c.board !== f.where)) return false;
    if (q && (c.name + ' ' + (c.label || '') + ' ' + (c.variant || '') + ' ' + c.source.repo + ' ' + (c.codec || '') + ' ' + (c.codec_version || '') + ' ' + (EX_DS[c.dataset] || c.dataset) + ' ' + (c.year || '')).toLowerCase().indexOf(q) < 0) return false;
    return true;
  });
}

function renderData() {
  var f = state.data, facts = $('#data-facts');
  var counts = { method: 0, anchor: 0 }, dsSet = {}, mSet = {};
  EXPLORER.curves.forEach(function (c) { counts[c.role] = (counts[c.role] || 0) + 1; dsSet[c.dataset] = 1; mSet[c.metric] = 1; });
  clear(facts);
  [[fmtInt(EXPLORER.curves.length), 'released rate–distortion curves'], [String(P.facts.repositories), 'public repositories, each pinned to a commit'],
   [counts.method + ' / ' + counts.anchor, 'curves of learned methods / of reference codecs'], [Object.keys(dsSet).length + ' / ' + Object.keys(mSet).length, 'test sets / quality measures'],
   [String(CLAIMS.record.length), 'published claims, with their sources'], [fmtInt(P.facts.records), 'encode–decode records of ' + REM.releases.length + ' measured releases']
  ].forEach(function (x) { facts.appendChild(h('div', { class: 'fact' }, h('div', { class: 'v num', text: x[0] }), h('div', { class: 'k', text: x[1] }))); });
  segButtons($('#data-tabs'), [{ value: 'curves', label: 'Released curves' }, { value: 'claims', label: 'Published claims' }, { value: 'measured', label: 'Measured releases' }], f.tab,
    function (v) { f.tab = v; renderData(); });
  var main = clear($('#data-main'));
  if (f.tab === 'curves') dataCurves(main);
  else if (f.tab === 'claims') dataClaims(main);
  else dataMeasured(main);
}

function selectField(label, id, options, value, onChange) {
  var sel = h('select', { id: id });
  options.forEach(function (o) { sel.appendChild(h('option', { value: o[0], text: o[1] })); });
  sel.value = value;
  sel.addEventListener('change', function () { onChange(sel.value); });
  return h('label', { class: 'field' }, h('span', { text: label }), sel);
}

function dataCurves(main) {
  var f = state.data, list = exFiltered();
  var dsOpts = [['all', 'All test sets']].concat(Object.keys(EX_DS).filter(function (k) { return EXPLORER.curves.some(function (c) { return c.dataset === k; }); }).map(function (k) { return [k, EX_DS[k]]; }));
  var search = h('input', { type: 'search', id: 'data-q', placeholder: 'Method, test set, repository or year', autocomplete: 'off', value: f.q });
  var timer = null;
  search.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(function () { f.q = search.value; f.limit = 40; dataCurvesBody(); }, 150); });
  main.appendChild(h('div', { class: 'controls' },
    selectField('Test set', 'data-ds', dsOpts, f.ds, function (v) { f.ds = v; f.limit = 40; dataCurvesBody(); }),
    selectField('Quality measure', 'data-metric', [['all', 'All']].concat(Object.keys(EX_METRIC).map(function (k) { return [k, EX_METRIC[k]]; })), f.metric, function (v) { f.metric = v; f.limit = 40; dataCurvesBody(); }),
    selectField('Kind', 'data-role', [['all', 'All'], ['method', 'Learned methods'], ['anchor', 'Reference codecs (VTM, BPG, …)']], f.role, function (v) { f.role = v; f.limit = 40; dataCurvesBody(); }),
    selectField('Curve comes from', 'data-tier', [['all', 'Anyone'], ['A', 'The authors'], ['B', 'A third-party transcription'], ['C', 'A third-party run']], f.tier, function (v) { f.tier = v; f.limit = 40; dataCurvesBody(); }),
    selectField('On the board', 'data-where', [['all', 'Any'], ['ranked', 'Ranked'], ['not ranked', 'Listed, not ranked'], ['earlier method', 'Earlier method'], ['VTM reference', 'VTM reference run'], ['none', 'Not on the board']], f.where, function (v) { f.where = v; f.limit = 40; dataCurvesBody(); }),
    h('label', { class: 'field grow' }, h('span', { text: 'Search' }), search)));
  main.appendChild(h('div', { class: 'sheet panel', id: 'data-plot' }));
  main.appendChild(h('div', { class: 'sheet panel flush', id: 'data-list' }));
  dataCurvesBody();
}

function dataCurvesBody() {
  var f = state.data, list = exFiltered(), plot = clear($('#data-plot')), box = clear($('#data-list'));
  var picked = f.picked.map(function (id) { return EXPLORER.curves.filter(function (c) { return c.id === id; })[0]; }).filter(Boolean);
  var withPts = picked.filter(function (c) { return c.points; });
  plot.appendChild(h('div', { class: 'panel-head' }, h('div', {}, h('h2', { text: 'Plot' }),
    h('p', { class: 'sub', text: picked.length ? 'The curves you ticked. Up to seven at a time; curves from repositories without a license are listed but not drawn.' : 'Tick up to seven curves in the list to draw them here.' })),
    h('div', { class: 'panel-tools' }, picked.length ? h('button', { class: 'btn ghost sm', type: 'button', text: 'Clear the plot', onclick: function () { f.picked = []; dataCurvesBody(); } }) : null,
      withPts.length ? h('button', { class: 'btn ghost sm', type: 'button', text: 'Download these curves (CSV)', onclick: function () {
        var out = 'curve,method,variant,test_set,quality,bpp,value,repository,commit,path\n';
        withPts.forEach(function (c) { c.points.forEach(function (p) { out += [c.id, c.name, c.variant || '', c.dataset, c.metric, p[0], p[1], c.source.repo, c.source.commit, c.source.path].map(csvCell).join(',') + '\n'; }); });
        saveFile('lic-audit-curves.csv', out, 'text/csv');
      } }) : null)));
  if (withPts.length) {
    var cbox = h('div', { class: 'chart' });
    plot.appendChild(cbox);
    var sameDs = withPts.every(function (c) { return c.dataset === withPts[0].dataset && c.metric === 'psnr_rgb'; }) && P.datasets[withPts[0].dataset];
    var sameMetric = withPts.every(function (c) { return c.metric === withPts[0].metric; });
    setTimeout(function () {
      rdChart(cbox, withPts.map(function (c, i) { return { name: c.name + (c.variant ? ' (' + c.variant + ')' : '') + (sameDs ? '' : ', ' + (EX_DS[c.dataset] || c.dataset)), color: PLOT_COLORS[i % PLOT_COLORS.length], points: c.points }; }),
        sameDs ? P.datasets[withPts[0].dataset].window : null, { qLabel: sameMetric ? (withPts[0].metric === 'msssim_rgb' ? 'MS-SSIM' : 'PSNR (dB)') : 'Quality', height: 330 });
    }, 0);
    if (!sameMetric) plot.appendChild(h('p', { class: 'note warn', text: 'The ticked curves use different quality measures; their vertical positions are not comparable.' }));
  }
  // list
  var tb = h('tbody'), shown = list.slice(0, f.limit);
  shown.forEach(function (c) {
    var on = f.picked.indexOf(c.id) >= 0, cb = h('input', { type: 'checkbox', 'aria-label': 'Plot ' + c.name, checked: on ? true : null });
    cb.addEventListener('change', function () {
      if (cb.checked) { if (f.picked.length >= 7) { cb.checked = false; toast('Seven curves at most. Untick one first.'); return; } f.picked.push(c.id); }
      else f.picked = f.picked.filter(function (x) { return x !== c.id; });
      dataCurvesBody();
    });
    tb.appendChild(h('tr', { class: on ? 'picked' : '' },
      h('td', {}, cb),
      h('td', {}, h('div', { class: 'name', text: c.name }), h('div', { class: 'meta-line', text: [c.variant, c.role === 'anchor' ? [c.codec, c.codec_version && c.codec_version !== 'unstated_in_file' ? c.codec_version : null].filter(Boolean).join(' ') : null, c.year].filter(Boolean).join(', ') })),
      h('td', { text: EX_DS[c.dataset] || c.dataset }), h('td', { class: 'nowrap', text: { psnr_rgb: 'PSNR', psnr_y: 'PSNR-Y', msssim_rgb: 'MS-SSIM' }[c.metric] || c.metric }),
      h('td', { class: 'num nowrap', text: c.n_points + ' pts, ' + c.span[0].toFixed(1) + NDASH + c.span[1].toFixed(1) }),
      h('td', { class: 'r num', text: c.score === null ? (P.datasets[c.dataset] && c.metric === 'psnr_rgb' ? 'no score' : NDASH) : pct(c.score) }),
      h('td', { class: 'small', text: c.board ? EX_WHERE[c.board] : '' }),
      h('td', { class: 'small', text: { A: 'authors', B: 'third-party transcription', C: 'third-party run' }[c.tier] }),
      h('td', { class: 'src' }, sourceLink(c.source), c.points ? null : h('div', { class: 'small muted', text: licenseText(c.source.license) + '; values not copied' }))));
  });
  box.appendChild(h('div', { class: 'panel-head padded' }, h('div', {}, h('h2', { text: plural(list.length, 'curve') }),
    h('p', { class: 'sub', text: 'Score: fixed-window BD-rate against the VTM reference, where the test set has a fixed window and the quality measure is RGB PSNR.' })),
    h('div', { class: 'panel-tools' }, h('button', { class: 'btn ghost sm', type: 'button', text: 'Download this list (CSV)', onclick: function () {
      var out = 'curve,method,variant,role,test_set,quality,points,psnr_min,psnr_max,score_percent,on_board,from,repository,commit,path,license\n';
      list.forEach(function (c) { out += [c.id, c.name, c.variant || '', c.role, c.dataset, c.metric, c.n_points, c.span[0], c.span[1], c.score === null ? '' : c.score, c.board || '', c.tier, c.source.repo, c.source.commit, c.source.path, c.source.license || ''].map(csvCell).join(',') + '\n'; });
      saveFile('lic-audit-curve-list.csv', out, 'text/csv');
    } }))));
  box.appendChild(h('div', { class: 'tablewrap' }, h('table', { class: 'board data' },
    h('thead', {}, h('tr', {}, h('th', { text: 'Plot' }), h('th', { text: 'Method or codec' }), h('th', { text: 'Test set' }), h('th', { text: 'Quality' }), h('th', { text: 'Points, range' }),
      h('th', { class: 'r', text: 'Score' }), h('th', { text: 'On the board' }), h('th', { text: 'From' }), h('th', { text: 'Source' }))), tb)));
  if (list.length > shown.length) box.appendChild(h('div', { class: 'padded' }, h('button', { class: 'btn ghost sm', type: 'button', text: 'Show ' + Math.min(40, list.length - shown.length) + ' more of ' + (list.length - shown.length),
    onclick: function () { f.limit += 40; dataCurvesBody(); } })));
  if (!list.length) box.appendChild(h('p', { class: 'padded muted', text: 'No curve matches these filters.' }));
}

function csvCell(v) { var s = String(v === null || v === undefined ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }

function dataClaims(main) {
  var f = state.data, box = h('div', { class: 'sheet panel flush' });
  var dsSel = f.claimDs || 'all', numeric = f.claimNumeric !== false, q = (f.claimQ || '').toLowerCase();
  var rows = CLAIMS.record.filter(function (r) {
    if (dsSel !== 'all' && r.dataset !== dsSel) return false;
    if (numeric && r.claim === null) return false;
    if (q && (r.paper + ' ' + r.variant + ' ' + r.anchor + ' ' + r.venue_year).toLowerCase().indexOf(q) < 0) return false;
    return true;
  });
  var search = h('input', { type: 'search', placeholder: 'Paper, model or VTM version', value: f.claimQ || '', autocomplete: 'off' });
  var timer = null;
  search.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(function () { f.claimQ = search.value; renderData(); var s = $('#data-main input[type=search]'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }, 200); });
  main.appendChild(h('div', { class: 'controls' },
    selectField('Test set', 'claim-ds', [['all', 'All'], ['kodak', 'Kodak'], ['tecnick', 'Tecnick'], ['clic_pv', 'CLIC Pro'], ['other', 'Other or not stated']], dsSel, function (v) { f.claimDs = v; renderData(); }),
    h('label', { class: 'check', style: 'align-self:end;margin-bottom:8px' }, h('input', { type: 'checkbox', checked: numeric ? true : null, onchange: function (e) { f.claimNumeric = e.target.checked; renderData(); } }), 'Only claims with a number'),
    h('label', { class: 'field grow' }, h('span', { text: 'Search' }), search)));
  var tb = h('tbody');
  rows.forEach(function (r) {
    tb.appendChild(h('tr', {},
      h('td', {}, h('div', { class: 'name', text: r.variant || r.paper }), h('div', { class: 'meta-line', text: r.venue_year })),
      h('td', { text: EX_DS[r.dataset] || r.dataset }),
      h('td', { class: 'r num' }, r.claim === null ? h('span', { class: 'muted', text: 'no number' }) : h('b', { text: pct(r.claim, r.claim % 1 === 0 ? 0 : 2) })),
      h('td', { text: r.anchor }), h('td', { class: 'small', text: r.metric }), h('td', { class: 'small muted', text: r.location }),
      h('td', {}, r.url ? h('a', { href: r.url, target: '_blank', rel: 'noopener', text: 'source' }) : null)));
  });
  box.appendChild(h('div', { class: 'panel-head padded' }, h('div', {}, h('h2', { text: plural(rows.length, 'published claim') }),
    h('p', { class: 'sub', text: 'BD-rates and savings as each paper or README states them, with the reference and the place where they appear. Negative: less rate than the reference.' }))));
  box.appendChild(h('div', { class: 'tablewrap' }, h('table', { class: 'board data' },
    h('thead', {}, h('tr', {}, h('th', { text: 'Model' }), h('th', { text: 'Test set' }), h('th', { class: 'r', text: 'Claim' }), h('th', { text: 'Against' }), h('th', { text: 'Quality measure, as stated' }), h('th', { text: 'Where' }), h('th', { text: 'Link' }))), tb)));
  main.appendChild(box);
}

function dataMeasured(main) {
  var box = h('div', { class: 'sheet panel flush' }), tb = h('tbody'), extra = REM.extra;
  REM.releases.forEach(function (r) {
    var sets = DS.filter(function (d) { return REM.datasets[d].releases[r.key]; }).map(dsLabel);
    if (extra.psnr.div2k.releases[r.key]) sets.push('DIV2K');
    var ops = REM.datasets.kodak.releases[r.key] ? REM.datasets.kodak.releases[r.key].ops.length : null;
    tb.appendChild(h('tr', {}, h('td', {}, h('div', { class: 'name', text: r.name }), h('div', { class: 'meta-line', text: String(r.year) })),
      h('td', { text: sets.join(', ') }), h('td', { class: 'r num', text: ops ? String(ops) : 'n/a' }),
      h('td', { text: extra.msssim.kodak.releases[r.key] ? 'yes' : 'not measured' }),
      h('td', { class: 'r num', text: r.parameters_m ? r.parameters_m + ' M' : 'n/a' }), h('td', { class: 'r num', text: r.decode_s_clic.toFixed(2) + ' s' }),
      h('td', { class: 'small', text: paddingText(r.padding) })));
  });
  var relSel = h('select', { id: 'dl-rel' }), dsSel = h('select', { id: 'dl-ds' });
  REM.releases.forEach(function (r) { relSel.appendChild(h('option', { value: r.key, text: r.name })); });
  DS.forEach(function (d) { dsSel.appendChild(h('option', { value: d, text: dsLabel(d) })); });
  box.appendChild(h('div', { class: 'panel-head padded' }, h('div', {}, h('h2', { text: 'Measured releases' }),
    h('p', { class: 'sub', text: REM.definition }))));
  box.appendChild(h('div', { class: 'tablewrap' }, h('table', { class: 'board data' },
    h('thead', {}, h('tr', {}, h('th', { text: 'Release' }), h('th', { text: 'Test sets measured' }), h('th', { class: 'r', text: 'Operating points' }), h('th', { text: 'MS-SSIM' }),
      h('th', { class: 'r', text: 'Parameters' }), h('th', { class: 'r', text: 'Decoding, CLIC Pro image' }), h('th', { text: 'Padding of its own script' }))), tb)));
  box.appendChild(h('div', { class: 'padded' },
    h('p', { class: 'small', style: 'margin-bottom:8px', text: 'Per-image records, one line per image and operating point (written bytes, image size and 8-bit RGB PSNR), as used for the paired intervals:' }),
    h('div', { class: 'controls', style: 'margin:0' }, h('label', { class: 'field' }, h('span', { text: 'Release' }), relSel), h('label', { class: 'field' }, h('span', { text: 'Test set' }), dsSel),
      h('button', { class: 'btn ghost sm', type: 'button', style: 'align-self:end', text: 'Download the records (CSV)', onclick: function () {
        if (!REM.datasets[dsSel.value].releases[relSel.value]) { toast('This release was not measured on this test set.'); return; }
        saveFile('lic-audit-' + relSel.value + '-' + dsSel.value + '.csv', sampleCsv(dsSel.value, relSel.value), 'text/csv');
      } })),
    h('p', { class: 'small muted', style: 'margin-top:10px', text: extra.note })));
  main.appendChild(box);
}
