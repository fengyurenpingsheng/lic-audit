// Parity of the JavaScript scoring core with the Python reference implementation.
//   node tests/test_parity.mjs
// Uses tests/fixtures/parity_public.json (curves whose source license allows redistribution); maintainers who have the
// full record also get tests/fixtures/_private/parity_full.json, which covers every curve and every pairwise decision.
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const L = require(path.join(root, 'site_src', 'core.js'));
const J = (p) => JSON.parse(readFileSync(path.join(root, p), 'utf8'));
const protocol = J('data/protocol.json'), board = J('data/board.json'), rem = J('data/remeasured.json');

let failures = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failures++; console.log('FAIL ' + msg); } };
const close = (a, b, tol) => (a === null || b === null) ? a === b : Math.abs(a - b) <= tol;

// ---- 1. levels of every protocol variant, for every fixture curve
const full = existsSync(path.join(root, 'tests/fixtures/_private/parity_full.json')) ? J('tests/fixtures/_private/parity_full.json') : null;
const fx = full || J('tests/fixtures/parity_public.json');
let maxDiff = { pchip: 0, akima: 0, cubic: 0 }, nCells = 0, nNull = 0;
for (const c of fx.curves) {
  const ds = protocol.datasets[c.dataset];
  const got = L.cells(c.bpp, c.q, ds);
  got.forEach((g, i) => {
    const want = c.cells[i], kind = ds.cells[i].interp;
    nCells++;
    if (want === null) nNull++;
    ok((g === null) === (want === null), `${c.id} cell ${i}: validity differs (js ${g}, reference ${want})`);
    if (g !== null && want !== null) {
      const d = Math.abs(g - want);
      if (d > maxDiff[kind]) maxDiff[kind] = d;
      ok(d < (kind === 'cubic' ? 1e-9 : 1e-12), `${c.id} cell ${i} (${kind}): |diff| ${d}`);
    }
  });
  if (c.canonical !== null) ok(close(L.pct(got[0] - ds.consensus_level), c.canonical, 1e-9), `${c.id}: canonical score`);
}
console.log(`levels: ${fx.curves.length} curves, ${nCells} cells (${nNull} invalid in both); max |diff| pchip ${maxDiff.pchip.toExponential(2)}, akima ${maxDiff.akima.toExponential(2)}, cubic ${maxDiff.cubic.toExponential(2)}`);

// ---- 2. shipped board: scores recomputed from the shipped levels, and from the shipped points where present
let nPts = 0;
for (const [dsKey, rows] of Object.entries(board.entries)) {
  const ds = protocol.datasets[dsKey];
  rows.forEach((e, i) => {
    ok(close(L.pct(e.cells[0] - ds.consensus_level), e.canonical, 1e-9), `${dsKey}/${e.key}: canonical from level`);
    if (i > 0) ok(rows[i - 1].canonical <= e.canonical, `${dsKey}: board is sorted`);
    if (e.points) {
      nPts++;
      const got = L.cells(e.points.map((p) => p[0]), e.points.map((p) => p[1]), ds);
      got.forEach((g, k) => ok(close(g, e.cells[k], 1e-8), `${dsKey}/${e.key}: cell ${k} from shipped points`));
    }
  });
}
console.log(`board: scores consistent; ${nPts} entries carry their curve points`);

// ---- 3. pairwise decisions against the reference decision function
if (full) {
  let n = 0;
  const byKey = {};
  for (const [dsKey, rows] of Object.entries(board.entries)) rows.forEach((e) => { byKey[dsKey + '|' + e.key] = e; });
  for (const d of full.decisions) {
    const a = byKey[d.dataset + '|' + d.a], b = byKey[d.dataset + '|' + d.b];
    const got = L.compare(a.cells, b.cells, protocol.datasets[d.dataset].n_images);
    n++;
    ok(close(got.canonical, d.canonical, 1e-8) && close(got.least, d.least, 1e-8) && close(got.min, d.min, 1e-8) && close(got.max, d.max, 1e-8)
       && got.stable === d.stable && got.nValid === d.n_valid && close(got.sigmaStar, d.sigma_star, 1e-7), `decision ${d.dataset} ${d.a} vs ${d.b}`);
    ok(L.referenceStatus(got, full.sigma_ref, full.sigma_hi) === d.status, `status ${d.dataset} ${d.a} vs ${d.b}: js ${L.referenceStatus(got, full.sigma_ref, full.sigma_hi)}, reference ${d.status}`);
  }
  console.log(`decisions: ${n} pairs agree with the reference`);
} else {
  console.log('decisions: skipped (the full fixture is not part of the public repository)');
}

// ---- 4. per-image records: point estimates, bootstrap and jackknife against the stored analysis
let maxEst = 0, maxCi = 0, nPairs = 0, nJack = 0, agree = 0, nBorder = 0;
for (const [dsKey, d] of Object.entries(rem.datasets)) {
  const W = protocol.datasets[dsKey].window, M = {};
  for (const [k, r] of Object.entries(d.releases)) {
    M[k] = { R: r.bytes.map((row, i) => row.map((b) => 8 * b / d.pixels[i])), Q: r.psnr };
    const c = L.meanCurve(M[k], null);
    ok(close(L.level(c.bpp, c.q, W).value, r.level, 1e-10), `${dsKey}/${k}: level of the mean curve`);
  }
  for (const p of d.pairs) {
    const tolEst = (p.a === 'mlicpp' || p.b === 'mlicpp') ? 2e-3 : 2e-5;
    const o = L.observed(M[p.a], M[p.b], W, { B: 2000, seed: 2027 });
    nPairs++;
    maxEst = Math.max(maxEst, Math.abs(o.estimate - p.estimate));
    ok(Math.abs(o.estimate - p.estimate) < tolEst, `${dsKey} ${p.a} vs ${p.b}: estimate ${o.estimate} vs ${p.estimate}`);
    // The share of resamples that lose coverage is itself a Monte Carlo estimate: next to the 1% rule the browser's
    // 2,000 resamples and the stored 10,000 may choose different interval methods. That is counted, not failed.
    const borderline = o.method !== p.method && o.failFraction > 0.004 && o.failFraction < 0.025;
    if (borderline) nBorder++;
    ok(o.method === p.method || borderline, `${dsKey} ${p.a} vs ${p.b}: interval method ${o.method} vs ${p.method} (fail ${o.failFraction})`);
    if (o.ci95 && borderline) { if ((o.status === 'resolved') === p.resolved) agree++; }
    else if (o.ci95) {
      const dc = Math.max(Math.abs(o.ci95[0] - p.ci95[0]), Math.abs(o.ci95[1] - p.ci95[1]));
      if (o.method === 'jackknife') { nJack++; ok(dc < 5e-3, `${dsKey} ${p.a} vs ${p.b}: jackknife interval differs by ${dc}`); }
      else { maxCi = Math.max(maxCi, dc); ok(dc < 0.25, `${dsKey} ${p.a} vs ${p.b}: bootstrap interval differs by ${dc}`); }
      if ((o.status === 'resolved') === p.resolved) agree++;
    }
  }
}
console.log(`per-image: ${nPairs} pairs; max |estimate diff| ${maxEst.toExponential(2)}; ${nJack} jackknife intervals reproduced; bootstrap interval ends within ${maxCi.toFixed(3)} points of the stored ones (different random numbers, 2,000 vs 10,000 resamples); ${nBorder} pairs sit at the 1% coverage rule and use the other interval; same decision for ${agree} of ${nPairs}`);
ok(agree >= nPairs - 2, `decisions from the browser bootstrap agree with the stored analysis for ${agree} of ${nPairs}`);
ok(Math.abs(L.tQuantile(0.975, 23) - 2.0686576) < 1e-6 && Math.abs(L.tQuantile(0.975, 99) - 1.9842169) < 1e-6, 't quantiles');

// ---- 5. input readers
const want = [[0.108, 29.18], [0.143, 30.09], [0.182, 30.91]];
const same = (r) => r.points && r.points.length === 3 && r.points.every((p, i) => p[0] === want[i][0] && p[1] === want[i][1]);
const inputs = {
  'two columns': '0.108 29.18\n0.143 30.09\n0.182 30.91',
  'csv with header': 'bpp,psnr\n0.108,29.18\n0.143,30.09\n0.182,30.91',
  'csv, psnr first': 'PSNR, bpp\n29.18, 0.108\n30.09, 0.143\n30.91, 0.182',
  'tabs with extra column': 'lambda\tbpp\tpsnr\tms-ssim\n0.0018\t0.108\t29.18\t0.93\n0.0035\t0.143\t30.09\t0.95\n0.0067\t0.182\t30.91\t0.96',
  'latex rows': '0.108 & 29.18 \\\\\n0.143 & 30.09 \\\\\n0.182 & 30.91 \\\\',
  'python lists': 'bpp = [0.108, 0.143, 0.182]\npsnr = [29.18, 30.09, 30.91]',
  'numpy lists, psnr first': 'psnr = np.array([29.18, 30.09, 30.91])\nbpp = np.array([0.108, 0.143, 0.182])',
  'compressai json': '{"name": "x", "results": {"bpp": [0.108, 0.143, 0.182], "psnr": [29.18, 30.09, 30.91], "ms-ssim": [0.9, 0.91, 0.92]}}',
  'list of objects': '[{"bpp": 0.108, "psnr_db": 29.18}, {"bpp": 0.143, "psnr_db": 30.09}, {"bpp": 0.182, "psnr_db": 30.91}]',
  'submission file': '{"curves": [{"points": [{"bpp": 0.108, "psnr_db": 29.18}, {"bpp": 0.143, "psnr_db": 30.09}, {"bpp": 0.182, "psnr_db": 30.91}]}]}',
  'two rows': 'bpp 0.108 0.143 0.182\nPSNR 29.18 30.09 30.91',
  'pairs': '[[0.108, 29.18], [0.143, 30.09], [0.182, 30.91]]',
  'semicolons and comments': '# my method\n0.108; 29.18\n0.143; 30.09\n0.182; 30.91',
};
for (const [name, text] of Object.entries(inputs)) ok(same(L.parsePoints(text)), `parsePoints: ${name} -> ${JSON.stringify(L.parsePoints(text))}`);
ok(!!L.parsePoints('').error && !!L.parsePoints('hello world').error, 'parsePoints: errors on empty or text-only input');
ok(!!L.parsePoints('bpp = [0.1, 0.2]\npsnr = [30, 31, 32]').error, 'parsePoints: unequal lists');
console.log(`readers: ${Object.keys(inputs).length} input formats read identically`);

// ---- 6. per-image reader and checks, on the stored records of one release written as CSV
{
  const d = rem.datasets.kodak, r = d.releases.dcae, W = protocol.datasets.kodak.window;
  let csv = 'image,quality,bytes,width,height,psnr\n';
  d.image_ids.forEach((id, i) => r.ops.forEach((op, j) => { csv += `images/${id.toUpperCase()}.png,${op},${r.bytes[i][j]},${d.pixels[i]},1,${r.psnr[i][j]}\n`; }));
  const parsed = L.parsePerImage(csv);
  ok(parsed.rows && parsed.rows.length === d.image_ids.length * r.ops.length, 'parsePerImage: all rows read');
  const m = L.perImageMatrix(parsed.rows, d.image_ids);
  ok(m.ok && close(L.level(m.curve.bpp, m.curve.q, W).value, r.level, 1e-10), 'perImageMatrix: rebuilds the mean curve');
  const short = L.perImageMatrix(parsed.rows.slice(0, 40), d.image_ids);
  ok(!short.ok && short.errors.length > 0, 'perImageMatrix: incomplete records are refused');
  const wrong = L.perImageMatrix(parsed.rows.map((x) => ({ ...x, image: 'img_' + x.image })), d.image_ids);
  ok(!wrong.ok, 'perImageMatrix: unknown image names are refused');
}

// ---- 7. submission checks agree with the reference validator on the shipped examples
if (existsSync(path.join(root, 'tests/fixtures/validation_cases.json'))) {
  const cases = J('tests/fixtures/validation_cases.json');
  for (const c of cases) {
    const issues = L.validateCurve(c.curve);
    ok(L.curveStatus(issues) === c.status, `validateCurve ${c.name}: status ${L.curveStatus(issues)} vs ${c.status}`);
    if (c.status !== 'invalid') ok(L.compatibilityClass(c.curve) === c.compatibility, `compatibility ${c.name}: ${L.compatibilityClass(c.curve)} vs ${c.compatibility}`);
    const key = (x) => x.level + '|' + x.field;
    ok(JSON.stringify(issues.map(key).sort()) === JSON.stringify(c.issues.map(key).sort()), `validateCurve ${c.name}: issues ${JSON.stringify(issues.map(key))} vs ${JSON.stringify(c.issues.map(key))}`);
  }
  console.log(`validation: ${cases.length} example curves classified as by the reference validator`);
}

console.log(failures ? `\n${failures} of ${checks} checks FAILED` : `\nall ${checks} checks passed`);
process.exit(failures ? 1 : 0);
