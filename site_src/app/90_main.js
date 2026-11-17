/* LIC-Audit site: routing and start-up. */

var VIEWS = ['leaderboard', 'compare', 'evaluate', 'data', 'guide'];
var ALIAS = { protocol: 'guide' };

function go(view) {
  if (location.hash !== '#' + view) location.hash = view;
  else { state.view = view; render(); }
  window.scrollTo(0, 0);
}

function render() {
  VIEWS.forEach(function (v) { $('#view-' + v).hidden = v !== state.view; });
  $all('.tabs button').forEach(function (b) { b.setAttribute('aria-selected', String(b.getAttribute('data-view') === state.view)); });
  hideTip();
  if (state.view === 'leaderboard') renderLeaderboard();
  else if (state.view === 'compare') renderCompare();
  else if (state.view === 'evaluate') renderEvaluate();
  else if (state.view === 'data') renderData();
  else renderGuide();
}

function start(saved) {
  var draft = (saved && saved.draft) || load('draft');
  if (draft) {
    DS.forEach(function (d) { if (draft.texts && typeof draft.texts[d] === 'string') state.mine[d].text = draft.texts[d]; });
    if (draft.form) Object.keys(state.form).forEach(function (k) { if (typeof draft.form[k] === 'string') state.form[k] = draft.form[k]; });
  }
  if (saved) ['ds', 'board', 'sigma', 'remDs', 'remQ'].forEach(function (k) { if (saved[k]) state[k] = saved[k]; });
  var theme = load('theme');
  if (theme === 'dark' || theme === 'light') document.documentElement.setAttribute('data-theme', theme);
  DS.forEach(evaluate);

  $('#ver').textContent = 'Protocol v' + P.version;
  var facts = clear($('#hero-facts'));
  [[fmtInt(P.facts.curves), 'released curves'], [String(P.facts.repositories), 'repositories'], [String(P.facts.releases_measured), 'checkpoints measured'],
   [fmtInt(P.facts.records), 'measured records'], [String(CLAIMS.record.length), 'published claims']].forEach(function (x) {
    facts.appendChild(h('div', { class: 'hf' }, h('span', { class: 'num v', text: x[0] }), h('span', { class: 'k', text: x[1] })));
  });
  var sel = $('#sigma');
  Object.keys(P.sigma).forEach(function (k) { sel.appendChild(h('option', { value: k, text: P.sigma[k].label + ' (' + P.sigma[k].value.toFixed(2) + ')', title: P.sigma[k].note })); });
  sel.value = state.sigma;
  sel.addEventListener('change', function () { state.sigma = sel.value; DS.forEach(evaluate); render(); });
  $('#sigma-help').addEventListener('click', function () { go('guide'); setTimeout(function () { var t = document.getElementById('g-params'); if (t) t.scrollIntoView({ block: 'start' }); }, 60); });
  $('#q').addEventListener('input', function (e) {
    state.query = e.target.value;
    if (state.board === 'curves') { curvesTable(); applyFocus(); }
    else if (state.board === 'remeasured') renderRemBoard();
  });
  $all('.tabs button').forEach(function (b) { b.addEventListener('click', function () { go(b.getAttribute('data-view')); }); });
  $('#cmp-a').addEventListener('change', function (e) { state.cmp.a = e.target.value; if (state.cmp.a === state.cmp.b) state.cmp.b = null; renderCompare(); });
  $('#cmp-b').addEventListener('change', function (e) { state.cmp.b = e.target.value; if (state.cmp.a === state.cmp.b) state.cmp.a = null; renderCompare(); });
  $('#cmp-swap').addEventListener('click', function () { state.cmp = { a: state.cmp.b, b: state.cmp.a }; renderCompare(); });
  $('#ev-example').addEventListener('click', function () {
    DATA.example.curves.forEach(function (c) {
      var m = state.mine[c.dataset];
      m.text = c.points.map(function (p) { return p.bpp + ' ' + p.psnr_db; }).join('\n'); m.M = null; m.ops = null; m.observed = null; m.perImageError = null;
    });
    if (!state.form.name.trim()) state.form.name = DATA.example.method.name;
    DS.forEach(evaluate); saveDraft(); renderEvaluate();
  });
  $('#ev-clear').addEventListener('click', function () { DS.forEach(function (d) { state.mine[d] = { text: '' }; }); saveDraft(); renderEvaluate(); });
  $('#ev-prompt').addEventListener('click', function () { copyText(aiPrompt(), 'Prompt copied. Paste it into your assistant together with the paper or file.'); });
  $('#theme').addEventListener('click', function () {
    var root = document.documentElement, cur = root.getAttribute('data-theme') || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    var next = cur === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next); store('theme', next);
  });
  $('#foot-left').textContent = 'LIC-Audit protocol v' + P.version + ', frozen on ' + P.frozen_on + '. Every score on this page is computed in your browser by the rules of the reference tool.';
  if (CFG.paper) $('#foot-right').appendChild(h('a', { href: CFG.paper, target: '_blank', rel: 'noopener', text: 'Paper' }));
  if (CFG.paper && CFG.repository) $('#foot-right').appendChild(document.createTextNode(' \u00b7 '));
  if (CFG.repository) $('#foot-right').appendChild(h('a', { href: 'https://github.com/' + CFG.repository, target: '_blank', rel: 'noopener', text: 'Source, data and reference tool' }));

  var route = function () {
    var v = (location.hash || '').replace('#', '');
    v = ALIAS[v] || v;
    state.view = VIEWS.indexOf(v) >= 0 ? v : 'leaderboard';
    render();
  };
  window.addEventListener('hashchange', route);
  var rt = null, lastW = window.innerWidth;
  window.addEventListener('resize', function () {
    if (window.innerWidth === lastW) return;
    lastW = window.innerWidth; clearTimeout(rt);
    rt = setTimeout(function () { if (state.view === 'evaluate') renderEvalOutputs(); else render(); }, 150);
  });
  route();
}

var hot = window.claude && window.claude.hot;
if (hot && hot.snapshot) {
  hot.snapshot(function () {
    return { ds: state.ds, board: state.board, sigma: state.sigma, remDs: state.remDs, remQ: state.remQ,
             draft: { texts: DS.reduce(function (o, d) { o[d] = state.mine[d].text; return o; }, {}), form: state.form } };
  });
}
if (hot && hot.ready) hot.ready(start); else start(hot && hot.data ? hot.data : null);
