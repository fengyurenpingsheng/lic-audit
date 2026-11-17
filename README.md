# LIC-Audit

A fixed-window, source-linked leaderboard for learned image compression.

LIC-Audit keeps BD-rate on PSNR and fixes three things about it: how it is computed (a direct BD-rate over one frozen
PSNR window per test set), how it is measured (written bits over the original image area, 8-bit RGB PSNR, per-image
means, all stated), and what evidence a gain needs (a paired interval over the test images when per-image records
exist, otherwise a margin that follows from the number of images and an assumed image-to-image variability).

The site is one file, `index.html`. It needs no server and makes no network request, so it also opens from a local disk.

| View | What it answers |
|---|---|
| Leaderboard | Three boards. Released curves: progress over time (year against score, coloured by main contribution) and the ranking on Kodak, Tecnick and CLIC Pro, with the positions average curves cannot separate. Measured checkpoints: eight public checkpoints measured under one set of definitions, with paired intervals, on PSNR and MS-SSIM, including DIV2K. Published claims: the BD-rates papers report, next to the fixed-window scores |
| Compare | The direct BD-rate of two methods, its range over other ways of computing it, and whether the gap exceeds the margin |
| Evaluate your method | The score and position of a new curve, computed in the browser from pasted or dropped operating points in any of six common formats; paired intervals from per-image records; the submission file |
| Data | Every collected curve (353, with role, score and source), the 198 published claims and the per-image records, with filters, a plot of up to seven curves and CSV downloads |
| User guide | How to read the board, how to evaluate and join it, every fixed and estimated number with its origin, how and when it is revisited, the number of test images a difference needs, and questions |

## Add your method

1. Open the site, choose **Evaluate a method**, and paste the operating points (bits per pixel, PSNR in dB) for one or
   more test sets. The score and position appear at once.
2. Publish the numbers in your repository and note the commit and the file that hold them.
3. Fill in step 4 on the site and open a submission (the button creates a GitHub issue with the file), or open a pull
   request that adds the file to `submissions/accepted/`.

An automatic check recomputes the score with the reference tool and looks for every number at the stated source. A
maintainer then accepts the entry. A curve must span the fixed window of its test set; the protocol never extrapolates.

Evidence levels: **1** a numeric curve at a pinned public commit; **2** with a stated measurement profile on the common
basis; **3** with per-image records that reproduce the curve; **4** measured by the maintainers from the public checkpoint.

## Run the reference tool

```bash
python -m pip install -r requirements.txt
python tools/check_submission.py submissions/examples/example_method.json            # report card
python tools/check_submission.py my_method.json --online                             # also look for the numbers at the stated source
python tools/check_submission.py --verify-engine                                     # engine files match the frozen benchmark
```

The engine in `licaudit/engine/` is byte-identical to the implementation whose SHA-256 the benchmark manifest records
(`data/protocol.json`, `engine_sha256`). The browser code in `site_src/core.js` is a port of it; `tests/test_parity.mjs`
compares the two on every curve that may be redistributed, on every protocol variant, on the paired intervals of the
measured releases, and on the submission checks.

```bash
python -m pytest -q tests        # reference tool, board, site build
node tests/test_parity.mjs       # browser code against the reference tool
```

## For maintainers

| Task | Command |
|---|---|
| Accept a submission | comment `/accept` on its issue, or `python tools/accept_submission.py my_method.json` |
| Rebuild the site | `python tools/build_site.py` (`--check` fails if `index.html` is out of date) |
| Set the public repository, the paper link, the citation text and the update policy shown in the guide | edit `site_config.json`, then rebuild |
| Re-estimate the image-to-image variability at a review | `python tools/recalibrate.py --review-year 2028 --out recalibration_2028.json` |
| Rebuild `data/` from the paper artifact | `python tools/export_from_artifact.py --artifact <path>` |

Frozen entries never change. An accepted submission is scored on the existing window against the existing reference
level, so it cannot change an existing score. A different window, test set or quality measure is a new protocol version.

Only one number of the protocol is estimated from data: the image-to-image variability behind the margin (5.37 in
v1.2.0, the 90th percentile of 45 measured pairs among six 2025-26 releases). `tools/recalibrate.py` applies the same
rule to the releases of the two calendar years before a review, adds the pairs of accepted entries that came with
per-image records, keeps the current value when fewer than 15 pairs are available, and reruns the leave-one-codec-out
check. On the data of v1.2.0 it returns 5.37 and 0 false and 14 missed decisions in 90. The review schedule in
`site_config.json` (`update_policy`: once a year in January, earlier after 10 new releases with per-image records; a new
major version when 25% of a year's submissions cannot reach a window) is a proposal for the maintainers to confirm. A new
value changes the width of the margins, never a score.

GitHub setup: create the label `submission`, and under *Settings > Pages* choose *GitHub Actions* as the source. The
workflows in `.github/workflows/` then test every push, publish the site, answer each submission issue with its report
card, and add an entry when a maintainer comments `/accept`.

## Layout

| Path | Content |
|---|---|
| `index.html` | the built site |
| `site_src/` | page template, styles, scoring code (`core.js`), interface code, fonts |
| `data/protocol.json` | frozen numbers: windows, reference levels, variability scales, engine hashes |
| `data/board.json` | frozen entries: metadata, source, score, and the log-rate level of every protocol variant |
| `data/remeasured.json` | the releases measured from public checkpoints: per-image records and paired intervals |
| `data/claims.json` | the published claims and the comparable subset shown on the claims board |
| `data/explorer.json` | every collected curve with its role, score and source, for the Data view |
| `submissions/accepted/` | accepted submissions, one file per method |
| `licaudit/` | reference tool: frozen engine and board logic |
| `tools/` | check, accept, build, export, recalibrate |
| `tests/` | tests and fixtures |

## Data and licenses

The code is released under the MIT license. The fonts in `site_src/fonts/` are under the SIL Open Font License.

Scores, levels and intervals are computed by this project. The curves were released by the authors of the respective
methods; every entry links to the repository, commit and file it comes from, so please cite the original works when you
use their numbers. Where a source repository carries a standard license, the curve values are included; where it
carries none, the board shows the score and the link and does not copy the values. Authors can submit their own curve
to have it shown. The per-image records in `data/remeasured.json` are this project's own measurements of public
checkpoints.
