"""Shape descriptors that say what a silhouette *is*, not how much it overlaps.

IoU and even profile RMS can be satisfied by a body of the wrong character.
These are the terms a potter would use about a 石瓢: is the widest point at the
foot, is the flank straight, does it bulge or hollow?

usage: ... shape_audit.py --views v.json --view 0 [--render r.png]
"""
import argparse, json, sys
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import photo_mask, render_mask, register, profile_curve


def descriptors(m, label, lo=0.55, hi=0.88):
    """lo..hi is the body band: below the lid overhang, above the feet."""
    p, top, bot = profile_curve(m, nrows=100)
    frac = (np.arange(100) + 0.5) / 100
    band = (frac >= lo) & (frac <= hi) & ~np.isnan(p)
    y, r = frac[band], p[band]
    if len(r) < 10:
        return None
    rmax = r.max()
    widest = y[int(np.argmax(r))]
    # chord between the band's endpoints; the sagitta against it says whether
    # the flank bulges out (convex, +) or hollows in (concave, -). A least
    # squares fit cannot: its residuals are zero-mean by construction.
    chord = np.interp(y, [y[0], y[-1]], [r[0], r[-1]])
    resid = r - chord
    sagitta = resid[len(resid) // 4: 3 * len(resid) // 4].mean() / rmax
    straight = np.abs(resid).max() / rmax
    taper = r[0] / r[-1]        # top of band vs bottom of band
    print(f'{label:26s} widest {widest*100:3.0f}% down   flank {sagitta*100:+5.2f}% '
          f'({"convex" if sagitta > 0.004 else "concave" if sagitta < -0.004 else "straight"})'
          f'   max dev {straight*100:4.2f}%   top/bottom {taper:.3f}')
    return dict(widest=widest, sagitta=sagitta, taper=taper)


def body_band(m, lo=0.38, hi=0.88):
    p, _, _ = profile_curve(m, 100)
    idx = np.arange(int(lo * 100), int(hi * 100))
    return idx[~np.isnan(p[idx])], p


def audit(render_png, pm, label):
    """Compare a render to the reference on terms a potter would recognise."""
    R, *_ = register(render_mask(render_png), pm)
    idx, C = body_band(R)
    jdx, P = body_band(pm)
    ok = np.intersect1d(idx, jdx)
    err = np.sqrt(np.mean((C[ok] - P[ok]) ** 2)) / P[ok].max()
    widens = float(np.mean(np.diff(C[ok]) >= -0.5))       # widening toward the foot
    widest = ok[int(np.argmax(C[ok]))] / 100
    p_widest = ok[int(np.argmax(P[ok]))] / 100
    # Photo agreement only. Family identity is check-canon.mjs's job — a rule
    # like "widens toward the foot" belongs to 石瓢, not to every pot.
    checks = [
        ('body profile within 2.5%', err <= 0.025, f'{err*100:.2f}%'),
        ('widest point within 8% of reference', abs(widest - p_widest) <= 0.08,
         f'{widest*100:.0f}% vs {p_widest*100:.0f}% down'),
    ]
    if a.expect_widening:
        checks.insert(1, ('widens toward the foot', widens >= 0.80, f'{widens*100:.0f}% of rows'))
    print(f'--- {label}')
    for name, passed, detail in checks:
        print(f'  {"PASS" if passed else "FAIL"}  {name:38s} {detail}')
    return all(c[1] for c in checks)


ap = argparse.ArgumentParser()
ap.add_argument('--views', required=True); ap.add_argument('--view', type=int, default=0)
ap.add_argument('--render', action='append', default=[])
ap.add_argument('--descriptors', action='store_true')
ap.add_argument('--expect-widening', action='store_true', help='石瓢-style: body must widen toward the foot')
a = ap.parse_args()
v = json.load(open(a.views))['views'][a.view]
pm = photo_mask(v)
if a.descriptors:
    descriptors(pm, 'PHOTO')
allok = True
for r in a.render:
    if a.descriptors:
        R, *_ = register(render_mask(r), pm)
        descriptors(R, Path(r).stem)
    allok &= audit(r, pm, Path(r).stem)
sys.exit(0 if allok else 1)
