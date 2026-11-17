"""Validation of submitted released results (schema versions 1 and 2).

A submission is a JSON object::

    {"schema_version": 1,
     "method": {"key": "...", "name": "...", "year": 2026, "venue": "...", "family": "E|T|O|R|unknown"},
     "curves": [{"dataset": "kodak|tecnick|clic_pv", "dataset_label": "as written by the authors",
                 "metric": "psnr_rgb", "psnr_definition": "rgb_8bit|ycbcr_y|unknown",
                 "rate_accounting": "actual_bitstream|estimated_likelihood|unknown",
                 "aggregation": "mean_per_image|psnr_of_mean_mse|pixel_weighted|unknown",
                 "dataset_identity_evidence": "where the authors state the split (needed if the label is ambiguous)",
                 "variant": "model variant as labelled in the source (needed when the source file holds several)",
                 "points": [{"bpp": 0.12, "psnr_db": 29.3}, ...],
                 "provenance": {"repository": "owner/repo", "commit": "<sha>", "path": "...", "field_path": "...",
                                "source_tier": "A|B|C"}}]}

Schema version 2 (benchmark v1.2.0) is version 1 plus optional matched per-image records: each point may carry an
``op_id`` and a curve may carry ``per_image`` records (image_id, op_id, width, height, total_bitstream_bytes or
reported_bpp, psnr_rgb_db); their consistency gate is perimage.check_curve. Provenance fields are only checked for
presence here; whether the stated source really holds the curve is decided by source_verification.py.

Every problem is reported as a machine-readable issue {level, field, message}; nothing is silently filtered.
Levels: 'error' (curve or submission cannot be scored), 'incompatible' (not a benchmark dataset, metric, or
measurement basis comparable with the frozen leaderboard), 'warning' (scorable, but comparability is provisional).

Measurement compatibility (decided here, enforced by the scorer before any position or frontier decision):
  * 'documented'   -- bitstream rate, RGB PSNR, mean of per-image values: comparable with the frozen leaderboard;
  * 'provisional'  -- one or more conventions not stated: scored and compared, flagged as provisional (this is the
                      status of most frozen entries, whose conventions are equally undocumented);
  * 'separate_rate_class'   -- likelihood-estimated rate: diagnostic score only, no position, no frontier decision;
  * 'different_aggregation' -- a documented aggregation other than the mean of per-image values: diagnostic only;
  * 'incompatible' -- luma PSNR, another metric, or another dataset split: rejected.
One curve per dataset is accepted; duplicate datasets make the submission invalid instead of being overwritten."""
from __future__ import annotations
import math

DATASETS = ('kodak', 'tecnick', 'clic_pv')
SCHEMA_VERSIONS = (1, 2)
KNOWN = {
    'psnr_definition': ('rgb_8bit', 'ycbcr_y', 'unknown'),
    'rate_accounting': ('actual_bitstream', 'estimated_likelihood', 'unknown'),
    'aggregation': ('mean_per_image', 'psnr_of_mean_mse', 'pixel_weighted', 'unknown'),
}
REFERENCE_CONVENTIONS = {'psnr_definition': 'rgb_8bit', 'rate_accounting': 'actual_bitstream', 'aggregation': 'mean_per_image'}
SCORABLE = ('documented', 'provisional')          # compatibility classes that may receive a position and a decision
DIAGNOSTIC_ONLY = ('separate_rate_class', 'different_aggregation')
# dataset identity: labels accepted for each benchmark dataset; labels naming another split are incompatible
ACCEPT = {'kodak': ('kodak', 'kodak24', 'kodak photocd'),
          'tecnick': ('tecnick', 'tecnik', 'testimages', 'rgb_or_1200x1200'),
          'clic_pv': ('clic2020 professional validation', 'clic 2020 professional valid', 'clic20-pro-valid', 'clic-pv',
                      'clic professional validation', 'clic2020-pro-valid')}
REJECT_TOKENS = ('test', '2021', '2022', 'mobile')     # e.g. CLIC 2021 test, CLIC 2022, CLIC mobile


def _issue(level, field, msg):
    return {'level': level, 'field': field, 'message': msg}


def compatibility_class(c: dict) -> str:
    """Measurement-compatibility class of a curve with respect to the frozen (bitstream, RGB, per-image mean) basis."""
    if c.get('metric') != 'psnr_rgb' or c.get('psnr_definition') == 'ycbcr_y':
        return 'incompatible'
    if c.get('rate_accounting') == 'estimated_likelihood':
        return 'separate_rate_class'
    agg = c.get('aggregation', 'unknown')
    if agg not in ('mean_per_image', 'unknown'):
        return 'different_aggregation'
    if all(c.get(k, 'unknown') == v for k, v in REFERENCE_CONVENTIONS.items()):
        return 'documented'
    return 'provisional'


def validate_curve(c: dict) -> list[dict]:
    out = []
    ds = c.get('dataset')
    if ds not in DATASETS:
        out.append(_issue('incompatible', 'dataset', f'{ds!r} is not a benchmark dataset {DATASETS}'))
    label = str(c.get('dataset_label', '')).strip().lower()
    evidence = str(c.get('dataset_identity_evidence', '')).strip()
    if ds in ACCEPT and label:
        if any(t in label for t in REJECT_TOKENS) and not any(a in label for a in ACCEPT[ds]):
            out.append(_issue('incompatible', 'dataset_label', f'label {label!r} names a different split than {ds}'))
        elif not any(a in label for a in ACCEPT[ds]):
            if evidence:
                out.append(_issue('warning', 'dataset_label', f'ambiguous label {label!r}; identity accepted from the stated evidence: {evidence}'))
            else:
                out.append(_issue('incompatible', 'dataset_label', f'ambiguous label {label!r} and no dataset_identity_evidence'))
    if not label:
        out.append(_issue('warning', 'dataset_label', 'no dataset label as written by the authors; identity not verifiable'))
    if c.get('metric') != 'psnr_rgb':
        out.append(_issue('incompatible', 'metric', f"metric {c.get('metric')!r}: the v1 benchmark scores PSNR (RGB) only"))
    for k, allowed in KNOWN.items():
        v = c.get(k, 'unknown')
        if v not in allowed:
            out.append(_issue('error', k, f'{v!r} not in {allowed}'))
        elif v == 'unknown':
            out.append(_issue('warning', k, 'convention not stated: comparability is provisional'))
    if c.get('psnr_definition') == 'ycbcr_y':
        out.append(_issue('incompatible', 'psnr_definition', 'luma PSNR cannot be compared with RGB-PSNR anchors'))
    if c.get('rate_accounting') == 'estimated_likelihood':
        out.append(_issue('warning', 'rate_accounting', 'likelihood-estimated rate: separate rate class; diagnostic score only, '
                                                         'no position on the bitstream leaderboard and no frontier decision'))
    if c.get('aggregation') in ('psnr_of_mean_mse', 'pixel_weighted'):
        out.append(_issue('warning', 'aggregation', f"documented aggregation {c.get('aggregation')!r} differs from the frozen basis "
                                                     "(mean of per-image PSNR and bpp): diagnostic score only"))
    pts = c.get('points')
    if not isinstance(pts, list) or len(pts) < 2:
        out.append(_issue('error', 'points', 'at least two operating points are required'))
        return out
    for i, p in enumerate(pts):
        try:
            b, q = float(p['bpp']), float(p['psnr_db'])
        except (KeyError, TypeError, ValueError):
            out.append(_issue('error', f'points[{i}]', 'each point needs numeric bpp and psnr_db')); continue
        if not (math.isfinite(b) and b > 0):
            out.append(_issue('error', f'points[{i}].bpp', f'rate must be finite and > 0, got {b}'))
        if not (math.isfinite(q) and 10.0 < q < 70.0):
            out.append(_issue('error', f'points[{i}].psnr_db', f'PSNR must be finite and within (10, 70) dB, got {q}'))
    qs = [p.get('psnr_db') for p in pts]
    if len(set(qs)) < len(qs):
        out.append(_issue('warning', 'points', 'duplicate PSNR values; duplicates are removed by the upper envelope'))
    if c.get('per_image') is not None and not isinstance(c.get('per_image'), list):
        out.append(_issue('error', 'per_image', 'per_image must be a list of records'))
    prov = c.get('provenance') or {}
    for k in ('repository', 'commit', 'path'):
        if not prov.get(k):
            out.append(_issue('warning', f'provenance.{k}', 'missing: the curve cannot be traced to a pinned source and will not be ranked'))
    if prov.get('commit') and len(str(prov['commit'])) < 7:
        out.append(_issue('warning', 'provenance.commit', 'commit should be a full or abbreviated SHA'))
    return out


def validate_submission(sub: dict) -> dict:
    issues = []
    if sub.get('schema_version') not in SCHEMA_VERSIONS:
        issues.append(_issue('error', 'schema_version', f'expected one of {SCHEMA_VERSIONS}'))
    elif sub.get('schema_version') == 1 and any(isinstance(c, dict) and c.get('per_image') is not None for c in sub.get('curves') or []):
        issues.append(_issue('error', 'schema_version', 'per_image records require schema_version 2'))
    m = sub.get('method') or {}
    if not m.get('key') or not m.get('name'):
        issues.append(_issue('error', 'method', 'method.key and method.name are required'))
    curves = sub.get('curves')
    if not isinstance(curves, list) or not curves:
        issues.append(_issue('error', 'curves', 'at least one curve is required'))
        curves = []
    seen = {}
    for i, c in enumerate(curves):
        seen.setdefault(c.get('dataset'), []).append(i)
    for ds, idx in seen.items():
        if len(idx) > 1:
            issues.append(_issue('error', 'curves', f'{len(idx)} curves for dataset {ds!r} (indices {idx}); submit one curve per dataset '
                                                     '(one variant per submission), so that no report is overwritten'))
    per = []
    for i, c in enumerate(curves):
        ci = validate_curve(c)
        if len(seen.get(c.get('dataset'), [])) > 1:
            ci.append(_issue('error', 'dataset', 'duplicate dataset in this submission'))
        status = ('invalid' if any(x['level'] == 'error' for x in ci) else
                  ('incompatible' if any(x['level'] == 'incompatible' for x in ci) else
                   ('provisional' if any(x['level'] == 'warning' for x in ci) else 'valid')))
        per.append({'index': i, 'dataset': c.get('dataset'), 'issues': ci, 'status': status,
                    'compatibility': compatibility_class(c) if status not in ('invalid',) else None})
    ok = not any(x['level'] == 'error' for x in issues)
    return {'valid': ok and any(p['status'] in ('valid', 'provisional') for p in per), 'issues': issues, 'curves': per}
