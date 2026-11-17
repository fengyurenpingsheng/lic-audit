#!/usr/bin/env python3
"""Maintainers only: rebuild data/ from the paper artifact.

    python3 tools/export_from_artifact.py --artifact /path/to/LIC-Audit_artifact [--include-unlicensed-values]

Reads the frozen record (curves, manifest, licenses), the analysis outputs and the stored measurement records of the
artifact, and writes
    data/protocol.json     frozen numbers of the protocol (windows, reference levels, variability scales)
    data/board.json        the frozen leaderboard entries: metadata, sources, scores, and the log-rate levels of every
                           protocol variant (enough to compare any two entries or a new curve with an entry)
    data/remeasured.json   the releases measured from public checkpoints: per-image records and paired intervals on the
                           frozen windows, plus DIV2K and MS-SSIM (sensitivity) results with their mean curves
    data/claims.json       BD-rates that papers report against VTM, next to the fixed-window scores, and the full record
                           of published claims (without quotations)
    data/explorer.json     every released curve of the record (methods and reference runs, all test sets and metrics)
    tests/fixtures/*.json  curves with the levels the reference implementation gives (for the JavaScript parity test)

Curve values from repositories without a standard license are not copied (the same rule as the paper's public data
release); their scores and levels, which are our own computations, are. Pass --include-unlicensed-values only for a
private build.
"""
import argparse
import ast
import csv
import hashlib
import itertools
import json
import math
import os
import sys
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument('--artifact', required=True)
ap.add_argument('--include-unlicensed-values', action='store_true')
ap.add_argument('--out', default=str(Path(__file__).resolve().parents[1]))
args = ap.parse_args()

ART = Path(args.artifact).resolve()
OUTROOT = Path(args.out).resolve()
os.environ['LICLEDGER_ROOT'] = str(ART)
sys.path.insert(0, str(ART / 'analysis'))
sys.path.insert(0, str(ART / 'src'))
from core import *                                   # noqa: E402,F401,F403  (LEDGER, META, method_curve, E, ...)
from licledger import decisions as D                 # noqa: E402

J = lambda n: json.load(open(ART / 'analysis' / 'out' / f'{n}.json'))
MAN = json.load(open(ART / 'data' / 'manifest' / 'scoring_manifest_v1.2.json'))
MV, REG, A16, A26, A27, A29, A34 = (J('a3_multiverse'), J('a8_regime'), J('a16_evidence_hierarchy'), J('a26_five_releases'),
                                    J('a27_matched_all_pairs'), J('a29_context'), J('a34_confirmation'))
LIC = {r['repo']: r['license'] for r in json.load(open(ART / 'data' / 'provenance' / 'source_licenses.json'))['repos']}
WITHHOLD = {'none_found', 'unclear'}
SHORT = {'caipaper-elic2022': 'ELIC', 'minnen2020': 'ChARM', 'cheng2020': "Cheng'20", 'mlicpp2023': 'MLIC++', 'mlicplus2023': 'MLIC+',
         'coolchic': 'Cool-chic 5', 'lotterycodec2025': 'LotteryCodec', 's2cformer2025': 'S2CFormer', 'neuralsyntax2022': 'Neural-Syntax',
         'qresvae2023': 'QRes-VAE', 'msinn2025': 'MSINN-VR', 'weconvene2024': 'WeConvene', 'segpic2024': 'SegPIC', 'qmap2021': 'Qmap'}
FAMILY = {'E': 'Entropy model', 'T': 'Transform', 'O': 'Overfitted codec', 'R': 'Rate control and efficiency'}
TIER = {'A': 'released by the authors', 'B': 'transcribed or digitized by a third party', 'C': 'run or re-implemented by a third party'}


def nm(mk):
    return SHORT.get(mk, name(mk))


def conv_class(c):
    r, a = c['rate_accounting'] != 'unstated', c['aggregation'] != 'unstated'
    return 'D' if (r and a) else ('P' if (r or a) else 'U')


def cells_of(bpp, q, ds):
    """Log-rate levels of a curve for every protocol variant: 3 interpolants x 3 point subsets on W_d, then PCHIP on
    each alternative window. None where the variant is not valid for this curve (no coverage, too few points)."""
    d = MAN['datasets'][ds]
    W = tuple(d['window'])
    out = []
    for it in INTERPS:
        for sub in SUBSETS:
            lv = E.level(bpp, q, W, it, sub)
            out.append(lv.value if lv.status == E.OK else None)
    for Wa in d['alternative_windows']:
        lv = E.level(bpp, q, tuple(Wa))
        out.append(lv.value if lv.status == E.OK else None)
    return out


def cell_specs(ds):
    d = MAN['datasets'][ds]
    specs = [{'interp': it, 'subset': sub, 'window': d['window']} for it in INTERPS for sub in SUBSETS]
    specs += [{'interp': 'pchip', 'subset': 'all', 'window': list(Wa)} for Wa in d['alternative_windows']]
    return specs


def r6(x):
    return None if x is None else float(f'{x:.10g}')


def pts(c, allow):
    return [[r6(b), r6(v)] for b, v in zip(c['bpp'], c['q'])] if allow else None


def allowed(repo):
    return args.include_unlicensed_values or LIC.get(repo) not in WITHHOLD


def score_on(c, ds):
    """Fixed-window score of any PSNR curve on a benchmark test set (None if it does not span the window)."""
    d = MAN['datasets'][ds]
    lv = E.level(c['bpp'], c['q'], tuple(d['window']))
    return E.pct(lv.value - d['consensus_level']) if lv.status == E.OK else None


TIER_WORD = {'A': 'authors', 'B': 'third-party transcription', 'C': 'third-party run'}


def other_curves(mk, ds, canonical_id):
    """The other released PSNR curves of a method on a test set: model sizes, settings and other sources."""
    out = []
    for c in LEDGER:
        if c['method_key'] != mk or c['dataset'] != ds or c['metric'] != 'psnr_rgb' or c['curve_id'] == canonical_id:
            continue
        env_b, env_q = E.upper_envelope(c['bpp'], c['q'])
        repo = c['provenance']['repo']
        out.append({'id': c['curve_id'], 'variant': c.get('variant') or None, 'score': score_on(c, ds), 'n_points': len(env_b),
                    'span_db': [min(env_q), max(env_q)], 'tier': c['provenance']['tier'][0], 'points': pts(c, allowed(repo)),
                    'source': {'repo': repo, 'commit': c['provenance']['commit'], 'path': c['provenance']['path'], 'license': LIC.get(repo)}})
    return out


# ------------------------------------------------------------------ protocol
SIG = {'calibrated': A27['scale']['frontier_pairs']['p90'], 'historical': MAN['sigma_ref'], 'stress': MAN['sigma_hi']}
protocol = {
    'name': 'LIC-Audit', 'version': MAN['benchmark_version'], 'frozen_on': MAN['frozen_on'], 'metric': 'psnr_rgb',
    'interpolation': 'pchip', 'grid_points': E.N_GRID, 'z': 1.96,
    'sigma': {k: {'value': v} for k, v in SIG.items()},
    'datasets': {},
}
protocol['sigma']['calibrated'].update(label='Recent releases', note='90th percentile over 45 measured comparisons among six 2025-26 releases')
protocol['sigma']['historical'].update(label='Older codecs', note='median over four measured pairs of older learned codecs')
protocol['sigma']['stress'].update(label='Stress', note='the historical value scaled by the CLIC Pro / Kodak ratio')
for ds in DATASETS:
    d = MAN['datasets'][ds]
    anchors = []
    for a in d['anchors']:
        c = next(c for c in LEDGER if c['curve_id'] == a['curve_id'])
        ok = allowed(c['provenance']['repo'])
        anchors.append({'key': a['key'], 'label': a['label'], 'level': a['level_D_W'],
                        'score': E.pct(a['level_D_W'] - d['consensus_level']),
                        'source': {'repo': c['provenance']['repo'], 'commit': c['provenance']['commit'], 'path': c['provenance']['path'],
                                   'license': LIC.get(c['provenance']['repo'])},
                        'points': pts(c, ok)})
    protocol['datasets'][ds] = {
        'label': DSNAME[ds], 'n_images': d['n_images'], 'window': d['window'], 'alternative_windows': d['alternative_windows'],
        'consensus_level': d['consensus_level'], 'anchors': anchors, 'cells': cell_specs(ds),
        'image_ids': d.get('image_ids') or None,
    }

# ------------------------------------------------------------------ board (released curves)
REMEASURED_KEY = {'hpcm2025': 'hpcm_large', 'cmic2026': 'cmic_auxt', 'glic2026': 'glic', 'saaf2026': 'saaf', 'dcae2025': 'dcae',
                  'lalic2025': 'lalic', 'mlicpp2023': 'mlicpp'}
board = {'entries': {}, 'unranked': {}}
fixture_full, fixture_public = [], []
for ds in DATASETS:
    d = MAN['datasets'][ds]
    o = MV[ds]
    pm = o['per_method']
    frozen = {r['method_key']: r for r in d['leaderboard']}
    assert set(frozen) == set(o['methods']), ds
    rows = []
    for m in sorted(o['methods'], key=lambda k: pm[k]['canonical']):
        c = method_curve(m, ds)
        assert c['curve_id'] == frozen[m]['curve_id'], (m, ds)
        cells = cells_of(c['bpp'], c['q'], ds)
        canon = E.pct(cells[0] - d['consensus_level'])
        assert abs(canon - frozen[m]['canonical']) < 1e-9 and abs(canon - pm[m]['canonical']) < 1e-9, (m, ds)
        repo = c['provenance']['repo']
        ok = allowed(repo)
        env_b, env_q = E.upper_envelope(c['bpp'], c['q'])
        rows.append({
            'key': m, 'name': frozen[m]['name'], 'year': year(m), 'venue': META[m].get('venue'), 'family': META[m].get('family'),
            'variant': c.get('variant') or None, 'tier': pm[m]['tier'], 'conventions': conv_class(c),
            'evidence': 2 if conv_class(c) == 'D' else 1,
            'canonical': canon, 'range': [pm[m]['min'], pm[m]['max']], 'variants_valid': [pm[m]['n_valid'], pm[m]['n_attempted']],
            'regime': REG[ds]['regime_bd'][m], 'cells': cells, 'n_points': len(env_b), 'span_db': [min(env_q), max(env_q)],
            'points': pts(c, ok), 'values_withheld': not ok,
            'source': {'repo': repo, 'commit': c['provenance']['commit'], 'path': c['provenance']['path'], 'license': LIC.get(repo)},
            'remeasured': REMEASURED_KEY.get(m), 'origin': 'frozen', 'other_curves': other_curves(m, ds, c['curve_id']),
        })
        fx = {'id': c['curve_id'], 'dataset': ds, 'bpp': c['bpp'], 'q': c['q'], 'cells': cells, 'canonical': canon}
        fixture_full.append(fx)
        if LIC.get(repo) not in WITHHOLD:
            fixture_public.append(fx)
    board['entries'][ds] = rows
    unr = []
    for m in o['partial']:
        c = method_curve(m, ds)
        env_b, env_q = E.upper_envelope(c['bpp'], c['q'])
        repo = c['provenance']['repo']
        unr.append({'key': m, 'name': nm(m), 'year': year(m), 'venue': META[m].get('venue'), 'family': META[m].get('family'),
                    'span_db': [min(env_q), max(env_q)], 'n_points': len(env_b), 'variant': c.get('variant') or None,
                    'reason': 'The released curve does not span the fixed window.', 'points': pts(c, allowed(repo)),
                    'values_withheld': not allowed(repo), 'other_curves': other_curves(m, ds, c['curve_id']),
                    'source': {'repo': repo, 'commit': c['provenance']['commit'], 'path': c['provenance']['path'], 'license': LIC.get(repo)}})
        fixture_full.append({'id': c['curve_id'], 'dataset': ds, 'bpp': c['bpp'], 'q': c['q'], 'cells': cells_of(c['bpp'], c['q'], ds),
                             'canonical': None})
    board['unranked'][ds] = unr
    ctx = []
    for m in FOUNDATIONAL:                     # 2017-19 methods: scored for context, outside the ranked 2020-26 corpus
        c = method_curve(m, ds)
        if c is None:
            continue
        cells = cells_of(c['bpp'], c['q'], ds)
        env_b, env_q = E.upper_envelope(c['bpp'], c['q'])
        repo = c['provenance']['repo']
        ctx.append({'key': m, 'name': nm(m), 'year': year(m), 'venue': META.get(m, {}).get('venue'), 'family': META.get(m, {}).get('family'),
                    'tier': c['provenance']['tier'][0], 'conventions': conv_class(c), 'evidence': 2 if conv_class(c) == 'D' else 1,
                    'canonical': None if cells[0] is None else E.pct(cells[0] - d['consensus_level']), 'cells': cells,
                    'n_points': len(env_b), 'span_db': [min(env_q), max(env_q)], 'points': pts(c, allowed(repo)),
                    'values_withheld': not allowed(repo), 'origin': 'context',
                    'source': {'repo': repo, 'commit': c['provenance']['commit'], 'path': c['provenance']['path'], 'license': LIC.get(repo)}})
    board['context'] = board.get('context', {})
    board['context'][ds] = sorted(ctx, key=lambda r: (r['canonical'] is None, r['canonical'] if r['canonical'] is not None else 0))
    for a in d['anchors']:
        c = next(c for c in LEDGER if c['curve_id'] == a['curve_id'])
        fx = {'id': c['curve_id'], 'dataset': ds, 'bpp': c['bpp'], 'q': c['q'], 'cells': cells_of(c['bpp'], c['q'], ds), 'canonical': None}
        fixture_full.append(fx)
        if LIC.get(c['provenance']['repo']) not in WITHHOLD:
            fixture_public.append(fx)

# reference decisions for the parity test: every ordered pair of ranked entries, classified by the reference code
decisions = []
for ds in DATASETS:
    rows = board['entries'][ds]
    n = MAN['datasets'][ds]['n_images']
    for i, a in enumerate(rows):
        for b in rows[i + 1:]:
            eff = [E.pct(y - x) for x, y in zip(a['cells'], b['cells']) if x is not None and y is not None]
            canon = E.pct(b['cells'][0] - a['cells'][0])
            dec = D.classify(eff, canon, n, MAN['sigma_ref'], MAN['sigma_hi'], len(a['cells']), b['key'], a['key'], ds)
            decisions.append({'dataset': ds, 'a': a['key'], 'b': b['key'], 'canonical': dec.canonical_direct_percent,
                              'least': dec.least_favorable_direct_percent, 'min': dec.protocol_min_percent, 'max': dec.protocol_max_percent,
                              'stable': dec.sign_stable, 'n_valid': dec.n_valid_protocols, 'sigma_star': dec.sigma_star, 'status': dec.status})

# ------------------------------------------------------------------ re-measured releases (public checkpoints)
import numpy as np                                    # noqa: E402

REL = [('hpcm_large', 'HPCM-Large', 2025, 'hpcm2025'), ('cmic_auxt', 'CMIC_AuxT', 2026, 'cmic2026'), ('glic', 'GLIC', 2026, 'glic2026'),
       ('saaf', 'SAAF', 2026, 'saaf2026'), ('dcae', 'DCAE', 2025, 'dcae2025'), ('lalic', 'LALIC', 2025, 'lalic2025'),
       ('mlicpp', 'MLIC++', 2023, 'mlicpp2023'), ('tcm_small', 'TCM-S', 2023, None)]
SRC = {'batch1': ART / 'remeasure/results/hpcm_cmic_matched', 'batch2': ART / 'remeasure/results/hpcm_cmic_padding_clic',
       'batch3': ART / 'remeasure/results/r15_five_releases', 'batch4': ART / 'remeasure/results/confirmation_runs'}


def load_records():
    rows = []
    for k, p in SRC.items():
        for r in json.load(open(p / 'records.json'))['records']:
            if r.get('role', 'full') != 'full' or r['profile'] != 'native':
                continue
            if k == 'batch1' and r['dataset'] == 'clic_pv':
                continue
            if k == 'batch4' and r['model'] != 'mlicpp':      # batch 4 repeats the others bit for bit; MLIC++ exists only there
                continue
            rows.append(r)
    return rows


RECS = load_records()


def release_profiles():
    """Measurement-profile columns of the paper's release table (paper/generated/clean/tab_profiles.tex)."""
    import re
    names = {n: k for k, n, *_ in REL}
    out = {}
    for line in (ART / 'paper' / 'generated' / 'clean' / 'tab_profiles.tex').read_text().splitlines():
        if '&' not in line or line.startswith('Release'):
            continue
        t = re.sub(r'~\\cite\{[^}]*\}', '', line).replace('\\_', '_').replace('\\\\', '')
        t = re.sub(r'\$\^[a-z]\$', '', t)
        cols = [c.strip() for c in t.split('&')]
        nm_ = re.sub(r"\s*'\d\d$", '', cols[0]).strip()
        if nm_ not in names:
            continue
        mc = re.match(r'\\multicolumn\{2\}\{l\}\{(.*)\}$', cols[2])
        if mc:
            bits, psnr, pad, dec = mc.group(1), None, cols[3], cols[4]
        else:
            bits, psnr, pad, dec = cols[2], cols[3], cols[4], cols[5]
        out[names[nm_]] = {'parameters_m': None if cols[1] == '--' else float(cols[1]), 'released_bits': bits, 'released_psnr': psnr,
                           'padding': pad, 'decode_s_clic': float(dec)}
    assert len(out) == len(REL), out
    return out


PROF = release_profiles()
rem = {'definition': 'Public checkpoints measured under one set of definitions: bits of the entropy-coded payload over the '
                     'original image area, PSNR of the 8-bit RGB reconstruction cropped to the original size, each release\'s '
                     'own padding, arithmetic mean over images.',
       'releases': [dict({'key': k, 'name': n, 'year': y, 'board_key': bk}, **PROF[k]) for k, n, y, bk in REL],
       'datasets': {}}
for ds in DATASETS:
    W = tuple(MAN['datasets'][ds]['window'])
    per = {}
    ids0 = None
    for k, *_ in REL:
        rr = [r for r in RECS if r['model'] == k and r['dataset'] == ds]
        ops = sorted({r['op_id'] for r in rr}, key=float)
        ids = sorted({r['image_id'] for r in rr})
        by = {(r['image_id'], r['op_id']): r for r in rr}
        assert len(by) == len(rr) == len(ids) * len(ops) and len(ids) == MAN['datasets'][ds]['n_images'], (k, ds, len(rr))
        if ids0 is None:
            ids0 = ids
            pix = [by[(i, ops[0])]['height'] * by[(i, ops[0])]['width'] for i in ids]
            sha = {i: by[(i, ops[0])]['pixels_sha256'] for i in ids}
        assert ids == ids0 and all(by[(i, ops[0])]['pixels_sha256'] == sha[i] for i in ids), (k, ds)
        Rb = [[int(by[(i, o)]['entropy_payload_bytes']) for o in ops] for i in ids]
        Q = [[float(f"{by[(i, o)]['psnr_rgb_db']:.6f}") for o in ops] for i in ids]
        R = np.array([[8.0 * Rb[a][b] / pix[a] for b in range(len(ops))] for a in range(len(ids))])
        mb, mq = R.mean(0), np.array(Q).mean(0)
        lv = E.level(list(mb), list(mq), W)
        assert lv.status == E.OK, (k, ds)
        per[k] = {'ops': ops, 'bytes': Rb, 'psnr': Q, 'curve': [[r6(b), r6(v)] for b, v in zip(mb, mq)], 'level': lv.value,
                  'cells': cells_of(list(mb), list(mq), ds)}
    pairs = []
    for p in A27['pairs']:
        if p['dataset'] != ds or p['window_kind'] != 'frozen':
            continue
        boot_ok = p['status'] != 'insufficient_bootstrap_coverage'
        ci = p['boot_ci95'] if boot_ok else p['jackknife_ci95']
        pairs.append({'a': p['a'], 'b': p['b'], 'estimate': p['estimate'], 'ci95': ci, 'method': 'bootstrap' if boot_ok else 'jackknife',
                      'resolved': bool(ci[0] > 0 or ci[1] < 0), 'sigma_pair': p['sigma_pair']})
    for p in A34['mlicpp_pairs'] + A34['mlicpp_vs_lalic']:
        if p['dataset'] != ds:
            continue
        pairs.append({'a': p['a'], 'b': p['b'], 'estimate': p['estimate'], 'ci95': p['ci95'], 'method': p['method'],
                      'resolved': bool(p['resolved']), 'sigma_pair': math.sqrt(p['n']) * p['boot_sd']})
    keys = [k for k, *_ in REL]
    assert len(pairs) == len(keys) * (len(keys) - 1) // 2, (ds, len(pairs))
    # the stored estimates are the direct BD-rates of the mean curves: check them against the levels recomputed here
    for p in pairs:
        est = E.pct(per[p['b']]['level'] - per[p['a']]['level'])
        tol = 2e-3 if 'mlicpp' in (p['a'], p['b']) else 2e-5      # PSNR is stored with six decimals; batch 4 re-ran MLIC++'s partners
        assert abs(est - p['estimate']) < tol, (ds, p['a'], p['b'], est, p['estimate'])
    rem['datasets'][ds] = {'image_ids': ids0, 'pixels': pix, 'releases': per, 'pairs': pairs,
                           'rank_first': {k: v for k, v in A34['frozen_rank'][ds]['first_frequency'].items()}}

# ------------------------------------------------------------------ DIV2K and MS-SSIM (batch 4: seven releases, no LALIC)
B4 = [r for r in json.load(open(SRC['batch4'] / 'records.json'))['records'] if r.get('role', 'full') == 'full' and r['profile'] == 'native']
B4_RELEASES = ['hpcm_large', 'cmic_auxt', 'glic', 'saaf', 'dcae', 'mlicpp', 'tcm_small']


def mean_curve_b4(model, ds, quality):
    rr = [r for r in B4 if r['model'] == model and r['dataset'] == ds]
    ops = sorted({r['op_id'] for r in rr}, key=float)
    ids = sorted({r['image_id'] for r in rr})
    by = {(r['image_id'], r['op_id']): r for r in rr}
    assert len(by) == len(rr) == len(ids) * len(ops), (model, ds, len(rr))
    bpp = [float(np.mean([8.0 * by[(i, o)]['entropy_payload_bytes'] / (by[(i, o)]['height'] * by[(i, o)]['width']) for i in ids])) for o in ops]
    if quality == 'msssim':                           # as in the paper: dB of the mean linear MS-SSIM over images
        q = [float(-10.0 * np.log10(1.0 - np.mean([float(by[(i, o)]['msssim_rgb']) for i in ids]))) for o in ops]
    else:
        q = [float(np.mean([float(f"{by[(i, o)][quality]:.6f}") for i in ids])) for o in ops]
    return bpp, q, len(ids)


def first_freq(x):
    x = x.get('first_frequency', x)
    return ast.literal_eval(x) if isinstance(x, str) else x


def pair_rows(rows):
    return [{'a': p['a'], 'b': p['b'], 'estimate': p['estimate'], 'ci95': p['ci95'], 'method': p['method'], 'resolved': bool(p['resolved'])}
            for p in rows]


def extra_block(ds, quality, window, pairs, rank):
    rel = {}
    for k in B4_RELEASES:
        bpp, q, n = mean_curve_b4(k, ds, quality)
        lv = E.level(bpp, q, tuple(window))
        assert lv.status == E.OK, (k, ds, quality)
        rel[k] = {'curve': [[r6(b), r6(v)] for b, v in zip(bpp, q)], 'level': lv.value}
    for p in pairs:                                   # stored estimates are direct BD-rates of these mean curves
        est = E.pct(rel[p['b']]['level'] - rel[p['a']]['level'])
        assert abs(est - p['estimate']) < 2e-3, (ds, quality, p['a'], p['b'], est, p['estimate'])
    assert len(pairs) == 21, (ds, quality, len(pairs))
    return {'window': list(window), 'n_images': n, 'releases': rel, 'pairs': pair_rows(pairs), 'rank_first': first_freq(rank)}


S34 = A34['summary']
rem['extra'] = {
    'note': 'DIV2K and MS-SSIM come from the confirmation batch, which measured seven of the eight releases (LALIC was not '
            'measured). MS-SSIM is a sensitivity analysis: the windows follow the same rule as DIV2K and are not part of the '
            'frozen protocol.',
    'releases': B4_RELEASES,
    'psnr': {'div2k': extra_block('div2k', 'psnr_rgb_db', S34['div2k_window'], A34['div2k_pairs'], A34['div2k_rank'])},
    'msssim': {ds: extra_block(ds, 'msssim', S34['msssim_windows'][ds], [p for p in A34['msssim_pairs'] if p['dataset'] == ds],
                               A34['msssim_rank'][ds]) for ds in ('kodak', 'tecnick', 'clic_pv', 'div2k')},
}
rem['extra']['psnr']['div2k']['label'] = 'DIV2K'
for ds, blk in rem['extra']['msssim'].items():
    blk['label'] = {'kodak': 'Kodak', 'tecnick': 'Tecnick', 'clic_pv': 'CLIC Pro', 'div2k': 'DIV2K'}[ds]
for ds in DATASETS:                                   # mean curves of the frozen-window releases, for the plots
    for k, r in rem['datasets'][ds]['releases'].items():
        r.pop('cells', None)

# ------------------------------------------------------------------ published claims
A10 = J('a10_claims')
claims = {'definition': 'BD-rates against VTM as printed in each paper or README, on the three test sets, for the flagship '
                        'variant, next to the fixed-window score of the released curve. Gap = reported minus fixed window: '
                        'negative when the paper reports a larger saving than the fixed window gives.',
          'rows': [], 'summary': A10['summary'], 'record': []}
board_name = {e['key']: e['name'] for ds in DATASETS for e in board['entries'][ds]}
for r in A10['rows']:
    claims['rows'].append({'method': r['method'], 'name': board_name.get(r['method'], nm(r['method'])), 'year': year(r['method']),
                           'family': META.get(r['method'], {}).get('family'), 'dataset': r['dataset'], 'claim': r['claim'],
                           'anchor': r['anchor'], 'canonical': r['canonical'], 'gap': r['gap'], 'location': r['location']})
for r in csv.DictReader(open(ART / 'data' / 'claims' / 'claims_ledger.csv')):
    v = r['claimed_bd_rate_pct'].strip()
    claims['record'].append({'paper': r['method_key'], 'venue_year': r['venue_year'], 'variant': r['variant'], 'dataset': r['dataset'],
                             'claim': float(v) if v else None, 'anchor': r['anchor_as_stated'], 'anchor_config': r['anchor_config_as_stated'],
                             'metric': r['metric'], 'location': r['location'], 'url': r['source_url']})
VTM = json.load(open(ART / 'paper' / 'generated' / 'vtm_versions.json'))
claims['vtm_versions'] = {k: VTM['macros'][k] for k in VTM['macros']}

# ------------------------------------------------------------------ every released curve
ROLE_ON_BOARD = {}
for ds in DATASETS:
    for e in board['entries'][ds]:
        ROLE_ON_BOARD[method_curve(e['key'], ds)['curve_id']] = ('ranked', e['key'])
    for e in board['unranked'][ds]:
        ROLE_ON_BOARD[method_curve(e['key'], ds)['curve_id']] = ('not ranked', e['key'])
    for e in board['context'][ds]:
        ROLE_ON_BOARD[method_curve(e['key'], ds)['curve_id']] = ('earlier method', e['key'])
    for a in MAN['datasets'][ds]['anchors']:
        ROLE_ON_BOARD[a['curve_id']] = ('VTM reference', a['key'])
explorer = {'definition': 'Every curve of the record: released by the authors (tier A), transcribed or digitized by a third '
                          'party (B), or run by a third party (C). Values of curves from repositories without a standard '
                          'license are not copied; the source link is given instead.',
            'curves': []}
for c in LEDGER:
    env_b, env_q = E.upper_envelope(c['bpp'], c['q'])
    repo = c['provenance']['repo']
    anc = c.get('anchor') or {}
    mk = c['method_key']
    on = ROLE_ON_BOARD.get(c['curve_id'])
    explorer['curves'].append({
        'id': c['curve_id'], 'key': mk, 'name': META[mk]['name'] if mk in META else c['method'], 'label': c['method'],
        'year': META.get(mk, {}).get('year'), 'role': c['role'], 'codec': anc.get('codec') if isinstance(anc, dict) else None,
        'codec_version': anc.get('version') if isinstance(anc, dict) else None, 'dataset': c['dataset'],
        'dataset_label': c.get('dataset_label_as_released'), 'metric': c['metric'], 'opt': c.get('opt'), 'variant': c.get('variant') or None,
        'n_points': len(env_b), 'span': [min(env_q), max(env_q)], 'bpp_range': [min(env_b), max(env_b)],
        'score': score_on(c, c['dataset']) if (c['dataset'] in DATASETS and c['metric'] == 'psnr_rgb') else None,
        'board': on[0] if on else None, 'tier': c['provenance']['tier'][0],
        'source': {'repo': repo, 'commit': c['provenance']['commit'], 'path': c['provenance']['path'], 'license': LIC.get(repo)},
        'points': [[float(f'{b:.6g}'), round(float(v), 4)] for b, v in zip(c['bpp'], c['q'])] if allowed(repo) else None,
    })

# ------------------------------------------------------------------ parameters, their origin and how they are revisited
A1, A33 = J('a1_anchors'), J('a33_guidance')
spread = {}
for ds in DATASETS:
    prs = [x for x in A1['pairs'] if x['dataset'] == ds]
    spread[ds] = {'pairs': [{'ref': x['ref'], 'test': x['test'], 'bd_window': x['pchip_window']} for x in prs],
                  'max_abs_bd_window': max(abs(x['pchip_window']) for x in prs) if prs else None}
P27 = {(p['a'], p['b'], p['dataset'], p['window_kind']): p for p in A27['pairs']}
sig_rows = [{'a': r['a'], 'b': r['b'], 'dataset': r['dataset'], 'window_kind': r['window_kind'],
             'window': P27[(r['a'], r['b'], r['dataset'], r['window_kind'])]['window'],
             'n': P27[(r['a'], r['b'], r['dataset'], r['window_kind'])]['n'],
             'estimate': P27[(r['a'], r['b'], r['dataset'], r['window_kind'])]['estimate'],
             'resolved': P27[(r['a'], r['b'], r['dataset'], r['window_kind'])]['status'] == 'resolved_observed',
             'sigma_pair': r['sigma_pair']}
            for r in A27['scale']['rows'] if r['frontier_pair']]
assert len(sig_rows) == 45 and abs(float(np.quantile([r['sigma_pair'] for r in sig_rows], 0.9)) - SIG['calibrated']) < 1e-12
protocol['reference_spread'] = spread
protocol['variability'] = {
    'rule': '90th percentile of the measured pairwise variabilities among releases of the last two years with per-image records',
    'definition': 'sigma_pair = sqrt(n) x standard deviation of the paired-bootstrap direct BD-rate (percentage points)',
    'bootstrap': {'B': A27['B'], 'seed': A27['seed'], 'max_fail': A27['max_fail'],
                  'window': 'frozen window when at most max_fail of the replicates fail to span it, else the one-point inset window of the pair'},
    'release_years': {k: y for k, _n, y, _b in REL},
    'rows': sig_rows, 'releases': sorted({r['a'] for r in sig_rows} | {r['b'] for r in sig_rows}),
    'median': float(np.median([r['sigma_pair'] for r in sig_rows])),
}
HO = json.load(open(ART / 'paper' / 'generated' / 'holdout_numbers.json'))
protocol['variability']['holdout'] = {'evaluations': int(HO['hoN']), 'false': int(HO['hoPninetyFalse']), 'missed': int(HO['hoPninetyMiss']),
                                      'coverage_percent': int(HO['hoPninetyCov']), 'expected_low': int(HO['hoExchLo']), 'expected_high': int(HO['hoExchHi'])}
protocol['planning'] = {'limits': A33['limits'], 'sample_size': A33['sample_size'], 'scales': A33['scales']}
protocol['history'] = [
    {'version': MAN['supersedes']['benchmark_version'], 'status': 'archived', 'note': 'First frozen version.'},
    {'version': MAN['benchmark_version'], 'status': 'current', 'frozen_on': MAN['frozen_on'],
     'note': 'Same windows, references and scores as 1.1.0; adds the source check for submissions and optional per-image records.'},
]
protocol['window_rule'] = ('Intersection of the released PSNR ranges of all fixed-rate models with at least five points, '
                           'rounded inward to 0.1 dB')
protocol['reference_rule'] = MAN['reference_aggregation']

# ------------------------------------------------------------------ facts quoted on the site (all from generated macros)
NUM = json.load(open(ART / 'paper' / 'generated' / 'numbers.json'))
CF = json.load(open(ART / 'paper' / 'generated' / 'cf_numbers.json'))
VTM = json.load(open(ART / 'paper' / 'generated' / 'vtm_versions.json'))
facts = {'curves': len(LEDGER), 'repositories': len({c['provenance']['repo'] for c in LEDGER}),
         'records': int(str(CF['cfRecordsAll']).replace('{,}', '').replace(',', '')),
         'vtm_versions': int(VTM['macros']['vtmVersionsN']), 'vtm_versions_year': int(VTM['macros']['vtmVersionsYear']),
         'vtm_versions_year_n': int(VTM['macros']['vtmVersionsYearN']), 'claims_naming_version': int(VTM['macros']['vtmVersionsClaims']),
         'releases_measured': len(REL)}
protocol['facts'] = facts
protocol['engine_sha256'] = {f: MAN['scoring_implementation_sha256'][f] for f in ('bd.py', 'decisions.py', 'validation.py', 'perimage.py')}
protocol['frozen_manifest_sha256'] = hashlib.sha256((ART / 'data' / 'manifest' / 'scoring_manifest_v1.2.json').read_bytes()).hexdigest()
protocol['tecnick_image_ids_note'] = 'Tecnick has no released identifier list; the names are those of the measured files.'

# ------------------------------------------------------------------ write
(OUTROOT / 'data').mkdir(exist_ok=True)
(OUTROOT / 'tests' / 'fixtures').mkdir(parents=True, exist_ok=True)


def dump(path, obj, **kw):
    path.write_text(json.dumps(obj, separators=(',', ':'), ensure_ascii=False, **kw) + '\n')
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16], path.stat().st_size


print('protocol.json  ', *dump(OUTROOT / 'data' / 'protocol.json', protocol))
print('board.json     ', *dump(OUTROOT / 'data' / 'board.json', board))
print('remeasured.json', *dump(OUTROOT / 'data' / 'remeasured.json', rem))
print('claims.json    ', *dump(OUTROOT / 'data' / 'claims.json', claims))
print('explorer.json  ', *dump(OUTROOT / 'data' / 'explorer.json', explorer))
print('parity_public  ', *dump(OUTROOT / 'tests' / 'fixtures' / 'parity_public.json', {'curves': fixture_public}))
priv = OUTROOT / 'tests' / 'fixtures' / '_private'
priv.mkdir(exist_ok=True)
print('parity_full    ', *dump(priv / 'parity_full.json', {'curves': fixture_full, 'decisions': decisions,
                                                            'sigma_ref': MAN['sigma_ref'], 'sigma_hi': MAN['sigma_hi']}))
for ds in DATASETS:
    e = board['entries'][ds]
    print(f"{ds:8s} ranked {len(e):2d}  unranked {len(board['unranked'][ds])}  values withheld {sum(x['values_withheld'] for x in e)}  "
          f"top {e[0]['name']} {e[0]['canonical']:+.2f}")
print('facts', facts)
print('sigma', {k: round(v, 4) for k, v in SIG.items()})
