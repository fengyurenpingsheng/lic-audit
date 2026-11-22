"""Scoring a submission under the frozen protocol and assembling the public board.

Every number comes from the frozen engine in licaudit/engine. This module only arranges them: it never changes a
frozen score, and a new entry is always scored on the existing window against the existing reference level.

Evidence levels shown on the board
  1  a numeric curve that spans the fixed window, at a pinned public commit
  2  ... with a stated measurement profile on the common basis (written bits, 8-bit RGB PSNR, per-image means)
  3  ... with per-image records at every operating point that reproduce the curve
  4  measured by the maintainers from the public checkpoint under the common definitions
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import urllib.request
from pathlib import Path

from .engine import bd as E
from .engine import decisions as D
from .engine import perimage as PI
from .engine import validation as V

ROOT = Path(__file__).resolve().parents[1]
DATASETS = ('kodak', 'tecnick', 'clic_pv')
KEY_RE = re.compile(r'^[a-z0-9][a-z0-9_\-]{1,39}$')


# ----------------------------------------------------------------------------------------------- frozen inputs
def load(root: Path = ROOT):
    """(protocol, frozen board, re-measured releases) as stored in data/."""
    root = Path(root)
    return tuple(json.loads((root / 'data' / f).read_text()) for f in ('protocol.json', 'board.json', 'remeasured.json'))


def verify_engine(protocol: dict) -> list[str]:
    """Problems found when comparing the engine files with the hashes of the frozen benchmark (empty if none)."""
    out = []
    for name, want in protocol['engine_sha256'].items():
        have = hashlib.sha256((Path(__file__).resolve().parent / 'engine' / name).read_bytes()).hexdigest()
        if have != want:
            out.append(f'{name}: {have[:12]} differs from the frozen {want[:12]}')
    return out


def image_ids(protocol: dict, remeasured: dict, ds: str):
    return protocol['datasets'][ds].get('image_ids') or remeasured['datasets'][ds]['image_ids']


# ----------------------------------------------------------------------------------------------- scores and decisions
def cells_of(bpp, q, ds_protocol: dict) -> list:
    """Log-rate levels of a curve for every protocol variant of a dataset; None where a variant is not valid."""
    out = []
    for c in ds_protocol['cells']:
        lv = E.level(bpp, q, tuple(c['window']), c['interp'], c['subset'])
        out.append(lv.value if lv.status == E.OK else None)
    return out


def decision(cells_a, cells_b, n_images: int, protocol: dict, name_b: str = 'B', name_a: str = 'A', ds: str = ''):
    """Decision object of the frozen decision function for B against A (negative effect: B needs less rate)."""
    eff = [E.pct(y - x) for x, y in zip(cells_a, cells_b) if x is not None and y is not None]
    canon = None if cells_a[0] is None or cells_b[0] is None else E.pct(cells_b[0] - cells_a[0])
    return D.classify(eff, canon, n_images, protocol['sigma']['historical']['value'], protocol['sigma']['stress']['value'],
                      len(cells_a), name_b, name_a, ds)


def limit(sigma: float, n_images: int) -> float:
    """Smallest difference (BD-rate points) that average curves can resolve at an assumed variability."""
    return 1.96 * sigma / math.sqrt(n_images)


def status_at(dec, sigma: float) -> str:
    """'no_coverage' | 'unstable' | 'resolved' | 'within' at the assumed image-to-image variability sigma."""
    if dec.status == D.ABSTAINED:
        return 'no_coverage'
    if not dec.sign_stable:
        return 'unstable'
    return 'resolved' if dec.sigma_star > sigma else 'within'


def conventions_class(curve: dict) -> str:
    """D: rate accounting and aggregation stated; P: one of them; U: neither (the board's 'Conventions' column)."""
    r = curve.get('rate_accounting', 'unknown') != 'unknown'
    a = curve.get('aggregation', 'unknown') != 'unknown'
    return 'D' if (r and a) else ('P' if (r or a) else 'U')


# ----------------------------------------------------------------------------------------------- source check
_NUM = re.compile(r'[-+]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)?')


def _decimals(token: str) -> int:
    t = token.lower().split('e')[0]
    return len(t.split('.')[1]) if '.' in t else 0


def source_presence(curve: dict, text: str) -> dict:
    """How many of the submitted rates and PSNR values occur in the text of the stated source file.

    A value counts as present when a number of the file equals it after rounding to the coarser of the two precisions.
    This is a presence check: it shows that the numbers were published at the stated place, and leaves to the
    maintainers the question whether the labels there name this method, variant and test set."""
    toks = [(float(m.group()), _decimals(m.group())) for m in _NUM.finditer(text)]
    out = {}
    for field in ('bpp', 'psnr_db'):
        found, missing = 0, []
        for p in curve.get('points') or []:
            v = float(p[field])
            dv = _decimals(repr(v))
            hit = any(abs(t - v) <= 0.5 * 10.0 ** (-min(dv, dt)) * (1 + 1e-9) + 1e-12 for t, dt in toks)
            found += int(hit)
            if not hit:
                missing.append(v)
        out[field] = {'found': found, 'of': len(curve.get('points') or []), 'missing': missing}
    out['all_present'] = all(out[f]['found'] == out[f]['of'] and out[f]['of'] > 0 for f in ('bpp', 'psnr_db'))
    return out


def fetch_source(prov: dict, timeout: float = 20.0) -> str:
    """The stated file at the stated commit, from raw.githubusercontent.com."""
    repo, commit, path = prov['repository'].strip('/'), prov['commit'], prov['path'].lstrip('/')
    if not re.fullmatch(r'[A-Za-z0-9_.\-]+/[A-Za-z0-9_.\-]+', repo) or not re.fullmatch(r'[0-9a-fA-F]{7,40}', commit):
        raise ValueError('repository must be "owner/name" and commit a 7-40 digit hexadecimal SHA')
    url = f'https://raw.githubusercontent.com/{repo}/{commit}/{urllib.request.quote(path)}'
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return r.read(8_000_000).decode('utf-8', 'replace')


# ----------------------------------------------------------------------------------------------- report card
def score_submission(sub: dict, protocol: dict, board: dict, remeasured: dict | None = None, sources: dict | None = None,
                     sigma_key: str = 'calibrated') -> dict:
    """Report card of a submission. ``sources``: optional {dataset: text of the stated source file}."""
    val = V.validate_submission(sub)
    method = sub.get('method') or {}
    sigma = protocol['sigma'][sigma_key]['value']
    rep = {'protocol_version': protocol['version'], 'assumed_variability': {'key': sigma_key, 'value': sigma}, 'method': method,
           'validation': val, 'datasets': {}, 'notes': []}
    key = str(method.get('key') or '')
    if key and not KEY_RE.match(key):
        rep['notes'].append(f'method.key {key!r} should use lower-case letters, digits, "-" or "_" (2-40 characters)')
    if any(x['level'] == 'error' for x in val['issues']):
        rep['status'] = 'invalid'
        return rep
    for i, c in enumerate(sub.get('curves') or []):
        ds, vc = c.get('dataset'), val['curves'][i]
        ent = {'validation_status': vc['status'], 'measurement_compatibility': vc['compatibility'], 'issues': vc['issues']}
        rep['datasets'][ds if ds in DATASETS and ds not in rep['datasets'] else f'{ds}#{i}'] = ent
        if vc['status'] in ('invalid', 'incompatible') or ds not in protocol['datasets']:
            ent['result'] = 'rejected' if vc['status'] == 'incompatible' else 'invalid'
            continue
        dp = protocol['datasets'][ds]
        n = dp['n_images']
        bpp = [float(p['bpp']) for p in c['points']]
        q = [float(p['psnr_db']) for p in c['points']]
        env_b, env_q = E.upper_envelope(bpp, q)
        ent.update(window_db=dp['window'], n_points=len(bpp), n_envelope_points=len(env_b), span_db=[min(env_q), max(env_q)])
        cells = cells_of(bpp, q, dp)
        ent['cells'] = cells
        if sources and ds in sources:
            ent['source_presence'] = source_presence(c, sources[ds])
        if c.get('per_image') is not None:
            g = PI.check_curve(c, n, image_ids(protocol, remeasured, ds) if remeasured else dp.get('image_ids'))
            ent['per_image'] = {k: v for k, v in g.items() if k != 'rows'}
            ent['per_image']['basis_problems'] = PI.basis_problems(c)
        if cells[0] is None:
            ent['result'] = 'unscored'
            ent['reason'] = (f"the curve spans {min(env_q):.2f} to {max(env_q):.2f} dB and does not cover the fixed window "
                             f"{dp['window'][0]} to {dp['window'][1]} dB; add operating points so that it does")
            continue
        score = E.pct(cells[0] - dp['consensus_level'])
        ent['score_percent'] = score
        ent['conventions'] = conventions_class(c)
        ent['evidence_level'] = 1
        if vc['compatibility'] == 'documented':
            ent['evidence_level'] = 2
            if c.get('per_image') is not None and ent['per_image'].get('status') == 'pass' and not ent['per_image']['basis_problems']:
                ent['evidence_level'] = 3
        if vc['compatibility'] in V.DIAGNOSTIC_ONLY:
            ent['result'] = 'diagnostic'
            ent['reason'] = ('likelihood-estimated rates are a separate rate class' if vc['compatibility'] == 'separate_rate_class'
                             else 'the stated averaging rule differs from the mean of per-image values')
            continue
        rows = [r for r in board['entries'][ds] if r['key'] != key]
        ent['result'] = 'scored'
        ent['already_on_board'] = any(r['key'] == key for r in board['entries'][ds])
        ent['position_if_inserted'] = 1 + sum(1 for r in rows if r['canonical'] < score)
        ent['entries_on_board'] = len(rows)
        ent['limit_points'] = limit(sigma, n)
        comps = []
        for r in rows:
            dec = decision(r['cells'], cells, n, protocol, key or 'submission', r['key'], ds)
            comps.append({'against': r['key'], 'name': r['name'], 'direct_percent': dec.canonical_direct_percent,
                          'least_favourable_percent': dec.least_favorable_direct_percent, 'sigma_star': dec.sigma_star,
                          'status': status_at(dec, sigma), 'reference_status': dec.status})
        ent['comparisons'] = comps
        better = [x for x in comps if x['status'] == 'resolved' and x['direct_percent'] < 0]
        worse = [x for x in comps if x['status'] == 'resolved' and x['direct_percent'] > 0]
        ent['summary'] = {'resolved_better_than': len(better), 'resolved_worse_than': len(worse),
                          'not_separable_from': len(comps) - len(better) - len(worse)}
    res = [e.get('result') for e in rep['datasets'].values()]
    rep['status'] = 'scored' if 'scored' in res else ('diagnostic only' if 'diagnostic' in res else 'not scored')
    return rep


LABEL = {'resolved': 'resolved', 'within': 'within the margin', 'unstable': 'unstable', 'no_coverage': 'no coverage'}
DSNAME = {'kodak': 'Kodak', 'tecnick': 'Tecnick', 'clic_pv': 'CLIC Pro'}


def render_markdown(rep: dict) -> str:
    m = rep['method']
    L = [f"## LIC-Audit report: {m.get('name', '?')} (protocol v{rep['protocol_version']})", '']
    if rep.get('status') == 'invalid':
        L += ['**The submission is not valid; nothing was scored.**', '']
        L += [f"- `{x['field']}`: {x['message']}" for x in rep['validation']['issues']]
        for c in rep['validation']['curves']:
            L += [f"- curve {c['index']} ({c['dataset']}), `{x['field']}`: {x['message']}" for x in c['issues'] if x['level'] == 'error']
        return '\n'.join(L) + '\n'
    L += ['| Test set | Result | BD-rate vs VTM reference | Position | Evidence | Measurement |', '|---|---|---:|---:|:---:|---|']
    for ds, e in rep['datasets'].items():
        score = f"{e['score_percent']:+.2f}%" if 'score_percent' in e else 'n/a'
        pos = f"{e['position_if_inserted']} of {e['entries_on_board'] + 1}" if e.get('result') == 'scored' else 'n/a'
        L.append(f"| {DSNAME.get(ds, ds)} | {e.get('result')} | {score} | {pos} | {e.get('evidence_level', 'n/a')} | {e.get('measurement_compatibility')} |")
    L.append('')
    sig = rep['assumed_variability']
    for ds, e in rep['datasets'].items():
        L.append(f"### {DSNAME.get(ds, ds)}")
        if e.get('reason'):
            L.append(f"- {e['reason'][0].upper()}{e['reason'][1:]}.")
        if e.get('result') == 'scored':
            s = e['summary']
            L.append(f"- Margin for average curves at an assumed variability of {sig['value']:.2f} points: {e['limit_points']:.2f} BD-rate points.")
            L.append(f"- Resolved as better than {s['resolved_better_than']} entries, resolved as worse than {s['resolved_worse_than']}, "
                     f"not separable from {s['not_separable_from']}.")
            near = sorted(e['comparisons'], key=lambda x: abs(x['direct_percent']))[:5]
            L += ['', '| Nearest entries | Direct BD-rate | Status |', '|---|---:|---|']
            L += [f"| {x['name']} | {x['direct_percent']:+.2f}% | {LABEL[x['status']]} |" for x in near]
            L.append('')
        sp = e.get('source_presence')
        if sp:
            L.append(f"- Source file: {sp['bpp']['found']} of {sp['bpp']['of']} rates and {sp['psnr_db']['found']} of {sp['psnr_db']['of']} PSNR "
                     f"values occur in the stated file" + ('.' if sp['all_present'] else f"; missing {sp['bpp']['missing'] + sp['psnr_db']['missing']}."))
        pi = e.get('per_image')
        if pi:
            L.append(f"- Per-image records: {pi.get('status')}" + (f" ({pi.get('consistency')} agreement with the curve)" if pi.get('consistency') else '')
                     + ''.join(f"; {x}" for x in (pi.get('errors') or [])[:3]) + '.')
        for x in e['issues']:
            L.append(f"- [{x['level']}] `{x['field']}`: {x['message']}")
        L.append('')
    if m.get('weights_url') or m.get('test_code'):
        L.append('- Re-measurement requested: ' + '; '.join(x for x in (
            f"public weights {m['weights_url']}" if m.get('weights_url') else '',
            f"test code {m['test_code']}" if m.get('test_code') else '') if x)
            + '. The maintainers can run the model on the fixed test sets; the entry then carries evidence level 4 (re-measured).')
    for n_ in rep.get('notes', []):
        L.append(f'- Note: {n_}')
    L.append('A negative BD-rate means less rate at equal PSNR. A difference within the margin cannot be told from zero with '
             'average curves alone; per-image records can resolve it.')
    return '\n'.join(L) + '\n'


# ----------------------------------------------------------------------------------------------- the public board
def accepted_submissions(root: Path = ROOT) -> list[dict]:
    out = []
    for f in sorted((Path(root) / 'submissions' / 'accepted').glob('*.json')):
        sub = json.loads(f.read_text())
        sub['_file'] = f.name
        out.append(sub)
    return out


def entry_from_submission(sub: dict, ds: str, protocol: dict, remeasured: dict) -> dict | None:
    """Board entry of an accepted submission on one test set (None if it has no scored curve there)."""
    rep = score_submission(sub, protocol, {'entries': {d: [] for d in DATASETS}}, remeasured)
    e = rep['datasets'].get(ds)
    if not e or e.get('result') != 'scored':
        return None
    c = next(c for c in sub['curves'] if c.get('dataset') == ds)
    m, prov, meta = sub['method'], c.get('provenance') or {}, sub.get('board') or {}
    ent = {'key': m['key'], 'name': m['name'], 'year': m.get('year'), 'venue': m.get('venue'), 'family': m.get('family') if m.get('family') in 'ETOR' else None,
           'variant': c.get('variant') or None, 'tier': 'A', 'conventions': e['conventions'], 'evidence': e['evidence_level'],
           'canonical': e['score_percent'], 'range': None, 'variants_valid': None, 'regime': None, 'cells': e['cells'],
           'n_points': e['n_envelope_points'], 'span_db': e['span_db'],
           'points': [[float(p['bpp']), float(p['psnr_db'])] for p in c['points']], 'values_withheld': False,
           'source': {'repo': prov.get('repository'), 'commit': prov.get('commit'), 'path': prov.get('path'), 'license': 'submitted by the authors'},
           'remeasured': None, 'origin': 'submission', 'accepted_on': meta.get('accepted_on'), 'paper_url': m.get('paper_url'),
           'other_curves': []}
    if e['evidence_level'] == 3:
        ids = [PI.norm_id(x) for x in image_ids(protocol, remeasured, ds)]
        g = PI.check_curve(c, protocol['datasets'][ds]['n_images'], ids)
        ops = g['operating_points']
        ent['per_image'] = {'ops': ops, 'R': [[g['rows'][i][o][0] for o in ops] for i in ids], 'Q': [[g['rows'][i][o][1] for o in ops] for i in ids]}
    return ent


def merged_board(root: Path = ROOT) -> dict:
    """The frozen entries plus the accepted submissions, each test set sorted by score. Frozen entries are unchanged."""
    protocol, board, rem = load(root)
    out = {'entries': {ds: list(board['entries'][ds]) for ds in DATASETS}, 'unranked': board['unranked'],
           'context': board.get('context', {ds: [] for ds in DATASETS}), 'accepted': []}
    for sub in accepted_submissions(root):
        key = sub['method']['key']
        for ds in DATASETS:
            if any(r['key'] == key for r in board['entries'][ds]):
                raise ValueError(f'{sub["_file"]}: method key {key!r} is a frozen entry on {ds}; frozen entries never change')
            ent = entry_from_submission(sub, ds, protocol, rem)
            if ent:
                if any(r['key'] == key for r in out['entries'][ds]):
                    raise ValueError(f'{sub["_file"]}: two accepted submissions use the key {key!r}')
                out['entries'][ds].append(ent)
        out['accepted'].append({'key': key, 'name': sub['method']['name'], 'file': sub['_file'], 'accepted_on': (sub.get('board') or {}).get('accepted_on')})
    for ds in DATASETS:
        out['entries'][ds].sort(key=lambda r: r['canonical'])
    return out
