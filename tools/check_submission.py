#!/usr/bin/env python3
"""Check and score a submission file under the frozen protocol.

    python tools/check_submission.py my_method.json                 # validate and score
    python tools/check_submission.py my_method.json --online        # also fetch the stated source file and look for the numbers
    python tools/check_submission.py my_method.json --source-file kodak=README.md   # the same check on a local copy
    python tools/check_submission.py --verify-engine                # the engine files match the frozen benchmark

Options: --markdown FILE (report card), --json FILE (full report).
Exit codes: 0 at least one curve scored; 2 invalid submission; 3 engine mismatch; 4 valid, but nothing scored.
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from licaudit import board as B  # noqa: E402


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('input', nargs='?')
    ap.add_argument('--online', action='store_true')
    ap.add_argument('--source-file', action='append', default=[], metavar='DATASET=PATH')
    ap.add_argument('--markdown')
    ap.add_argument('--json')
    ap.add_argument('--verify-engine', action='store_true')
    a = ap.parse_args(argv)
    protocol, board, rem = B.load()
    problems = B.verify_engine(protocol)
    if problems:
        print('ENGINE MISMATCH: ' + '; '.join(problems))
        return 3
    if a.verify_engine and not a.input:
        print(f"engine files match the frozen benchmark v{protocol['version']}")
        return 0
    if not a.input:
        ap.error('give a submission file')
    try:
        sub = json.loads(Path(a.input).read_text())
    except (OSError, ValueError) as e:
        print(f'cannot read {a.input}: {e}')
        return 2
    sources, notes = {}, []
    for item in a.source_file:
        ds, _, path = item.partition('=')
        if not path:
            ap.error('--source-file expects DATASET=PATH')
        sources[ds] = Path(path).read_text(errors='replace')
    if a.online:
        for c in sub.get('curves') or []:
            ds, prov = c.get('dataset'), c.get('provenance') or {}
            if ds in sources or not all(prov.get(k) for k in ('repository', 'commit', 'path')):
                continue
            try:
                sources[ds] = B.fetch_source(prov)
            except Exception as e:                       # network or a wrong locator: reported, never fatal
                notes.append(f'{ds}: the stated source file could not be fetched ({e})')
    rep = B.score_submission(sub, protocol, B.merged_board(), rem, sources or None)
    rep['notes'] += notes
    md = B.render_markdown(rep)
    if a.markdown:
        Path(a.markdown).write_text(md)
    if a.json:
        Path(a.json).write_text(json.dumps(rep, indent=1))
    print(md)
    if rep['status'] == 'invalid':
        return 2
    return 0 if rep['status'] == 'scored' else 4


if __name__ == '__main__':
    sys.exit(main())
