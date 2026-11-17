"""Matched per-image results (submission schema v2) and the observed paired bootstrap (benchmark v1.2.0).

A schema-v2 curve carries, besides its released aggregate ``points`` (each with an ``op_id``), one record per image and
operating point::

    {"image_id": "kodim01", "op_id": "q3", "width": 768, "height": 512,
     "total_bitstream_bytes": 10123, "psnr_rgb_db": 32.214}

``total_bitstream_bytes`` must include every byte the decoder needs; bpp = 8 * bytes / (width * height). If only per-image
bpp values are released, ``reported_bpp`` replaces the byte count: the evidence is then a *reported* per-image metric,
not a re-checked bitstream size, and the report says so.

Consistency gate (before any statistics; every failure is an explicit error, nothing is silently intersected)
  * records are matched by explicit image_id and op_id, never by sorting PSNR values;
  * exactly one record per (image, operating point); every operating point covers the same images; every released
    point has per-image records and vice versa;
  * the image set equals the dataset's frozen identifier list where the manifest has one (Kodak, CLIC Pro); otherwise
    its size equals the dataset size (Tecnick: 100) and the identifiers cannot be checked against a frozen list;
  * values finite, rate > 0, PSNR within (10, 70) dB, positive integer image sizes;
  * the per-image means (arithmetic mean of per-image PSNR in dB and of per-image bpp, the frozen aggregation) reproduce
    every released point with the same op_id: 'exact' within half a unit of the last released decimal of each value
    (rounding of the release; plus 1e-9 relative for summation order), 'within_tolerance' within 0.01 dB and 1% of the
    rate, otherwise 'mismatch'. Both levels
    and the actual largest errors are reported; the levels are fixed here and are not tuned to any data.
Only curves that pass the gate and are measured on the documented frozen basis (bitstream rate, RGB PSNR, per-image
mean) can enter an observed comparison.

Observed paired bootstrap: the formulas are those of the analysis code (analysis/core.py: aggregate, paired_bootstrap);
reports/observed_pipeline_qa.json shows that both give identical numbers on the released Cool-chic and USTC-TD per-image
data. The window is fixed before resampling (default: the frozen W_d of the dataset); the same resampled image indices
are applied to both codecs; each replicate rebuilds both aggregate curves and recomputes the direct BD-rate strictly on
the window (a replicate whose curves do not span it is a coverage failure, never re-windowed or dropped silently);
95% percentile interval; B = 2000 and seed 2027 by default. A coverage-failure share above MAX_FAIL gives the status
insufficient_bootstrap_coverage instead of a decision. No p-value is derived from the percentile interval.
"""
from __future__ import annotations

import hashlib
import itertools
import json
import math
from decimal import Decimal

import numpy as np

from . import bd as E
from .decisions import classify_observed

SCHEMA_VERSION = 2
B_DEFAULT, SEED_DEFAULT, MAX_FAIL = 2000, 2027, 0.01
LOOSE_PSNR_DB, LOOSE_REL_BPP = 0.01, 0.01
FLOAT_REL = 1e-9          # floating-point accumulation slack of the 'exact' level (summation order)
INTERPS = ('pchip', 'akima', 'cubic')
SUBSETS = ('all', 'drop_high', 'drop_low')
REFERENCE_BASIS = {'psnr_definition': 'rgb_8bit', 'rate_accounting': 'actual_bitstream', 'aggregation': 'mean_per_image'}


class PerImageError(ValueError):
    """The per-image records of a curve fail the consistency gate."""


def _half_ulp(x) -> float:
    """Half a unit in the last decimal place of a released number (its rounding error bound)."""
    d = Decimal(repr(float(x))).normalize()
    exp = d.as_tuple().exponent
    return 0.5 * 10.0 ** exp if isinstance(exp, int) and exp < 0 else 0.5


def _finite(x) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def norm_id(s) -> str:
    """Image identifiers are compared without directory, extension and case (kodim01.png == KODIM01)."""
    s = str(s).strip().replace('\\', '/').split('/')[-1]
    for ext in ('.png', '.jpg', '.jpeg', '.ppm', '.bmp', '.tif', '.tiff'):
        if s.lower().endswith(ext):
            s = s[: -len(ext)]
    return s.lower()


def check_curve(curve: dict, n_images: int, frozen_ids: list | None = None) -> dict:
    """Consistency gate for one schema-v2 curve. Returns a report with 'status' in {'pass', 'fail', 'absent'}, the errors,
    the matched rows {image: {op: (bpp, psnr, n_pixels)}}, the operating points, and the agreement with the released
    points ('consistency': exact / within_tolerance / mismatch)."""
    rec = curve.get('per_image')
    if rec is None:
        return {'status': 'absent'}
    errors, warnings = [], []
    if not isinstance(rec, list) or not rec:
        return {'status': 'fail', 'errors': ['per_image must be a non-empty list of records']}
    pts = curve.get('points') or []
    released = {}
    for i, p in enumerate(pts):
        op = p.get('op_id') if isinstance(p, dict) else None
        if op is None:
            errors.append(f'points[{i}] has no op_id: released points must name their operating point')
        elif str(op) in released:
            errors.append(f'duplicate op_id {op!r} in points')
        else:
            released[str(op)] = p
    rows, evidence = {}, set()
    for i, r in enumerate(rec):
        if not isinstance(r, dict):
            errors.append(f'per_image[{i}] is not an object'); continue
        img, op = r.get('image_id'), r.get('op_id')
        if img in (None, '') or op in (None, ''):
            errors.append(f'per_image[{i}] needs image_id and op_id'); continue
        img, op = norm_id(img), str(op)
        q = r.get('psnr_rgb_db')
        if not (_finite(q) and 10.0 < q < 70.0):
            errors.append(f'per_image[{i}] ({img}, {op}): psnr_rgb_db must be finite and within (10, 70) dB'); continue
        w, h = r.get('width'), r.get('height')
        npix = None
        if w is not None or h is not None:
            if not (isinstance(w, int) and isinstance(h, int) and not isinstance(w, bool) and w > 0 and h > 0):
                errors.append(f'per_image[{i}] ({img}, {op}): width and height must be positive integers'); continue
            npix = w * h
        if r.get('total_bitstream_bytes') is not None:
            nb = r['total_bitstream_bytes']
            if not (isinstance(nb, int) and not isinstance(nb, bool) and nb > 0):
                errors.append(f'per_image[{i}] ({img}, {op}): total_bitstream_bytes must be a positive integer'); continue
            if npix is None:
                errors.append(f'per_image[{i}] ({img}, {op}): width and height are needed to turn bytes into bpp'); continue
            bpp = 8.0 * nb / npix; evidence.add('bitstream_bytes')
        elif r.get('reported_bpp') is not None:
            bpp = r['reported_bpp']
            if not (_finite(bpp) and bpp > 0):
                errors.append(f'per_image[{i}] ({img}, {op}): reported_bpp must be finite and > 0'); continue
            bpp = float(bpp); evidence.add('reported_bpp')
        else:
            errors.append(f'per_image[{i}] ({img}, {op}): total_bitstream_bytes or reported_bpp is required'); continue
        if op in rows.get(img, {}):
            errors.append(f'duplicate record for image {img!r} at operating point {op!r}'); continue
        rows.setdefault(img, {})[op] = (bpp, float(q), npix)
    ops = sorted({op for d in rows.values() for op in d})
    imgs = sorted(rows)
    for op in ops:
        miss = [i for i in imgs if op not in rows[i]]
        if miss:
            errors.append(f'operating point {op!r} lacks {len(miss)} image(s), e.g. {miss[:3]}: every operating point must '
                          'cover the same images')
    if released:
        no_rows = sorted(set(released) - set(ops)); no_point = sorted(set(ops) - set(released))
        if no_rows:
            errors.append(f'released points without per-image records: {no_rows}')
        if no_point:
            errors.append(f'per-image operating points without a released point: {no_point}')
    if frozen_ids:
        want = {norm_id(x) for x in frozen_ids}
        if set(imgs) != want:
            errors.append(f'image set differs from the frozen list of the dataset ({len(set(imgs) - want)} unknown, '
                          f'{len(want - set(imgs))} missing)')
    elif len(imgs) != n_images:
        errors.append(f'{len(imgs)} images, the dataset has {n_images}')
    else:
        warnings.append('no frozen identifier list for this dataset: only the number of images is checked')
    out = {'status': 'fail' if errors else 'pass', 'errors': errors, 'warnings': warnings, 'n_images': len(imgs),
           'operating_points': ops, 'evidence': 'bitstream_bytes' if evidence == {'bitstream_bytes'} else
           ('reported_bpp' if evidence == {'reported_bpp'} else 'mixed')}
    if errors:
        return out
    out['rows'] = rows
    out['image_set_sha256'] = hashlib.sha256(json.dumps(imgs).encode()).hexdigest()
    out['operating_points_sha256'] = hashlib.sha256(json.dumps(ops).encode()).hexdigest()
    agg = aggregate_rows(rows, imgs, ops)
    if released:
        dq, rb, exact, loose = [], [], 0, 0
        for op, b, q in zip(ops, agg['bpp'], agg['q']):
            p = released[op]
            eq, eb = abs(q - float(p['psnr_db'])), abs(b - float(p['bpp']))
            dq.append(eq); rb.append(eb / float(p['bpp']))
            exact += int(eq <= _half_ulp(p['psnr_db']) + FLOAT_REL * abs(q) and eb <= _half_ulp(p['bpp']) + FLOAT_REL * abs(b))
            loose += int(eq <= LOOSE_PSNR_DB and eb <= LOOSE_REL_BPP * float(p['bpp']))
        n = len(ops)
        out.update({'max_abs_psnr_db_error': max(dq), 'max_rel_bpp_error': max(rb), 'point_match_fraction': loose / n,
                    'point_match_fraction_exact': exact / n,
                    'consistency': 'exact' if exact == n else ('within_tolerance' if loose == n else 'mismatch'),
                    'tolerances': {'exact': 'half a unit of the last released decimal of PSNR and bpp',
                                   'within_tolerance': f'{LOOSE_PSNR_DB} dB and {LOOSE_REL_BPP:.0%} of the rate'}})
        if out['consistency'] == 'mismatch':
            out['status'] = 'fail'
            out['errors'].append(f"per-image means do not reproduce the released curve (max |dPSNR| {max(dq):.4f} dB, "
                                 f"max relative rate error {max(rb):.2%}); no observed decision can be based on them")
    return out


def aggregate_rows(rows: dict, imgs: list, ops: list) -> dict:
    """Mean of per-image bpp and of per-image PSNR (dB) at each operating point (the frozen aggregation basis)."""
    R = np.array([[rows[i][o][0] for o in ops] for i in imgs])
    Q = np.array([[rows[i][o][1] for o in ops] for i in imgs])
    return {'bpp': list(R.mean(0)), 'q': list(Q.mean(0))}


def to_analysis_rows(rows: dict) -> dict:
    """The {image: [(op, bpp, psnr, n_pixels), ...]} layout of analysis/core.load_per_image."""
    return {i: [(o, *v) for o, v in sorted(d.items())] for i, d in rows.items()}


def inset_window(fa: dict, fb: dict) -> tuple:
    """The one-point inset common range used by the analysis code (a sensitivity window; not the default here)."""
    qa, qb = sorted(fa['q']), sorted(fb['q'])
    return (max(qa[1], qb[1]), min(qa[-2], qb[-2]))


def paired_bootstrap(rows_a: dict, rows_b: dict, imgs: list, ops_a: list, ops_b: list, window, B: int = B_DEFAULT,
                     seed: int = SEED_DEFAULT, interp: str = 'pchip', n: int | None = None) -> dict:
    """Paired image bootstrap of the direct BD-rate (%) of B relative to A on a window fixed in advance."""
    imgs = sorted(imgs)
    rng = np.random.default_rng(seed)
    W = (float(window[0]), float(window[1]))
    fa, fb = aggregate_rows(rows_a, imgs, ops_a), aggregate_rows(rows_b, imgs, ops_b)
    full = E.bd_rate_checked(fa['bpp'], fa['q'], fb['bpp'], fb['q'], interpolation=interp, window=W, window_policy='strict')
    n = n or len(imgs)
    vals, fails = [], 0
    for _ in range(B):
        sel = [imgs[i] for i in rng.integers(0, len(imgs), n)]
        ra, rb = aggregate_rows(rows_a, sel, ops_a), aggregate_rows(rows_b, sel, ops_b)
        r = E.bd_rate_checked(ra['bpp'], ra['q'], rb['bpp'], rb['q'], interpolation=interp, window=W, window_policy='strict')
        if r.status == E.OK:
            vals.append(r.value_percent)
        else:
            fails += 1
    v = np.array(vals)
    return {'estimate': full.value_percent, 'estimate_status': full.status, 'window': list(W), 'B': B, 'seed': seed,
            'interp': interp, 'n_images': len(imgs), 'n_resampled': n, 'n_valid_replicates': len(vals),
            'fail_fraction': fails / B,
            'ci95': [float(np.percentile(v, 2.5)), float(np.percentile(v, 97.5))] if len(v) > 1 else None,
            'sd': float(v.std(ddof=1)) if len(v) > 1 else None}


def protocol_effects(fa: dict, fb: dict, window, alternative_windows=()) -> tuple:
    """Direct effects of the full-sample curves over the protocol family of the scorer (interpolators x point subsets on
    the window, PCHIP on each alternative window). Returns (valid effects, number attempted)."""
    W = tuple(window); vals, attempted = [], 0
    for it, sub in itertools.product(INTERPS, SUBSETS):
        attempted += 1
        la = E.level(fa['bpp'], fa['q'], W, it, sub); lb = E.level(fb['bpp'], fb['q'], W, it, sub)
        if la.status == E.OK and lb.status == E.OK:
            vals.append(E.pct(lb.value - la.value))
    for Wa in alternative_windows:
        attempted += 1
        la = E.level(fa['bpp'], fa['q'], tuple(Wa)); lb = E.level(fb['bpp'], fb['q'], tuple(Wa))
        if la.status == E.OK and lb.status == E.OK:
            vals.append(E.pct(lb.value - la.value))
    return vals, attempted


def basis_problems(curve: dict) -> list:
    """Reasons why a curve's measurement basis does not allow an observed comparison (empty if it does)."""
    out = []
    if curve.get('metric') != 'psnr_rgb':
        out.append(f"metric {curve.get('metric')!r} is not RGB PSNR")
    for k, v in REFERENCE_BASIS.items():
        if curve.get(k, 'unknown') != v:
            out.append(f"{k} is {curve.get(k, 'unknown')!r}; an observed comparison needs {v!r}")
    return out


def observed_compare(curve_a: dict, curve_b: dict, dataset: dict, *, name_a: str = 'A', name_b: str = 'B',
                     B: int = B_DEFAULT, seed: int = SEED_DEFAULT, window=None, interp: str = 'pchip',
                     max_fail: float = MAX_FAIL) -> dict:
    """Observed comparison of codec B against codec A on one dataset (``dataset``: the manifest entry with window,
    n_images, image_ids, alternative_windows). Returns {'gate': ..., 'bootstrap': ..., 'decision': ...}; if a gate fails,
    'decision' is None and 'reasons' explains why (nothing is computed from data that failed the gate)."""
    ids = dataset.get('image_ids') or None
    ga, gb = check_curve(curve_a, dataset['n_images'], ids), check_curve(curve_b, dataset['n_images'], ids)
    reasons = []
    for nm, c, g in ((name_a, curve_a, ga), (name_b, curve_b, gb)):
        if g['status'] == 'absent':
            reasons.append(f'{nm}: no per-image records (schema v1 curves keep conditional decisions)')
        elif g['status'] != 'pass':
            reasons += [f'{nm}: {e}' for e in g.get('errors', [])]
        reasons += [f'{nm}: {p}' for p in basis_problems(c)]
    if curve_a.get('dataset') != curve_b.get('dataset'):
        reasons.append('the two curves are on different datasets')
    if not reasons and ga['image_set_sha256'] != gb['image_set_sha256']:
        reasons.append('the two curves are measured on different image sets')
    gate = {k: {kk: vv for kk, vv in g.items() if kk != 'rows'} for k, g in ((name_a, ga), (name_b, gb))}
    if reasons:
        return {'gate': gate, 'bootstrap': None, 'decision': None, 'reasons': reasons}
    W = tuple(window) if window is not None else tuple(dataset['window'])
    imgs = sorted(ga['rows'])
    bs = paired_bootstrap(ga['rows'], gb['rows'], imgs, ga['operating_points'], gb['operating_points'], W, B=B, seed=seed,
                          interp=interp)
    fa = aggregate_rows(ga['rows'], imgs, ga['operating_points']); fb = aggregate_rows(gb['rows'], imgs, gb['operating_points'])
    eff, attempted = protocol_effects(fa, fb, W, dataset.get('alternative_windows', []) if window is None else [])
    evidence = {k: bs[k] for k in ('B', 'seed', 'interp', 'window', 'n_valid_replicates', 'fail_fraction', 'sd')}
    evidence.update({'ci_method': 'percentile, 95%, paired image resampling', 'max_fail': max_fail,
                     'image_set_sha256': ga['image_set_sha256'],
                     'operating_points_sha256': {name_a: ga['operating_points_sha256'], name_b: gb['operating_points_sha256']},
                     'per_image_evidence': {name_a: ga['evidence'], name_b: gb['evidence']},
                     'consistency_with_released_curve': {name_a: ga.get('consistency'), name_b: gb.get('consistency')}})
    if bs['estimate'] is None or bs['ci95'] is None:
        dec = classify_observed(None, None, len(imgs), name_b, name_a, curve_a.get('dataset'), evidence=evidence)
    else:
        dec = classify_observed(bs['estimate'], tuple(bs['ci95']), len(imgs), name_b, name_a, curve_a.get('dataset'),
                                fail_fraction=bs['fail_fraction'], max_fail=max_fail, protocol_effects=eff,
                                n_attempted=attempted, evidence=evidence)
    return {'gate': gate, 'bootstrap': bs, 'decision': dec.to_dict(), 'reasons': []}
