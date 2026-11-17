#!/usr/bin/env python3
"""Read a submission from the text of a GitHub issue and write the report card as a comment body.

    ISSUE_BODY="..." python tools/issue_to_submission.py --out submission.json --comment comment.md [--online]

The issue text is data: it is parsed as JSON and never executed. The submission is taken from the first fenced code
block or bare JSON object that parses and has "method" and "curves"; if there is none, from the first .json or .txt
attachment hosted by GitHub. Exit codes: 0 report written (whatever the result), 2 no submission found.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ATTACHMENT = re.compile(r'https://github\.com/(?:user-attachments/files/\d+|[\w.\-]+/[\w.\-]+/files/\d+)/[\w.\-]+\.(?:json|txt)')


def candidates(body: str):
    for m in re.finditer(r'```(?:json)?\s*\n(.*?)```', body, flags=re.S):
        yield m.group(1)
    start = body.find('{')
    if start >= 0:
        yield body[start:body.rfind('}') + 1]


def find_submission(body: str, fetch=True):
    for text in candidates(body):
        try:
            obj = json.loads(text)
        except ValueError:
            continue
        if isinstance(obj, dict) and 'method' in obj and 'curves' in obj:
            return obj, 'the issue text'
    m = ATTACHMENT.search(body)
    if m and fetch:
        try:
            with urllib.request.urlopen(m.group(0), timeout=30) as r:
                obj = json.loads(r.read(20_000_000).decode('utf-8', 'replace'))
            if isinstance(obj, dict) and 'method' in obj and 'curves' in obj:
                return obj, 'the attached file'
        except Exception:                                  # an unreadable attachment is reported as "not found"
            pass
    return None, None


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--comment', required=True)
    ap.add_argument('--online', action='store_true')
    a = ap.parse_args(argv)
    sub, where = find_submission(os.environ.get('ISSUE_BODY', ''))
    if sub is None:
        Path(a.comment).write_text('No submission file was found in this issue. Paste the JSON from the site (Evaluate a method, step 4) '
                                   'into the "Submission file" field, or attach it as a `.json` or `.txt` file, then edit the issue.\n')
        return 2
    Path(a.out).write_text(json.dumps(sub, indent=1) + '\n')
    cmd = [sys.executable, str(ROOT / 'tools' / 'check_submission.py'), a.out] + (['--online'] if a.online else [])
    r = subprocess.run(cmd, capture_output=True, text=True)
    verdict = {0: 'At least one curve is scored. A maintainer will review the source and accept the entry.',
               2: 'The submission is not valid; see the messages below, fix the file and edit the issue.',
               4: 'The file is valid, but no curve can be ranked; see the reasons below.'}.get(r.returncode, 'The check could not run; a maintainer will look at it.')
    Path(a.comment).write_text(f'Automatic check of the submission read from {where}.\n\n**{verdict}**\n\n' + (r.stdout or r.stderr)[:60000] +
                               '\n\n<sub>Recomputed with the reference tool of this repository. Maintainers: comment `/accept` to add the entry.</sub>\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
