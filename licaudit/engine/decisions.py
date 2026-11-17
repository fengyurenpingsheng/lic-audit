"""One decision object for every comparison reported by LIC-Ledger.

Every status, symbol, count and sentence about a comparison is derived from ``ComparisonDecision`` through
``classify``; no other code path may define "resolved".

Evidence types
--------------
* ``transported_sigma``: aggregate-only curves; the sampling statement is conditional on an *assumed* per-image
  heterogeneity sigma (normal approximation, independent images, paired design). The break-even value
  sigma_star = |least favourable effect| * sqrt(n) / 1.96 is reported so that readers can apply their own sigma.
* ``paired_bootstrap``: matched per-image results are released for both codecs; the interval is an empirical
  paired-bootstrap interval for the stated images and measurement protocol.
* ``protocol_only``: no sampling statement (e.g. cross-dataset contrasts).

Statuses
--------
* ``abstained``: no valid comparison under the declared protocol (e.g. a curve does not span the window).
* ``unstable``: the direction changes across valid protocol variants; least favourable effect and sigma_star are
  undefined (None, never 0).
* ``unresolved``: direction stable, but sigma_star <= sigma_ref (or the paired interval contains 0).
* ``resolved_conditional``: sigma_ref < sigma_star <= sigma_hi.
* ``robust_conditional``: sigma_star > sigma_hi.
* ``resolved_observed``: paired-bootstrap interval excludes 0 and the sign is stable over the valid protocol variants
  of the full-sample curves (evidence_type == 'paired_bootstrap').
* ``unresolved_observed``: paired-bootstrap interval contains 0.
* ``insufficient_bootstrap_coverage``: more replicates than the declared limit failed to span the frozen window; no
  decision is made (failed replicates are never dropped silently or re-windowed).

The conditional statuses (``resolved_conditional``, ``robust_conditional``) are nominal: one comparison at a time,
5% two-sided, under the assumed sigma. A familywise (Holm) adjustment over a declared family of comparisons is a separate
quantity (analysis/a6_progress.py, conditional_p_holm) and is reported next to the status, never folded into it.
Observed decisions carry their bootstrap metadata in ``evidence`` (B, seed, window, interval level, coverage failures,
image-set and operating-point hashes, consistency of the per-image data with the released curves).
"""
from __future__ import annotations

from dataclasses import dataclass, asdict, field
import math

ABSTAINED, UNSTABLE, UNRESOLVED = 'abstained', 'unstable', 'unresolved'
RESOLVED_C, ROBUST_C, RESOLVED_OBS = 'resolved_conditional', 'robust_conditional', 'resolved_observed'
UNRESOLVED_OBS, INSUFFICIENT = 'unresolved_observed', 'insufficient_bootstrap_coverage'
SUPPORTED = (RESOLVED_C, ROBUST_C, RESOLVED_OBS)
SIGMA_GRID = (2.5, 5.0, 7.5, 10.0, 12.5)   # assumed per-image heterogeneity scenarios (percentage points)


@dataclass(frozen=True)
class ComparisonDecision:
    method: str
    baseline: str
    dataset: str
    n_images: int
    canonical_direct_percent: float | None          # PCHIP, all points, frozen window
    least_favorable_direct_percent: float | None    # smallest |effect| over valid variants if the sign is stable
    protocol_min_percent: float | None
    protocol_max_percent: float | None
    sign_stable: bool
    n_valid_protocols: int
    n_attempted_protocols: int
    sigma_star: float | None
    sigma_ref_assumed: float | None
    sigma_hi_assumed: float | None
    status: str
    evidence_type: str
    direction: str | None                           # 'advance' (effect < 0), 'regression' (> 0), None
    sigma_grid: dict = field(default_factory=dict)  # sigma -> bool (resolved at that sigma)
    canonical_only_resolution: bool | None = None   # exploratory: |canonical| > 1.96 sigma_ref / sqrt(n); never a verdict
    evidence: dict = field(default_factory=dict)    # observed decisions: bootstrap and consistency metadata

    def to_dict(self):
        d = asdict(self)
        if not d['evidence']:            # conditional decisions: unchanged serialization
            d.pop('evidence')
        return d

    @property
    def supported_advance(self) -> bool:
        return self.status in SUPPORTED and self.direction == 'advance'


def sigma_star(effect_percent: float | None, n_images: int) -> float | None:
    if effect_percent is None:
        return None
    return abs(effect_percent) * math.sqrt(n_images) / 1.96


def classify(effects: list[float], canonical: float | None, n_images: int, sigma_ref: float, sigma_hi: float,
             n_attempted: int, method: str, baseline: str, dataset: str,
             evidence_type: str = 'transported_sigma') -> ComparisonDecision:
    """Classify a comparison from the list of its *valid* protocol effects (percent, candidate vs baseline).
    ``canonical`` must be one of the valid effects (or None if the canonical protocol is invalid)."""
    eff = [float(e) for e in effects if e is not None and math.isfinite(e)]
    if not eff or canonical is None:
        return ComparisonDecision(method, baseline, dataset, n_images, canonical, None, None, None, False, len(eff),
                                  n_attempted, None, sigma_ref, sigma_hi, ABSTAINED, evidence_type, None, {}, None)
    lo, hi = min(eff), max(eff)
    stable = all(e < 0 for e in eff) or all(e > 0 for e in eff)
    direction = 'advance' if canonical < 0 else ('regression' if canonical > 0 else None)
    canon_only = abs(canonical) > 1.96 * sigma_ref / math.sqrt(n_images)
    if not stable:
        return ComparisonDecision(method, baseline, dataset, n_images, canonical, None, lo, hi, False, len(eff), n_attempted,
                                  None, sigma_ref, sigma_hi, UNSTABLE, evidence_type, direction,
                                  {s: False for s in SIGMA_GRID}, canon_only)
    least = min(eff, key=abs)
    s_star = sigma_star(least, n_images)
    if s_star > sigma_hi:
        status = ROBUST_C
    elif s_star > sigma_ref:
        status = RESOLVED_C
    else:
        status = UNRESOLVED
    grid = {s: bool(s_star > s) for s in SIGMA_GRID}
    return ComparisonDecision(method, baseline, dataset, n_images, canonical, least, lo, hi, True, len(eff), n_attempted,
                              s_star, sigma_ref, sigma_hi, status, evidence_type, direction, grid, canon_only)


def classify_observed(estimate: float | None, ci: tuple[float, float] | None, n_images: int, method: str, baseline: str,
                      dataset: str, *, fail_fraction: float = 0.0, max_fail: float | None = None,
                      protocol_effects: list | None = None, n_attempted: int | None = None,
                      evidence: dict | None = None) -> ComparisonDecision:
    """Decision from an empirical paired-bootstrap interval (matched per-image results).
    ``protocol_effects``: direct effects of the full-sample curves over the valid protocol variants (the sign must not
    change across them); ``fail_fraction``: share of replicates that did not span the window; with ``max_fail`` set,
    a larger share gives insufficient_bootstrap_coverage. Without keyword arguments this is the decision from the
    interval alone (as used by the held-out calibration, analysis/a12_calibration.py)."""
    ev = dict(evidence or {})
    ev.setdefault('fail_fraction', fail_fraction)
    if estimate is None or ci is None or not all(math.isfinite(x) for x in (estimate, *ci)):
        return ComparisonDecision(method, baseline, dataset, n_images, estimate, None, None, None, False, 0, n_attempted or 0,
                                  None, None, None, ABSTAINED, 'paired_bootstrap', None, {}, None, ev)
    eff = [float(e) for e in (protocol_effects if protocol_effects is not None else [estimate]) if e is not None and math.isfinite(e)]
    stable = bool(eff) and (all(e < 0 for e in eff) or all(e > 0 for e in eff) or all(e == 0 for e in eff))
    direction = 'advance' if estimate < 0 else ('regression' if estimate > 0 else None)
    excludes0 = (ci[0] > 0) or (ci[1] < 0)
    if max_fail is not None and fail_fraction > max_fail:
        status = INSUFFICIENT
    elif not stable:
        status = UNSTABLE
    else:
        status = RESOLVED_OBS if excludes0 else UNRESOLVED_OBS
    lo, hi = (min(eff), max(eff)) if eff else (None, None)
    return ComparisonDecision(method, baseline, dataset, n_images, estimate, min(eff, key=abs) if stable else None, lo, hi,
                              stable, len(eff), n_attempted if n_attempted is not None else len(eff), None, None, None,
                              status, 'paired_bootstrap', direction, {}, None, {**ev, 'ci95': [float(ci[0]), float(ci[1])]})


SYMBOL = {ROBUST_C: r'\bullet', RESOLVED_C: r'\odot', UNRESOLVED: r'\circ', UNSTABLE: r'\circ', ABSTAINED: r'\times',
          RESOLVED_OBS: r'\star', UNRESOLVED_OBS: r'\circ', INSUFFICIENT: r'\times'}
