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
OUT = sys.argv[2] if len(sys.argv) > 2 else 'src/glyphs/cha.json'
N = 1024
FONT = sorted(glob.glob('/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc'))[0]

f = ImageFont.truetype(FONT, 820)
im = Image.new('L', (N, N), 0)
d = ImageDraw.Draw(im)
bb = d.textbbox((0, 0), CHAR, font=f)
d.text(((N - (bb[2] - bb[0])) / 2 - bb[0], (N - (bb[3] - bb[1])) / 2 - bb[1]),
       CHAR, font=f, fill=255)
mask = np.asarray(im) > 127
ys, xs = np.where(mask)
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
apex_x = rx[ry == apex_y].mean()
eaves_y = ry.max()                               # where the roof's arms end
by = np.where(body)[0]
base_y = by.max()
half = (rx.max() - rx.min()) / 2                 # sides at the roof's own span,
                                                 # so 撇 and 捺 both fall inside
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
lid_d = ndimage.binary_dilation(lid, iterations=int(0.02 * em))
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
        cx, cy = (xs.min() + xs.max()) / 2, (ys.min() + ys.max()) / 2
        out.append([[(x - cx) / em, (cy - y) / em] for x, y in keep])
    out.sort(key=lambda p: -_area(p))
    # drop specks: marching squares finds a few 3-4 point contours around the
    # dilation's stair-steps, and they are not holes anyone meant
    biggest = _area(out[0]) if out else 0
    return [c for c in out if _area(c) > biggest * 0.01 and len(c) >= 6]

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

# relief: the true strokes, softened, as a height field over the body's bbox
relief = ndimage.gaussian_filter(mask.astype(float), sigma=em * 0.012)
relief = np.clip((relief - 0.35) / 0.5, 0, 1)
R = 160
bx0, bx1 = np.where(body_d)[1].min(), np.where(body_d)[1].max()
by0, by1 = np.where(body_d)[0].min(), np.where(body_d)[0].max()
grid = np.array(Image.fromarray((relief * 255).astype(np.uint8)).resize((R, R), Image.BILINEAR))

cx, cy = (xs.min() + xs.max()) / 2, (ys.min() + ys.max()) / 2
data = {
    'char': CHAR,
    'em': int(em),
    'grow': round(grow / em, 4),
    'mouthW': round(MOUTH_W / em, 4),
    'apexX': round((apex_x - (xs.min()+xs.max())/2) / em, 4),
    'seamY': round((cy - seam) / em, 4),
    'body': outlines(body_d),
    'lid': outlines(lid_d),
    'relief': {
        'size': R,
        'x0': round((0 - cx) / em, 4), 'x1': round((N - cx) / em, 4),
        'y0': round((cy - N) / em, 4), 'y1': round((cy - 0) / em, 4),
        'data': base64.b64encode(grid.tobytes()).decode(),
    },
}
json.dump(data, open(OUT, 'w'), ensure_ascii=False)
print(f'{CHAR}: grow {data["grow"]:.3f} em, seam y {data["seamY"]:.3f}, '
      f'body {len(data["body"])} contour(s) {[len(c) for c in data["body"]]}, '
      f'lid {len(data["lid"])} {[len(c) for c in data["lid"]]}')
