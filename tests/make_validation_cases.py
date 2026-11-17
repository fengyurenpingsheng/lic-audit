#!/usr/bin/env python3
"""Writes tests/fixtures/validation_cases.json: synthetic curves classified by the reference validator.
tests/test_parity.mjs checks that the browser code classifies them in the same way."""
import copy
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from licaudit.engine import validation as V  # noqa: E402

base = {'dataset': 'kodak', 'dataset_label': 'Kodak', 'metric': 'psnr_rgb', 'psnr_definition': 'rgb_8bit',
        'rate_accounting': 'actual_bitstream', 'aggregation': 'mean_per_image',
        'points': [{'bpp': 0.12, 'psnr_db': 29.5}, {'bpp': 0.2, 'psnr_db': 31.4}, {'bpp': 0.33, 'psnr_db': 33.2}, {'bpp': 0.55, 'psnr_db': 35.3}, {'bpp': 0.9, 'psnr_db': 37.6}],
        'provenance': {'repository': 'example-org/codec', 'commit': '0123456789abcdef', 'path': 'results/kodak.json', 'source_tier': 'A'}}


def variant(**kw):
    c = copy.deepcopy(base)
    for k, v in kw.items():
        if v is None:
            c.pop(k, None)
        else:
            c[k] = v
    return c


cases = {
    'documented': variant(),
    'conventions not stated': variant(psnr_definition='unknown', rate_accounting='unknown', aggregation='unknown'),
    'one convention stated': variant(psnr_definition='unknown', aggregation='unknown'),
    'estimated rate': variant(rate_accounting='estimated_likelihood'),
    'pixel-weighted averaging': variant(aggregation='pixel_weighted'),
    'psnr of mean mse': variant(aggregation='psnr_of_mean_mse'),
    'luma psnr': variant(psnr_definition='ycbcr_y'),
    'ms-ssim': variant(metric='msssim_rgb'),
    'other dataset': variant(dataset='div2k', dataset_label='DIV2K'),
    'wrong split label': variant(dataset='clic_pv', dataset_label='CLIC 2021 test'),
    'ambiguous label without evidence': variant(dataset='clic_pv', dataset_label='CLIC'),
    'ambiguous label with evidence': variant(dataset='clic_pv', dataset_label='CLIC', dataset_identity_evidence='Table 1: CLIC professional validation'),
    'clic label accepted': variant(dataset='clic_pv', dataset_label='CLIC2020 professional validation'),
    'tecnick label accepted': variant(dataset='tecnick', dataset_label='Tecnick'),
    'no label': variant(dataset_label=None),
    'no provenance': variant(provenance=None),
    'short commit': variant(provenance={'repository': 'a/b', 'commit': 'abc', 'path': 'x.json'}),
    'one point': variant(points=[{'bpp': 0.2, 'psnr_db': 31.4}]),
    'negative rate': variant(points=[{'bpp': -0.1, 'psnr_db': 29.5}, {'bpp': 0.2, 'psnr_db': 31.4}]),
    'psnr out of range': variant(points=[{'bpp': 0.1, 'psnr_db': 9.0}, {'bpp': 0.2, 'psnr_db': 31.4}]),
    'duplicate psnr': variant(points=[{'bpp': 0.1, 'psnr_db': 30.0}, {'bpp': 0.2, 'psnr_db': 30.0}, {'bpp': 0.3, 'psnr_db': 33.0}]),
    'unknown convention value': variant(rate_accounting='guessed'),
    'missing value in a point': variant(points=[{'bpp': 0.1}, {'bpp': 0.2, 'psnr_db': 31.4}]),
}
out = []
for name, c in cases.items():
    issues = V.validate_curve(c)
    status = ('invalid' if any(x['level'] == 'error' for x in issues) else
              ('incompatible' if any(x['level'] == 'incompatible' for x in issues) else
               ('provisional' if any(x['level'] == 'warning' for x in issues) else 'valid')))
    out.append({'name': name, 'curve': c, 'status': status, 'compatibility': V.compatibility_class(c),
                'issues': [{'level': x['level'], 'field': x['field']} for x in issues]})
(ROOT / 'tests' / 'fixtures' / 'validation_cases.json').write_text(json.dumps(out, indent=1) + '\n')
print(len(out), 'cases:', {s: sum(1 for o in out if o['status'] == s) for s in ('valid', 'provisional', 'incompatible', 'invalid')})
