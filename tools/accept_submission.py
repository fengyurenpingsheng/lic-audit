#!/usr/bin/env python3
"""Maintainers: add a checked submission to the board and rebuild the site.

    python tools/accept_submission.py my_method.json [--date 2027-01-31]

The file is copied to submissions/accepted/<key>.json with the acceptance date. A submission is accepted only if at
least one curve is scored, its method key is new, and (unless --no-source-check) every curve names a public source.
Frozen entries never change.
"""
import argparse
import datetime
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from licaudit import board as B  # noqa: E402


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('input')
    ap.add_argument('--date', default=datetime.date.today().isoformat())
    ap.add_argument('--no-source-check', action='store_true', help='accept curves without repository, commit and path')
    ap.add_argument('--no-build', action='store_true')
    a = ap.parse_args(argv)
    protocol, board, rem = B.load()
    sub = json.loads(Path(a.input).read_text())
    rep = B.score_submission(sub, protocol, B.merged_board(), rem)
    if rep['status'] != 'scored':
        print(f"not accepted: status is {rep['status']!r}; run tools/check_submission.py for the report")
        return 2
    key = sub['method']['key']
    if not B.KEY_RE.match(key):
        print(f'not accepted: method.key {key!r} must use lower-case letters, digits, "-" or "_"')
        return 2
    if any(e.get('already_on_board') for e in rep['datasets'].values()) or (ROOT / 'submissions' / 'accepted' / f'{key}.json').exists():
        print(f'not accepted: the key {key!r} is already on the board')
        return 2
    if not a.no_source_check:
        for c in sub['curves']:
            prov = c.get('provenance') or {}
            if not all(prov.get(k) for k in ('repository', 'commit', 'path')):
                print(f"not accepted: the {c.get('dataset')} curve names no public source (repository, commit, path)")
                return 2
    sub = {k: v for k, v in sub.items() if not k.startswith('_')}
    sub['board'] = {'accepted_on': a.date, 'protocol_version': protocol['version']}
    out = ROOT / 'submissions' / 'accepted' / f'{key}.json'
    out.write_text(json.dumps(sub, indent=1) + '\n')
    print(f'accepted: {out.relative_to(ROOT)}')
    if not a.no_build:
        return subprocess.call([sys.executable, str(ROOT / 'tools' / 'build_site.py')])
    return 0


if __name__ == '__main__':
    sys.exit(main())
