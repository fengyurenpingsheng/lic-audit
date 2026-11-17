#!/usr/bin/env python3
"""Re-estimate the image-to-image variability behind the margin, with the frozen rule, and rerun the holdout check.

Rule (protocol v1.2.0; "Fixed numbers, estimated numbers and updates" in the user guide)
  value      90th percentile (numpy's default, linear) of the measured pairwise variabilities
             sigma_pair = sqrt(n) x SD of the paired-bootstrap direct BD-rate (percentage points)
  pairs      every pair of releases with per-image records on a frozen test set, both released in the two calendar
             years before the review or in the review year
  window     the frozen window when at most 1% of the bootstrap replicates fail to span it, otherwise the one-point
             inset window of the pair (as in the paper's analysis)
  holdout    each release in turn is held out; on each test set the value is estimated from the pairs without it and
             applied to its pairs: |difference| > 1.96 x value / sqrt(n) is compared with the paired-interval decision

Inputs
  data/protocol.json             the measured pairs of the current version (protocol.variability.rows) and release years
  data/remeasured.json           per-image records of the releases measured by LIC-Audit
  submissions/accepted/*.json    accepted entries; those with per-image records (schema_version 2) that pass the
                                 consistency check and use the reference measurement basis add new pairs

Run
  python3 tools/recalibrate.py                                  # current data: the frozen 5.37 and 0 / 14 / 80%
  python3 tools/recalibrate.py --review-year 2028 --out recalibration_2028.json
The output is a proposal for the maintainers. A new value is published as a minor version with a change log; it changes
the width of the margins, never a score.
"""
from __future__ import annotations

import argparse
import glob
import itertools
import json
import math
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from licaudit.engine import bd as E  # noqa: E402
from licaudit.engine import perimage as PI  # noqa: E402

DATASETS = ('kodak', 'tecnick', 'clic_pv')
QUANTILE = 0.9


def load(rel):
    with open(os.path.join(ROOT, rel)) as f:
        return json.load(f)


def measured_rows(rem, ds, key):
    """Per-image records of a measured release as {image: {op: (bpp, psnr)}} and its operating points."""
    d = rem['datasets'][ds]
    r = d['releases'][key]
    rows = {}
    for j, img in enumerate(PI.norm_id(i) for i in d['image_ids']):
        rows[img] = {op: (r['bytes'][j][k] * 8.0 / d['pixels'][j], r['psnr'][j][k]) for k, op in enumerate(r['ops'])}
    return rows, list(r['ops'])


def submission_rows(path, protocol):
    """Releases with usable per-image records from one accepted submission: [(key, year, dataset, rows, ops)]."""
    with open(path) as f:
        sub = json.load(f)
    out, notes = [], []
    if sub.get('schema_version') != 2:
        return out, [f'{os.path.basename(path)}: no per-image records (schema_version {sub.get("schema_version")})']
    key, year = sub['method']['key'], int(sub['method']['year'])
    for c in sub.get('curves', []):
        ds = c.get('dataset')
        if ds not in DATASETS:
            continue
        problems = PI.basis_problems(c)
        if problems:
            notes.append(f'{key} on {ds}: not used ({"; ".join(problems)})')
            continue
        dp = protocol['datasets'][ds]
        chk = PI.check_curve(c, dp['n_images'], dp.get('image_ids'))
        if chk['status'] != 'pass':
            notes.append(f'{key} on {ds}: per-image records not used ({chk["status"]}: {"; ".join(chk.get("errors", []))[:200]})')
            continue
        out.append((key, year, ds, chk['rows'], chk['operating_points']))
    return out, notes


def measure_pair(ra, oa, rb, ob, imgs, window, B, seed):
    """sigma_pair of one pair on the frozen window, or on the inset window when the frozen one fails."""
    for kind in ('frozen', 'inset'):
        if kind == 'frozen':
            W = tuple(window)
        else:
            W = PI.inset_window(PI.aggregate_rows(ra, imgs, oa), PI.aggregate_rows(rb, imgs, ob))
            if not W[0] < W[1]:
                return None
        res = PI.paired_bootstrap(ra, rb, imgs, oa, ob, W, B=B, seed=seed)
        if res['estimate_status'] == E.OK and res['fail_fraction'] <= PI.MAX_FAIL and res['sd'] is not None:
            lo, hi = res['ci95']
            return {'window_kind': kind, 'window': [float(W[0]), float(W[1])], 'n': len(imgs), 'estimate': res['estimate'],
                    'resolved': bool(lo > 0 or hi < 0), 'sigma_pair': math.sqrt(len(imgs)) * res['sd'],
                    'fail_fraction': res['fail_fraction'], 'B': B, 'seed': seed}
    return None


def holdout(rows):
    """Leave-one-release-out check of the rule on the given pairs (per test set, as in the paper's supplement)."""
    ev = false = missed = covered = 0
    train_sizes = []
    for ds in DATASETS:
        R = [r for r in rows if r['dataset'] == ds]
        for c in sorted({r['a'] for r in R} | {r['b'] for r in R}):
            test = [r for r in R if c in (r['a'], r['b'])]
            train = [r['sigma_pair'] for r in R if c not in (r['a'], r['b'])]
            if not test or len(train) < 2:
                continue
            train_sizes.append(len(train))
            s = float(np.quantile(train, QUANTILE))
            for r in test:
                ev += 1
                cond = abs(r['estimate']) > 1.96 * s / math.sqrt(r['n'])
                false += int(cond and not r['resolved'])
                missed += int(r['resolved'] and not cond)
                covered += int(r['sigma_pair'] <= s)
    out = {'evaluations': ev, 'false': false, 'missed': missed,
           'coverage_percent': round(100 * covered / ev) if ev else None}
    if train_sizes and len(set(train_sizes)) == 1:
        m = train_sizes[0]
        k = math.floor((m - 1) * QUANTILE)  # numpy's linear quantile sits between order statistics k+1 and k+2
        out['expected_low'], out['expected_high'] = round(100 * (k + 1) / (m + 1)), round(100 * min(k + 2, m + 1) / (m + 1))
    return out


def recalibrate(review_year=None, submissions_dir=None, B=10000, seed=20261110, min_pairs=15):
    protocol, rem = load('data/protocol.json'), load('data/remeasured.json')
    V = protocol['variability']
    years = dict(V['release_years'])
    current = protocol['sigma']['calibrated']['value']
    stored = [dict(r, origin='v' + protocol['version']) for r in V['rows']]
    if review_year is None:
        review_year = max(years[k] for r in stored for k in (r['a'], r['b'])) + 1
    first_year = review_year - 2

    def recent(k):
        return first_year <= years[k] <= review_year

    rows = [r for r in stored if recent(r['a']) and recent(r['b'])]
    notes = []
    # releases that can be paired: measured releases plus accepted submissions with per-image records
    pool = {ds: {} for ds in DATASETS}
    for ds in DATASETS:
        for k in rem['datasets'][ds]['releases']:
            if k in years and recent(k):
                pool[ds][k] = measured_rows(rem, ds, k)
    new_keys = set()
    for path in sorted(glob.glob(os.path.join(submissions_dir or os.path.join(ROOT, 'submissions', 'accepted'), '*.json'))):
        rel, nt = submission_rows(path, protocol)
        notes += nt
        for key, year, ds, r, ops in rel:
            if key in years and years[key] != year:
                notes.append(f'{key}: year {year} differs from the stored {years[key]}; the stored year is used')
            years.setdefault(key, year)
            if not recent(key):
                notes.append(f'{key} ({year}) is outside the review period {first_year}-{review_year}')
                continue
            if key in pool[ds]:
                notes.append(f'{key} on {ds} is already measured; the submission does not add pairs')
                continue
            pool[ds][key] = (r, ops)
            new_keys.add(key)
    have = {(r['a'], r['b'], r['dataset']) for r in rows} | {(r['b'], r['a'], r['dataset']) for r in rows}
    for ds in DATASETS:
        window = protocol['datasets'][ds]['window']
        for a, b in itertools.combinations(sorted(pool[ds]), 2):
            if (a, b, ds) in have or not (a in new_keys or b in new_keys):
                continue
            (ra, oa), (rb, ob) = pool[ds][a], pool[ds][b]
            imgs = sorted(set(ra) & set(rb))
            if len(imgs) != protocol['datasets'][ds]['n_images']:
                notes.append(f'{a} and {b} on {ds}: {len(imgs)} common images; pair skipped')
                continue
            m = measure_pair(ra, oa, rb, ob, imgs, window, B, seed)
            if m is None:
                notes.append(f'{a} and {b} on {ds}: neither the frozen nor the inset window gives a valid bootstrap; pair skipped')
                continue
            rows.append(dict({'a': a, 'b': b, 'dataset': ds, 'origin': 'new'}, **m))
    sig = [r['sigma_pair'] for r in rows]
    releases = sorted({r['a'] for r in rows} | {r['b'] for r in rows})
    enough = len(sig) >= min_pairs
    value = float(np.quantile(sig, QUANTILE)) if sig else None
    return {
        'rule': V['rule'], 'definition': V['definition'], 'review_year': review_year,
        'release_years_used': [first_year, review_year],
        'releases': [{'key': k, 'year': years[k], 'new': k in new_keys} for k in releases],
        'pairs_used': len(sig), 'pairs_new': sum(r['origin'] == 'new' for r in rows), 'minimum_pairs': min_pairs,
        'value': value, 'median': float(np.median(sig)) if sig else None, 'current_value': current,
        'proposal': (value if enough else current),
        'decision': ('re-estimated' if enough else f'kept: {len(sig)} pairs, fewer than {min_pairs}'),
        'margins': {ds: 1.96 * (value if enough else current) / math.sqrt(protocol['datasets'][ds]['n_images']) for ds in DATASETS},
        'holdout': holdout(rows), 'notes': notes, 'rows': rows,
    }


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--review-year', type=int, default=None, help='year of the review (default: the year after the newest release)')
    ap.add_argument('--submissions', default=None, help='folder of accepted submissions (default: submissions/accepted)')
    ap.add_argument('--bootstrap', type=int, default=10000, help='bootstrap replicates for new pairs (default 10000)')
    ap.add_argument('--seed', type=int, default=20261110)
    ap.add_argument('--min-pairs', type=int, default=15, help='keep the current value below this number of pairs')
    ap.add_argument('--out', default=None, help='write the full report as JSON')
    a = ap.parse_args(argv)
    rep = recalibrate(a.review_year, a.submissions, a.bootstrap, a.seed, a.min_pairs)
    h = rep['holdout']
    print(f"review {rep['review_year']}: releases {rep['release_years_used'][0]}-{rep['release_years_used'][1]}, "
          f"{len(rep['releases'])} releases, {rep['pairs_used']} pairs ({rep['pairs_new']} new)")
    if rep['value'] is not None:
        print(f"90th percentile {rep['value']:.4f} (median {rep['median']:.4f}); current {rep['current_value']:.4f}")
    print(f"decision: {rep['decision']}; proposed value {rep['proposal']:.4f}; margins "
          + ', '.join(f'{ds} +/-{m:.2f}' for ds, m in rep['margins'].items()))
    if h['evaluations']:
        exp = f", {h['expected_low']}-{h['expected_high']}% expected if releases were exchangeable" if 'expected_low' in h else ''
        print(f"holdout: {h['false']} false and {h['missed']} missed of {h['evaluations']}; coverage {h['coverage_percent']}%{exp}")
    for n in rep['notes']:
        print('note:', n)
    if a.out:
        with open(a.out, 'w') as f:
            json.dump(rep, f, indent=1)
        print('wrote', a.out)
    return rep


if __name__ == '__main__':
    main()
