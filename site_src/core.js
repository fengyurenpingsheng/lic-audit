/* LIC-Audit scoring core (protocol v1.2).
 *
 * Pure functions, no dependencies. The same file runs in the browser (global LICAudit) and in Node (module.exports).
 * It mirrors the Python reference implementation (licaudit/bd.py and licaudit/decisions.py); tests/test_parity.mjs
 * compares the two on every released curve.
 *
 * Conventions: rate in bits per pixel (> 0), quality in dB (PSNR). level() is the average of log10(rate) over a quality
 * window on the curve's monotone interpolant; the BD-rate of b against a is 100 * (10^(level_b - level_a) - 1) percent,
 * negative when b needs fewer bits. A window is used exactly as given: a curve that does not span it gets no value.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LICAudit = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TOL_DB = 1e-9, N_GRID = 2001, MIN_POINTS_SUBSET = 5, MIN_POINTS_AKIMA = 5, Z95 = 1.96;
  var INTERPS = ['pchip', 'akima', 'cubic'], SUBSETS = ['all', 'drop_high', 'drop_low'];

  function sign(x) { return x > 0 ? 1 : (x < 0 ? -1 : 0); }
  function finite(x) { return typeof x === 'number' && isFinite(x); }

  /* ---------------------------------------------------------------- curve preparation */

  // Upper envelope: sort by rate and keep the points whose quality strictly increases.
  function upperEnvelope(bpp, q) {
    var pts = [], i, out = [];
    for (i = 0; i < bpp.length; i++) pts.push([Number(bpp[i]), Number(q[i])]);
    pts.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    for (i = 0; i < pts.length; i++) {
      if (!out.length || pts[i][1] > out[out.length - 1][1] + 1e-9) out.push(pts[i]);
    }
    return out;
  }

  // Returns {ok, status, note, x (quality, increasing), y (log10 rate), n, nEnvelope}.
  function prepare(bpp, q, subset) {
    subset = subset || 'all';
    var bad = function (status, note, nEnv) { return { ok: false, status: status, note: note, x: [], y: [], n: 0, nEnvelope: nEnv || 0 }; };
    if (!bpp || !q || bpp.length !== q.length || bpp.length < 2) return bad('invalid_curve', 'fewer than two points or length mismatch');
    var i;
    for (i = 0; i < bpp.length; i++) {
      var b = Number(bpp[i]), v = Number(q[i]);
      if (!(isFinite(b) && b > 0) || !isFinite(v)) return bad('invalid_curve', 'non-finite quality or non-positive rate');
    }
    var env = upperEnvelope(bpp, q), nEnv = env.length;
    if (nEnv < 2) return bad('invalid_curve', 'fewer than two envelope points', nEnv);
    if (subset !== 'all') {
      if (nEnv < MIN_POINTS_SUBSET) return bad('not_applicable', 'subset needs >= ' + MIN_POINTS_SUBSET + ' points', nEnv);
      if (subset === 'drop_low') env = env.slice(1);
      else if (subset === 'drop_high') env = env.slice(0, -1);
      else throw new Error('unknown subset ' + subset);
    }
    env = env.slice().sort(function (a, b) { return a[1] - b[1]; });
    var x = [], y = [];
    for (i = 0; i < env.length; i++) {
      if (i === 0 || env[i][1] - env[i - 1][1] > 1e-12) { x.push(env[i][1]); y.push(Math.log10(env[i][0])); }
    }
    return { ok: true, status: 'ok', note: '', x: x, y: y, n: x.length, nEnvelope: nEnv };
  }

  /* ---------------------------------------------------------------- interpolants (as in SciPy) */

  function pchipEdge(h0, h1, m0, m1) {
    var d = ((2 * h0 + h1) * m0 - h0 * m1) / (h0 + h1);
    if (sign(d) !== sign(m0)) return 0;
    if (sign(m0) !== sign(m1) && Math.abs(d) > 3 * Math.abs(m0)) return 3 * m0;
    return d;
  }

  function pchipDerivs(x, y) {
    var n = x.length, h = [], m = [], d = new Array(n), i;
    for (i = 0; i < n - 1; i++) { h.push(x[i + 1] - x[i]); m.push((y[i + 1] - y[i]) / h[i]); }
    if (n === 2) { d[0] = m[0]; d[1] = m[0]; return d; }
    for (i = 1; i < n - 1; i++) {
      var m0 = m[i - 1], m1 = m[i];
      if (sign(m0) !== sign(m1) || m0 === 0 || m1 === 0) d[i] = 0;
      else {
        var w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
        d[i] = 1 / ((w1 / m0 + w2 / m1) / (w1 + w2));
      }
    }
    d[0] = pchipEdge(h[0], h[1], m[0], m[1]);
    d[n - 1] = pchipEdge(h[n - 2], h[n - 3], m[n - 2], m[n - 3]);
    return d;
  }

  function akimaDerivs(x, y) {
    var n = x.length, m = new Array(n + 3), i;
    for (i = 0; i < n - 1; i++) m[i + 2] = (y[i + 1] - y[i]) / (x[i + 1] - x[i]);
    m[1] = 2 * m[2] - m[3]; m[0] = 2 * m[1] - m[2];
    m[n + 1] = 2 * m[n] - m[n - 1]; m[n + 2] = 2 * m[n + 1] - m[n];
    var f1 = new Array(n), f2 = new Array(n), f12 = new Array(n), t = new Array(n), mmax = -Infinity;
    for (i = 0; i < n; i++) {
      f1[i] = Math.abs(m[i + 3] - m[i + 2]); f2[i] = Math.abs(m[i + 1] - m[i]); f12[i] = f1[i] + f2[i];
      if (f12[i] > mmax) mmax = f12[i];
      t[i] = 0.5 * (m[i + 3] + m[i]);
    }
    for (i = 0; i < n; i++) {
      if (f12[i] > 1e-9 * mmax) t[i] = m[i + 1] + (f2[i] / f12[i]) * (m[i + 2] - m[i + 1]);
    }
    return t;
  }

  // Piecewise cubic through (x, y) with slopes d, in the power form SciPy evaluates; NaN outside [x0, xn].
  function hermite(x, y, d) {
    var n = x.length, c0 = [], c1 = [], i;
    for (i = 0; i < n - 1; i++) {
      var dx = x[i + 1] - x[i], slope = (y[i + 1] - y[i]) / dx, t = (d[i] + d[i + 1] - 2 * slope) / dx;
      c0.push(t / dx); c1.push((slope - d[i]) / dx - t);
    }
    return function (v) {
      if (!(v >= x[0] && v <= x[n - 1])) return NaN;
      var lo = 0, hi = n - 2;
      while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (x[mid] <= v) lo = mid; else hi = mid - 1; }
      var s = v - x[lo], z = s, res = y[lo];
      res += d[lo] * z; z *= s; res += c1[lo] * z; z *= s; res += c0[lo] * z;
      return res;
    };
  }

  // Least-squares polynomial of degree deg (the fitted function of numpy.polyfit, solved on centred, scaled abscissae).
  function polyfit(x, y, deg) {
    var n = x.length, k = deg + 1, i, j, r, mean = 0, scale = 0;
    for (i = 0; i < n; i++) mean += x[i];
    mean /= n;
    for (i = 0; i < n; i++) scale = Math.max(scale, Math.abs(x[i] - mean));
    if (!(scale > 0)) scale = 1;
    // Householder QR of the Vandermonde matrix in u = (x - mean) / scale
    var A = [], bvec = y.slice();
    for (i = 0; i < n; i++) { var u = (x[i] - mean) / scale, row = [1]; for (j = 1; j < k; j++) row.push(row[j - 1] * u); A.push(row); }
    for (j = 0; j < k; j++) {
      var norm = 0;
      for (i = j; i < n; i++) norm += A[i][j] * A[i][j];
      norm = Math.sqrt(norm);
      if (norm === 0) continue;
      var alpha = A[j][j] > 0 ? -norm : norm, vv = [];
      for (i = j; i < n; i++) vv.push(A[i][j]);
      vv[0] -= alpha;
      var vnorm = 0;
      for (i = 0; i < vv.length; i++) vnorm += vv[i] * vv[i];
      if (vnorm === 0) continue;
      for (r = j; r < k; r++) {
        var dot = 0;
        for (i = j; i < n; i++) dot += vv[i - j] * A[i][r];
        dot = 2 * dot / vnorm;
        for (i = j; i < n; i++) A[i][r] -= dot * vv[i - j];
      }
      var dotb = 0;
      for (i = j; i < n; i++) dotb += vv[i - j] * bvec[i];
      dotb = 2 * dotb / vnorm;
      for (i = j; i < n; i++) bvec[i] -= dotb * vv[i - j];
    }
    var coef = new Array(k);
    for (j = k - 1; j >= 0; j--) {
      var sum = bvec[j];
      for (r = j + 1; r < k; r++) sum -= A[j][r] * coef[r];
      coef[j] = sum / A[j][j];
    }
    return function (v) {
      var u = (v - mean) / scale, res = 0;
      for (var p = k - 1; p >= 0; p--) res = res * u + coef[p];
      return res;
    };
  }

  // Returns {f, used}; `used` differs from `method` when Akima needs a substitute (fewer than five points).
  function interpolant(p, method) {
    if (method === 'pchip') return { f: hermite(p.x, p.y, pchipDerivs(p.x, p.y)), used: 'pchip' };
    if (method === 'akima') {
      if (p.n < MIN_POINTS_AKIMA) return { f: hermite(p.x, p.y, pchipDerivs(p.x, p.y)), used: 'pchip' };
      return { f: hermite(p.x, p.y, akimaDerivs(p.x, p.y)), used: 'akima' };
    }
    if (method === 'cubic') return { f: polyfit(p.x, p.y, Math.min(3, p.n - 1)), used: 'cubic' };
    throw new Error('unknown interpolation ' + method);
  }

  function windowMean(f, lo, hi) {
    var step = (hi - lo) / (N_GRID - 1), prevX = lo, prevY = f(lo), acc = 0;
    for (var i = 1; i < N_GRID; i++) {
      var x = i === N_GRID - 1 ? hi : lo + i * step, yv = f(x);
      acc += (yv + prevY) / 2 * (x - prevX);
      prevX = x; prevY = yv;
    }
    return acc / (hi - lo);
  }

  function covers(p, w) { return p.ok && p.x[0] <= w[0] + TOL_DB && p.x[p.n - 1] >= w[1] - TOL_DB; }

  /* ---------------------------------------------------------------- levels and BD-rates */

  // Strict log-rate level on exactly `window`. value is null unless status === 'ok'.
  function level(bpp, q, window, method, subset) {
    method = method || 'pchip';
    var p = prepare(bpp, q, subset || 'all');
    if (!p.ok) return { value: null, status: p.status, note: p.note, n: p.n };
    if (!covers(p, window)) {
      return { value: null, status: 'insufficient_coverage', n: p.n,
               note: 'curve spans [' + p.x[0].toFixed(3) + ', ' + p.x[p.n - 1].toFixed(3) + '] dB, window [' + window[0].toFixed(3) + ', ' + window[1].toFixed(3) + '] dB' };
    }
    var it = interpolant(p, method);
    var lo = Math.max(window[0], p.x[0]), hi = Math.min(window[1], p.x[p.n - 1]);
    var val = windowMean(it.f, lo, hi);
    if (!isFinite(val)) return { value: null, status: 'invalid_curve', note: 'non-finite interpolant on window', n: p.n };
    if (it.used !== method) return { value: null, status: 'fallback', note: method + ' needs >= ' + MIN_POINTS_AKIMA + ' points', n: p.n };
    return { value: val, status: 'ok', note: '', n: p.n };
  }

  function pct(dLog) { return (Math.pow(10, dLog) - 1) * 100; }

  // Levels of a curve for every protocol variant of a dataset (same order as data/protocol.json "cells").
  function cells(bpp, q, ds) {
    return ds.cells.map(function (c) { return level(bpp, q, c.window, c.interp, c.subset).value; });
  }

  // Conventional BD-rate of `test` against `anchor` on the pair's own common PSNR range (PCHIP); null if no overlap.
  function overlapBD(anchorBpp, anchorQ, testBpp, testQ) {
    var pa = prepare(anchorBpp, anchorQ), pt = prepare(testBpp, testQ);
    if (!pa.ok || !pt.ok) return null;
    var lo = Math.max(pa.x[0], pt.x[0]), hi = Math.min(pa.x[pa.n - 1], pt.x[pt.n - 1]);
    if (!(hi - lo > 1e-6)) return null;
    var d = windowMean(interpolant(pt, 'pchip').f, lo, hi) - windowMean(interpolant(pa, 'pchip').f, lo, hi);
    return isFinite(d) ? { value: pct(d), window: [lo, hi] } : null;
  }

  // Local rate difference (%) of test against anchor at each quality of qgrid (NaN outside the common range).
  function rateRatioProfile(aBpp, aQ, tBpp, tQ, qgrid) {
    var pa = prepare(aBpp, aQ), pt = prepare(tBpp, tQ);
    if (!pa.ok || !pt.ok) return qgrid.map(function () { return NaN; });
    var fa = interpolant(pa, 'pchip').f, ft = interpolant(pt, 'pchip').f;
    return qgrid.map(function (v) { var a = fa(v), t = ft(v); return isFinite(a) && isFinite(t) ? pct(t - a) : NaN; });
  }

  // Sampled interpolant of a curve for plotting: [[quality, bpp], ...] between its end points.
  function sampleCurve(bpp, q, nSamples) {
    var p = prepare(bpp, q);
    if (!p.ok) return [];
    var f = interpolant(p, 'pchip').f, out = [], lo = p.x[0], hi = p.x[p.n - 1], n = nSamples || 80;
    for (var i = 0; i <= n; i++) { var v = i === n ? hi : lo + (hi - lo) * i / n; out.push([v, Math.pow(10, f(v))]); }
    return out;
  }

  /* ---------------------------------------------------------------- decisions */

  // Direct effects (percent, b against a) over the protocol variants valid for both curves.
  function family(cellsA, cellsB) {
    var eff = [];
    for (var i = 0; i < cellsA.length; i++) {
      if (cellsA[i] !== null && cellsB[i] !== null && cellsA[i] !== undefined && cellsB[i] !== undefined) eff.push(pct(cellsB[i] - cellsA[i]));
    }
    var canon = (cellsA[0] === null || cellsB[0] === null || cellsA[0] === undefined || cellsB[0] === undefined) ? null : pct(cellsB[0] - cellsA[0]);
    return { effects: eff, canonical: canon, attempted: cellsA.length };
  }

  // The decision summary of the reference code: least favourable valid effect and break-even variability sigma*.
  function decide(effects, canonical, nImages) {
    var eff = effects.filter(finite);
    if (!eff.length || canonical === null || canonical === undefined) {
      return { abstained: true, stable: false, canonical: canonical === undefined ? null : canonical, least: null, min: null, max: null, sigmaStar: null, nValid: eff.length };
    }
    var lo = Math.min.apply(null, eff), hi = Math.max.apply(null, eff);
    var stable = eff.every(function (e) { return e < 0; }) || eff.every(function (e) { return e > 0; });
    if (!stable) return { abstained: false, stable: false, canonical: canonical, least: null, min: lo, max: hi, sigmaStar: null, nValid: eff.length };
    var least = eff[0];
    for (var i = 1; i < eff.length; i++) if (Math.abs(eff[i]) < Math.abs(least)) least = eff[i];
    return { abstained: false, stable: true, canonical: canonical, least: least, min: lo, max: hi,
             sigmaStar: Math.abs(least) * Math.sqrt(nImages) / Z95, nValid: eff.length };
  }

  function compare(cellsA, cellsB, nImages) {
    var fam = family(cellsA, cellsB), d = decide(fam.effects, fam.canonical, nImages);
    d.attempted = fam.attempted;
    return d;
  }

  // Smallest difference a test set can resolve from average curves at an assumed image-to-image variability.
  function limit(sigma, nImages) { return Z95 * sigma / Math.sqrt(nImages); }

  // 'no_coverage' | 'unstable' | 'resolved' | 'within' at an assumed variability sigma (points).
  function statusAt(decision, sigma) {
    if (decision.abstained) return 'no_coverage';
    if (!decision.stable) return 'unstable';
    return decision.sigmaStar > sigma ? 'resolved' : 'within';
  }

  // The status names of the reference code at its two frozen scales.
  function referenceStatus(decision, sigmaRef, sigmaHi) {
    if (decision.abstained) return 'abstained';
    if (!decision.stable) return 'unstable';
    if (decision.sigmaStar > sigmaHi) return 'robust_conditional';
    if (decision.sigmaStar > sigmaRef) return 'resolved_conditional';
    return 'unresolved';
  }

  // The part of a difference that remains beyond the margin (the paper's conditional margin).
  function conditionalMargin(least, nImages, sigma) {
    if (least === null || !isFinite(least)) return null;
    var mag = Math.abs(least) - limit(sigma, nImages);
    return mag > 0 ? sign(least) * mag : 0;
  }

  // For entries sorted by score, the positions each entry cannot be separated from at the assumed variability.
  function rankBands(entries, nImages, sigma) {
    var n = entries.length, out = [];
    for (var i = 0; i < n; i++) {
      var lo = i, hi = i, tied = [];
      for (var j = 0; j < n; j++) {
        if (j === i) continue;
        var st = statusAt(compare(entries[i].cells, entries[j].cells, nImages), sigma);
        if (st !== 'resolved') { tied.push(j); if (j < lo) lo = j; if (j > hi) hi = j; }
      }
      out.push({ lo: lo, hi: hi, tied: tied });
    }
    return out;
  }

  /* ---------------------------------------------------------------- per-image records */

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Mean rate and quality per operating point over the images in idx (all images when idx is null; skip = one index left out).
  function meanCurve(M, idx, skip) {
    var k = M.R[0].length, n = M.R.length, b = new Array(k).fill(0), v = new Array(k).fill(0), cnt = 0, i, j, r;
    if (idx) {
      for (i = 0; i < idx.length; i++) { r = idx[i]; for (j = 0; j < k; j++) { b[j] += M.R[r][j]; v[j] += M.Q[r][j]; } }
      cnt = idx.length;
    } else {
      for (r = 0; r < n; r++) { if (r === skip) continue; for (j = 0; j < k; j++) { b[j] += M.R[r][j]; v[j] += M.Q[r][j]; } cnt++; }
    }
    for (j = 0; j < k; j++) { b[j] /= cnt; v[j] /= cnt; }
    return { bpp: b, q: v };
  }

  function directOfCurves(ca, cb, window) {
    var la = level(ca.bpp, ca.q, window), lb = level(cb.bpp, cb.q, window);
    return (la.value === null || lb.value === null) ? NaN : pct(lb.value - la.value);
  }

  function percentile(sorted, p) {
    var pos = (sorted.length - 1) * p, l = Math.floor(pos), u = Math.min(l + 1, sorted.length - 1);
    return sorted[l] + (pos - l) * (sorted[u] - sorted[l]);
  }

  // Regularized incomplete beta function (continued fraction) for Student's t.
  function lgamma(x) {
    var c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    var y = x, tmp = x + 5.5, ser = 1.000000000190015;
    tmp -= (x + 0.5) * Math.log(tmp);
    for (var j = 0; j < 6; j++) ser += c[j] / ++y;
    return -tmp + Math.log(2.5066282746310005 * ser / x);
  }
  function betacf(a, b, x) {
    var qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap, m, m2, aa, del, h;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    d = 1 / d; h = d;
    for (m = 1; m <= 300; m++) {
      m2 = 2 * m; aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < 1e-300) d = 1e-300; c = 1 + aa / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < 1e-300) d = 1e-300; c = 1 + aa / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d; del = d * c; h *= del;
      if (Math.abs(del - 1) < 3e-16) break;
    }
    return h;
  }
  function betai(a, b, x) {
    if (x <= 0) return 0; if (x >= 1) return 1;
    var bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
  }
  function tCdf(t, df) { var x = df / (df + t * t), p = 0.5 * betai(df / 2, 0.5, x); return t > 0 ? 1 - p : p; }
  function tQuantile(p, df) {
    var lo = 0, hi = 100;
    for (var i = 0; i < 200; i++) { var mid = 0.5 * (lo + hi); if (tCdf(mid, df) < p) lo = mid; else hi = mid; }
    return 0.5 * (lo + hi);
  }

  /* Paired image bootstrap of the direct BD-rate (%) of B against A on a window fixed in advance. The same resampled
     images are applied to both codecs; a replicate whose curves do not span the window counts as a coverage failure.
     A, B: {R: [[bpp per operating point] per image], Q: [[psnr ...]]} over the same images in the same order. */
  function pairedBootstrap(A, B, window, opts) {
    opts = opts || {};
    var nB = opts.B || 2000, rnd = mulberry32(opts.seed === undefined ? 2027 : opts.seed), n = A.R.length;
    var est = directOfCurves(meanCurve(A, null), meanCurve(B, null), window), vals = [], fails = 0, idx = new Array(n);
    for (var r = 0; r < nB; r++) {
      for (var i = 0; i < n; i++) idx[i] = Math.floor(rnd() * n);
      var v = directOfCurves(meanCurve(A, idx), meanCurve(B, idx), window);
      if (isFinite(v)) vals.push(v); else fails++;
    }
    vals.sort(function (a, b) { return a - b; });
    var out = { estimate: isFinite(est) ? est : null, B: nB, n: n, failFraction: fails / nB, ci95: null, sd: null };
    if (vals.length > 1) {
      var mean = 0, ss = 0;
      vals.forEach(function (x) { mean += x; }); mean /= vals.length;
      vals.forEach(function (x) { ss += (x - mean) * (x - mean); });
      out.sd = Math.sqrt(ss / (vals.length - 1));
      out.ci95 = [percentile(vals, 0.025), percentile(vals, 0.975)];
    }
    return out;
  }

  // Delete-one jackknife with a t(n-1) interval, used where the bootstrap abstains.
  function jackknife(A, B, window) {
    var n = A.R.length, th = [], i;
    var est = directOfCurves(meanCurve(A, null), meanCurve(B, null), window);
    for (i = 0; i < n; i++) {
      var v = directOfCurves(meanCurve(A, null, i), meanCurve(B, null, i), window);
      if (!isFinite(v)) return { ok: false, estimate: isFinite(est) ? est : null };
      th.push(v);
    }
    var mean = 0, ss = 0;
    th.forEach(function (x) { mean += x; }); mean /= n;
    th.forEach(function (x) { ss += (x - mean) * (x - mean); });
    var se = Math.sqrt((n - 1) / n * ss), t = tQuantile(0.975, n - 1);
    return { ok: true, estimate: est, se: se, ci95: [est - t * se, est + t * se] };
  }

  // Observed decision as in the paper: percentile bootstrap, or the jackknife if more than 1% of replicates fail coverage.
  function observed(A, B, window, opts) {
    var bs = pairedBootstrap(A, B, window, opts), out = { estimate: bs.estimate, failFraction: bs.failFraction, B: bs.B, n: bs.n };
    if (bs.estimate === null) { out.method = null; out.ci95 = null; out.status = 'no_coverage'; return out; }
    if (bs.failFraction <= 0.01 && bs.ci95) { out.method = 'bootstrap'; out.ci95 = bs.ci95; out.sd = bs.sd; }
    else {
      var jk = jackknife(A, B, window);
      if (!jk.ok) { out.method = null; out.ci95 = null; out.status = 'no_decision'; return out; }
      out.method = 'jackknife'; out.ci95 = jk.ci95; out.se = jk.se;
    }
    out.status = (out.ci95[0] > 0 || out.ci95[1] < 0) ? 'resolved' : 'unresolved';
    return out;
  }

  /* ---------------------------------------------------------------- submission checks (as in licaudit/validation.py) */

  var DATASETS = ['kodak', 'tecnick', 'clic_pv'];
  var KNOWN = { psnr_definition: ['rgb_8bit', 'ycbcr_y', 'unknown'], rate_accounting: ['actual_bitstream', 'estimated_likelihood', 'unknown'],
                aggregation: ['mean_per_image', 'psnr_of_mean_mse', 'pixel_weighted', 'unknown'] };
  var REFERENCE = { psnr_definition: 'rgb_8bit', rate_accounting: 'actual_bitstream', aggregation: 'mean_per_image' };
  var ACCEPT = { kodak: ['kodak', 'kodak24', 'kodak photocd'], tecnick: ['tecnick', 'tecnik', 'testimages', 'rgb_or_1200x1200'],
                 clic_pv: ['clic2020 professional validation', 'clic 2020 professional valid', 'clic20-pro-valid', 'clic-pv', 'clic professional validation', 'clic2020-pro-valid'] };
  var REJECT_TOKENS = ['test', '2021', '2022', 'mobile'];

  function compatibilityClass(c) {
    if (c.metric !== 'psnr_rgb' || c.psnr_definition === 'ycbcr_y') return 'incompatible';
    if (c.rate_accounting === 'estimated_likelihood') return 'separate_rate_class';
    var agg = c.aggregation || 'unknown';
    if (agg !== 'mean_per_image' && agg !== 'unknown') return 'different_aggregation';
    var all = Object.keys(REFERENCE).every(function (k) { return (c[k] || 'unknown') === REFERENCE[k]; });
    return all ? 'documented' : 'provisional';
  }

  function validateCurve(c) {
    var out = [], issue = function (level, field, message) { out.push({ level: level, field: field, message: message }); };
    var ds = c.dataset, has = function (list, s) { return list.some(function (a) { return s.indexOf(a) >= 0; }); };
    if (DATASETS.indexOf(ds) < 0) issue('incompatible', 'dataset', String(ds) + ' is not a benchmark dataset');
    var label = String(c.dataset_label || '').trim().toLowerCase(), evidence = String(c.dataset_identity_evidence || '').trim();
    if (ACCEPT[ds] && label) {
      if (has(REJECT_TOKENS, label) && !has(ACCEPT[ds], label)) issue('incompatible', 'dataset_label', 'label "' + label + '" names a different split than ' + ds);
      else if (!has(ACCEPT[ds], label)) {
        if (evidence) issue('warning', 'dataset_label', 'ambiguous label "' + label + '"; identity accepted from the stated evidence');
        else issue('incompatible', 'dataset_label', 'ambiguous label "' + label + '" and no dataset_identity_evidence');
      }
    }
    if (!label) issue('warning', 'dataset_label', 'no dataset label as written by the authors; identity not verifiable');
    if (c.metric !== 'psnr_rgb') issue('incompatible', 'metric', 'this benchmark version scores PSNR (RGB) only');
    Object.keys(KNOWN).forEach(function (k) {
      var v = c[k] || 'unknown';
      if (KNOWN[k].indexOf(v) < 0) issue('error', k, '"' + v + '" is not one of ' + KNOWN[k].join(', '));
      else if (v === 'unknown') issue('warning', k, 'convention not stated: comparability is provisional');
    });
    if (c.psnr_definition === 'ycbcr_y') issue('incompatible', 'psnr_definition', 'luma PSNR cannot be compared with RGB-PSNR references');
    if (c.rate_accounting === 'estimated_likelihood') issue('warning', 'rate_accounting', 'likelihood-estimated rate: separate rate class; diagnostic score only');
    if (c.aggregation === 'psnr_of_mean_mse' || c.aggregation === 'pixel_weighted') issue('warning', 'aggregation', 'documented aggregation differs from the frozen basis (mean of per-image PSNR and bpp): diagnostic score only');
    var pts = c.points;
    if (!Array.isArray(pts) || pts.length < 2) { issue('error', 'points', 'at least two operating points are required'); return out; }
    pts.forEach(function (p, i) {
      var b = Number(p && p.bpp), q = Number(p && p.psnr_db);
      if (!p || p.bpp === undefined || p.psnr_db === undefined || isNaN(b) || isNaN(q)) { issue('error', 'points[' + i + ']', 'each point needs numeric bpp and psnr_db'); return; }
      if (!(isFinite(b) && b > 0)) issue('error', 'points[' + i + '].bpp', 'rate must be finite and > 0, got ' + b);
      if (!(isFinite(q) && q > 10 && q < 70)) issue('error', 'points[' + i + '].psnr_db', 'PSNR must be finite and within (10, 70) dB, got ' + q);
    });
    var seen = {}, dup = false;
    pts.forEach(function (p) { var key = String(p && p.psnr_db); if (seen[key]) dup = true; seen[key] = true; });
    if (dup) issue('warning', 'points', 'duplicate PSNR values; duplicates are removed by the upper envelope');
    var prov = c.provenance || {};
    ['repository', 'commit', 'path'].forEach(function (k) {
      if (!prov[k]) issue('warning', 'provenance.' + k, 'missing: the curve cannot be traced to a pinned source and will not be ranked');
    });
    if (prov.commit && String(prov.commit).length < 7) issue('warning', 'provenance.commit', 'commit should be a full or abbreviated SHA');
    return out;
  }

  function curveStatus(issues) {
    if (issues.some(function (x) { return x.level === 'error'; })) return 'invalid';
    if (issues.some(function (x) { return x.level === 'incompatible'; })) return 'incompatible';
    if (issues.some(function (x) { return x.level === 'warning'; })) return 'provisional';
    return 'valid';
  }

  /* ---------------------------------------------------------------- tolerant input parsing */

  var NUM = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

  function numbersIn(s) { var m = String(s).match(NUM); return m ? m.map(Number) : []; }

  function looksLikePsnr(a) { return a.length > 0 && a.every(function (v) { return v > 10 && v < 70; }); }
  function looksLikeBpp(a) { return a.length > 0 && a.every(function (v) { return v > 0 && v < 12; }); }

  function pick(named, rx) {
    var keys = Object.keys(named);
    for (var i = 0; i < keys.length; i++) if (rx.test(keys[i])) return named[keys[i]];
    return null;
  }

  function fromArrays(b, v, notes) {
    if (!b || !v) return null;
    if (b.length !== v.length) return { error: 'The rate list has ' + b.length + ' values and the PSNR list has ' + v.length + '. They must have the same length.' };
    if (!looksLikePsnr(v) && looksLikePsnr(b) && looksLikeBpp(v)) { var t = b; b = v; v = t; notes.push('The two lists were swapped: the one with values above 10 was read as PSNR.'); }
    return { points: b.map(function (x, i) { return [x, v[i]]; }), notes: notes };
  }

  // Collect numeric arrays found anywhere in a parsed JSON value, keyed by their property path.
  function walkJson(o, path, acc, rows) {
    if (Array.isArray(o)) {
      if (o.length && o.every(function (x) { return typeof x === 'number'; })) acc[path] = o;
      else if (o.length && o.every(function (x) { return x && typeof x === 'object' && !Array.isArray(x); })) rows.push(o);
      o.forEach(function (x, i) { if (x && typeof x === 'object') walkJson(x, path + '[' + i + ']', acc, rows); });
    } else if (o && typeof o === 'object') {
      Object.keys(o).forEach(function (k) { walkJson(o[k], path ? path + '.' + k : k, acc, rows); });
    }
  }

  var RX_BPP = /(^|[^a-z])(bpp|rate|bits?_?per_?pixel)s?($|[^a-z])/i, RX_PSNR = /psnr|quality|(^|[^a-z])db($|[^a-z])/i;

  /* Reads operating points from whatever a paper or repository offers: two columns, two rows, a CSV with a header,
     LaTeX table rows, Python or JSON lists (bpp = [...], psnr = [...]), a CompressAI result file, or a submission file.
     Returns {points: [[bpp, psnr], ...], notes: [...]} or {error: '...'}. */
  function parsePoints(text) {
    var notes = [], raw = String(text || '').trim();
    if (!raw) return { error: 'Paste the operating points of your method first.' };
    // 1. JSON
    if (/^[\[{]/.test(raw)) {
      try {
        var o = JSON.parse(raw), acc = {}, rows = [];
        walkJson(o, '', acc, rows);
        var b = pick(acc, RX_BPP), v = pick(acc, RX_PSNR);
        if (b && v) return fromArrays(b, v, notes);
        for (var r = 0; r < rows.length; r++) {
          var keys = Object.keys(rows[r][0]), kb = keys.filter(function (k) { return RX_BPP.test(k); })[0], kv = keys.filter(function (k) { return RX_PSNR.test(k); })[0];
          if (kb && kv) return { points: rows[r].map(function (x) { return [Number(x[kb]), Number(x[kv])]; }), notes: notes };
        }
        var arrs = Object.keys(acc).map(function (k) { return acc[k]; });
        if (arrs.length === 2) return fromArrays(arrs[0], arrs[1], notes);
        if (Array.isArray(o) && o.length && o.every(function (x) { return Array.isArray(x) && x.length === 2; })) {
          return fromArrays(o.map(function (x) { return x[0]; }), o.map(function (x) { return x[1]; }), notes);
        }
      } catch (e) { /* not JSON: fall through to the text readers */ }
    }
    // 2. named lists: bpp = [..], "psnr": [..]
    var named = {}, m, rx = /["']?([A-Za-z_][\w.\-]*)["']?\s*[:=]\s*(?:np\.array\()?\[([^\]]*)\]/g;
    while ((m = rx.exec(raw))) { var arr = numbersIn(m[2]); if (arr.length) named[m[1]] = arr; }
    if (Object.keys(named).length >= 2) {
      var nb = pick(named, RX_BPP), nv = pick(named, RX_PSNR);
      if (nb && nv) return fromArrays(nb, nv, notes);
      var ks = Object.keys(named);
      if (ks.length === 2) return fromArrays(named[ks[0]], named[ks[1]], notes);
    }
    // 3. lines of numbers (CSV, TSV, spaces, LaTeX rows), with an optional header
    var lines = raw.split(/\r?\n/).map(function (l) { return l.replace(/\\\\|\\hline|\\midrule|\\toprule|\\bottomrule/g, ' ').trim(); }).filter(function (l) { return l && !/^[#%]/.test(l); });
    var header = null, data = [];
    lines.forEach(function (l) {
      var nums = numbersIn(l.replace(/[A-Za-z_][\w]*\d*/g, function (w) { return /^[eE][-+]?\d+$/.test(w) ? w : ' '; }));
      var words = l.split(/[,;\t&|]+|\s{2,}|\s+/).map(function (w) { return w.trim(); }).filter(Boolean);
      var wordy = words.filter(function (w) { return /[A-Za-z]/.test(w) && !/^[-+]?[\d.]+[eE][-+]?\d+$/.test(w); });
      if (wordy.length && !data.length && !header && nums.length < 2) header = words;
      else if (nums.length >= 2) data.push({ nums: nums, label: wordy.join(' ') });
    });
    if (!data.length) return { error: 'No numbers found. Paste one operating point per line, for example "0.213 31.87" (bits per pixel, then PSNR in dB).' };
    // two rows of equal length: a transposed table
    if (data.length === 2 && data[0].nums.length === data[1].nums.length && data[0].nums.length >= 3) {
      var first = data[0], second = data[1];
      if (RX_PSNR.test(first.label) && !RX_PSNR.test(second.label)) return fromArrays(second.nums, first.nums, notes);
      return fromArrays(first.nums, second.nums, notes);
    }
    var width = data[0].nums.length;
    if (!data.every(function (d) { return d.nums.length === width; })) {
      width = Math.min.apply(null, data.map(function (d) { return d.nums.length; }));
      notes.push('Lines have different numbers of values; only the first ' + width + ' of each line were read.');
    }
    var col = function (j) { return data.map(function (d) { return d.nums[j]; }); };
    var ib = -1, iv = -1, j;
    if (header && header.length === width) {
      for (j = 0; j < width; j++) { if (ib < 0 && RX_BPP.test(header[j])) ib = j; if (iv < 0 && RX_PSNR.test(header[j])) iv = j; }
    }
    if (iv < 0) for (j = 0; j < width; j++) if (j !== ib && looksLikePsnr(col(j))) { iv = j; break; }
    if (ib < 0) for (j = 0; j < width; j++) if (j !== iv && looksLikeBpp(col(j)) && !looksLikePsnr(col(j))) { ib = j; break; }
    if (ib < 0) for (j = 0; j < width; j++) if (j !== iv && looksLikeBpp(col(j))) { ib = j; break; }
    if ((ib < 0 || iv < 0) && width === 2) {            // two bare columns: the documented order, unless they are plainly swapped
      var swapped = looksLikePsnr(col(0)) && !looksLikePsnr(col(1));
      ib = swapped ? 1 : 0; iv = swapped ? 0 : 1;
    }
    if (ib < 0 || iv < 0) return { error: 'Could not tell which column is the rate and which is PSNR. Use two columns: bits per pixel, then PSNR in dB.' };
    if (width > 2) notes.push('Read column ' + (ib + 1) + ' as bits per pixel and column ' + (iv + 1) + ' as PSNR.');
    return { points: data.map(function (d) { return [d.nums[ib], d.nums[iv]]; }), notes: notes };
  }

  function normId(s) {
    s = String(s).trim().replace(/\\/g, '/').split('/').pop();
    return s.replace(/\.(png|jpe?g|ppm|bmp|tiff?)$/i, '').toLowerCase();
  }

  /* Reads per-image records from a CSV with a header: an image column, an operating-point column, bpp (or bytes with
     width and height) and PSNR. Returns {rows: [{image, op, bpp, psnr}], notes} or {error}. */
  function parsePerImage(text) {
    var lines = String(text || '').split(/\r?\n/).filter(function (l) { return l.trim() && !/^\s*#/.test(l); });
    if (lines.length < 2) return { error: 'The file needs a header line and one line per image and operating point.' };
    var delim = [',', '\t', ';'].sort(function (a, b) { return lines[0].split(b).length - lines[0].split(a).length; })[0];
    var head = lines[0].split(delim).map(function (h) { return h.trim().replace(/^"|"$/g, '').toLowerCase(); });
    var find = function (rxs) { for (var r = 0; r < rxs.length; r++) for (var i = 0; i < head.length; i++) if (rxs[r].test(head[i])) return i; return -1; };
    var ci = find([/^image(_?id|_?name)?$/, /^(img|file|filename|name|image_path|path)$/]);
    var co = find([/^op(_?id)?$/, /^(quality|q|lambda|lmbda|lam|level|point|rate_?point|checkpoint|model|qp)$/]);
    var cb = find([/^bpp$/, /^(reported_bpp|rate|bits_per_pixel)$/]);
    var cby = find([/^(total_bitstream_bytes|bytes|bitstream_bytes|size_bytes|payload_bytes)$/]);
    var cw = find([/^(width|w)$/]), ch = find([/^(height|h)$/]);
    var cp = find([/^psnr(_rgb)?(_db)?$/, /^psnr/]);
    var missing = [];
    if (ci < 0) missing.push('image'); if (co < 0) missing.push('op (the operating point, for example the quality level or lambda)');
    if (cp < 0) missing.push('psnr'); if (cb < 0 && (cby < 0 || cw < 0 || ch < 0)) missing.push('bpp (or bytes with width and height)');
    if (missing.length) return { error: 'Missing column' + (missing.length > 1 ? 's' : '') + ': ' + missing.join('; ') + '. Found: ' + head.join(', ') + '.' };
    var rows = [], bad = 0;
    for (var l = 1; l < lines.length; l++) {
      var f = lines[l].split(delim).map(function (x) { return x.trim().replace(/^"|"$/g, ''); });
      var bpp = cb >= 0 ? Number(f[cb]) : 8 * Number(f[cby]) / (Number(f[cw]) * Number(f[ch])), ps = Number(f[cp]);
      if (!f[ci] || f[co] === undefined || f[co] === '' || !(isFinite(bpp) && bpp > 0) || !(isFinite(ps) && ps > 10 && ps < 70)) { bad++; continue; }
      rows.push({ image: normId(f[ci]), op: f[co], bpp: bpp, psnr: ps });
    }
    if (!rows.length) return { error: 'No valid records. Each line needs an image name, an operating point, a rate above 0 and a PSNR between 10 and 70 dB.' };
    return { rows: rows, notes: bad ? [bad + ' line' + (bad > 1 ? 's were' : ' was') + ' skipped (missing or out-of-range values).'] : [], rateFromBytes: cb < 0 };
  }

  /* Checks per-image rows against a dataset's image list and builds the matrices in that order.
     Returns {ok, errors, M: {R, Q}, ops, curve} ; nothing is computed from records that fail a check. */
  function perImageMatrix(rows, imageIds) {
    var ids = imageIds.map(normId), index = {}, errors = [], byOp = {}, ops = [], i;
    ids.forEach(function (id, k) { index[id] = k; });
    var unknown = {};
    rows.forEach(function (r) {
      if (index[r.image] === undefined) { unknown[r.image] = true; return; }
      if (!byOp[r.op]) { byOp[r.op] = {}; ops.push(r.op); }
      if (byOp[r.op][r.image] !== undefined) errors.push('Two records for image "' + r.image + '" at operating point "' + r.op + '".');
      byOp[r.op][r.image] = r;
    });
    var nUnknown = Object.keys(unknown).length;
    if (nUnknown) errors.push(nUnknown + ' image name' + (nUnknown > 1 ? 's are' : ' is') + ' not in this test set, for example "' + Object.keys(unknown)[0] + '". Expected names like "' + ids[0] + '".');
    if (ops.length < 2) errors.push('At least two operating points are needed; found ' + ops.length + '.');
    ops.forEach(function (op) {
      var have = Object.keys(byOp[op]).length;
      if (have !== ids.length) errors.push('Operating point "' + op + '" has ' + have + ' of ' + ids.length + ' images. Every operating point must cover the whole test set.');
    });
    if (errors.length) return { ok: false, errors: errors.slice(0, 6) };
    var mean = {};
    ops.forEach(function (op) { var s = 0; ids.forEach(function (id) { s += byOp[op][id].bpp; }); mean[op] = s / ids.length; });
    ops.sort(function (a, b) { return mean[a] - mean[b]; });
    var R = [], Q = [];
    for (i = 0; i < ids.length; i++) {
      R.push(ops.map(function (op) { return byOp[op][ids[i]].bpp; }));
      Q.push(ops.map(function (op) { return byOp[op][ids[i]].psnr; }));
    }
    var M = { R: R, Q: Q };
    return { ok: true, errors: [], M: M, ops: ops, curve: meanCurve(M, null) };
  }

  return {
    N_GRID: N_GRID, Z95: Z95, INTERPS: INTERPS, SUBSETS: SUBSETS,
    upperEnvelope: upperEnvelope, prepare: prepare, level: level, pct: pct, cells: cells, overlapBD: overlapBD,
    rateRatioProfile: rateRatioProfile, sampleCurve: sampleCurve,
    family: family, decide: decide, compare: compare, limit: limit, statusAt: statusAt, referenceStatus: referenceStatus,
    conditionalMargin: conditionalMargin, rankBands: rankBands,
    meanCurve: meanCurve, pairedBootstrap: pairedBootstrap, jackknife: jackknife, observed: observed, tQuantile: tQuantile,
    compatibilityClass: compatibilityClass, validateCurve: validateCurve, curveStatus: curveStatus,
    parsePoints: parsePoints, parsePerImage: parsePerImage, perImageMatrix: perImageMatrix, normId: normId
  };
});
