"""Tests of the reference tool: frozen scores, report cards, source check, the merged board and the site build.

    python -m pytest -q tests
"""
import copy
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from licaudit import board as B  # noqa: E402
from licaudit.engine import bd as E  # noqa: E402

PROTOCOL, BOARD, REM = B.load()
EXAMPLE = json.loads((ROOT / 'submissions' / 'examples' / 'example_method.json').read_text())


def test_engine_files_are_the_frozen_ones():
    assert B.verify_engine(PROTOCOL) == []


def test_frozen_scores_follow_from_the_shipped_levels_and_points():
    n_points = 0
    for ds, rows in BOARD['entries'].items():
        dp = PROTOCOL['datasets'][ds]
        assert [r['canonical'] for r in rows] == sorted(r['canonical'] for r in rows)
        for r in rows:
            assert abs(E.pct(r['cells'][0] - dp['consensus_level']) - r['canonical']) < 1e-9
            assert len(r['cells']) == len(dp['cells'])
            if r['points']:
                n_points += 1
                cells = B.cells_of([p[0] for p in r['points']], [p[1] for p in r['points']], dp)
                for a, b in zip(cells, r['cells']):
                    assert (a is None) == (b is None) and (a is None or abs(a - b) < 1e-8)
            else:
                assert r['values_withheld'] and r['source']['license'] in ('none_found', 'unclear')
    assert n_points > 40


def test_margins_match_the_paper_table():
    lim = {ds: round(B.limit(PROTOCOL['sigma']['calibrated']['value'], PROTOCOL['datasets'][ds]['n_images']), 2) for ds in B.DATASETS}
    assert lim == {'kodak': 2.15, 'tecnick': 1.05, 'clic_pv': 1.64}
    lim = {ds: round(B.limit(PROTOCOL['sigma']['historical']['value'], PROTOCOL['datasets'][ds]['n_images']), 2) for ds in B.DATASETS}
    assert lim == {'kodak': 2.54, 'tecnick': 1.24, 'clic_pv': 1.94}


def test_example_submission_is_scored_on_all_three_sets():
    rep = B.score_submission(EXAMPLE, PROTOCOL, BOARD, REM)
    assert rep['status'] == 'scored'
    for ds in B.DATASETS:
        e = rep['datasets'][ds]
        assert e['result'] == 'scored' and e['evidence_level'] == 2 and e['measurement_compatibility'] == 'documented'
        assert 1 <= e['position_if_inserted'] <= e['entries_on_board'] + 1
        s = e['summary']
        assert s['resolved_better_than'] + s['resolved_worse_than'] + s['not_separable_from'] == e['entries_on_board']
        better = sum(1 for r in BOARD['entries'][ds] if r['canonical'] < e['score_percent'])
        assert e['position_if_inserted'] == better + 1
    md = B.render_markdown(rep)
    assert 'Kodak' in md and 'Position' in md


def test_scoring_does_not_depend_on_point_order_or_dominated_points():
    sub = copy.deepcopy(EXAMPLE)
    c = sub['curves'][0]
    ref = B.score_submission(EXAMPLE, PROTOCOL, BOARD, REM)['datasets']['kodak']['score_percent']
    c['points'] = list(reversed(c['points'])) + [{'bpp': c['points'][2]['bpp'] * 1.2, 'psnr_db': c['points'][2]['psnr_db'] - 0.3}]
    assert abs(B.score_submission(sub, PROTOCOL, BOARD, REM)['datasets']['kodak']['score_percent'] - ref) < 1e-12


def test_a_curve_that_misses_the_window_gets_no_score():
    sub = copy.deepcopy(EXAMPLE)
    sub['curves'][0]['points'] = sub['curves'][0]['points'][2:]          # lowest point now above the window's lower edge
    rep = B.score_submission(sub, PROTOCOL, BOARD, REM)
    e = rep['datasets']['kodak']
    assert e['result'] == 'unscored' and 'does not cover the fixed window' in e['reason'] and 'score_percent' not in e
    assert rep['status'] == 'scored'                                     # the other two test sets still count


def test_other_measurement_bases_are_not_ranked():
    sub = copy.deepcopy(EXAMPLE)
    sub['curves'][0]['rate_accounting'] = 'estimated_likelihood'
    sub['curves'][1]['psnr_definition'] = 'ycbcr_y'
    sub['curves'][2]['aggregation'] = 'pixel_weighted'
    rep = B.score_submission(sub, PROTOCOL, BOARD, REM)
    assert rep['datasets']['kodak']['result'] == 'diagnostic' and 'position_if_inserted' not in rep['datasets']['kodak']
    assert rep['datasets']['tecnick']['result'] == 'rejected'
    assert rep['datasets']['clic_pv']['result'] == 'diagnostic'
    assert rep['status'] == 'diagnostic only'


def test_invalid_submissions_score_nothing():
    sub = copy.deepcopy(EXAMPLE)
    sub['curves'].append(copy.deepcopy(sub['curves'][0]))               # two curves for one test set
    rep = B.score_submission(sub, PROTOCOL, BOARD, REM)
    assert rep['status'] == 'invalid' and rep['datasets'] == {}
    sub = copy.deepcopy(EXAMPLE)
    del sub['method']['name']
    assert B.score_submission(sub, PROTOCOL, BOARD, REM)['status'] == 'invalid'


def test_source_presence_check():
    c = EXAMPLE['curves'][0]
    text = json.dumps({'results': {'bpp': [p['bpp'] for p in c['points']], 'psnr': [p['psnr_db'] for p in c['points']]}})
    sp = B.source_presence(c, text)
    assert sp['all_present'] and sp['bpp']['found'] == len(c['points'])
    sp = B.source_presence(c, text.replace(str(c['points'][3]['psnr_db']), '99.99'))
    assert not sp['all_present'] and sp['psnr_db']['missing'] == [c['points'][3]['psnr_db']]
    # a source that prints more decimals than the submission still counts; a different value does not
    one = {'points': [{'bpp': 0.3341, 'psnr_db': 33.08}]}
    assert B.source_presence(one, 'bpp 0.33412  psnr 33.0791')['all_present']
    assert not B.source_presence(one, 'bpp 0.3351  psnr 33.08')['all_present']
    with pytest.raises(ValueError):
        B.fetch_source({'repository': 'not a repo', 'commit': 'abc1234', 'path': 'x'})


def per_image_submission(release='dcae', ds='kodak'):
    d, r = REM['datasets'][ds], REM['datasets'][ds]['releases'][release]
    n, k = len(d['image_ids']), len(r['ops'])
    R = [[8.0 * r['bytes'][i][j] / d['pixels'][i] for j in range(k)] for i in range(n)]
    pts = [{'bpp': sum(R[i][j] for i in range(n)) / n, 'psnr_db': sum(r['psnr'][i][j] for i in range(n)) / n, 'op_id': r['ops'][j]} for j in range(k)]
    rec = [{'image_id': d['image_ids'][i], 'op_id': r['ops'][j], 'reported_bpp': R[i][j], 'psnr_rgb_db': r['psnr'][i][j]} for i in range(n) for j in range(k)]
    return {'schema_version': 2, 'method': {'key': 'per-image-example', 'name': 'Per-image example', 'year': 2027, 'family': 'E'},
            'curves': [{'dataset': ds, 'dataset_label': 'Kodak', 'metric': 'psnr_rgb', 'psnr_definition': 'rgb_8bit', 'rate_accounting': 'actual_bitstream',
                        'aggregation': 'mean_per_image', 'points': pts, 'per_image': rec,
                        'provenance': {'repository': 'example-org/codec', 'commit': '0123456789abcdef', 'path': 'results/kodak_per_image.csv'}}]}


def test_per_image_records_raise_the_evidence_level():
    sub = per_image_submission()
    rep = B.score_submission(sub, PROTOCOL, BOARD, REM)
    e = rep['datasets']['kodak']
    assert e['result'] == 'scored' and e['evidence_level'] == 3 and e['per_image']['status'] == 'pass' and e['per_image']['consistency'] == 'exact'
    assert abs(e['cells'][0] - REM['datasets']['kodak']['releases']['dcae']['level']) < 1e-9
    sub['curves'][0]['per_image'] = sub['curves'][0]['per_image'][:-5]   # incomplete records: no level 3, the curve is still scored
    e = B.score_submission(sub, PROTOCOL, BOARD, REM)['datasets']['kodak']
    assert e['evidence_level'] == 2 and e['per_image']['status'] == 'fail'


@pytest.fixture()
def sandbox(tmp_path):
    """A copy of the repository parts that the board and the site build read."""
    for d in ('data', 'licaudit', 'site_src', 'tools', 'submissions'):
        shutil.copytree(ROOT / d, tmp_path / d, ignore=shutil.ignore_patterns('__pycache__', '_private'))
    shutil.copy(ROOT / 'site_config.json', tmp_path / 'site_config.json')
    for f in (tmp_path / 'submissions' / 'accepted').glob('*.json'):
        f.unlink()
    return tmp_path


def run(root, tool, *args):
    return subprocess.run([sys.executable, str(root / 'tools' / tool), *args], capture_output=True, text=True)


def test_accepting_a_submission_adds_it_without_changing_frozen_entries(sandbox):
    before = B.merged_board(sandbox)
    r = run(sandbox, 'accept_submission.py', str(sandbox / 'submissions' / 'examples' / 'example_method.json'), '--date', '2027-02-01')
    assert r.returncode == 0, r.stdout + r.stderr
    after = B.merged_board(sandbox)
    for ds in B.DATASETS:
        keys = [e['key'] for e in after['entries'][ds]]
        assert 'example-codec' in keys and len(keys) == len(before['entries'][ds]) + 1
        assert [e['canonical'] for e in after['entries'][ds]] == sorted(e['canonical'] for e in after['entries'][ds])
        frozen_after = [e for e in after['entries'][ds] if e['origin'] == 'frozen']
        assert frozen_after == before['entries'][ds]
        mine = next(e for e in after['entries'][ds] if e['key'] == 'example-codec')
        assert mine['origin'] == 'submission' and mine['evidence'] == 2 and mine['accepted_on'] == '2027-02-01' and mine['points']
    assert (sandbox / 'index.html').exists() and 'example-codec' in (sandbox / 'index.html').read_text()
    again = run(sandbox, 'accept_submission.py', str(sandbox / 'submissions' / 'examples' / 'example_method.json'))
    assert again.returncode == 2 and 'already on the board' in again.stdout


def test_a_submission_cannot_replace_a_frozen_entry(sandbox):
    sub = copy.deepcopy(EXAMPLE)
    sub['method']['key'] = BOARD['entries']['kodak'][0]['key']
    p = sandbox / 'clash.json'
    p.write_text(json.dumps(sub))
    r = run(sandbox, 'accept_submission.py', str(p))
    assert r.returncode == 2 and 'already on the board' in r.stdout
    (sandbox / 'submissions' / 'accepted' / 'clash.json').write_text(json.dumps(sub))
    with pytest.raises(ValueError):
        B.merged_board(sandbox)


def test_check_tool_exit_codes(sandbox, tmp_path):
    ex = sandbox / 'submissions' / 'examples' / 'example_method.json'
    assert run(sandbox, 'check_submission.py', '--verify-engine').returncode == 0
    src = tmp_path / 'kodak.json'
    c = EXAMPLE['curves'][0]
    src.write_text(json.dumps({'bpp': [p['bpp'] for p in c['points']], 'psnr': [p['psnr_db'] for p in c['points']]}))
    r = run(sandbox, 'check_submission.py', str(ex), '--source-file', f'kodak={src}')
    assert r.returncode == 0 and '7 of 7 rates and 7 of 7 PSNR values occur in the stated file' in r.stdout
    bad = tmp_path / 'bad.json'
    bad.write_text('{"schema_version": 1, "method": {"key": "x1", "name": "X"}, "curves": []}')
    assert run(sandbox, 'check_submission.py', str(bad)).returncode == 2
    sub = copy.deepcopy(EXAMPLE)
    for cv in sub['curves']:
        cv['rate_accounting'] = 'estimated_likelihood'
    est = tmp_path / 'est.json'
    est.write_text(json.dumps(sub))
    assert run(sandbox, 'check_submission.py', str(est)).returncode == 4


def test_site_build_is_reproducible_and_self_contained(sandbox):
    assert run(sandbox, 'build_site.py').returncode == 0
    html = (sandbox / 'index.html').read_text()
    assert run(sandbox, 'build_site.py', '--check').returncode == 0
    assert html.startswith('<!DOCTYPE html>') and 'src="http' not in html and "url(http" not in html and '<link' not in html
    data = json.loads(html.split('<script id="lic-data" type="application/json">')[1].split('</script>')[0])
    assert set(data) == {'protocol', 'board', 'remeasured', 'claims', 'explorer', 'config', 'example'}
    assert len(data['board']['entries']['kodak']) == len(BOARD['entries']['kodak'])
    (sandbox / 'site_src' / 'style.css').write_text((sandbox / 'site_src' / 'style.css').read_text() + '\n/* changed */\n')
    assert run(sandbox, 'build_site.py', '--check').returncode == 1


def test_the_committed_site_is_up_to_date():
    assert run(ROOT, 'build_site.py', '--check').returncode == 0
