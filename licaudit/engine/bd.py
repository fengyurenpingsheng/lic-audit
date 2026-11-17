"""LIC-Ledger Bjontegaard-delta engine with explicit window semantics.

Units and conventions
---------------------
* rate in bits per pixel (> 0), quality in dB (PSNR).
* ``level(curve, W)`` is the log-rate level D_W = mean over q in W of log10 rate(q), computed on the curve's
  monotone interpolant (Eq. 1 of the paper).
* ``BD_W(a -> b)`` as a *fraction* is 10**(D_W(b) - D_W(a)) - 1; every function here returns the *percentage*
  100 * BD_W, i.e. a percentage rate change of b relative to a (negative: b needs fewer bits at equal quality).
  The arithmetic difference of two such percentages is a difference in *percentage points*, which is not a
  direct codec-to-codec BD-rate; under one shared window and interpolation the direct value is
  100 * ((1 + s_b/100) / (1 + s_a/100) - 1) for scores s against a common reference.

Window policies
---------------
* ``strict``: the requested window W is mandatory and is used exactly. Both curves must cover it (after the
  upper-envelope filter and the point-subset rule); otherwise the result has status ``insufficient_coverage``
  and value ``None``. The window is never shrunk silently.
* ``common_overlap``: the pair's own common PSNR range. This reproduces the conventional per-pair BD-rate of
  the literature; it is a pair-level quantity and is not transitive across pairs.

Interpolation
-------------
* ``pchip`` (JVET CTC piecewise-cubic Hermite), ``akima`` (Herglotz et al.; requires >= 5 points, otherwise the
  cell is reported as ``interpolator_used == 'pchip'`` with status ``fallback`` and must not be counted as an
  independent Akima measurement), ``cubic`` (Bjontegaard 2001 least-squares cubic; degree reduced for < 4 points,
  reported in ``note``).
"""
from __future__ import annotations

from dataclasses import dataclass, field
import math
import numpy as np
from scipy.interpolate import PchipInterpolator, Akima1DInterpolator

TOL_DB = 1e-9          # coverage tolerance (dB)
N_GRID = 2001          # trapezoid grid for the window mean
MIN_POINTS_SUBSET = 5  # point-subset variants are defined only for curves with >= 5 envelope points
MIN_POINTS_AKIMA = 5

OK = 'ok'
FALLBACK = 'fallback'                     # computed, but with a substituted interpolator
INSUFFICIENT = 'insufficient_coverage'    # curve does not span the requested window
NOT_APPLICABLE = 'not_applicable'         # protocol variant undefined for this curve (e.g. subset on <5 points)
INVALID = 'invalid_curve'                 # non-finite / non-positive rates, < 2 points, ...
NO_OVERLAP = 'no_overlap'
VALID_STATUSES = (OK,)


@dataclass(frozen=True)
class Prepared:
    log_rate: np.ndarray          # sorted by quality
    q: np.ndarray
    n_points: int                 # after envelope + subset
    n_envelope: int               # after envelope, before subset
    status: str
    note: str = ''

    @property
    def qmin(self) -> float:
        return float(self.q[0])

    @property
    def qmax(self) -> float:
        return float(self.q[-1])


@dataclass(frozen=True)
class Level:
    value: float | None
    window: tuple[float, float] | None
    status: str
    interpolator_requested: str
    interpolator_used: str | None
    n_points: int
    note: str = ''

    @property
    def ok(self) -> bool:
        return self.status == OK


@dataclass(frozen=True)
class BDResult:
    value_percent: float | None
    requested_window: tuple[float, float] | None
    effective_window: tuple[float, float] | None
    status: str
    window_policy: str
    interpolator_requested: str
    interpolator_used: tuple[str | None, str | None]
    n_anchor_points: int
    n_test_points: int
    note: str = ''

    @property
    def ok(self) -> bool:
        return self.status == OK

    def as_float(self) -> float:
        return float('nan') if self.value_percent is None else float(self.value_percent)


def upper_envelope(bpp, q):
    """Rate-distortion upper envelope: sort by rate and keep points whose quality strictly increases.
    Dominated points (higher rate, no higher quality) are removed; the removal is recorded by the caller."""
    pts = sorted(zip(map(float, bpp), map(float, q)))
    out = []
    for x, y in pts:
        if not out or y > out[-1][1] + 1e-9:
            out.append((x, y))
    return [p[0] for p in out], [p[1] for p in out]


def prepare(bpp, q, subset: str = 'all', envelope: bool = True) -> Prepared:
    """Validate a released curve, apply the upper envelope and a point-subset rule.
    subset: 'all' | 'drop_low' (remove the lowest-rate point) | 'drop_high' (remove the highest-rate point)."""
    try:
        b = [float(x) for x in bpp]; v = [float(x) for x in q]
    except (TypeError, ValueError):
        return Prepared(np.array([]), np.array([]), 0, 0, INVALID, 'non-numeric values')
    if len(b) != len(v) or len(b) < 2:
        return Prepared(np.array([]), np.array([]), 0, 0, INVALID, 'fewer than two points or length mismatch')
    if not all(math.isfinite(x) and x > 0 for x in b) or not all(math.isfinite(y) for y in v):
        return Prepared(np.array([]), np.array([]), 0, 0, INVALID, 'non-finite quality or non-positive rate')
    if envelope:
        b, v = upper_envelope(b, v)
    n_env = len(b)
    if n_env < 2:
        return Prepared(np.array([]), np.array([]), 0, n_env, INVALID, 'fewer than two envelope points')
    if subset != 'all':
        if n_env < MIN_POINTS_SUBSET:
            return Prepared(np.array([]), np.array([]), 0, n_env, NOT_APPLICABLE, f'subset needs >= {MIN_POINTS_SUBSET} points')
        if subset == 'drop_low':
            b, v = b[1:], v[1:]
        elif subset == 'drop_high':
            b, v = b[:-1], v[:-1]
        else:
            raise ValueError(subset)
    order = np.argsort(v)
    qa = np.asarray(v, float)[order]; la = np.log10(np.asarray(b, float))[order]
    keep = np.concatenate([[True], np.diff(qa) > 1e-12])
    return Prepared(la[keep], qa[keep], int(keep.sum()), n_env, OK)


def _interpolant(p: Prepared, method: str):
    """Return (callable, interpolator_used, note)."""
    x, y = p.q, p.log_rate
    if method == 'pchip':
        return PchipInterpolator(x, y, extrapolate=False), 'pchip', ''
    if method == 'akima':
        if len(x) < MIN_POINTS_AKIMA:
            return PchipInterpolator(x, y, extrapolate=False), 'pchip', f'akima needs >= {MIN_POINTS_AKIMA} points'
        return Akima1DInterpolator(x, y, extrapolate=False), 'akima', ''
    if method == 'cubic':
        deg = min(3, len(x) - 1)
        return np.poly1d(np.polyfit(x, y, deg)), 'cubic', ('' if deg == 3 else f'polynomial degree reduced to {deg}')
    if method == 'linear':
        return (lambda xx: np.interp(xx, x, y)), 'linear', ''
    raise ValueError(method)


def _window_mean(f, lo: float, hi: float) -> float:
    xx = np.linspace(lo, hi, N_GRID)
    return float(np.trapezoid(f(xx), xx) / (hi - lo))


def covers(p: Prepared, window) -> bool:
    return p.status == OK and p.qmin <= window[0] + TOL_DB and p.qmax >= window[1] - TOL_DB


def level(bpp, q, window, method: str = 'pchip', subset: str = 'all') -> Level:
    """Strict log-rate level D_W on exactly the requested window."""
    p = prepare(bpp, q, subset)
    if p.status != OK:
        return Level(None, None, p.status, method, None, p.n_points, p.note)
    if not covers(p, window):
        return Level(None, None, INSUFFICIENT, method, None, p.n_points,
                     f'curve spans [{p.qmin:.3f}, {p.qmax:.3f}] dB, window [{window[0]:.3f}, {window[1]:.3f}] dB')
    f, used, note = _interpolant(p, method)
    lo, hi = max(window[0], p.qmin), min(window[1], p.qmax)   # differs from the window by <= TOL_DB
    val = _window_mean(f, lo, hi)
    if not math.isfinite(val):
        return Level(None, None, INVALID, method, used, p.n_points, 'non-finite interpolant on window')
    status = OK if used == method else FALLBACK
    return Level(val, (float(window[0]), float(window[1])), status, method, used, p.n_points, note)


def pct(d_log: float) -> float:
    """Percentage rate change for a difference of log-rate levels."""
    return (10.0 ** d_log - 1.0) * 100.0


def bd_rate_checked(anchor_bpp, anchor_q, test_bpp, test_q, *, interpolation: str = 'pchip', window=None,
                    window_policy: str = 'strict', subset_anchor: str = 'all', subset_test: str = 'all') -> BDResult:
    """BD-rate (%) of test against anchor with an explicit window policy (see module docstring)."""
    pa = prepare(anchor_bpp, anchor_q, subset_anchor); pt = prepare(test_bpp, test_q, subset_test)
    for p in (pa, pt):
        if p.status != OK:
            return BDResult(None, window, None, p.status, window_policy, interpolation, (None, None), pa.n_points, pt.n_points, p.note)
    if window_policy == 'strict':
        if window is None:
            raise ValueError('strict window policy requires an explicit window')
        lo, hi = float(window[0]), float(window[1])
        if not (covers(pa, (lo, hi)) and covers(pt, (lo, hi))):
            return BDResult(None, (lo, hi), None, INSUFFICIENT, window_policy, interpolation, (None, None), pa.n_points, pt.n_points,
                            f'anchor [{pa.qmin:.3f}, {pa.qmax:.3f}], test [{pt.qmin:.3f}, {pt.qmax:.3f}] dB')
        lo_e, hi_e = max(lo, pa.qmin, pt.qmin), min(hi, pa.qmax, pt.qmax)
        eff = (lo, hi)
    elif window_policy == 'common_overlap':
        if window is not None:
            raise ValueError('common_overlap uses the pair\'s own overlap; do not pass a window')
        lo_e, hi_e = max(pa.qmin, pt.qmin), min(pa.qmax, pt.qmax)
        if not hi_e - lo_e > 1e-6:
            return BDResult(None, None, None, NO_OVERLAP, window_policy, interpolation, (None, None), pa.n_points, pt.n_points)
        eff = (lo_e, hi_e)
    else:
        raise ValueError(window_policy)
    fa, ua, na = _interpolant(pa, interpolation); ft, ut, nt = _interpolant(pt, interpolation)
    d = _window_mean(ft, lo_e, hi_e) - _window_mean(fa, lo_e, hi_e)
    if not math.isfinite(d):
        return BDResult(None, window, eff, INVALID, window_policy, interpolation, (ua, ut), pa.n_points, pt.n_points, 'non-finite interpolant')
    status = OK if (ua == interpolation and ut == interpolation) else FALLBACK
    return BDResult(pct(d), None if window is None else (float(window[0]), float(window[1])), (float(eff[0]), float(eff[1])),
                    status, window_policy, interpolation, (ua, ut), pa.n_points, pt.n_points, '; '.join(x for x in (na, nt) if x))


def direct_from_scores(s_a: float, s_b: float) -> float:
    """Direct BD-rate (%) of b relative to a from two scores against one common reference on one shared window."""
    return ((1 + s_b / 100.0) / (1 + s_a / 100.0) - 1.0) * 100.0


def rate_ratio_profile(anchor_bpp, anchor_q, test_bpp, test_q, qgrid, method: str = 'pchip'):
    """Local rate difference (%) at each quality in qgrid (nan outside the pair's common range)."""
    pa = prepare(anchor_bpp, anchor_q); pt = prepare(test_bpp, test_q)
    fa, _, _ = _interpolant(pa, method); ft, _, _ = _interpolant(pt, method)
    qgrid = np.asarray(qgrid, float)
    ok = (qgrid >= max(pa.qmin, pt.qmin)) & (qgrid <= min(pa.qmax, pt.qmax))
    out = np.full(qgrid.shape, np.nan)
    out[ok] = (10 ** (ft(qgrid[ok]) - fa(qgrid[ok])) - 1) * 100
    return out
