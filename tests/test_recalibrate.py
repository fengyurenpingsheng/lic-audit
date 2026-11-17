"""tools/recalibrate.py: the frozen value and holdout check are reproduced, and new per-image releases add pairs."""
import json
import math
import os
import subprocess
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
sys.path.insert(0, ROOT)
import recalibrate as RC  # noqa: E402

P = json.load(open(os.path.join(ROOT, 'data', 'protocol.json')))
REM = json.load(open(os.path.join(ROOT, 'data', 'remeasured.json')))


def test_current_data_give_the_frozen_value_and_holdout():
    rep = RC.recalibrate()
    assert rep['review_year'] == 2027 and rep['pairs_used'] == 45 and rep['pairs_new'] == 0
    assert abs(rep['value'] - P['sigma']['calibrated']['value']) < 1e-12
    assert abs(rep['value'] - 5.371263657861854) < 1e-12
    assert rep['decision'] == 're-estimated'
    h = rep['holdout']
    assert {k: h[k] for k in ('evaluations', 'false', 'missed', 'coverage_percent', 'expected_low', 'expected_high')} == P['variability']['holdout']
    for ds, m in {'kodak': 2.15, 'tecnick': 1.05, 'clic_pv': 1.64}.items():
        assert round(rep['margins'][ds], 2) == m


def test_review_period_and_minimum_number_of_pairs():
    rep = RC.recalibrate(review_year=2028)
    assert rep['release_years_used'] == [2026, 2028]
    assert sorted(r['key'] for r in rep['releases']) == ['cmic_auxt', 'glic', 'saaf']
    assert rep['pairs_used'] == 9 and rep['decision'].startswith('kept')
    assert rep['proposal'] == P['sigma']['calibrated']['value']


def make_submission(path, source='mlicpp', key='newcodec2027', year=2027):
    d = REM['datasets']['kodak']
    r = d['releases'][source]
    per, pts = [], []
    for k, op in enumerate(r['ops']):
        bpp, q = [], []
        for j, img in enumerate(d['image_ids']):
            per.append({'image_id': img, 'op_id': op, 'total_bitstream_bytes': int(r['bytes'][j][k]), 'width': 768, 'height': 512,
                        'psnr_rgb_db': r['psnr'][j][k]})
            bpp.append(r['bytes'][j][k] * 8 / d['pixels'][j])
            q.append(r['psnr'][j][k])
        pts.append({'op_id': op, 'bpp': sum(bpp) / len(bpp), 'psnr_db': sum(q) / len(q)})
    sub = {'schema_version': 2, 'method': {'key': key, 'name': 'New codec', 'year': year, 'venue': 'test', 'family': 'E'},
           'curves': [{'dataset': 'kodak', 'metric': 'psnr_rgb', 'psnr_definition': 'rgb_8bit', 'rate_accounting': 'actual_bitstream',
                       'aggregation': 'mean_per_image', 'points': pts, 'per_image': per}]}
    with open(path, 'w') as f:
        json.dump(sub, f)


def test_a_new_release_with_per_image_records_adds_pairs(tmp_path):
    make_submission(tmp_path / 'newcodec2027.json')
    rep = RC.recalibrate(submissions_dir=str(tmp_path), B=300)
    new = [r for r in rep['rows'] if r['origin'] == 'new']
    assert rep['pairs_new'] == len(new) == 6 and {r['dataset'] for r in new} == {'kodak'}
    # the copied release is MLIC++: each new pair must agree with the measured MLIC++ pair within bootstrap noise
    ref = {frozenset((p['a'], p['b'])): p['sigma_pair'] for p in REM['datasets']['kodak']['pairs']}
    for r in new:
        other = r['b'] if r['a'] == 'newcodec2027' else r['a']
        s = ref[frozenset((other, 'mlicpp'))]
        assert abs(r['sigma_pair'] - s) / s < 0.15, (other, r['sigma_pair'], s)
        assert math.isfinite(r['estimate']) and r['n'] == 24
    assert rep['pairs_used'] == 51


def test_a_submission_without_per_image_records_or_with_another_basis_adds_nothing(tmp_path):
    ex = json.load(open(os.path.join(ROOT, 'submissions', 'examples', 'example_method.json')))
    json.dump(ex, open(tmp_path / 'example.json', 'w'))
    make_submission(tmp_path / 'luma.json', key='lumacodec2027')
    sub = json.load(open(tmp_path / 'luma.json'))
    sub['curves'][0]['psnr_definition'] = 'ycbcr_y'
    json.dump(sub, open(tmp_path / 'luma.json', 'w'))
    rep = RC.recalibrate(submissions_dir=str(tmp_path), B=50)
    assert rep['pairs_new'] == 0 and rep['pairs_used'] == 45
    assert any('no per-image records' in n for n in rep['notes'])
    assert any('lumacodec2027' in n and 'not used' in n for n in rep['notes'])


def test_command_line_writes_the_report(tmp_path):
    out = tmp_path / 'rep.json'
    res = subprocess.run([sys.executable, os.path.join(ROOT, 'tools', 'recalibrate.py'), '--out', str(out)],
                         capture_output=True, text=True, check=True)
    assert '90th percentile 5.3713' in res.stdout and 'holdout: 0 false and 14 missed of 90' in res.stdout
    assert json.load(open(out))['pairs_used'] == 45
