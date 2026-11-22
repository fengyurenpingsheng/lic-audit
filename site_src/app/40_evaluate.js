/* LIC-Audit site: evaluating a new method in the browser and building its submission file. */

var DSLABEL_SUBMIT = { kodak: 'Kodak', tecnick: 'Tecnick', clic_pv: 'CLIC2020 professional validation' };
function idsFor(ds) { return P.datasets[ds].image_ids || REM.datasets[ds].image_ids; }

// The synthetic example codec on Kodak, written in each format the reader accepts.
var EX_B = [0.1426, 0.1837, 0.2455, 0.334, 0.4785, 0.7123, 1.078], EX_Q = [28.92, 30.21, 31.63, 33.08, 34.71, 36.44, 38.17];
var FORMATS = [
  { key: 'cols', label: 'Two columns', note: 'Rate, then PSNR, one operating point per line. Spaces, tabs, commas or semicolons all work.',
    text: EX_B.map(function (b, i) { return b + ' ' + EX_Q[i]; }).join('\n') },
  { key: 'csv', label: 'CSV with a header', note: 'Header words find the columns; extra columns such as λ or MS-SSIM are ignored.',
    text: 'lambda,bpp,psnr,ms-ssim\n' + EX_B.map(function (b, i) { return [0.0018, 0.0035, 0.0067, 0.013, 0.025, 0.0483, 0.0932][i] + ',' + b + ',' + EX_Q[i] + ',' + (0.93 + i * 0.008).toFixed(3); }).join('\n') },
  { key: 'py', label: 'Python lists', note: 'Named lists from a script or a notebook, including np.array([...]).',
    text: 'bpp = [' + EX_B.join(', ') + ']\npsnr = [' + EX_Q.join(', ') + ']' },
  { key: 'tex', label: 'LaTeX rows', note: 'Rows copied from a table in the paper source; & and \\\\ are ignored.',
    text: EX_B.map(function (b, i) { return b + ' & ' + EX_Q[i] + ' \\\\'; }).join('\n') },
  { key: 'json', label: 'CompressAI JSON', note: 'A result file of the CompressAI evaluation script, or any JSON with bpp and psnr lists.',
    text: '{"name": "my-codec", "results": {"bpp": [' + EX_B.join(', ') + '], "psnr": [' + EX_Q.join(', ') + ']}}' },
  { key: 'rows', label: 'A table with two rows', note: 'One row of rates and one row of PSNR, as many papers print them.',
    text: 'PSNR ' + EX_Q.join(' ') + '\nbpp  ' + EX_B.join(' ') }
];
var PLACEHOLDER = {
  kodak: 'Paste here, for example\n0.120  29.70\n0.190  31.40\n0.290  33.10\n0.440  34.90\n0.650  36.70\n0.900  38.20',
  tecnick: 'Paste here, for example\n0.080  31.90\n0.130  33.60\n0.200  35.20\n0.300  36.80\n0.450  38.40',
  clic_pv: 'Paste here, for example\n0.070  31.80\n0.115  33.50\n0.180  35.10\n0.280  36.70\n0.420  38.10'
};
var evFormat = 'cols';

function evaluate(ds) {
  var m = state.mine[ds], text = m.text || '', dp = P.datasets[ds], f = state.form, i;
  m.result = null;
  if (!text.trim()) return;
  var r = L.parsePoints(text);
  if (r.error) { m.result = { error: r.error }; return; }
  var pts = r.points;
  if (pts.length < 2) { m.result = { error: 'At least two operating points are needed; ' + pts.length + ' was read.' }; return; }
  for (i = 0; i < pts.length; i++) {
    if (!(isFinite(pts[i][0]) && pts[i][0] > 0)) { m.result = { error: 'Point ' + (i + 1) + ': the rate must be above 0 bits per pixel (read ' + pts[i][0] + ').', points: pts }; return; }
    if (!(isFinite(pts[i][1]) && pts[i][1] > 10 && pts[i][1] < 70)) { m.result = { error: 'Point ' + (i + 1) + ': PSNR must be between 10 and 70 dB (read ' + pts[i][1] + ').', points: pts }; return; }
  }
  var bpp = pts.map(function (p) { return p[0]; }), q = pts.map(function (p) { return p[1]; });
  var env = L.upperEnvelope(bpp, q), span = [env[0][1], env[env.length - 1][1]], cells = L.cells(bpp, q, dp);
  var used = {};
  env.forEach(function (p) { used[p[0] + '|' + p[1]] = true; });
  var compat = L.compatibilityClass({ metric: 'psnr_rgb', psnr_definition: f.psnr, rate_accounting: f.rate, aggregation: f.agg });
  var res = { points: pts, used: used, notes: r.notes.slice(), span: span, nEnv: env.length, cells: cells, compat: compat,
              evidence: compat === 'documented' ? (m.M ? 3 : 2) : 1,
              conventions: (f.rate !== 'unknown' && f.agg !== 'unknown') ? 'D' : ((f.rate !== 'unknown' || f.agg !== 'unknown') ? 'P' : 'U') };
  if (pts.length - env.length > 0) res.notes.push(plural(pts.length - env.length, 'point') + ' with more rate and no more PSNR ' + (pts.length - env.length === 1 ? 'was' : 'were') + ' left out.');
  if (env.length < 5) res.notes.push('With fewer than five points, the checks that drop the lowest or highest point are skipped.');
  if (cells[0] === null) {
    res.unscored = true; res.need = [];
    if (span[0] > dp.window[0] + 1e-9) res.need.push('a point at or below ' + dp.window[0] + ' dB');
    if (span[1] < dp.window[1] - 1e-9) res.need.push('a point at or above ' + dp.window[1] + ' dB');
    m.result = res; return;
  }
  var rows = BOARD.entries[ds];
  res.scored = true; res.score = L.pct(cells[0] - dp.consensus_level);
  res.position = 1 + rows.filter(function (e) { return e.canonical < res.score; }).length; res.total = rows.length + 1;
  res.comps = rows.map(function (e, k) { var dec = L.compare(e.cells, cells, dp.n_images); return { e: e, rank: k + 1, dec: dec, status: L.statusAt(dec, sigmaValue()) }; });
  res.tied = res.comps.filter(function (x) { return x.status !== 'resolved'; }).length;
  res.anchors = dp.anchors.filter(function (a) { return a.points; }).map(function (a) {
    return { label: a.label, bd: L.overlapBD(a.points.map(function (p) { return p[0]; }), a.points.map(function (p) { return p[1]; }), bpp, q) };
  });
  m.result = res;
}

function saveDraft() {
  store('draft', { texts: DS.reduce(function (o, d) { o[d] = state.mine[d].text; return o; }, {}), form: state.form });
}

/* ---------------------------------------------------------------- step 1: how to prepare the numbers */
function renderEvalGuide() {
  var box = clear($('#ev-guide'));
  var winRows = DS.map(function (ds) { var dp = P.datasets[ds]; return h('tr', {}, h('td', { text: dsLabel(ds) }), h('td', { class: 'num', text: dp.window[0] + NDASH + dp.window[1] + ' dB' }), h('td', { class: 'num r', text: String(dp.n_images) })); });
  var demo = h('div', { class: 'chart covdemo' }), demo2 = h('div', { class: 'chart covdemo' });
  var fmtSeg = h('div', { class: 'seg wrap', role: 'group', 'aria-label': 'Example format' });
  var fmtPre = h('pre', { class: 'json ex', tabindex: 0 }), fmtNote = h('p', { class: 'small muted' });
  var showFmt = function () {
    var f = FORMATS.filter(function (x) { return x.key === evFormat; })[0];
    segButtons(fmtSeg, FORMATS.map(function (x) { return { value: x.key, label: x.label }; }), evFormat, function (v) { evFormat = v; showFmt(); });
    fmtPre.textContent = f.text; fmtNote.textContent = f.note;
  };
  box.appendChild(h('div', { class: 'guidegrid' },
    h('div', { class: 'sheet gcard' }, h('h4', { text: 'What to paste' }),
      h('ul', { class: 'ticks' },
        h('li', {}, h('b', { text: 'One line per operating point' }), ': the rate in bits per pixel, then PSNR in dB.'),
        h('li', {}, 'Both are ', h('b', { text: 'averages over the images' }), ' of the test set: the mean of per-image values.'),
        h('li', {}, 'PSNR on the ', h('b', { text: '8-bit RGB reconstruction' }), '. Not luma PSNR, not MS-SSIM.'),
        h('li', {}, 'Have file sizes instead? bpp = 8 × bytes ÷ (width × height). A Kodak image has 768 × 512 = 393,216 pixels.'),
        h('li', {}, 'At least two points, reaching both ends of the window; with five or more, every robustness check runs. The order of the lines does not matter.'))),
    h('div', { class: 'sheet gcard' }, h('h4', { text: 'Which range' }),
      h('p', { class: 'small', text: 'A score needs a curve that reaches both ends of the fixed window: one point at or below the lower end and one at or above the upper end. Points outside the window are welcome; nothing is extrapolated.' }),
      h('table', { class: 'compact mini' }, h('thead', {}, h('tr', {}, h('th', { text: 'Test set' }), h('th', { text: 'Fixed window' }), h('th', { class: 'r', text: 'Images' }))), h('tbody', {}, winRows)),
      h('div', { class: 'covpair' }, h('div', {}, h('span', { class: 'small ok-t', text: 'Covers the window: scored' }), demo), h('div', {}, h('span', { class: 'small bad-t', text: 'Stops short: not scored, the box says what is missing' }), demo2))),
    h('div', { class: 'sheet gcard wide' }, h('h4', { text: 'Formats it reads' }),
      fmtSeg, fmtPre, fmtNote,
      h('div', { class: 'btnrow' }, h('button', { class: 'btn ghost sm', type: 'button', text: 'Paste this example into Kodak', onclick: function () {
        var f = FORMATS.filter(function (x) { return x.key === evFormat; })[0];
        setEvalText('kodak', f.text); var ta = $('#ev-text-kodak'); if (ta) ta.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } })),
      h('h4', { style: 'margin-top:14px', text: 'What the reader does for you' }),
      h('ul', { class: 'ticks two-col' },
        h('li', { text: 'Finds the rate and the PSNR column: PSNR values lie between 10 and 70 dB, and header words such as bpp, rate and psnr are used when present.' }),
        h('li', { text: 'Fixes swapped columns or lists and reads tables printed as one row of rates and one row of PSNR.' }),
        h('li', { text: 'Ignores headers, extra columns, comment lines starting with # or %, and LaTeX markup.' }),
        h('li', { text: 'Sorts the points and leaves out any point that uses more bits without more PSNR.' }),
        h('li', { text: 'Shows under each box exactly which numbers it read, so you can check every one.' }),
        h('li', { text: 'Numbers only in a figure or a PDF? “Copy a prompt for an AI assistant” asks one to read them with their source; check them before you submit.' })))));
  showFmt();
  setTimeout(function () { coverageBar(demo, [29.6, 31.3, 33.1, 34.9, 36.8, 38.2], [30.5, 36.6]); coverageBar(demo2, [31.4, 33.1, 34.9, 36.8, 38.2], [30.5, 36.6]); }, 0);
}

function setEvalText(ds, text) {
  var m = state.mine[ds];
  m.text = text; m.M = null; m.ops = null; m.observed = null; m.perImageError = null;
  var ta = $('#ev-text-' + ds); if (ta) ta.value = text;
  evaluate(ds); saveDraft(); renderEvalOutputs();
}

function renderEvalInputs() {
  var box = clear($('#ev-inputs'));
  DS.forEach(function (ds) {
    var dp = P.datasets[ds], preview = h('div', { class: 'preview', id: 'ev-prev-' + ds, 'aria-live': 'polite' });
    var ta = h('textarea', { id: 'ev-text-' + ds, spellcheck: 'false', 'aria-label': 'Operating points on ' + dsLabel(ds), placeholder: PLACEHOLDER[ds] });
    ta.value = state.mine[ds].text;
    var timer = null;
    ta.addEventListener('input', function () {
      var m = state.mine[ds];
      m.text = ta.value; m.M = null; m.ops = null; m.observed = null; m.perImageError = null;
      clearTimeout(timer); timer = setTimeout(function () { evaluate(ds); saveDraft(); renderEvalOutputs(); }, 180);
    });
    var card = h('div', { class: 'sheet dsbox', id: 'ev-box-' + ds },
      h('div', { class: 'dshead' }, h('h4', { text: dsLabel(ds) }), h('span', { class: 'w', text: dp.window[0] + NDASH + dp.window[1] + ' dB, ' + dp.n_images + ' images' })),
      ta, h('div', { class: 'dropnote', text: 'or drop a .txt, .csv or .json file on this box' }), preview);
    card.addEventListener('dragover', function (e) { e.preventDefault(); card.classList.add('over'); });
    card.addEventListener('dragleave', function () { card.classList.remove('over'); });
    card.addEventListener('drop', function (e) {
      e.preventDefault(); card.classList.remove('over');
      var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!file) return;
      var fr = new FileReader();
      fr.onload = function () { setEvalText(ds, String(fr.result)); toast('Read ' + file.name); };
      fr.readAsText(file);
    });
    box.appendChild(card);
  });
}

function evalPreviews() {
  DS.forEach(function (ds) {
    var box = clear($('#ev-prev-' + ds)), r = state.mine[ds].result, dp = P.datasets[ds];
    if (!r) { box.appendChild(h('p', { class: 'small muted', text: 'The points it reads appear here.' })); return; }
    if (r.error) { box.appendChild(h('div', { class: 'note err', text: r.error })); return; }
    var bar = h('div', { class: 'chart covmini' });
    box.appendChild(bar);
    setTimeout(function () { coverageBar(bar, r.points.map(function (p) { return p[1]; }), dp.window); }, 0);
    if (r.unscored) box.appendChild(h('div', { class: 'note warn', text: 'Read ' + plural(r.points.length, 'point') + ', ' + r.span[0].toFixed(2) + NDASH + r.span[1].toFixed(2) + ' dB. Not scored yet: add ' + r.need.join(' and ') + '.' }));
    else box.appendChild(h('div', { class: 'note ok' }, 'Read ' + plural(r.points.length, 'point') + ', ' + r.span[0].toFixed(2) + NDASH + r.span[1].toFixed(2) + ' dB. Covers the window: ', h('b', { class: 'num', text: pct(r.score) }), '.'));
    r.notes.forEach(function (t) { box.appendChild(h('div', { class: 'small muted', style: 'margin-top:4px', text: t })); });
    var tb = h('tbody');
    r.points.slice().sort(function (a, b) { return a[0] - b[0]; }).forEach(function (p, i) {
      var u = r.used[p[0] + '|' + p[1]];
      tb.appendChild(h('tr', { class: u ? '' : 'dim' }, h('td', { class: 'num muted', text: String(i + 1) }), h('td', { class: 'r num', text: String(p[0]) }), h('td', { class: 'r num', text: String(p[1]) }),
        h('td', { class: 'small', text: u ? (p[1] < dp.window[0] || p[1] > dp.window[1] ? 'used, outside the window' : 'used') : 'left out' })));
    });
    box.appendChild(h('details', { class: 'pts' }, h('summary', { text: 'What was read' }),
      h('table', { class: 'compact mini' }, h('thead', {}, h('tr', {}, h('th', { text: '#' }), h('th', { class: 'r', text: 'bpp' }), h('th', { class: 'r', text: 'PSNR (dB)' }), h('th', { text: '' }))), tb)));
  });
}

function scoredSets() { return DS.filter(function (d) { var r = state.mine[d].result; return r && r.scored; }); }

/* ---------------------------------------------------------------- step 2: the result */
function renderEvalResult() {
  var box = clear($('#ev-result')), any = DS.some(function (d) { return state.mine[d].result; }), scored = scoredSets();
  $('#step1').classList.toggle('done', any); $('#step2').classList.toggle('done', scored.length > 0);
  if (!any) { box.appendChild(h('div', { class: 'chart-empty', text: 'The result appears here as soon as you paste points for a test set. “Load the example codec” shows what it looks like.' })); return; }
  var card = h('div', { class: 'sheet reportcard' });
  DS.forEach(function (ds) {
    var r = state.mine[ds].result, cell = h('div', {}, h('div', { class: 'ds', text: dsLabel(ds) }));
    if (!r) append(cell, [h('div', { class: 'big muted', text: NDASH }), h('div', { class: 'pos', text: 'No points pasted' })]);
    else if (r.error) append(cell, [h('div', { class: 'big muted', text: NDASH }), h('div', { class: 'pos', text: 'The input could not be read' })]);
    else if (r.unscored) append(cell, [h('div', { class: 'big muted', text: 'Not scored' }), h('div', { class: 'pos', text: 'Add ' + r.need.join(' and ') + '.' })]);
    else append(cell, [h('div', { class: 'big num', text: pct(r.score) }),
      h('div', { class: 'pos' }, 'Position ', h('b', { class: 'num', text: String(r.position) }), ' of ' + r.total + ' on the board'),
      h('div', { style: 'margin-top:8px' }, r.tied ? h('span', { class: 'bandtxt on', text: 'not separable from ' + plural(r.tied, 'entry', 'entries') }) : h('span', { class: 'muted', text: 'separated from every entry' }))]);
    card.appendChild(cell);
  });
  box.appendChild(card);
  box.appendChild(h('p', { class: 'small muted', style: 'margin-top:8px;max-width:62em',
    text: 'Decisions use the margin for the variability of ' + P.sigma[state.sigma].label.toLowerCase() + ' (' + sigmaValue().toFixed(2) + '): ' +
          DS.map(function (d) { return '±' + limitFor(d).toFixed(2) + '% on ' + dsLabel(d); }).join(', ') + '. You can change this assumption on the leaderboard.' }));
  if (!scored.length) return;
  var ds = scored.indexOf(state.ds) >= 0 ? state.ds : scored[0], r = state.mine[ds].result, dp = P.datasets[ds];
  var seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Details for' });
  segButtons(seg, scored.map(function (d) { return { value: d, label: dsLabel(d) }; }), ds, function (v) { state.ds = v; renderEvalOutputs(); });
  box.appendChild(h('div', { class: 'controls', style: 'margin-top:18px' }, h('div', { class: 'field' }, h('span', { text: 'Details for' }), seg)));
  var near = r.comps.slice().sort(function (a, b) { return Math.abs(a.dec.canonical) - Math.abs(b.dec.canonical); }).slice(0, 6).sort(function (a, b) { return a.rank - b.rank; });
  var tb = h('tbody');
  near.forEach(function (x) {
    tb.appendChild(h('tr', {}, h('td', { class: 'num muted', text: String(x.rank) }), h('td', {}, h('div', { class: 'mcell' }, famDot(x.e.family), h('span', { class: 'name', text: x.e.name }))), h('td', { class: 'r num', text: pct(x.e.canonical) }),
      h('td', { class: 'r num' }, h('b', { text: pct(x.dec.canonical) })), h('td', {}, chip(x.status, STATUS_SHORT[x.status]))));
  });
  var chartBox = h('div', { class: 'chart' }), partner = null;
  r.comps.slice().sort(function (a, b) { return Math.abs(a.dec.canonical) - Math.abs(b.dec.canonical); }).some(function (x) { if (x.e.points) { partner = x.e; return true; } return false; });
  box.appendChild(h('div', { class: 'two wide-left', style: 'margin-top:14px' },
    h('div', { class: 'sheet' }, h('div', { class: 'tablewrap' }, h('table', { class: 'compact' },
      h('thead', {}, h('tr', {}, h('th', { text: '#' }), h('th', { text: 'Nearest entries on ' + dsLabel(ds) }), h('th', { class: 'r', text: 'Its score' }), h('th', { class: 'r', text: 'Yours against it' }), h('th', { text: 'Decision' }))), tb))),
    h('div', { class: 'sheet pad' }, chartBox)));
  var series = [];
  if (partner) series.push({ name: partner.name, color: 'var(--s1)', points: partner.points });
  series.push({ name: state.form.name.trim() || 'Your method', color: 'var(--s2)', points: r.points });
  rdChart(chartBox, series, dp.window);
  if (r.anchors.length) {
    var vals = r.anchors.filter(function (a) { return a.bd; });
    box.appendChild(h('div', { class: 'note', style: 'margin-top:16px;max-width:62em' },
      'For comparison, the conventional BD-rate of the same curve against each released VTM run, on the overlapping range: ',
      vals.map(function (a, k) { return [h('b', { class: 'num', text: pct(a.bd.value) }), ' (' + a.label + ')' + (k < vals.length - 1 ? ', ' : '. ')]; }),
      'These depend on the run. The fixed-window score does not: a different run shifts every score by the same factor.'));
  }
  box.appendChild(h('div', { class: 'btnrow', style: 'margin-top:14px' },
    h('button', { class: 'btn', type: 'button', text: 'Show it on the leaderboard', onclick: function () { state.showMine = true; state.board = 'curves'; state.ds = ds; state.focus[ds] = MINE; go('leaderboard'); } }),
    h('button', { class: 'btn ghost', type: 'button', text: 'Copy a summary for your paper', onclick: function () { copyText(summaryText(), 'Summary copied'); } })));
}

function summaryText() {
  var name = state.form.name.trim() || 'Our method', parts = scoredSets().map(function (ds) {
    var r = state.mine[ds].result, w = P.datasets[ds].window;
    return dsLabel(ds) + ' ' + pct(r.score).replace(MINUS, '-') + ' (window ' + w[0] + '-' + w[1] + ' dB, position ' + r.position + ' of ' + r.total + ')';
  });
  return name + ' under LIC-Audit protocol v' + P.version + ' (fixed-window BD-rate against the VTM reference, PCHIP): ' + parts.join('; ') + '.';
}

/* ---------------------------------------------------------------- step 3: per-image records */
function renderPerImage() {
  var box = clear($('#ev-perimage')), scored = scoredSets(), ds = scored.indexOf(state.ds) >= 0 ? state.ds : (scored[0] || state.ds), m = state.mine[ds];
  var input = h('input', { type: 'file', id: 'ev-file', accept: '.csv,.tsv,.txt,text/csv,text/plain', style: 'max-width:100%' });
  var take = function (file) {
    if (!file) return;
    var fr = new FileReader();
    fr.onload = function () { loadPerImage(ds, String(fr.result)); };
    fr.readAsText(file);
  };
  input.addEventListener('change', function () { take(input.files[0]); });
  var drop = h('div', { class: 'drop' },
    h('label', { for: 'ev-file', style: 'display:block;margin-bottom:8px' }, 'Records for ', h('b', { text: dsLabel(ds) }), ': a CSV with the columns ', h('code', { text: 'image, op, bpp, psnr' }),
      ' (or ', h('code', { text: 'bytes, width, height' }), ' instead of bpp). ', h('code', { text: 'op' }), ' names the operating point, for example the quality level. Image names as in the test set, for example ', h('code', { text: String(idsFor(ds)[0]) }), '.'),
    input,
    h('pre', { class: 'json ex', style: 'margin-top:10px', text: 'image,op,bpp,psnr\n' + idsFor(ds)[0] + ',1,0.1234,29.87\n' + idsFor(ds)[0] + ',2,0.1876,31.45\n' + idsFor(ds)[1] + ',1,0.0981,30.12\n…' }));
  drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', function () { drop.classList.remove('over'); });
  drop.addEventListener('drop', function (e) { e.preventDefault(); drop.classList.remove('over'); take(e.dataTransfer.files[0]); });
  box.appendChild(drop);
  box.appendChild(h('div', { class: 'btnrow', style: 'margin-top:10px' },
    h('button', { class: 'btn ghost sm', type: 'button', text: 'Try it with the measured records of DCAE', title: 'Loads the per-image records of one measured release as if they were yours',
      onclick: function () { loadPerImage(ds, sampleCsv(ds, 'dcae'), 'DCAE'); } })));
  if (m.perImageError) box.appendChild(h('div', { class: 'note err', style: 'margin-top:12px' }, m.perImageError.map(function (t) { return h('div', { text: t }); })));
  $('#step3').classList.toggle('done', !!m.M);
  if (!m.M) return;
  var tb = h('tbody'), rel = remModel(ds, 'psnr').releases;
  rel.forEach(function (r) {
    var o = m.observed && m.observed[r.key], st = o ? (o.status === 'resolved' ? 'resolved' : (o.status === 'unresolved' ? 'unresolved' : 'no_coverage')) : null;
    tb.appendChild(h('tr', {}, h('td', {}, h('span', { class: 'name', text: r.name }), h('span', { class: 'meta-line', text: '  ' + r.year })),
      h('td', { class: 'r num' }, o ? h('b', { text: pct(o.estimate) }) : h('span', { class: 'muted', text: 'computing…' })),
      h('td', { class: 'num', text: o && o.ci95 ? pct(o.ci95[0]) + ' to ' + pct(o.ci95[1]) : '' }),
      h('td', { class: 'muted', text: o ? (o.method === 'jackknife' ? 'delete-one jackknife' : (o.method === 'bootstrap' ? 'paired bootstrap' : 'no interval')) : '' }),
      h('td', {}, st ? chip(st, STATUS_SHORT[st]) : null)));
  });
  box.appendChild(h('div', { class: 'sheet tablewrap', style: 'margin-top:12px' }, h('table', {},
    h('thead', {}, h('tr', {}, h('th', { text: 'Measured release on ' + dsLabel(ds) }), h('th', { class: 'r', text: 'Yours against it' }), h('th', { text: 'Paired 95% interval' }), h('th', { text: 'Interval from' }), h('th', { text: 'Decision' }))), tb)));
  box.appendChild(h('p', { class: 'small muted', style: 'margin-top:8px;max-width:62em',
    text: plural(m.M.R.length, 'image') + ' and ' + plural(m.ops.length, 'operating point') + ' read; the curve above now uses their means. Intervals use 2,000 paired resamples of the test images in your browser; the reference tool reports the official interval when you submit.' + (m.demo ? ' These are the measured records of ' + m.demo + ', so its own row is zero.' : '') }));
}

// Per-image records of a measured release: written bytes, pixel count, bits per pixel and 8-bit RGB PSNR.
function sampleCsv(ds, key) {
  var d = REM.datasets[ds], r = d.releases[key], out = 'image,op,bytes,pixels,bpp,psnr\n';
  d.image_ids.forEach(function (id, i) { r.ops.forEach(function (op, j) { out += id + ',' + op + ',' + r.bytes[i][j] + ',' + d.pixels[i] + ',' + (8 * r.bytes[i][j] / d.pixels[i]) + ',' + r.psnr[i][j] + '\n'; }); });
  return out;
}

function loadPerImage(ds, text, demoName) {
  var m = state.mine[ds], parsed = L.parsePerImage(text);
  m.perImageError = null; m.M = null; m.observed = null; m.demo = demoName || null;
  if (parsed.error) { m.perImageError = [parsed.error]; renderPerImage(); return; }
  var mat = L.perImageMatrix(parsed.rows, idsFor(ds));
  if (!mat.ok) { m.perImageError = mat.errors; renderPerImage(); return; }
  m.M = mat.M; m.ops = mat.ops; m.perImageNotes = parsed.notes; m.rateFromBytes = parsed.rateFromBytes;
  m.text = mat.curve.bpp.map(function (b, i) { return Number(b.toFixed(6)) + ' ' + Number(mat.curve.q[i].toFixed(6)); }).join('\n');
  var ta = $('#ev-text-' + ds); if (ta) ta.value = m.text;
  evaluate(ds); saveDraft(); renderEvalOutputs();
  var rel = remModel(ds, 'psnr').releases, d = REM.datasets[ds], W = P.datasets[ds].window, k = 0, token = {};
  m.observed = {}; m.token = token;
  var next = function () {
    if (m.token !== token || k >= rel.length) return;
    var r = d.releases[rel[k].key], A = { R: r.bytes.map(function (row, i) { return row.map(function (b) { return 8 * b / d.pixels[i]; }); }), Q: r.psnr };
    m.observed[rel[k].key] = L.observed(A, m.M, W, { B: 2000, seed: 2027 });
    k++; renderPerImage(); setTimeout(next, 10);
  };
  setTimeout(next, 30);
}

/* ---------------------------------------------------------------- step 4: the submission file */
function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30); }

function buildSubmission() {
  var f = state.form, curves = [], anyRecords = false;
  DS.forEach(function (ds) {
    var m = state.mine[ds], r = m.result;
    if (!r || r.error || !r.points) return;
    var c = { dataset: ds, dataset_label: DSLABEL_SUBMIT[ds], metric: 'psnr_rgb', psnr_definition: f.psnr, rate_accounting: f.rate, aggregation: f.agg,
              points: r.points.map(function (p, i) { var o = { bpp: p[0], psnr_db: p[1] }; if (m.M) o.op_id = String(m.ops[i]); return o; }),
              provenance: { repository: f.repo.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/+$/, ''), commit: f.commit.trim(), path: f.path.trim(), source_tier: 'A' } };
    if (m.M) {
      anyRecords = true;
      var ids = idsFor(ds);
      c.per_image = [];
      ids.forEach(function (id, i) { m.ops.forEach(function (op, j) { c.per_image.push({ image_id: id, op_id: String(op), reported_bpp: m.M.R[i][j], psnr_rgb_db: m.M.Q[i][j] }); }); });
    }
    curves.push(c);
  });
  var method = { key: slug(f.name) + (f.year && slug(f.name).indexOf(String(f.year)) < 0 ? String(f.year) : ''), name: f.name.trim(), year: Number(f.year) || null, venue: f.venue.trim() || null, family: f.family || 'unknown' };
  if (f.paper.trim()) method.paper_url = f.paper.trim();
  if (f.contact.trim()) method.contact = f.contact.trim();
  if (f.weights.trim()) method.weights_url = f.weights.trim();
  if (f.code.trim()) method.test_code = f.code.trim();
  return { schema_version: anyRecords ? 2 : 1, method: method, curves: curves };
}

function renderSubmit() {
  var box = clear($('#ev-submit')), f = state.form;
  var field = function (label, key, attrs) {
    var inp = h('input', Object.assign({ type: 'text', id: 'f-' + key, autocomplete: 'off' }, attrs || {}));
    inp.value = f[key];
    inp.addEventListener('input', function () { f[key] = inp.value; saveDraft(); refreshSubmit(); });
    return h('label', { class: 'field' }, h('span', { text: label }), inp);
  };
  var choice = function (label, key, options) {
    var sel = h('select', { id: 'f-' + key });
    options.forEach(function (o) { sel.appendChild(h('option', { value: o[0], text: o[1] })); });
    sel.value = f[key];
    sel.addEventListener('change', function () { f[key] = sel.value; saveDraft(); DS.forEach(evaluate); renderEvalOutputs(); });
    return h('label', { class: 'field' }, h('span', { text: label }), sel);
  };
  var li = function (b, t) { return h('li', {}, h('b', { text: b }), ' ' + t); };
  box.appendChild(h('div', { class: 'sheet checkcard' },
    h('h4', { text: 'How a submission is checked' }),
    h('ol', { class: 'seq' },
      li('Anyone can submit.', 'The button below opens a public GitHub issue, so every submission and its review are visible to everyone.'),
      li('Source check, automatic.', 'Every number must already be public in your repository, at the commit and in the file you name. A script reads that file and confirms each number, and the reference tool recomputes the score. The report card is posted on the issue.'),
      li('Consistency check, automatic.', 'Per-image records, if you add them, must reproduce your curve; they also give paired intervals against the measured releases.'),
      li('Maintainer review.', 'A maintainer confirms that the source names this method and test set, then adds the entry with its evidence level and a link to the source.'),
      li('Re-measurement, optional.', 'With public weights and test code, the maintainers can run your model on the fixed test sets themselves. The entry then shows the highest evidence level, “Re-measured”.')),
    h('p', { class: 'small muted', text: 'LIC-Audit does not search the web for results: numbers collected automatically can come from the wrong table, model variant or test set. An AI assistant can help you read your own numbers (“Copy a prompt for an AI assistant” in step 1), but every number is checked at its source before it is listed.' })));
  box.appendChild(h('div', { class: 'formgrid' },
    field('Method name', 'name', { placeholder: 'as in the paper' }), field('Year', 'year', { inputmode: 'numeric' }), field('Venue', 'venue', { placeholder: 'CVPR, arXiv, …' }),
    choice('Main contribution', 'family', [['', 'Choose…'], ['E', 'Entropy model'], ['T', 'Transform'], ['O', 'Overfitted codec'], ['R', 'Rate control and efficiency']]),
    field('Paper link', 'paper', { type: 'url', placeholder: 'https://' }),
    field('Repository with the numbers', 'repo', { placeholder: 'owner/name' }), field('Commit', 'commit', { placeholder: 'full or short SHA' }), field('File that holds the numbers', 'path', { placeholder: 'results/kodak.json' }),
    choice('The rate is', 'rate', [['unknown', 'not stated'], ['actual_bitstream', 'the written bitstream'], ['estimated_likelihood', 'estimated from likelihoods']]),
    choice('PSNR is', 'psnr', [['unknown', 'not stated'], ['rgb_8bit', 'RGB, 8-bit reconstruction'], ['ycbcr_y', 'luma (Y) only']]),
    choice('Averaging over images', 'agg', [['unknown', 'not stated'], ['mean_per_image', 'mean of per-image bpp and PSNR'], ['psnr_of_mean_mse', 'PSNR of the mean MSE'], ['pixel_weighted', 'pixel-weighted']]),
    field('Contact for questions', 'contact', { placeholder: 'optional' }),
    field('Public model weights', 'weights', { type: 'url', placeholder: 'optional: link to the released checkpoint' }),
    field('Test code or command', 'code', { placeholder: 'optional: repository link or command' })));
  box.appendChild(h('div', { id: 'ev-submit-out', style: 'margin-top:14px' }));
  refreshSubmit();
}

function refreshSubmit() {
  var box = $('#ev-submit-out');
  if (!box) return;
  clear(box);
  var sub = buildSubmission(), f = state.form, scored = scoredSets();
  $('#step4').classList.toggle('done', scored.length > 0 && !!f.name.trim() && !!f.repo.trim() && !!f.commit.trim() && !!f.path.trim());
  if (!sub.curves.length) { box.appendChild(h('div', { class: 'chart-empty', text: 'Paste points for at least one test set in step 1 to build the submission file.' })); return; }
  var notes = [];
  if (!f.name.trim()) notes.push(['warn', 'Add the method name.']);
  if (!f.repo.trim() || !f.commit.trim() || !f.path.trim()) notes.push(['warn', 'Without a repository, commit and file, the entry gets a score but no position: the board ranks numbers that anyone can check at their source.']);
  var compat = L.compatibilityClass({ metric: 'psnr_rgb', psnr_definition: f.psnr, rate_accounting: f.rate, aggregation: f.agg });
  if (compat === 'incompatible') notes.push(['err', 'Luma PSNR cannot be compared with RGB PSNR. The board scores RGB PSNR only.']);
  else if (compat === 'separate_rate_class') notes.push(['warn', 'Rates estimated from likelihoods are scored for diagnosis and are not ranked. Measure the written bitstream to enter the board.']);
  else if (compat === 'different_aggregation') notes.push(['warn', 'This averaging rule differs from the mean of per-image values; the curve is scored for diagnosis and is not ranked.']);
  else if (compat === 'provisional') notes.push(['', 'Measurement not fully stated: the entry is ranked with evidence “Curve only”. Stating written bits, 8-bit RGB PSNR and per-image means raises it to “Measurement stated”.']);
  else notes.push(['ok', 'Measurement stated on the common basis: evidence “' + (sub.schema_version === 2 ? 'Per-image records' : 'Measurement stated') + '”.']);
  if (f.weights.trim()) notes.push(['ok', 'Public weights given: the maintainers can re-measure the model on the fixed test sets. After that the entry shows the evidence level “Re-measured”.']);
  notes.forEach(function (x) { box.appendChild(h('div', { class: 'note ' + x[0], style: 'margin-bottom:8px;max-width:62em', text: x[1] })); });
  var json = JSON.stringify(sub, null, 1), big = json.length > 60000;
  var shown = big ? JSON.stringify(Object.assign({}, sub, { curves: sub.curves.map(function (c) { var o = Object.assign({}, c); if (o.per_image) o.per_image = '[' + c.per_image.length + ' records, included in the file]'; return o; }) }), null, 1) : json;
  box.appendChild(h('pre', { class: 'json', tabindex: 0, 'aria-label': 'Submission file', text: shown }));
  var name = (sub.method.key || 'method') + '.json';
  var repo = (CFG.repository || '').trim(), compact = JSON.stringify(sub), url = null;
  if (repo) {
    url = 'https://github.com/' + repo + '/issues/new?template=submission.yml&title=' + encodeURIComponent('Submission: ' + (f.name.trim() || 'new method'));
    if (encodeURIComponent(compact).length < 5500) url += '&submission=' + encodeURIComponent(compact);
  }
  box.appendChild(h('div', { class: 'btnrow', style: 'margin-top:12px' },
    h('button', { class: 'btn', type: 'button', text: 'Copy the submission file', onclick: function () { copyText(json, 'Submission file copied'); } }),
    h('button', { class: 'btn ghost', type: 'button', text: 'Download ' + name, onclick: function () { saveFile(name, json + '\n'); } }),
    url ? h('a', { class: 'btn ghost', href: url, target: '_blank', rel: 'noopener', text: 'Open a submission on GitHub' })
        : h('span', { class: 'small muted', text: 'The submission address appears here once the public repository is open. Keep the file until then.' })));
  if (url && url.indexOf('&submission=') < 0) box.appendChild(h('p', { class: 'small muted', style: 'margin-top:8px', text: 'The file is too large for a link: attach the downloaded file to the GitHub form.' }));
}

function renderEvalOutputs() { evalPreviews(); renderEvalResult(); renderPerImage(); refreshSubmit(); }

function renderEvaluate() {
  renderEvalGuide(); renderEvalInputs(); renderSubmit(); renderEvalOutputs();
}

function aiPrompt() {
  return 'I am preparing a submission for the LIC-Audit leaderboard for learned image compression.\n\n' +
    'From the paper, table, figure or repository file I attach, read the rate-distortion operating points of the method <METHOD NAME> on <Kodak | Tecnick | CLIC 2020 professional validation> (PSNR on RGB).\n\n' +
    'Reply with:\n' +
    '1. The points as two plain columns, one operating point per line: bits per pixel, then PSNR in dB. Copy the numbers exactly as printed. If you have to read them off a plot, say so and give your uncertainty.\n' +
    '2. Whether the rate is measured from the written bitstream or estimated from likelihoods, and where the source says so.\n' +
    '3. Whether PSNR is the mean of per-image values on the 8-bit RGB reconstruction, and where the source says so.\n' +
    '4. The file, table or figure (and line if possible) where each number appears, so that I can check it.\n\n' +
    'Do not invent or interpolate missing points.';
}
