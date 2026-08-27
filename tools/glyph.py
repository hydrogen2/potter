"""Turn a Chinese character into vessel geometry data.

A glyph is not a solid: a font draws 茶 as five separate strokes that never
touch, so extruding the outline gives five floating slabs. The body is therefore
the *fattened envelope* of the strokes — dilated just far enough to become one
connected piece — while the true strokes are kept separately and become relief
on the faces, so the character reads crisply even though the silhouette is bold.

  uv run --with pillow --with numpy --with scipy python tools/glyph.py 茶 src/glyphs/cha.json
"""
import base64, json, sys, glob
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

CHAR = sys.argv[1] if len(sys.argv) > 1 else '茶'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'src/glyphs/cha.js'
N = 1024
# Sans, not serif. 茶 is a symmetric character and a serif face fights that: its
# 艹 carries a flared right end the left does not have, and 捺 is nothing like a
# mirrored 撇. Measured against its own best mirror axis, the serif glyph is 22.8%
# asymmetric and the sans one 5.2%.
FONT = sorted(glob.glob('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'))[0]
# The relief may use a different face from the contours. The contour wants the
# plainest, most symmetric letterform; the bulges want calligraphic life, and
# 捺 and 撇 are a *pair* rather than mirror images — flattening that costs them.
RELIEF_FONT = sorted(glob.glob('/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc'))[0]

def draw(path, size=820):
    f = ImageFont.truetype(path, size)
    im = Image.new('L', (N, N), 0)
    d = ImageDraw.Draw(im)
    bb = d.textbbox((0, 0), CHAR, font=f)
    d.text(((N - (bb[2] - bb[0])) / 2 - bb[0], (N - (bb[3] - bb[1])) / 2 - bb[1]),
           CHAR, font=f, fill=255)
    return np.asarray(im) > 127

mask = draw(FONT)

def find_axis(m):
    """The glyph's own vertical axis.

    The axis is searched for rather than assumed to be the bounding box centre,
    but constrained near it and required to compare a real half — an
    unconstrained search happily returns an axis at the very edge, where only a
    sliver overlaps and the mismatch is trivially near zero.
    """
    ys, xs = np.where(m)
    x0, x1 = xs.min(), xs.max()
    c = (x0 + x1) // 2
    best = (1e9, c)
    for ax in range(c - int(0.10 * (x1 - x0)), c + int(0.10 * (x1 - x0)) + 1):
        L = min(ax - x0, x1 - ax)
        if L < 0.40 * (x1 - x0):
            continue
        a = m[:, ax - L:ax]
        b = m[:, ax + 1:ax + 1 + L][:, ::-1]
        w = min(a.shape[1], b.shape[1])
        mm = np.logical_xor(a[:, -w:], b[:, -w:]).sum() / max(m.sum(), 1)
        if mm < best[0]:
            best = (mm, ax)
    mism, ax = best
    print(f'  axis x={ax}; glyph is {mism*100:.1f}% asymmetric about it')
    return ax

def mirror_about(m, ax):
    """Mirror the left half onto the right. Used for the *contours* only."""
    ys, xs = np.where(m)
    L = min(ax - xs.min(), xs.max() - ax)
    half = m[:, ax - L:ax]
    out = np.zeros_like(m)
    out[:, ax - L:ax] = half
    out[:, ax + 1:ax + 1 + half.shape[1]] = half[:, ::-1]
    out[:, ax] = m[:, ax]
    return out

# The *contour* must be symmetric — it is the pot's silhouette, and 茶 is a
# symmetric character. The *relief* need not be: 捺 and 撇 are a calligraphic
# pair, not mirror images, and flattening that costs the strokes their life.
# So the axis is measured, the outlines are built symmetric about it, and the
# relief keeps the glyph exactly as drawn.
AXIS = find_axis(mask)
CY0 = None   # set once the glyph's vertical extent is known
def align_to(src, ref):
    """Warp one face's glyph onto another's box.

    Two faces do not share metrics: the serif 茶 is wider than the sans one, so
    dropped in as-is its 捺 runs off the roof and its 艹 sits away from the lid's
    outline. Scale the relief glyph so its bounding box matches the contour
    glyph's, and it lands where the contour says it should.
    """
    sy, sx = np.where(src); ry, rx = np.where(ref)
    crop = Image.fromarray((src * 255).astype(np.uint8)).crop(
        (sx.min(), sy.min(), sx.max() + 1, sy.max() + 1))
    w, h = rx.max() - rx.min() + 1, ry.max() - ry.min() + 1
    out = Image.new('L', (N, N), 0)
    out.paste(crop.resize((w, h), Image.LANCZOS), (rx.min(), ry.min()))
    return np.asarray(out) > 127

relief_src = align_to(draw(RELIEF_FONT), mask)
ys, xs = np.where(mask)
CY0 = (ys.min() + ys.max()) / 2
em = ys.max() - ys.min()

# the lid is the topmost connected piece — 艹 for 茶
lbl, n = ndimage.label(mask)
top = sorted((np.where(lbl == i + 1)[0].min(), i + 1) for i in range(n))[0][1]
lid = lbl == top
seam = np.where(lid)[0].max() + 6
body = mask.copy(); body[:seam, :] = False

# The body is NOT the strokes' envelope. Following the 撇 and 捺 diagonals gives
# a spidery silhouette that reads as top-heavy — it looks like it would topple,
# and a teapot must not. 茶's 𠆢 is literally a roof, so the body is the house it
# implies: flat base, upright sides, a pitched roof on the 𠆢's own slope, and a
# rectangular mouth cut out of the peak. The strokes then live entirely in the
# relief, where they are legible without having to hold the pot up.
# Measure the roof on the *uncut* glyph. Cutting at the seam first slices the
# inverted V in two, and the topmost piece is then one arm, which gives a house
# far too narrow to hold the character.
order = sorted((np.where(lbl == i + 1)[0].min(), i + 1) for i in range(n))
roof = lbl == order[1][1]                        # 艹 is order[0]; 𠆢 is next
ry, rx = np.where(roof)
apex_y = ry.min()
apex_x = float(AXIS)
eaves_y = ry.max()                               # where the roof's arms end
by = np.where(body)[0]
base_y = by.max()
half = max(AXIS - rx.min(), rx.max() - AXIS)      # symmetric about the axis by
                                                 # construction, not by luck
cx0, cx1 = apex_x - half, apex_x + half

MOUTH_W = 0.32 * em                              # a little wider than 艹's verticals
MOUTH_D = 0.10 * em
mx0, mx1 = apex_x - MOUTH_W / 2, apex_x + MOUTH_W / 2
# where the roof's slope stands at the mouth's edges
def roof_y(x):
    t = abs(x - apex_x) / max(half, 1e-6)
    return apex_y + t * (eaves_y - apex_y)
house = [
    (cx0, base_y), (cx0, eaves_y),
    (mx0, roof_y(mx0)), (mx0, roof_y(mx0) - MOUTH_D),
    (mx1, roof_y(mx1) - MOUTH_D), (mx1, roof_y(mx1)),
    (cx1, eaves_y), (cx1, base_y),
]
body_img = Image.new('L', (N, N), 0)
ImageDraw.Draw(body_img).polygon(house, fill=255)
body_d = np.asarray(body_img) > 127
grow = 0
lid_d = ndimage.binary_dilation(mirror_about(lid, AXIS), iterations=int(0.02 * em))
lid_d &= ~ndimage.binary_dilation(body_d, iterations=2)   # keep the seam open

def outlines(m, simplify=2.0):
    """Marching-squares contours, in em units, y up, origin at the glyph centre."""
    from skimage import measure
    cs = measure.find_contours(m.astype(float), 0.5)
    out = []
    for c in cs:
        pts = [(float(x), float(y)) for y, x in c]
        # Douglas-Peucker
        keep = _dp_closed(pts, simplify)
        out.append([[(x - AXIS) / em, (CY - y) / em] for x, y in keep])
    out.sort(key=lambda p: -_area(p))
    # drop specks: marching squares finds a few 3-4 point contours around the
    # dilation's stair-steps, and they are not holes anyone meant
    biggest = _area(out[0]) if out else 0
    return [c for c in out if _area(c) > biggest * 0.01 and len(c) >= 6]


def sym_poly(poly):
    """Make a closed polygon exactly symmetric about x = 0.

    Extracting a contour from an already-mirrored raster is not enough: the
    simplifier chooses its keep-points independently on each side, so the two
    halves end up a few pixels apart. Take the left chain and mirror it.
    """
    if not poly:
        return poly
    top = max(range(len(poly)), key=lambda i: (poly[i][1], -abs(poly[i][0])))
    n = len(poly)
    order = [poly[(top + i) % n] for i in range(n)]
    bot = min(range(n), key=lambda i: (order[i][1], abs(order[i][0])))
    a, b = order[:bot + 1], order[bot:] + [order[0]]
    left = a if sum(p[0] for p in a) < sum(p[0] for p in b) else b
    left = [[-abs(x), y] for x, y in left]
    right = [[-x, y] for x, y in reversed(left)]
    return left + right[1:-1]

def _area(p):
    a = 0.0
    for i in range(len(p)):
        x0, y0 = p[i]; x1, y1 = p[(i + 1) % len(p)]
        a += x0 * y1 - x1 * y0
    return abs(a) / 2

def _dp_closed(pts, eps):
    """Simplify a *closed* contour. Running Douglas-Peucker straight down a
    closed ring collapses it: its first and last point coincide, so the chord
    between them has no length and every point measures zero distance from it.
    Split the ring at its two most distant points and simplify each arc."""
    if len(pts) > 2 and abs(pts[0][0]-pts[-1][0]) < 1e-9 and abs(pts[0][1]-pts[-1][1]) < 1e-9:
        pts = pts[:-1]
    if len(pts) < 4: return pts
    x0, y0 = pts[0]
    far = max(range(len(pts)), key=lambda i: (pts[i][0]-x0)**2 + (pts[i][1]-y0)**2)
    a = _dp(pts[:far+1], eps)
    b = _dp(pts[far:] + [pts[0]], eps)
    return a[:-1] + b[:-1]

def _dp(pts, eps):
    if len(pts) < 3: return pts
    def rec(a, b):
        if b <= a + 1: return []
        x0, y0 = pts[a]; x1, y1 = pts[b]
        dx, dy = x1 - x0, y1 - y0
        L = (dx * dx + dy * dy) ** 0.5 or 1e-9
        worst, wi = 0.0, a
        for i in range(a + 1, b):
            x, y = pts[i]
            dist = abs(dy * x - dx * y + x1 * y0 - y1 * x0) / L
            if dist > worst: worst, wi = dist, i
        if worst <= eps: return []
        return rec(a, wi) + [wi] + rec(wi, b)
    idx = [0] + rec(0, len(pts) - 1) + [len(pts) - 1]
    return [pts[i] for i in idx]

# Line relief for the strokes that are *not* the silhouette. 艹 is the lid and
# 𠆢 is the pot's own shoulder, so only 木 and its two diagonals get drawn — and
# drawn as lines, skeletons of the strokes rather than the font's filled shapes,
# because what belongs on a pot is a drawn character, not a typeset one.
from skimage.morphology import skeletonize
lbl_r, n_r = ndimage.label(relief_src)
by_top = sorted((np.where(lbl_r == i + 1)[0].min(), i + 1) for i in range(n_r))
mu = np.zeros_like(relief_src)
for _, i in by_top[2:]:                       # skip 艹 and 𠆢
    mu |= (lbl_r == i)
skel = skeletonize(mu)
LINE = max(1, int(round(0.013 * em)))         # the drawn line's half-width
lines_m = ndimage.binary_dilation(skel, iterations=LINE)
lines = ndimage.gaussian_filter(lines_m.astype(float), sigma=em * 0.006)
lines = np.clip(lines / max(lines.max(), 1e-6), 0, 1)
ly, lx = np.where(lines_m)
LBB = [round((lx.min() - AXIS) / em, 4), round((lx.max() - AXIS) / em, 4),
       round((CY0 - ly.max()) / em, 4), round((CY0 - ly.min()) / em, 4)]
LR = 200
lhalf = max(AXIS - 0, N - AXIS)
lpad = np.zeros((N, 2 * lhalf), float)
ls0, ls1 = max(0, AXIS - lhalf), min(N, AXIS + lhalf)
lpad[:, ls0 - (AXIS - lhalf):ls1 - (AXIS - lhalf)] = lines[:, ls0:ls1]
lgrid = np.array(Image.fromarray((lpad * 255).astype(np.uint8)).resize((LR, LR), Image.BILINEAR))

# relief: the true strokes, softened, as a height field over the body's bbox
relief = ndimage.gaussian_filter(relief_src.astype(float), sigma=em * 0.012)
relief = np.clip((relief - 0.35) / 0.5, 0, 1)
# The relief window must be centred on the glyph's own axis, not on the image.
# Exported over the whole 1024 frame it sits three pixels off centre, and the
# relief then reads very slightly off-axis on a pot whose whole point is symmetry.
R = 160
cx, cy = float(AXIS), (ys.min() + ys.max()) / 2
halfw = max(AXIS - 0, N - AXIS)
wx0, wx1 = int(cx - halfw), int(cx + halfw)
pad = np.zeros((N, wx1 - wx0), float)
src0, src1 = max(0, wx0), min(N, wx1)
pad[:, src0 - wx0:src1 - wx0] = relief[:, src0:src1]
grid = np.array(Image.fromarray((pad * 255).astype(np.uint8)).resize((R, R), Image.BILINEAR))
# The character revolved: the radius at each height is the distance from the axis
# to the outermost stroke. Taken literally this is a wasp-waisted double cone —
# at 木's vertical there is nothing off-axis at all — so a pot built from it
# treats this as a *deviation* from a plain cone rather than as the profile
# itself. Relief 0 is the cone; relief 1 is this.
rev = []
for y in range(ys.min(), ys.max() + 1):
    x = np.where(relief_src[y])[0]
    r = 0.0 if len(x) == 0 else max(abs(x.min() - AXIS), abs(x.max() - AXIS)) / em
    rev.append(round(r, 4))
# smooth it: a revolved stroke edge is a step, and a pot wants a swelling
rev = ndimage.uniform_filter1d(np.array(rev), size=max(3, int(0.03 * em))).tolist()
STEP = max(1, len(rev) // 220)
CY = (ys.min() + ys.max()) / 2
data = {
    'char': CHAR,
    'em': int(em),
    'grow': round(grow / em, 4),
    'mouthW': round(MOUTH_W / em, 4),
    'apexX': round((apex_x - (xs.min()+xs.max())/2) / em, 4),
    'seamY': round((cy - seam) / em, 4),
    # the house is already an exact polygon; sending it through a raster and a
    # contour tracer would only add discretisation error to a symmetric shape
    'body': [[[round((x - AXIS) / em, 5), round((CY - y) / em, 5)] for x, y in house]],
    # The lid raster is already exactly mirrored, so its contour is symmetric to
    # within the tracer's own step. Splitting the polygon to force symmetry does
    # not work here — 艹 has a wide flat top with no vertex on the axis, so there
    # is no natural pair of half-chains — and simplifying hard breaks it, because
    # the simplifier chooses its keep-points independently on each side. Trace it
    # closely instead and let the residual be sub-pixel.
    'lid': outlines(lid_d, simplify=0.6),
    # the character's own extent, so a relief window can be filled by the glyph
    # rather than by the empty margin the frame happens to carry
    'bbox': [round((xs.min() - AXIS) / em, 4), round((xs.max() - AXIS) / em, 4),
             round((CY - ys.max()) / em, 4), round((CY - ys.min()) / em, 4)],
    'revolve': [round(v, 4) for v in rev[::STEP]],
    'lines': {
        'size': LR, 'bbox': LBB,
        'x0': round((AXIS - lhalf - AXIS) / em, 4), 'x1': round((AXIS + lhalf - AXIS) / em, 4),
        'y0': round((CY0 - N) / em, 4), 'y1': round((CY0 - 0) / em, 4),
        'data': base64.b64encode(lgrid.tobytes()).decode(),
    },
    'relief': {
        'size': R,
        'x0': round((wx0 - cx) / em, 4), 'x1': round((wx1 - cx) / em, 4),
        'y0': round((cy - N) / em, 4), 'y1': round((cy - 0) / em, 4),
        'data': base64.b64encode(grid.tobytes()).decode(),
    },
}
# Emitted as a JS module rather than JSON: a component importing .json needs an
# import attribute under plain node, which the check scripts run without, while
# Vite does not require one. A module works in both.
body = json.dumps(data, ensure_ascii=False)
open(OUT, 'w').write(
    '// Generated by tools/glyph.py — do not edit by hand.\n'
    f'export default {body}\n')
print(f'{CHAR}: grow {data["grow"]:.3f} em, seam y {data["seamY"]:.3f}, '
      f'body {len(data["body"])} contour(s) {[len(c) for c in data["body"]]}, '
      f'lid {len(data["lid"])} {[len(c) for c in data["lid"]]}')
