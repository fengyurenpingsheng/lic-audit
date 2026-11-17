/* LIC-Audit site: the user guide. Prose with the live numbers of the current protocol version. */

var GUIDE_SECTIONS = [
  ['g-what', 'What LIC-Audit does'], ['g-read', 'Reading the leaderboard'], ['g-eval', 'Evaluating your method'],
  ['g-join', 'Joining the board'], ['g-params', 'Fixed numbers, estimated numbers and updates'], ['g-images', 'How many test images you need'],
  ['g-faq', 'Questions'], ['g-cite', 'Version and citation']
];

function gsec(id, title, kids) { return h('section', { class: 'gsec', id: id }, h('h2', { text: title }), kids); }
function gp(text) { return h('p', {}, text); }

function renderGuide() {
  var toc = clear($('#guide-toc')), body = clear($('#guide-body'));
  toc.appendChild(h('div', { class: 'toc-t', text: 'On this page' }));
  GUIDE_SECTIONS.forEach(function (s) {
    toc.appendChild(h('a', { href: '#guide', 'data-target': s[0], text: s[1], onclick: function (e) {
      e.preventDefault(); var t = document.getElementById(s[0]);
      if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
      guidePinned = s[0]; clearTimeout(guidePinTimer); guidePinTimer = setTimeout(function () { guidePinned = null; }, 900);
      $all('#guide-toc a').forEach(function (a) { a.classList.toggle('on', a.getAttribute('data-target') === s[0]); });
    } }));
  });
  var sig = P.sigma, V = P.variability, cfg = CFG.update_policy || {};
  var review = cfg.review || 'once a year, in January', early = cfg.early_review_records || 10, majorShare = cfg.major_version_share || 25, minPairs = cfg.minimum_pairs || 15;

  // 1 -----------------------------------------------------------------
  body.appendChild(gsec('g-what', 'What LIC-Audit does', [
    gp('LIC-Audit keeps the usual measure of learned image compression, BD-rate on PSNR, and fixes the three things that make reported numbers hard to compare.'),
    h('div', { class: 'rules' },
      h('div', {}, h('h3', { text: 'Compute it the same way' }), h('p', { text: 'BD-rate is computed directly between two codecs over one frozen PSNR range per test set, on the monotone (PCHIP) interpolant of log-rate. A curve that does not span the range gets no score. On a shared range the reference cancels, so a different VTM run cannot change an order.' })),
      h('div', {}, h('h3', { text: 'Measure the same thing' }), h('p', { text: 'Rate is the written bitstream over the original image area. PSNR is taken on the 8-bit RGB reconstruction, cropped to the original size, and averaged per image. Every entry shows which of these its numbers follow.' })),
      h('div', {}, h('h3', { text: 'Say what the evidence supports' }), h('p', { text: 'With per-image records, a paired interval over the test images decides. With average curves only, a gap counts when it is larger than a margin that follows from the number of test images and an assumed image-to-image variability.' })))
  ]));

  // 2 -----------------------------------------------------------------
  var evRows = [1, 2, 3, 4].map(function (l) {
    return h('tr', {}, h('td', { class: 'nowrap' }, evidenceBadge(l)), h('td', { text: EVIDENCE_LONG[l] }),
      h('td', { text: { 1: 'A score, a position, and comparisons that depend on the assumed variability.', 2: 'Comparison with entries on the same measurement basis.', 3: 'A paired interval over the test images, with no assumed variability.', 4: 'A measurement-level comparison under common definitions.' }[l] }));
  });
  body.appendChild(gsec('g-read', 'Reading the leaderboard', [
    h('h3', { text: 'The score' }),
    gp('Each entry’s score is the BD-rate of its released curve against the VTM reference on the fixed window of the test set. Negative means less rate than VTM at equal PSNR, so lower is better. The reference is the mean log-rate of several released VTM runs; it shifts every score by the same factor and never changes an order.'),
    h('h3', { text: 'Progress over time' }),
    h('ul', { class: 'ticks' },
      h('li', {}, h('b', { text: 'Horizontal axis' }), ': the year the method was published.'),
      h('li', {}, h('b', { text: 'Vertical axis' }), ': its score. Higher on the chart means less rate.'),
      h('li', {}, h('b', { text: 'Colour' }), ': what the paper presents as its main contribution: ', FAMILY_ORDER.map(function (f, i) { return [famDot(f), ' ' + FAMILY[f].toLowerCase() + (i < FAMILY_ORDER.length - 1 ? ', ' : '.')]; })),
      h('li', {}, h('b', { text: 'Line' }), ': the best score so far. A dashed step means the new best is within the margin of the previous one, so average curves cannot show that it is better.'),
      h('li', {}, h('b', { text: 'Yellow band' }), ': the margin around the selected method. Dots with a yellow ring cannot be separated from it.')),
    h('h3', { text: 'Possible positions' }),
    gp('For every entry, the ranking lists the positions of the entries it cannot be separated from. “1–4” means that average curves cannot order this entry against the entries at positions 1 to 4. It is not a tie: per-image records can resolve it.'),
    h('h3', { text: 'Evidence' }),
    gp('The evidence column says how much was released for an entry. Each step includes the previous ones; the first needs only numbers that are already public.'),
    h('div', { class: 'sheet tablewrap' }, h('table', { class: 'ladder' }, h('thead', {}, h('tr', {}, h('th', { text: 'Level' }), h('th', { text: 'What was released' }), h('th', { text: 'What the board can say' }))), h('tbody', {}, evRows))),
    h('h3', { text: 'The other two boards' }),
    gp('Measured checkpoints: eight public checkpoints measured by LIC-Audit on Kodak, Tecnick, CLIC Pro and DIV2K, with paired 95% intervals over the images, and MS-SSIM as a sensitivity check. Published claims: the BD-rates that papers print against their own VTM run, next to the fixed-window scores, with the pairs whose order changes.')
  ]));

  // 3 -----------------------------------------------------------------
  body.appendChild(gsec('g-eval', 'Evaluating your method', [
    gp('Open “Evaluate your method” and paste the average rate (bits per pixel) and PSNR (dB) of each operating point. Fill one test set or all three. The score, the position and every comparison are computed in your browser; nothing is uploaded.'),
    h('ul', { class: 'ticks' },
      h('li', {}, 'The curve must reach both ends of the fixed window: ', DS.map(function (d, i) { return dsLabel(d) + ' ' + P.datasets[d].window[0] + NDASH + P.datasets[d].window[1] + ' dB' + (i < DS.length - 1 ? ', ' : '.'); })),
      h('li', { text: 'Two columns, a CSV with a header, Python lists, LaTeX rows, a CompressAI result file and tables with one row per quantity are all read. The page shows exactly what it read.' }),
      h('li', { text: 'At least two points reaching both ends of the window; with five or more, every robustness check runs.' }),
      h('li', {}, 'Per-image records (optional): a CSV with ', h('code', { text: 'image, op, bpp, psnr' }), ' gives paired intervals against the eight measured releases.')),
    h('div', { class: 'btnrow' }, h('a', { class: 'btn', href: '#evaluate', text: 'Evaluate your method' }))
  ]));

  // 4 -----------------------------------------------------------------
  body.appendChild(gsec('g-join', 'Joining the board', [
    h('ol', { class: 'seq' },
      h('li', {}, h('b', { text: 'Evaluate' }), ' your method on this site and fill in step 4: name, paper, and how bits and PSNR were measured.'),
      h('li', {}, h('b', { text: 'Publish the numbers' }), ' in your repository and note the commit and the file that hold them.'),
      h('li', {}, h('b', { text: 'Submit' }), ': the button opens a GitHub issue with the submission file, or add the file to submissions/accepted/ in a pull request.'),
      h('li', {}, h('b', { text: 'Automatic check' }), ': the reference tool recomputes the score and looks for every number at the stated repository, commit and file. The report card is posted on the issue.'),
      h('li', {}, h('b', { text: 'Acceptance' }), ': a maintainer confirms that the labels at the source name this method and test set, and the entry appears with its evidence level and source link.')),
    gp('Rates estimated from likelihoods and averaging rules other than the mean of per-image values are scored for diagnosis and are not ranked. Luma PSNR and other test-set splits are not accepted. A new entry is scored on the existing window against the existing reference, so it cannot change any existing score.')
  ]));

  // 5 -----------------------------------------------------------------
  var winTxt = DS.map(function (d) { return dsLabel(d) + ' ' + P.datasets[d].window[0] + NDASH + P.datasets[d].window[1] + ' dB'; }).join(', ');
  var limTxt = DS.map(function (d) { return '±' + L.limit(sig.calibrated.value, P.datasets[d].n_images).toFixed(2) + '% on ' + dsLabel(d); }).join(', ');
  var prow = function (name, value, origin, change, when) {
    return h('tr', {}, h('td', {}, h('b', { text: name })), h('td', { class: 'num' }, value), h('td', { text: origin }), h('td', {}, change), h('td', { text: when }));
  };
  var yes = function (t) { return h('span', { class: 'pill yes', text: t }); }, no = function (t) { return h('span', { class: 'pill no', text: t }); };
  var strip = h('div', { class: 'chart', id: 'sigma-strip' });
  body.appendChild(gsec('g-params', 'Fixed numbers, estimated numbers and updates', [
    gp('The protocol has a few frozen numbers. Only one of them is estimated from data: the image-to-image variability behind the margin. The table says where each comes from and whether a new method changes it.'),
    h('div', { class: 'sheet tablewrap' }, h('table', { class: 'params' },
      h('thead', {}, h('tr', {}, h('th', { text: 'Number' }), h('th', { text: 'Now (v' + P.version + ')' }), h('th', { text: 'Where it comes from' }), h('th', { text: 'Does a new method change it?' }), h('th', { text: 'When it is revisited' }))),
      h('tbody', {},
        prow('Fixed window per test set', winTxt, P.window_rule + ', frozen on ' + P.frozen_on + '.', no('No. A new curve must reach the existing window.'), 'Only in a new major version.'),
        prow('VTM reference level', DS.map(function (d) { return dsLabel(d) + ' ' + P.datasets[d].anchors.length; }).join(', ') + ' runs', 'Mean log-rate of the released VTM runs on the window.', no('No, and it cannot change any order or any direct comparison.'), 'Only in a new major version.'),
        prow('How BD-rate is computed', 'PCHIP, ' + P.grid_points + ' grid points', 'Predeclared: three interpolants, three point subsets and three alternative windows as robustness checks.', no('No.'), 'Only in a new major version.'),
        prow('Image-to-image variability', sig.calibrated.value.toFixed(2) + ' (also ' + sig.historical.value.toFixed(2) + ' and ' + sig.stress.value.toFixed(2) + ')', 'The 90th percentile of ' + V.rows.length + ' measured comparisons among six 2025–26 releases, from their per-image records.',
             no('Not right away. Per-image records that come with new submissions are collected and enter the next estimate.'), 'At each review: ' + review + ', or earlier once ' + early + ' new releases with per-image records have arrived.'),
        prow('Margin per test set', limTxt, '1.96 × variability ÷ √(number of images).', no('Only through the variability.'), 'With the variability.'),
        prow('Positions', 'computed', 'Sorting by score.', yes('Yes, as soon as an entry is accepted.'), 'With every accepted entry.')))),
    h('div', { class: 'callout' }, h('b', { text: 'What never changes: ' }), 'an accepted entry never changes an existing score. A new estimate of the variability changes how wide the yellow band is, and therefore which gaps can be called from average curves; it never changes a score or a position.'),
    h('h3', { text: 'Where the variability comes from' }),
    gp('Each dot is the measured variability of one pair of 2025–26 releases on one test set, from their per-image records. The default assumption is the 90th percentile; the median is shown for reference.'),
    strip,
    gp('Does a value borrowed from other releases work for a new codec? In a leave-one-codec-out check, each release was held out in turn and the value was estimated from the pairs without it. Applied to the held-out pairs, it called ' + V.holdout.false + ' differences that the per-image intervals do not support and missed ' + V.holdout.missed + ' that they do support, out of ' + V.holdout.evaluations + ' comparisons. It was at least as large as the measured variability in ' + V.holdout.coverage_percent + '% of the held-out pairs, somewhat below the ' + V.holdout.expected_low + NDASH + V.holdout.expected_high + '% expected if codecs were exchangeable. For a new paper without per-image records it is therefore a conservative working assumption, not a guarantee.'),
    h('h3', { text: 'How an update works' }),
    h('ol', { class: 'seq' },
      h('li', {}, h('b', { text: 'Within a version' }), ', new entries are added and positions change; windows, reference, rules and the variability stay as they are.'),
      h('li', {}, h('b', { text: 'At each review' }), ' (' + review + '), the variability is re-estimated with the same rule from the per-image records of the releases of the two previous calendar years: those measured by LIC-Audit and those that came with accepted entries. With fewer than ' + minPairs + ' measured pairs the current value is kept. The leave-one-codec-out check is rerun, and the result is published as a minor version (for example v1.3) with a change log. In the repository, tools/recalibrate.py does all of this; on the data of v' + P.version + ' it returns ' + sig.calibrated.value.toFixed(2) + ' and the check above.'),
      h('li', {}, h('b', { text: 'A new major version' }), ' (for example v2.0) is considered when at least ' + majorShare + '% of a year’s submissions cannot reach a window, when the reference codec is replaced, or when a test set or a quality measure is added. Windows are then derived again with the same rule.'),
      h('li', {}, h('b', { text: 'Old versions stay available' }), ': every entry records the version it was scored under, and the previous board can be rebuilt from the repository.')),
    h('h3', { text: 'Version history' }),
    h('ul', { class: 'ticks' }, P.history.slice().reverse().map(function (v) {
      return h('li', {}, h('b', { text: 'v' + v.version }), v.frozen_on ? ' (frozen on ' + v.frozen_on + ', current)' : ' (archived)', ': ' + v.note);
    }))
  ]));
  setTimeout(function () { sigmaStrip(strip); }, 0);

  // 6 -----------------------------------------------------------------
  var ss = P.planning.sample_size, diffs = Object.keys(ss.p90).sort(function (a, b) { return Number(a) - Number(b); });
  var srows = diffs.map(function (d) {
    return h('tr', {}, h('td', { class: 'num', text: Number(d).toFixed(1) + ' points' }),
      h('td', { class: 'r num', text: fmtInt(ss.p90[d].resolve) }), h('td', { class: 'r num', text: fmtInt(ss.p90[d].power80) }),
      h('td', { class: 'r num', text: fmtInt(ss.ref[d].resolve) }), h('td', { class: 'r num', text: fmtInt(ss.ref[d].power80) }));
  });
  body.appendChild(gsec('g-images', 'How many test images you need', [
    gp('With average curves only, the smallest difference you can call depends on the number of test images. The table gives the number of images needed to resolve a true difference, and to detect it with 80% power, at the two variability assumptions. Kodak has 24 images, CLIC Pro 41 and Tecnick 100.'),
    h('div', { class: 'sheet tablewrap' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', { text: 'True difference' }), h('th', { class: 'r', text: 'Recent releases: to resolve' }), h('th', { class: 'r', text: 'with 80% power' }), h('th', { class: 'r', text: 'Older codecs: to resolve' }), h('th', { class: 'r', text: 'with 80% power' }))),
      h('tbody', {}, srows))),
    gp('Per-image records avoid the assumption altogether: the paired interval uses the variability of your own two codecs on your own images.')
  ]));

  // 7 -----------------------------------------------------------------
  var faq = [
    ['Why is a method listed but not ranked?', 'Its released curve does not reach both ends of the fixed window, and the protocol never extrapolates or narrows the window. One more operating point at the missing end is enough.'],
    ['Why do some entries have no curve in the plots?', 'Their source repository carries no license, so the board shows the score computed from the curve and links to the file, but does not copy the values. Authors can submit their own curve to have it shown.'],
    ['Why is the reference a mean of several VTM runs?', 'Released VTM runs differ by up to ' + Math.max.apply(null, DS.map(function (d) { return P.reference_spread[d].max_abs_bd_window || 0; })).toFixed(1) + ' BD-rate points on the same window. A fixed mean keeps scores stable; direct comparisons between methods do not depend on it at all.'],
    ['Do the scores here match the reference tool?', 'Yes. The browser code and the Python reference implementation are compared on every released curve, every pairwise decision and the measured paired intervals; the test ships with the repository.'],
    ['Can I run the check in a script?', 'Yes: python tools/check_submission.py my_method.json prints the same report card, and --online also looks for the numbers at the stated source.'],
    ['Why are the 2017–2019 methods not ranked?', 'The ranked corpus is the MSE-optimised methods of 2020–2026 with released numeric curves. Earlier methods are scored for context and can be shown on the chart.']
  ];
  body.appendChild(gsec('g-faq', 'Questions', faq.map(function (x) { return h('details', { class: 'faq' }, h('summary', { text: x[0] }), h('p', { text: x[1] })); })));

  // 8 -----------------------------------------------------------------
  var eng = P.engine_sha256 || {};
  body.appendChild(gsec('g-cite', 'Version and citation', [
    gp('Protocol v' + P.version + ', frozen on ' + P.frozen_on + '. Reference engine files (SHA-256): ' + Object.keys(eng).map(function (k) { return k + ' ' + eng[k].slice(0, 12); }).join(', ') + '.'),
    CFG.paper ? h('p', {}, 'Paper: ', h('a', { href: CFG.paper, target: '_blank', rel: 'noopener', text: CFG.paper })) : null,
    CFG.citation ? h('pre', { class: 'cite', text: CFG.citation }) : gp('The citation appears here once the paper is public.')
  ]));
  guideSpy();
}

function sigmaStrip(box) {
  clear(box);
  var V = P.variability, vals = V.rows.map(function (r) { return r.sigma_pair; }), p90 = P.sigma.calibrated.value, med = V.median, ref = P.sigma.historical.value;
  var W = Math.max(300, Math.floor(box.clientWidth || 600)), H = 134, m = { l: 16, r: 16 }, top = 36;
  var lo = 0, hi = Math.max(Math.max.apply(null, vals), ref) * 1.08;
  var X = function (v) { return m.l + (v - lo) / (hi - lo) * (W - m.l - m.r); };
  var svg = svgBox(box, W, H, vals.length + ' measured variabilities; median ' + med.toFixed(2) + ', 90th percentile ' + p90.toFixed(2));
  niceTicks(lo, hi, 6).forEach(function (t) { svg.appendChild(sv('line', { class: 'gridl', x1: X(t), x2: X(t), y1: top, y2: 100 })); svg.appendChild(sv('text', { x: X(t), y: 118, 'text-anchor': 'middle' }, trim(t))); });
  var sorted = vals.slice().sort(function (a, b) { return a - b; }), rowsLast = [];
  sorted.forEach(function (v) {
    var px = X(v), row = 0;
    while (rowsLast[row] !== undefined && px - rowsLast[row] < 9) row++;
    rowsLast[row] = px;
    svg.appendChild(sv('circle', { class: 'sdot2', cx: px, cy: 92 - row * 9, r: 4 }));
  });
  var ends = [];
  [[med, 'median ' + med.toFixed(2), 'medl'], [p90, '90th percentile ' + p90.toFixed(2) + ' (default)', 'p90l'], [ref, 'older codecs ' + ref.toFixed(2), 'refl']].forEach(function (x) {
    var w = textWidth(x[1], '400 11.5px "LA Instrument", sans-serif'), x0 = X(x[0]) + 4, row = 0;
    while (ends[row] !== undefined && x0 < ends[row] + 10) row++;
    if (x0 + w > W) x0 = X(x[0]) - 4 - w;
    ends[row] = x0 + w;
    var ty = 12 + row * 13;
    svg.appendChild(sv('line', { class: x[2], x1: X(x[0]), x2: X(x[0]), y1: ty + 3, y2: 102 }));
    svg.appendChild(sv('text', { class: 'mlab', x: x0, y: ty }, x[1]));
  });
  svg.appendChild(sv('text', { class: 'title', x: W - m.r, y: H - 2, 'text-anchor': 'end' }, 'variability, BD-rate points per image'));
  box.appendChild(svg);
}

var guidePinned = null, guidePinTimer = null;
function guideScroll() {
  if (state.view !== 'guide' || guidePinned) return;
  var cur = GUIDE_SECTIONS[0][0];
  GUIDE_SECTIONS.forEach(function (s) { var el = document.getElementById(s[0]); if (el && el.getBoundingClientRect().top < 140) cur = s[0]; });
  // at the bottom of the page the last sections cannot reach the top: mark the last one
  if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) cur = GUIDE_SECTIONS[GUIDE_SECTIONS.length - 1][0];
  $all('#guide-toc a').forEach(function (a) { a.classList.toggle('on', a.getAttribute('data-target') === cur); });
}
function guideSpy() {
  if (!state.guide) { window.addEventListener('scroll', guideScroll, { passive: true }); state.guide = true; }
  guideScroll();
}
