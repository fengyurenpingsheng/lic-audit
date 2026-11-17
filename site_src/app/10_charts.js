/* LIC-Audit site: charts. Every chart names both axes, draws to one scale and has a hover readout. */

function svgBox(box, W, H, label) {
  return sv('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img', 'aria-label': label });
}

/* ---------------------------------------------------------------- rate-distortion curves */
// series: [{name, color, points: [[bpp, quality], ...], dash}] ; win: [q0, q1] or null ; opts: {qLabel, height, table}
function rdChart(box, series, win, opts) {
  opts = opts || {};
  clear(box);
  series = series.filter(function (s) { return s.points && s.points.length >= 2; });
  if (!series.length) return false;
  var W = Math.max(300, Math.floor(box.clientWidth || 520)), H = opts.height || Math.round(Math.min(360, Math.max(250, W * 0.62)));
  var m = { l: 48, r: 16, t: 30, b: 42 }, qLabel = opts.qLabel || 'PSNR (dB)';
  series.forEach(function (s) {
    var b = s.points.map(function (p) { return p[0]; }), q = s.points.map(function (p) { return p[1]; });
    s.samp = L.sampleCurve(b, q, 120); s.env = L.upperEnvelope(b, q);
  });
  var qAll = [];
  series.forEach(function (s) { s.env.forEach(function (p) { qAll.push(p[1]); }); });
  var qLo = win ? win[0] - 1.6 : Math.min.apply(null, qAll) - 0.4, qHi = win ? win[1] + 1.6 : Math.max.apply(null, qAll) + 0.4;
  var bMax = 0, bMin = Infinity;
  series.forEach(function (s) { s.samp.forEach(function (p) { if (p[0] >= qLo && p[0] <= qHi) { bMax = Math.max(bMax, p[1]); bMin = Math.min(bMin, p[1]); } }); });
  if (!(bMax > 0)) return false;
  var bx0 = Math.max(0, bMin - (bMax - bMin) * 0.06), bx1 = bMax + (bMax - bMin) * 0.06;
  var X = function (b) { return m.l + (b - bx0) / (bx1 - bx0) * (W - m.l - m.r); };
  var Y = function (q) { return H - m.b - (q - qLo) / (qHi - qLo) * (H - m.t - m.b); };
  var svg = svgBox(box, W, H, 'Rate-distortion curves of ' + series.map(function (s) { return s.name; }).join(' and ') + (win ? '; fixed window ' + win[0] + ' to ' + win[1] + ' dB' : ''));
  var grid = sv('g', { class: 'grid' });
  niceTicks(qLo, qHi, 5).forEach(function (t) {
    grid.appendChild(sv('line', { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t) }));
    svg.appendChild(sv('text', { x: m.l - 8, y: Y(t) + 4, 'text-anchor': 'end' }, trim(t)));
  });
  svg.insertBefore(grid, svg.firstChild);
  if (win) {
    svg.insertBefore(sv('rect', { class: 'window', x: m.l, y: Y(win[1]), width: W - m.l - m.r, height: Y(win[0]) - Y(win[1]) }), svg.firstChild);
    svg.appendChild(sv('text', { class: 'window-label', x: W - m.r - 6, y: Y(win[0]) - 6, 'text-anchor': 'end' }, 'fixed window ' + win[0] + NDASH + win[1] + ' dB'));
  }
  niceTicks(bx0, bx1, W < 420 ? 4 : 6).forEach(function (t) { svg.appendChild(sv('text', { x: X(t), y: H - m.b + 18, 'text-anchor': 'middle' }, trim(t))); });
  svg.appendChild(sv('line', { class: 'axisline', x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b }));
  svg.appendChild(sv('text', { class: 'title', x: m.l - 40, y: 14 }, qLabel));
  svg.appendChild(sv('text', { class: 'title', x: W - m.r, y: H - 6, 'text-anchor': 'end' }, 'Rate (bits per pixel)'));
  series.forEach(function (s) {
    var d = '', started = false;
    s.samp.forEach(function (p) { if (p[0] < qLo || p[0] > qHi) return; d += (started ? 'L' : 'M') + X(p[1]).toFixed(1) + ' ' + Y(p[0]).toFixed(1); started = true; });
    svg.appendChild(sv('path', { class: 'line', d: d, stroke: s.color, 'stroke-dasharray': s.dash ? '6 4' : null }));
    s.env.forEach(function (p) { if (p[1] >= qLo && p[1] <= qHi) svg.appendChild(sv('circle', { class: 'pt', cx: X(p[0]), cy: Y(p[1]), r: 4, fill: s.dash ? 'var(--sheet)' : s.color, stroke: s.dash ? s.color : null, 'stroke-width': s.dash ? 2 : null })); });
  });
  var cross = sv('line', { class: 'cross', x1: m.l, x2: W - m.r, y1: 0, y2: 0, visibility: 'hidden' });
  svg.appendChild(cross);
  var over = sv('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent' });
  over.addEventListener('pointermove', function (e) {
    var rect = svg.getBoundingClientRect(), yy = (e.clientY - rect.top) * (H / rect.height), q = qLo + (H - m.b - yy) / (H - m.t - m.b) * (qHi - qLo);
    cross.setAttribute('y1', yy); cross.setAttribute('y2', yy); cross.setAttribute('visibility', 'visible');
    var rows = [h('div', {}, 'At ', h('b', { text: q.toFixed(2) + ' dB' }))], vals = [];
    series.forEach(function (s) {
      var samp = s.samp, v = null;
      for (var i = 1; i < samp.length; i++) if (samp[i - 1][0] <= q && samp[i][0] >= q) { var f = (q - samp[i - 1][0]) / ((samp[i][0] - samp[i - 1][0]) || 1); v = samp[i - 1][1] + f * (samp[i][1] - samp[i - 1][1]); break; }
      vals.push(v);
      rows.push(h('div', {}, h('span', { class: 'tk', style: 'border-color:' + s.color }), h('b', { text: v === null ? 'outside its range' : v.toFixed(4) + ' bpp' }), ' ' + s.name));
    });
    if (vals.length === 2 && vals[0] && vals[1]) rows.push(h('div', {}, h('b', { text: pct((vals[1] / vals[0] - 1) * 100) }), ' rate, ' + series[1].name + ' against ' + series[0].name));
    showTip(e, rows);
  });
  over.addEventListener('pointerleave', function () { cross.setAttribute('visibility', 'hidden'); hideTip(); });
  svg.appendChild(over);
  box.appendChild(svg);
  if (series.length > 1) box.appendChild(h('div', { class: 'legend' }, series.map(function (s) { return h('span', {}, h('i', { class: 'key line' + (s.dash ? ' dash' : ''), style: 'border-color:' + s.color }), s.name); })));
  if (opts.table !== false) {
    var tb = h('tbody');
    series.forEach(function (s) { s.env.forEach(function (p, k) { tb.appendChild(h('tr', {}, h('td', { text: k === 0 ? s.name : '' }), h('td', { class: 'r num', text: String(p[0]) }), h('td', { class: 'r num', text: String(p[1]) }))); }); });
    box.appendChild(h('details', { class: 'pts' }, h('summary', { text: 'Show the plotted points as a table' }),
      h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', { text: 'Curve' }), h('th', { class: 'r', text: 'bits per pixel' }), h('th', { class: 'r', text: qLabel }))), tb))));
  }
  return true;
}

// Local rate difference (%) of b against a across quality, with the fixed window marked.
function profileChart(box, a, b, win) {
  clear(box);
  if (!a.points || !b.points) return false;
  var col = function (pts, j) { return pts.map(function (p) { return p[j]; }); };
  var pa = L.prepare(col(a.points, 0), col(a.points, 1)), pb = L.prepare(col(b.points, 0), col(b.points, 1));
  if (!pa.ok || !pb.ok) return false;
  var qLo = Math.max(pa.x[0], pb.x[0]), qHi = Math.min(pa.x[pa.n - 1], pb.x[pb.n - 1]);
  if (!(qHi - qLo > 0.2)) return false;
  var qs = [], i, N = 160;
  for (i = 0; i <= N; i++) qs.push(i === N ? qHi : qLo + (qHi - qLo) * i / N);
  var ys = L.rateRatioProfile(col(a.points, 0), col(a.points, 1), col(b.points, 0), col(b.points, 1), qs);
  var yMin = Math.min.apply(null, ys.concat([0])), yMax = Math.max.apply(null, ys.concat([0])), padY = (yMax - yMin) * 0.12 || 1;
  yMin -= padY; yMax += padY;
  var W = Math.max(300, Math.floor(box.clientWidth || 520)), H = Math.round(Math.min(300, Math.max(210, W * 0.5))), m = { l: 50, r: 16, t: 30, b: 42 };
  var X = function (q) { return m.l + (q - qLo) / (qHi - qLo) * (W - m.l - m.r); };
  var Y = function (v) { return H - m.b - (v - yMin) / (yMax - yMin) * (H - m.t - m.b); };
  var svg = svgBox(box, W, H, 'Rate difference of ' + b.name + ' against ' + a.name + ' at each PSNR');
  var wx0 = Math.max(X(win[0]), m.l), wx1 = Math.min(X(win[1]), W - m.r);
  if (wx1 > wx0) {
    svg.appendChild(sv('rect', { class: 'window', x: wx0, y: m.t, width: wx1 - wx0, height: H - m.t - m.b }));
    svg.appendChild(sv('text', { class: 'window-label', x: wx0 + 6, y: m.t + 14 }, 'fixed window'));
  }
  var grid = sv('g', { class: 'grid' });
  niceTicks(yMin, yMax, 4).forEach(function (t) {
    grid.appendChild(sv('line', { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t) }));
    svg.appendChild(sv('text', { x: m.l - 8, y: Y(t) + 4, 'text-anchor': 'end' }, (t < 0 ? MINUS : (t > 0 ? '+' : '')) + trim(Math.abs(t)) + '%'));
  });
  svg.insertBefore(grid, svg.firstChild);
  niceTicks(qLo, qHi, W < 420 ? 4 : 6).forEach(function (t) { svg.appendChild(sv('text', { x: X(t), y: H - m.b + 18, 'text-anchor': 'middle' }, trim(t))); });
  svg.appendChild(sv('line', { class: 'zero', x1: m.l, x2: W - m.r, y1: Y(0), y2: Y(0) }));
  svg.appendChild(sv('text', { class: 'title', x: m.l - 42, y: 14 }, 'Rate of ' + b.name + ' against ' + a.name + ' (%)'));
  svg.appendChild(sv('text', { class: 'title', x: W - m.r, y: H - 6, 'text-anchor': 'end' }, 'PSNR (dB)'));
  var d = '';
  qs.forEach(function (q, k) { d += (k ? 'L' : 'M') + X(q).toFixed(1) + ' ' + Y(ys[k]).toFixed(1); });
  svg.appendChild(sv('path', { class: 'line', d: d, stroke: 'var(--s2)' }));
  var cross = sv('line', { class: 'cross', y1: m.t, y2: H - m.b, x1: 0, x2: 0, visibility: 'hidden' }), dot = sv('circle', { class: 'pt', r: 4, fill: 'var(--s2)', visibility: 'hidden' });
  svg.appendChild(cross); svg.appendChild(dot);
  var over = sv('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent' });
  over.addEventListener('pointermove', function (e) {
    var rect = svg.getBoundingClientRect(), xx = (e.clientX - rect.left) * (W / rect.width), k = Math.max(0, Math.min(N, Math.round((xx - m.l) / (W - m.l - m.r) * N)));
    cross.setAttribute('x1', X(qs[k])); cross.setAttribute('x2', X(qs[k])); cross.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', X(qs[k])); dot.setAttribute('cy', Y(ys[k])); dot.setAttribute('visibility', 'visible');
    showTip(e, [h('div', {}, 'At ', h('b', { text: qs[k].toFixed(2) + ' dB' })), h('div', {}, h('b', { text: pct(ys[k]) }), ' rate, ' + b.name + ' against ' + a.name)]);
  });
  over.addEventListener('pointerleave', function () { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); hideTip(); });
  svg.appendChild(over);
  box.appendChild(svg);
  return true;
}

/* ---------------------------------------------------------------- progress over time */
// items: [{key, name, year, score, family, mine, context, venue}] ; opts: {refs: [scores], onSelect(key), onHover(key)}
// Horizontal: year of publication. Vertical: BD-rate against VTM on the fixed window (ratio scale, lower is better).
// Returns {update({selected, tied, band: [pLo, pHi] | null, steps})}; update changes attributes only.
function progressChart(box, items, opts) {
  clear(box);
  var W = Math.max(320, Math.floor(box.clientWidth || 900)), small = W < 600;
  var H = small ? 380 : 460, m = { l: small ? 46 : 60, r: small ? 14 : 112, t: 38, b: 46 }, R = small ? 5.5 : 7;
  var years = items.map(function (d) { return d.year; });
  var y0 = Math.min.apply(null, years), y1 = Math.max.apply(null, years);
  var rs = items.map(function (d) { return pctToRatio(d.score); }).concat((opts.refs || []).map(pctToRatio)).concat([0]);
  var rLo = Math.min.apply(null, rs), rHi = Math.max.apply(null, rs), pad = (rHi - rLo) * 0.07;
  rLo -= pad; rHi += pad;
  var X = function (y) { return m.l + (y - (y0 - 0.5)) / ((y1 + 0.5) - (y0 - 0.5)) * (W - m.l - m.r); };
  var Y = function (r) { return m.t + (r - rLo) / (rHi - rLo) * (H - m.t - m.b); };   // less rate (better) is higher up
  var colW = X(y0 + 1) - X(y0);
  var svg = svgBox(box, W, H, 'BD-rate against VTM by year of publication for ' + items.length + ' methods');
  // grid, axes
  var grid = sv('g', { class: 'grid' });
  pctTicks(rLo, rHi, (H - m.t - m.b) / (rHi - rLo), small ? 30 : 34).forEach(function (p) {
    var yy = Y(pctToRatio(p));
    grid.appendChild(sv('line', { x1: m.l, x2: W - m.r, y1: yy, y2: yy }));
    svg.appendChild(sv('text', { x: m.l - 8, y: yy + 4, 'text-anchor': 'end' }, pctLabel(p)));
  });
  for (var yr = y0; yr <= y1; yr++) {
    if (yr > y0) grid.appendChild(sv('line', { class: 'col', x1: X(yr - 0.5), x2: X(yr - 0.5), y1: m.t, y2: H - m.b }));
    if (!small || (yr - y0) % 2 === 0 || yr === y1) svg.appendChild(sv('text', { x: X(yr), y: H - m.b + 20, 'text-anchor': 'middle' }, String(yr)));
  }
  svg.appendChild(grid);
  svg.appendChild(sv('line', { class: 'axisline', x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b }));
  svg.appendChild(sv('text', { class: 'title', x: m.l - (small ? 40 : 52), y: H - m.b + 38 }, small ? 'Year' : 'Year of publication'));
  svg.appendChild(sv('text', { class: 'title', x: m.l - (small ? 40 : 52), y: 13 }, 'BD-rate against VTM on the fixed window'));
  svg.appendChild(sv('text', { class: 'title muted2', x: m.l - (small ? 40 : 52), y: 27 }, '\u2191 less rate, better'));
  // VTM runs and the reference
  var refs = opts.refs || [];
  if (refs.length) {
    var ra = Y(pctToRatio(Math.min.apply(null, refs))), rb = Y(pctToRatio(Math.max.apply(null, refs)));
    svg.appendChild(sv('rect', { class: 'refband', x: m.l, y: ra - 1, width: W - m.l - m.r, height: Math.max(2, rb - ra + 2) }));
  }
  svg.appendChild(sv('line', { class: 'refline', x1: m.l, x2: W - m.r, y1: Y(0), y2: Y(0) }));
  if (!small) {
    svg.appendChild(sv('text', { class: 'reflabel', x: W - m.r + 8, y: Y(0) - 3 }, 'VTM reference'));
    if (refs.length) svg.appendChild(sv('text', { class: 'reflabel muted2', x: W - m.r + 8, y: Y(0) + 11 }, refs.length + ' runs: ' + pct(Math.min.apply(null, refs), 1) + ' to ' + pct(Math.max.apply(null, refs), 1)));
  }
  // margin band (behind dots)
  var band = sv('rect', { class: 'band', x: m.l, width: W - m.l - m.r, y: 0, height: 0 }), bandEdge = sv('path', { class: 'band-edge', d: '' });
  svg.appendChild(band); svg.appendChild(bandEdge);
  // frontier: best so far among published methods
  var pub = items.filter(function (d) { return !d.mine && !d.context; }).slice().sort(function (a, b) { return a.year - b.year || a.score - b.score; });
  var best = null, frontier = [];
  pub.forEach(function (d) { if (best === null || d.score < best.score - 1e-12) { best = d; frontier.push(d); } });
  var stepsG = sv('g', { class: 'frontier' });
  svg.appendChild(stepsG);
  // dots, dodged within each year column
  var placed = {};
  var sorted = items.slice().sort(function (a, b) { return a.score - b.score; });
  sorted.forEach(function (d) {
    var cx = X(d.year), cy = Y(pctToRatio(d.score)), list = placed[d.year] || (placed[d.year] = []), k = 0, off = 0, limit = colW * 0.42;
    var clash = function (x) { return list.some(function (p) { return Math.hypot(p.x - x, p.y - cy) < 2 * R + 1.5; }); };
    while (clash(cx + off) && k < 24) { k++; off = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (2 * R + 1.6); if (Math.abs(off) > limit) off = (k % 2 ? 1 : -1) * limit * ((k % 5) / 5); }
    d._x = cx + off; d._y = cy; list.push({ x: d._x, y: cy });
  });
  var halos = sv('g'), dots = sv('g'), hits = sv('g'), labelsG = sv('g', { class: 'labels' }), dotEl = {}, haloEl = {};
  sorted.forEach(function (d) {
    haloEl[d.key] = halos.appendChild(sv('circle', { class: 'halo', cx: d._x, cy: d._y, r: R + 4.5, visibility: 'hidden' }));
    var cls = 'dot f' + (FAMILY[d.family] ? d.family.toLowerCase() : 'x') + (d.context ? ' ctx' : '') + (d.mine ? ' mine' : '');
    dotEl[d.key] = d.mine
      ? dots.appendChild(sv('path', { class: cls, d: starPath(d._x, d._y, R + 2.5) }))
      : dots.appendChild(sv('circle', { class: cls, cx: d._x, cy: d._y, r: d.context ? R - 1.5 : R }));
    var hit = sv('circle', { class: 'hit', cx: d._x, cy: d._y, r: R + 6, tabindex: 0, role: 'button', 'aria-label': d.name + ', ' + d.year + ', ' + pct(d.score) });
    hit.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') opts.onHover(d.key); });
    hit.addEventListener('pointermove', function (e) {
      showTip(e, [h('b', { text: d.name }), h('div', { text: [d.venue, d.year].filter(Boolean).join(' ') + (FAMILY[d.family] ? ', ' + FAMILY[d.family].toLowerCase() : '') }),
                  h('div', {}, h('b', { text: pct(d.score) }), ' against VTM' + (d.context ? ' (earlier method, not ranked)' : (d.mine ? ' (your method, not submitted)' : '')))]);
    });
    hit.addEventListener('pointerleave', function (e) { hideTip(); if (e.pointerType === 'mouse') opts.onHover(null); });
    hit.addEventListener('click', function () { hideTip(); opts.onSelect(d.key); });
    hit.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); opts.onSelect(d.key); } });
    hits.appendChild(hit);
  });
  svg.appendChild(halos); svg.appendChild(dots); svg.appendChild(labelsG); svg.appendChild(hits);
  box.appendChild(svg);

  function update(o) {
    sorted.forEach(function (d) {
      var sel = d.key === o.selected, tied = !sel && o.tied && o.tied[d.key];
      dotEl[d.key].classList.toggle('sel', sel);
      haloEl[d.key].setAttribute('visibility', tied || sel ? 'visible' : 'hidden');
      haloEl[d.key].setAttribute('class', 'halo' + (sel ? ' sel' : ''));
    });
    if (o.band) {
      var a = Y(pctToRatio(o.band[0])), b = Y(pctToRatio(o.band[1]));
      band.setAttribute('y', a); band.setAttribute('height', Math.max(0, b - a));
      bandEdge.setAttribute('d', 'M' + m.l + ' ' + a + 'H' + (W - m.r) + 'M' + m.l + ' ' + b + 'H' + (W - m.r));
    } else { band.setAttribute('height', 0); bandEdge.setAttribute('d', ''); }
    // frontier steps: solid when the new best is resolved against the previous best, dashed when it is within the margin
    clear(stepsG);
    if (frontier.length) {
      var path = '', xEnd = X(y1 + 0.45);
      frontier.forEach(function (d, i) {
        var yy = Y(pctToRatio(d.score));
        if (i === 0) path += 'M' + X(d.year - 0.45) + ' ' + yy;
        else {
          var prevY = Y(pctToRatio(frontier[i - 1].score)), st = (o.steps || {})[d.key];
          path += 'H' + X(d.year - 0.45);
          stepsG.appendChild(sv('path', { class: 'step' + (st === 'resolved' ? '' : ' weak'), d: 'M' + X(d.year - 0.45) + ' ' + prevY + 'V' + yy }));
          path += 'M' + X(d.year - 0.45) + ' ' + yy;
        }
      });
      path += 'H' + xEnd;
      stepsG.insertBefore(sv('path', { class: 'run', d: path }), stepsG.firstChild);
    }
    // labels: the selected method first, then new bests, the methods tied with it, then by score
    clear(labelsG);
    var fset = {};
    frontier.forEach(function (d) { fset[d.key] = true; });
    var lab = sorted.map(function (d, i) {
      var pr = d.key === o.selected ? 0 : (d.mine ? 1 : (fset[d.key] ? 2 : (o.tied && o.tied[d.key] ? 3 : 4 + i / 100)));
      return { key: d.key, text: d.name, x: d._x, y: d._y, r: R, bold: d.key === o.selected || !!fset[d.key] || d.mine, priority: pr, force: d.key === o.selected };
    });
    var marks = sorted.map(function (d) { return { key: d.key, x: d._x, y: d._y, r: R }; });
    placeLabels(lab, marks, { x0: m.l + 2, x1: W - 4, y0: m.t, y1: H - m.b - 2 }, small ? 10.5 : 11.5).forEach(function (l) {
      labelsG.appendChild(sv('text', { class: 'lab' + (l.bold ? ' b' : ''), x: l.x, y: l.y, 'text-anchor': l.anchor }, l.text));
    });
  }
  return { update: update, frontier: frontier };
}
function starPath(cx, cy, r) {
  var d = '', i, a, rr;
  for (i = 0; i < 10; i++) { a = -Math.PI / 2 + i * Math.PI / 5; rr = i % 2 ? r * 0.45 : r; d += (i ? 'L' : 'M') + (cx + rr * Math.cos(a)).toFixed(1) + ' ' + (cy + rr * Math.sin(a)).toFixed(1); }
  return d + 'Z';
}

/* ---------------------------------------------------------------- measured releases: estimates with intervals */
// rows: [{key, name, est, ci, resolved, said, best}] ; opts: {xLabel, onSelect, selected}
function forestChart(box, rows, opts) {
  clear(box);
  var W = Math.max(320, Math.floor(box.clientWidth || 700)), small = W < 560, rowH = 30, m = { l: small ? 92 : 128, r: small ? 64 : 92, t: 10, b: 44 };
  var H = m.t + rows.length * rowH + m.b;
  var vals = [0];
  rows.forEach(function (r) { vals.push(r.est); if (r.ci) vals.push(r.ci[0], r.ci[1]); if (r.said !== null && r.said !== undefined) vals.push(r.said); });
  var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), pad = (hi - lo) * 0.06 || 1;
  lo -= pad; hi += pad;
  var X = function (v) { return m.l + (v - lo) / (hi - lo) * (W - m.l - m.r); };
  var svg = svgBox(box, W, H, 'Rate of each measured release against the best one, with paired 95% intervals');
  var grid = sv('g', { class: 'grid' });
  niceTicks(lo, hi, small ? 4 : 6).forEach(function (t) {
    grid.appendChild(sv('line', { x1: X(t), x2: X(t), y1: m.t, y2: H - m.b }));
    svg.appendChild(sv('text', { x: X(t), y: H - m.b + 18, 'text-anchor': 'middle' }, (t > 0 ? '+' : (t < 0 ? MINUS : '')) + trim(Math.abs(t)) + '%'));
  });
  svg.appendChild(grid);
  svg.appendChild(sv('line', { class: 'refline', x1: X(0), x2: X(0), y1: m.t, y2: H - m.b }));
  svg.appendChild(sv('text', { class: 'title', x: W - m.r, y: H - 8, 'text-anchor': 'end' }, opts.xLabel || 'Rate against the best release (%)'));
  rows.forEach(function (r, i) {
    var cy = m.t + i * rowH + rowH / 2, g = sv('g', { class: 'frow' + (opts.selected === r.key ? ' sel' : ''), tabindex: 0, role: 'button', 'aria-label': r.name });
    g.appendChild(sv('rect', { class: 'frow-bg', x: 0, y: cy - rowH / 2, width: W, height: rowH }));
    g.appendChild(sv('text', { class: 'fname', x: m.l - 12, y: cy + 4, 'text-anchor': 'end' }, r.name));
    if (r.ci) {
      g.appendChild(sv('line', { class: 'ci' + (r.resolved ? '' : ' weak'), x1: X(r.ci[0]), x2: X(r.ci[1]), y1: cy, y2: cy }));
    }
    if (r.said !== null && r.said !== undefined) g.appendChild(sv('path', { class: 'said', d: 'M' + X(r.said) + ' ' + (cy - 5.5) + 'l5.5 5.5-5.5 5.5-5.5-5.5z' }));
    g.appendChild(sv('circle', { class: 'est' + (r.best ? ' best' : ''), cx: X(r.est), cy: cy, r: 5.5 }));
    g.appendChild(sv('text', { class: 'fval', x: W - m.r + 10, y: cy + 4 }, r.best ? 'least rate' : pct(r.est)));
    g.addEventListener('pointermove', function (e) {
      showTip(e, [h('b', { text: r.name }), r.best ? h('div', { text: 'Needs the least rate on this test set.' }) :
        h('div', {}, h('b', { text: pct(r.est) }), ' rate against the best release'),
        r.ci ? h('div', { text: 'Paired 95% interval ' + pct(r.ci[0]) + ' to ' + pct(r.ci[1]) + (r.resolved ? ' (excludes zero)' : ' (includes zero)') }) : null,
        r.said !== null && r.said !== undefined ? h('div', { text: 'Released curves gave ' + pct(r.said) }) : null]);
    });
    g.addEventListener('pointerleave', hideTip);
    if (opts.onSelect) {
      g.addEventListener('click', function () { opts.onSelect(r.key); });
      g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); opts.onSelect(r.key); } });
    }
    svg.appendChild(g);
  });
  box.appendChild(svg);
}

/* ---------------------------------------------------------------- published claims against the fixed window */
// rows: [{key, name, family, claim, canonical}] ; returns nothing. Lines that cross mark pairs whose order differs.
function slopeChart(box, rows, opts) {
  clear(box);
  var W = Math.max(320, Math.floor(box.clientWidth || 760)), small = W < 600;
  var H = small ? 420 : Math.max(380, 26 * rows.length + 90), lwA = small ? 56 : 170, lwB = small ? 124 : 170;
  var xa = lwA + (small ? 18 : 40), xb = W - lwB - (small ? 14 : 40), m = { t: 44, b: 24 };
  var vals = [];
  rows.forEach(function (r) { vals.push(r.claim, r.canonical); });
  var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), pad = (hi - lo) * 0.05 || 1;
  lo -= pad; hi += pad;
  var Y = function (v) { return m.t + (v - lo) / (hi - lo) * (H - m.t - m.b); };   // lower BD-rate (better) at the top
  var svg = svgBox(box, W, H, 'BD-rates as reported by each paper against the fixed-window scores');
  svg.appendChild(sv('text', { class: 'title', x: xa, y: 18, 'text-anchor': 'middle' }, 'As reported'));
  svg.appendChild(sv('text', { class: 'title', x: xb, y: 18, 'text-anchor': 'middle' }, 'Fixed window'));
  svg.appendChild(sv('text', { class: 'title muted2', x: xa, y: 32, 'text-anchor': 'middle' }, small ? 'own VTM run' : 'against each paper’s VTM run'));
  svg.appendChild(sv('text', { class: 'title muted2', x: xb, y: 32, 'text-anchor': 'middle' }, small ? 'VTM reference' : 'against the VTM reference'));
  svg.appendChild(sv('line', { class: 'axisline', x1: xa, x2: xa, y1: m.t - 4, y2: H - m.b + 4 }));
  svg.appendChild(sv('line', { class: 'axisline', x1: xb, x2: xb, y1: m.t - 4, y2: H - m.b + 4 }));
  var swaps = {};
  rows.forEach(function (a) {
    swaps[a.key] = rows.filter(function (b) { return b !== a && Math.sign(a.claim - b.claim) !== Math.sign(a.canonical - b.canonical); }).map(function (b) { return b.key; });
  });
  var spread = function (list, side) {      // keep labels apart vertically
    var items = list.map(function (r) { return { r: r, y: Y(side === 'a' ? r.claim : r.canonical) }; }).sort(function (p, q) { return p.y - q.y; });
    var gap = small ? 13 : 15;
    for (var i = 1; i < items.length; i++) if (items[i].y - items[i - 1].y < gap) items[i].y = items[i - 1].y + gap;
    var over = items.length ? items[items.length - 1].y - (H - m.b + 6) : 0;
    if (over > 0) { items.forEach(function (it) { it.y -= over; }); for (var j = items.length - 2; j >= 0; j--) if (items[j + 1].y - items[j].y < gap) items[j].y = items[j + 1].y - gap; }
    var map = {};
    items.forEach(function (it) { map[it.r.key] = it.y; });
    return map;
  };
  var la = spread(rows, 'a'), lb = spread(rows, 'b'), groups = {};
  rows.forEach(function (r) {
    var col = famColor(r.family), ya = Y(r.claim), yb = Y(r.canonical), g = sv('g', { class: 'sl', tabindex: 0, role: 'button', 'aria-label': r.name + ': reported ' + pct(r.claim) + ', fixed window ' + pct(r.canonical) });
    g.appendChild(sv('line', { class: 'shit', x1: xa, y1: ya, x2: xb, y2: yb }));
    g.appendChild(sv('line', { class: 'sline' + (swaps[r.key].length ? ' swap' : ''), x1: xa, y1: ya, x2: xb, y2: yb, stroke: col === 'none' ? 'var(--ink-2)' : col }));
    g.appendChild(sv('circle', { class: 'send', cx: xa, cy: ya, r: 4.5, fill: col === 'none' ? 'var(--sheet)' : col, stroke: col === 'none' ? 'var(--ink-2)' : 'var(--sheet)' }));
    g.appendChild(sv('circle', { class: 'send', cx: xb, cy: yb, r: 4.5, fill: col === 'none' ? 'var(--sheet)' : col, stroke: col === 'none' ? 'var(--ink-2)' : 'var(--sheet)' }));
    g.appendChild(sv('text', { class: 'slab', x: xa - 10, y: la[r.key] + 4, 'text-anchor': 'end' }, (small ? '' : r.name + '  ') + pct(r.claim, 1)));
    g.appendChild(sv('text', { class: 'slab', x: xb + 10, y: lb[r.key] + 4 }, pct(r.canonical, 1) + '  ' + r.name));
    var on = function () {
      svg.classList.add('focus');
      Object.keys(groups).forEach(function (k) { groups[k].classList.toggle('hl', k === r.key); groups[k].classList.toggle('sw', swaps[r.key].indexOf(k) >= 0); });
    };
    var off = function () { svg.classList.remove('focus'); Object.keys(groups).forEach(function (k) { groups[k].classList.remove('hl'); groups[k].classList.remove('sw'); }); hideTip(); };
    g.addEventListener('pointerenter', on);
    g.addEventListener('focus', on);
    g.addEventListener('pointerleave', off);
    g.addEventListener('blur', off);
    g.addEventListener('pointermove', function (e) {
      var sw = swaps[r.key].map(function (k) { return rows.filter(function (x) { return x.key === k; })[0].name; });
      showTip(e, [h('b', { text: r.name }), h('div', { text: 'Reported ' + pct(r.claim) + ' against ' + r.anchor }), h('div', { text: 'Fixed window ' + pct(r.canonical) }),
                  h('div', { text: sw.length ? 'Order differs from: ' + listNames(sw, 4) : 'Same order as every other paper here' })]);
    });
    groups[r.key] = g;
    svg.appendChild(g);
  });
  box.appendChild(svg);
  return swaps;
}

/* ---------------------------------------------------------------- coverage of the fixed window */
// q: PSNR values of the points, win: [q0, q1]. Shows where the curve starts and stops against the window.
function coverageBar(box, q, win) {
  clear(box);
  var W = Math.max(220, Math.floor(box.clientWidth || 300)), H = 40, m = { l: 4, r: 4 };
  var lo = Math.min(win[0], Math.min.apply(null, q)) - 0.8, hi = Math.max(win[1], Math.max.apply(null, q)) + 0.8;
  var X = function (v) { return m.l + (v - lo) / (hi - lo) * (W - m.l - m.r); };
  var qmin = Math.min.apply(null, q), qmax = Math.max.apply(null, q), okLo = qmin <= win[0] + 1e-9, okHi = qmax >= win[1] - 1e-9;
  var svg = svgBox(box, W, H, 'Points from ' + qmin.toFixed(2) + ' to ' + qmax.toFixed(2) + ' dB against the window ' + win[0] + ' to ' + win[1] + ' dB');
  svg.appendChild(sv('rect', { class: 'cov-win', x: X(win[0]), y: 4, width: X(win[1]) - X(win[0]), height: 18, rx: 2 }));
  svg.appendChild(sv('line', { class: 'cov-span', x1: X(qmin), x2: X(qmax), y1: 13, y2: 13 }));
  if (!okLo) svg.appendChild(sv('line', { class: 'cov-miss', x1: X(win[0]), x2: X(qmin), y1: 13, y2: 13 }));
  if (!okHi) svg.appendChild(sv('line', { class: 'cov-miss', x1: X(qmax), x2: X(win[1]), y1: 13, y2: 13 }));
  q.forEach(function (v) { svg.appendChild(sv('circle', { class: 'cov-pt', cx: X(v), cy: 13, r: 3.2 })); });
  svg.appendChild(sv('text', { class: 'cov-t', x: X(win[0]), y: 35, 'text-anchor': 'middle' }, String(win[0])));
  svg.appendChild(sv('text', { class: 'cov-t', x: X(win[1]), y: 35, 'text-anchor': 'middle' }, String(win[1])));
  box.appendChild(svg);
  return okLo && okHi;
}
