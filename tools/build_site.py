#!/usr/bin/env python3
"""Build the single-file site.

    python tools/build_site.py            # writes index.html
    python tools/build_site.py --check    # exit 1 if index.html is not up to date

index.html carries everything it needs: styles, fonts, the scoring code and the data (the frozen board, the accepted
submissions, the measured releases, the published claims and every released curve). It makes no network request, so it also works from a local disk.
site_config.json: "repository" is the public GitHub repository ("owner/name") that receives submissions; "paper" is the
URL of the paper (for example its arXiv abstract page), linked in the footer and the guide; "citation" is
the text shown in the user guide; "update_policy" sets the review schedule that the guide states. All may stay empty.
"""
import argparse
import base64
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from licaudit import board as B  # noqa: E402

FONTS = [('LA Instrument', 400, 'InstrumentSans-Regular.woff'), ('LA Instrument', 700, 'InstrumentSans-Bold.woff'),
         ('LA Bricolage', 700, 'BricolageGrotesque-Bold.woff')]


def font_faces() -> str:
    out = []
    for family, weight, name in FONTS:
        b64 = base64.b64encode((ROOT / 'site_src' / 'fonts' / name).read_bytes()).decode()
        out.append(f'@font-face{{font-family:"{family}";font-weight:{weight};font-style:normal;font-display:swap;'
                   f'src:url(data:font/woff;base64,{b64}) format("woff")}}')
    return '\n'.join(out)


def embed_json(obj) -> str:
    """JSON that is safe inside a <script> element."""
    s = json.dumps(obj, separators=(',', ':'), ensure_ascii=False)
    return s.replace('<', '\\u003c').replace('\u2028', '\\u2028').replace('\u2029', '\\u2029')


def build() -> str:
    protocol, _, rem = B.load(ROOT)
    problems = B.verify_engine(protocol)
    if problems:
        raise SystemExit('engine mismatch: ' + '; '.join(problems))
    board = B.merged_board(ROOT)
    for d in rem['datasets'].values():                     # the browser does not need the variant levels here
        for r in d['releases'].values():
            r.pop('cells', None)
    example = json.loads((ROOT / 'submissions' / 'examples' / 'example_method.json').read_text())
    config = json.loads((ROOT / 'site_config.json').read_text())
    claims = json.loads((ROOT / 'data' / 'claims.json').read_text())
    explorer = json.loads((ROOT / 'data' / 'explorer.json').read_text())
    data = {'protocol': protocol, 'board': board, 'remeasured': rem, 'claims': claims, 'explorer': explorer, 'config': config,
            'example': {'method': {'name': example['method']['name']},
                        'curves': [{'dataset': c['dataset'], 'points': c['points']} for c in example['curves']]}}
    src = ROOT / 'site_src'
    parts_js = sorted((src / 'app').glob('*.js'))
    if not parts_js:
        raise SystemExit('site_src/app/ holds no interface code')
    app = "(function () {\n'use strict';\n" + '\n'.join(f.read_text() for f in parts_js) + '\n})();'
    html = (src / 'template.html').read_text()
    parts = {'/*STYLE*/': (src / 'style.css').read_text().replace('/*FONT_FACES*/', font_faces()),
             '/*DATA*/': embed_json(data), '/*CORE*/': (src / 'core.js').read_text(), '/*APP*/': app}
    for k, v in parts.items():
        if html.count(k) != 1:
            raise SystemExit(f'template must contain {k} exactly once')
        html = html.replace(k, v)
    if '</script' in parts['/*CORE*/'].lower() or '</script' in app.lower():
        raise SystemExit('script sources must not contain a closing script tag')
    return html


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--out', default=str(ROOT / 'index.html'))
    a = ap.parse_args(argv)
    html = build()
    out = Path(a.out)
    if a.check:
        if not out.exists() or out.read_text() != html:
            print(f'{out.name} is not up to date: run python tools/build_site.py')
            return 1
        print(f'{out.name} is up to date')
        return 0
    out.write_text(html)
    print(f'{out.name}: {len(html.encode()) / 1024:.0f} kB')
    return 0


if __name__ == '__main__':
    sys.exit(main())
