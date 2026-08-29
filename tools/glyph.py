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
# The relief face. Sans, like the contour: the strokes are drawn as *lines* —
# skeletons — and a serif face's flares and swells are exactly the information a
# skeleton throws away, so all they add is an uneven line width.
RELIEF_FONT = sorted(glob.glob('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'))[0]

def draw_char(ch, path, size=820):
    f = ImageFont.truetype(path, size)
    im = Image.new('L', (N, N), 0)
    d = ImageDraw.Draw(im)
    bb = d.textbbox((0, 0), ch, font=f)
    d.text(((N - (bb[2] - bb[0])) / 2 - bb[0], (N - (bb[3] - bb[1])) / 2 - bb[1]),
           ch, font=f, fill=255)
    return np.asarray(im) > 127


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
    ASYM.append(mism)
    return ax

ASYM = []

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

def encode(mask, size=200, sigma=0.006):
    """A stroke mask as a base64 height field, softened, with the window centred
    on the glyph's own axis and the strokes' own bounding box alongside it."""
    # A boolean figure is a figure at one height. A float one carries relief
    # *and* colour strength per pixel, since both are read from the same value —
    # so bark drawn at a lower value comes out shallower and lighter, which is
    # what bark is.
    m = mask.astype(float)
    if m.max() > 1.0:
        m = m / 255.0
    # sigma is a parameter because a figure of strokes and a figure of texture
    # want different things from it: 0.006 em softens a drawn line nicely and
    # erases anything finer than about 0.018, which is most of a painted tree.
    soft = ndimage.gaussian_filter(m, sigma=em * sigma)
    soft = np.clip(soft / max(soft.max(), 1e-6), 0, 1)
    yy, xx = np.where(m > 0.15)
    hw = max(AXIS - 0, N - AXIS)
    pad = np.zeros((N, 2 * hw), float)
    s0, s1 = max(0, AXIS - hw), min(N, AXIS + hw)
    pad[:, s0 - (AXIS - hw):s1 - (AXIS - hw)] = soft[:, s0:s1]
    g = np.array(Image.fromarray((pad * 255).astype(np.uint8)).resize((size, size), Image.BILINEAR))
    return {
        'size': size,
        'bbox': [round(float(xx.min() - AXIS) / em, 4), round(float(xx.max() - AXIS) / em, 4),
                 round(float(CY0 - yy.max()) / em, 4), round(float(CY0 - yy.min()) / em, 4)],
        'x0': round(float(-hw) / em, 4), 'x1': round(float(hw) / em, 4),
        'y0': round(float(CY0 - N) / em, 4), 'y1': round(float(CY0) / em, 4),
        'data': base64.b64encode(g.tobytes()).decode(),
    }

# ---- per-character readings ------------------------------------------------
#
# The pipeline up to here is shared: render, find the axis, measure the em. What
# a character *means* as a vessel is not, and pretending otherwise is what made
# this file a 茶 pipeline wearing a general name. 茶 is a house — a roof over a
# trunk — and its silhouette had to be built, because the strokes' own envelope
# is a spidery thing that reads as about to topple. 壺 needs none of that: it is
# already a pot drawn in elevation, and its own rows say so.

def read_hu():
    """壺 — a lidded jar, read straight off the character.

    Measured per row, outermost ink from the axis (y down from the glyph's top):

        0.000-0.090  r 0.040   竖         the peg
        0.092-0.160  r 0.490   长横       the brim      | 士: the whole lid
        0.161-0.247  r 0.040   竖         the stem      |
        0.249-0.316  r 0.410   短横       the 子口      |
        0.317-0.389    ——                 the lid seam — no ink at all
        0.391-0.568  r 0.480   冖         shoulder, and the wall's top
        0.570-0.929  r <=0.370 亞         inside the outline: relief
        0.930-1.000  r 0.510   一         the foot, widest in the character

    So the character hands over the mouth's radius (its own 子口, 0.410), the
    wall's top and bottom, and a lid drawn in full. What it does not draw is the
    wall between 冖's turned-down ends and the foot bar — that stretch is empty —
    so the one thing built here is the line joining them, which is completing two
    strokes the character already started rather than inventing a shape.
    """
    rows = []
    for y in range(ys.min(), ys.max() + 1):
        x = np.where(mask[y])[0]
        rows.append(0.0 if len(x) == 0 else
                    max(abs(x.min() - AXIS), abs(x.max() - AXIS)) / em)
    rows = np.array(rows)
    runs, prev, start = [], None, 0
    for i, r in enumerate(rows):
        k = round(float(r), 2)
        if prev is None:
            prev, start = k, i
        elif k != prev:
            if i - start >= 3:
                runs.append((start / em, (i - 1) / em, prev))
            prev, start = k, i
    if len(rows) - start >= 3:
        runs.append((start / em, (len(rows) - 1) / em, prev))

    def band(i):
        return runs[i]

    peg, brim, stem, kou, seam, shoulder = (band(i) for i in range(6))
    foot = runs[-1]
    wall_top = shoulder[1]                      # 冖's ends stop here
    foot_top = foot[0]

    def up(v):                                  # glyph row -> y, up, centred
        return round(float(CY0 - ys.min()) / em - v, 5)

    # 冖's bar is the full-width run at the top of its band; everything below it
    # in that band is the two ends turning down, which belong to the wall and not
    # to the flange. Reading the whole band as the flange makes it two and a half
    # times as deep as every other slab in the character.
    top_i = ys.min() + int(shoulder[0] * em)
    span = 2 * shoulder[2] * em
    bar_bot = shoulder[1]
    for yy in range(top_i, ys.min() + int(shoulder[1] * em)):
        if mask[yy].sum() < 0.55 * span:
            bar_bot = (yy - ys.min()) / em
            break

    # 工. The wall between 冖's ends and the foot bar is not empty after all —
    # 亞 is in it, and 亞 is narrower than either bar. So the middle's width is
    # given by the character rather than invented: the pot flanges out top and
    # bottom and draws in at the waist, which is what 工 is.
    lo_i = int((shoulder[1] + 0.004) * em)
    hi_i = int((foot_top - 0.004) * em)
    R_YA = float(rows[lo_i:hi_i].max())
    R_SH, R_FT = shoulder[2], foot[2]
    R_MOUTH = kou[2]
    # 工 has three horizontal steps, and each is two points at the same height.
    # A profile sorted by height cannot order a tie, and getting one backwards
    # sends the wall in before it goes out — the silhouette zigzags. Half a
    # thousandth of an em separates them: invisible, and it fixes the order.
    E = 5e-4
    yFoot, yBar, yTop = up(foot_top), up(bar_bot), up(shoulder[0])
    house = [
        (-R_FT, up(1.0)), (-R_FT, yFoot),
        (-R_YA, yFoot + E), (-R_YA, yBar),
        (-R_SH, yBar + E), (-R_SH, yTop),
        (-R_MOUTH, yTop + E),
        (R_MOUTH, yTop + E),
        (R_SH, yTop), (R_SH, yBar + E),
        (R_YA, yBar), (R_YA, yFoot + E),
        (R_FT, yFoot), (R_FT, up(1.0)),
    ]
    # 冖's two ends run down the *same rows* as 亞's top verticals, so cutting by
    # row to be rid of them takes the top of the cross with it — which is what
    # happened. Cut them by radius instead: they stand at 0.48 and every stroke
    # of 亞 is inside 0.375, so a line between the two keeps the cross whole and
    # drops the ends. The bar of 冖 itself is a full-width run, so the slice
    # starts where that run stops rather than at a guessed offset.
    inner = mask.copy()
    inner[:ys.min() + int(bar_bot * em), :] = False
    inner[ys.min() + int(foot_top * em):, :] = False
    cols = np.abs(np.arange(N) - AXIS) / em
    # just outside 亞's own reach, not halfway to 冖 — halfway cuts *through*
    # the ends and leaves a sliver of each standing at the edge of the pattern
    inner[:, cols > R_YA + 0.012] = False
    lines_m = mirror_about(inner, AXIS)

    # 业 as two trees, drawn the way a child draws one: a thick trunk, one bough
    # off it, a couple of leaves. Not mirrored, and not laid out on a grid — the
    # trunks lean differently, the boughs leave at different heights and angles,
    # the leaves are not a matched pair. Every earlier attempt was exact
    # geometry, and exact geometry is what made it read as a lattice rather than
    # as a drawing. The 一 underneath is gone: the pot's own foot is that stroke.
    by0, by1 = -0.429, 0.0396              # 亞's own extent, so they interchange
    # thick. Thin trunks with a stub and a dot read as bare saplings, not trees
    TRUNK = max(1, int(round(0.112 * em)))
    BOUGH = max(1, int(round(0.030 * em)))
    BARKW = max(1, int(round(0.013 * em)))
    BARK = 132                              # drawn under the trunk's own 255

    def em2px(x, y):
        return (AXIS + x * em, CY0 - y * em)

    def stroke(d, pts, w, v=255):
        d.line([em2px(*q) for q in pts], fill=v, width=w, joint='curve')

    def blossom(d, x, y, rp, spread, tilt, v=255):
        """梅花 — five petals round a centre. A rosette holds together at this
        size where a blade does not: it is compact, and its notches read as
        shape even when the whole flower is only a tenth of an em across. The
        petals are set to overlap, so the flower is one piece with a scalloped
        edge rather than five dots that the blur would weld into a disc anyway.
        """
        for k in range(5):
            a = tilt + k * 2 * np.pi / 5
            cx, cy = x + spread * np.cos(a), y + spread * np.sin(a)
            d.ellipse([em2px(cx - rp, cy + rp), em2px(cx + rp, cy - rp)], fill=v)
        # the eye of it, lighter, the way bark is lighter than trunk
        e = rp * 0.42
        d.ellipse([em2px(x - e, y + e), em2px(x + e, y - e)], fill=150)

    tree = Image.new('L', (N, N), 0)
    td = ImageDraw.Draw(tree)

    # The bough leaves *low* and the trunk carries on bare above it. Branching
    # near the top puts trunk, bough and leaves in one place and they merge into
    # a single knob — which is what the last pass drew: two mushrooms. A tree is
    # legible because there is clear trunk above the branch.
    #
    # left tree: near-straight, a small lean, standing to the ceiling
    stroke(td, [(-0.178, by0 + 0.004), (-0.184, -0.16), (-0.192, by1 - 0.004)], TRUNK)
    stroke(td, [(-0.186, -0.244), (-0.300, -0.170), (-0.372, -0.116)], BOUGH)
    # Leaves stand clear of the bough. Touching it, they are read as its blunt
    # end and vanish — everything on this motif is small enough that whatever
    # touches merges into one mass. A gap is what makes them leaves.
    # 梅花 set off the bough, alternately above and below it, and out toward the
    # tip. Threaded along its centreline they only thicken the twig into a
    # knobbly stick — the flower has to break the line of the branch to be seen
    # as a flower. Each still overlaps the wood, as plum does; it is the part
    # standing off to one side that reads.
    RP, SP = 0.018, 0.025

    def spray(a, b, plan):
        ax, ay = a
        bx, by = b
        dx, dy = bx - ax, by - ay
        L = np.hypot(dx, dy) or 1
        nx, ny = -dy / L, dx / L                 # unit normal to the bough
        for t, off, tilt in plan:
            cx, cy = ax + dx * t, ay + dy * t
            blossom(td, cx + nx * off, cy + ny * off, RP, SP, tilt)

    # two on this one, three on the other, and at different places along each
    # bough. Three and three at matching stations reads as one spray copied,
    # which is the last thing left making the two trees look like a pair.
    spray((-0.186, -0.244), (-0.372, -0.116),
          [(0.84, 0.052, 0.30), (1.22, -0.046, -0.55)])

    # right tree: branches lower, reaches further, leans the other way
    stroke(td, [(0.190, by0 + 0.004), (0.200, -0.18), (0.186, by1 - 0.010)], TRUNK)
    stroke(td, [(0.196, -0.292), (0.306, -0.222), (0.378, -0.172)], BOUGH)
    spray((0.196, -0.292), (0.378, -0.172),
          [(0.70, -0.050, -0.20), (0.99, 0.054, 0.45), (1.31, -0.042, -0.35)])

    # Bark. Even fissures at even spacing are a ladder, which is what the last
    # pass drew — bark is irregular, so the marks vary in length, in how far off
    # centre they sit, and in where they start. Deterministic, not random: the
    # same glyph must come out the same every time it is generated.
    rng = np.random.default_rng(7)
    for tx in (-0.185, 0.194):
        yy2 = by0 + 0.045
        while yy2 < by1 - 0.075:
            seg = float(rng.uniform(0.030, 0.075))
            dx = float(rng.choice([-0.030, -0.010, 0.012, 0.031]))
            stroke(td, [(tx + dx, yy2), (tx + dx, min(yy2 + seg, by1 - 0.075))],
                   BARKW, BARK)
            yy2 += seg * float(rng.uniform(0.45, 0.80))

    ye = np.asarray(tree).astype(float)

    return {
        'char': CHAR, 'em': int(em), 'asym': round(float(ASYM[0]), 4),
        'reading': 'hu',
        'body': [[[round(x, 5), y] for x, y in house]],
        'mouthW': round(2 * R_MOUTH, 4),
        # 士 as the lid. The two 一 are kept together rather than held apart by
        # the 竖: as a *character* the stroke passes between them, but as a pot a
        # 0.04-radius waist between two discs is a stem holding up a plate. Set
        # against each other they are one stepped lid, the wider over the
        # narrower, which is what 士 looks like at a glance anyway.
        'shi': {
            'pegR': round(peg[2], 4), 'pegH': round(peg[1] - peg[0], 4),
            'brimR': round(brim[2], 4), 'brimH': round(brim[1] - brim[0], 4),
            'stemR': round(stem[2], 4), 'stemH': round(stem[1] - stem[0], 4),
            'kouR': round(kou[2], 4), 'kouH': round(kou[1] - kou[0], 4),
            'seamH': round(seam[1] - seam[0], 4),
        },
        'wall': {'shoulderR': round(R_SH, 4), 'footR': round(R_FT, 4),
                 'waistR': round(R_YA, 4), 'barH': round(bar_bot - shoulder[0], 4),
                 'topY': up(shoulder[0]), 'wallTopY': up(wall_top),
                 'footTopY': up(foot_top), 'baseY': up(1.0)},
        'groups': {'ya': encode(lines_m), 'ye': encode(ye)},
        'bbox': [round(float(xs.min() - AXIS) / em, 4), round(float(xs.max() - AXIS) / em, 4),
                 round(float(CY0 - ys.max()) / em, 4), round(float(CY0 - ys.min()) / em, 4)],
    }

if CHAR in ('壺', '壶'):
    data = read_hu()
    body = json.dumps(data, ensure_ascii=False,
                      default=lambda o: o.item() if hasattr(o, 'item') else str(o))
    open(OUT, 'w').write(
        '// Generated by tools/glyph.py — do not edit by hand.\n'
        f'export default {body}\n')
    sh = data['shi']
    print(f"{CHAR}: asym {data['asym']*100:.2f}%, mouth {data['mouthW']:.3f} em, "
          f"士 peg r{sh['pegR']} brim r{sh['brimR']} 子口 r{sh['kouR']}, "
          f"wall {data['wall']['footR']} -> {data['wall']['shoulderR']}")
    sys.exit()

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

# The mouth is where 艹's two verticals come down. Revolved, those verticals are
# a ring, and that ring is the lid's — so the mouth's radius IS the 艹 verticals'
# distance from the axis, and the lid's ring drops straight into it. Guessing a
# narrower mouth here is what made the lid read as a lid rather than as 艹.
MOUTH_W = 2 * 0.2162 * em
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

# 艹's own proportions, so the lid is measured off the character rather than
# guessed. The crossbar is the wide run of rows; the verticals are what stands
# above and below it. Revolved, that is a disc with a ring standing through it.
cy_, cx_ = np.where(lid)
widths = np.array([lid[y].sum() for y in range(cy_.min(), cy_.max() + 1)])
wmax = widths.max()
bar_rows = np.where(widths > 0.55 * wmax)[0] + cy_.min()
bar_t, bar_b = bar_rows.min(), bar_rows.max()
bar_half = max(AXIS - cx_.min(), cx_.max() - AXIS)
vert_up = lid[:bar_t]
vy, vx = np.where(vert_up)
vert_r = (max(AXIS - vx.min(), vx.max() - AXIS) + abs(np.median(np.abs(vx - AXIS)))) / 2
CAO = {
    'barHalf': round(bar_half / em, 4),          # crossbar half-length
    'barH':    round((bar_b - bar_t + 1) / em, 4),
    'ringR':   round(vert_r / em, 4),            # where the verticals stand
    'up':      round((bar_t - cy_.min()) / em, 4),
    'down':    round((cy_.max() - bar_b) / em, 4),
}
ROOF_DEG = round(float(np.degrees(np.arctan2(eaves_y - apex_y, half))), 2)
print('  艹', CAO, 'roof', ROOF_DEG, 'deg from horizontal')

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
# Only 木. Drawing 艹 and 𠆢 as well makes the pot a plain pot with a character
# stuck on it — and if the character is only ever drawn, the cone shape is doing
# no work and any pot would serve. So each part of 茶 carries a different piece
# of the form: 𠆢 is the roof, i.e. the cone's own slope; 艹 is the lid and the
# mouth, a bar crossed by a standing ring; 木 alone is drawn, on the cylinder.
wood = np.isin(lbl_r, [i for _, i in by_top[2:]])
LINE = max(1, int(round(0.013 * em)))         # the drawn line's half-width

# 木 is drawn analytically rather than skeletonised, and the reason is the whole
# premise of the revolution: a character may be revolved only because it is
# symmetric about a vertical axis. 茶 is — except for 捺 and 撇, which are a
# calligraphic pair, not mirror images. Skeletonising the font keeps that
# asymmetry and puts it on a pot whose entire point is symmetry. So the four
# strokes are measured off the glyph and re-drawn as lines: 一 and 丨 are already
# symmetric, and 捺/撇 are abstracted to a mirrored pair on the roof's own slope,
# inverted — 𠆢 upside down. Nothing here can come out asymmetric.
wy, wx = np.where(wood)
w_top, w_bot = wy.min(), wy.max()
w_half = max(AXIS - wx.min(), wx.max() - AXIS)
wid = np.array([wood[y].sum() for y in range(w_top, w_bot + 1)])
bar_y = w_top + int(np.argmax(wid))                    # 一: the widest row
bar_x = np.where(wood[bar_y])[0]
bar_half = max(AXIS - bar_x.min(), bar_x.max() - AXIS)
# where 捺/撇 leave 丨: the first row under 一 with ink well off the axis
off = int(0.08 * em)
branch_y = next((y for y in range(bar_y + 1, w_bot)
                 if np.any(np.abs(np.where(wood[y])[0] - AXIS) > off)), bar_y + int(0.05 * em))
slope = np.tan(np.radians(ROOF_DEG))
dy = min(w_half * slope, w_bot - branch_y)
dx = dy / max(slope, 1e-6)
# Off CAO, not off the loose names: the 木 block above reuses `bar_half` for 一,
# so reading it here silently drew 艹's crossbar at 木's width.
cao_bar = (bar_t + bar_b) // 2                 # 艹's crossbar, as a single line
cao_half = CAO['barHalf'] * em
cao_vx = CAO['ringR'] * em
cao_top, cao_bot = cy_.min(), cy_.max()
W = 2 * LINE

def draw_group(strokes):
    """Rasterise a group of strokes and mirror one half onto the other. PIL
    rounds endpoints and widths per side, so drawing both halves leaves a few
    hundred pixels of mismatch where mirroring leaves none."""
    g = Image.new('L', (N, N), 0)
    d = ImageDraw.Draw(g)
    for a, b in strokes:
        d.line([a, b], fill=255, width=W)
    return mirror_about(np.asarray(g) > 127, AXIS)

WOOD = [((AXIS - bar_half, bar_y), (AXIS + bar_half, bar_y)),          # 一
        ((AXIS, w_top), (AXIS, w_bot)),                                 # 丨
        ((AXIS, branch_y), (AXIS - dx, branch_y + dy)),                 # 撇
        ((AXIS, branch_y), (AXIS + dx, branch_y + dy))]                 # 捺
# The three groups are kept apart rather than drawn into one image, because each
# belongs on a different part of the pot and the pot's own corners say where:
# 木 on the cylinder, 𠆢 on the cone whose slope it is, 艹 at the mouth. Drawn as
# one block they can only be placed as a block, and then 𠆢 lands on the cylinder
# instead of on the slope it describes.
ROOF = [((apex_x, apex_y), (apex_x - half, eaves_y)),
        ((apex_x, apex_y), (apex_x + half, eaves_y))]
CAO_LINES = [((AXIS - cao_half, cao_bar), (AXIS + cao_half, cao_bar))] + \
      [((AXIS + sgn * cao_vx, cao_top), (AXIS + sgn * cao_vx, cao_bot)) for sgn in (-1, 1)]
# PIL's rasteriser rounds endpoints and widths per-side, so drawing both halves
# leaves a few hundred pixels of mismatch. Mirror one half instead: exact.

# 木 as the oracle bone draws it — a tree, not a character: one upright, two
# limbs curving up from it, two roots curving down. The seal and modern forms
# straightened those curves into 撇 and 捺 and the picture became a sign; this
# goes back the other way. Laid out in the same box as the drawn 木 so the two
# faces of the pot can carry one each.
def _oracle_wood():
    im2 = Image.new('L', (N, N), 0)
    d2 = ImageDraw.Draw(im2)

    def px(x, y):
        return (AXIS + x * em, CY0 - y * em)

    def walk(pts, n=90):
        """the polyline resampled evenly, so a taper runs smoothly along it"""
        seg = [np.array(q, float) for q in pts]
        out = []
        for i in range(n + 1):
            t = i / n * (len(seg) - 1)
            k = min(int(t), len(seg) - 2)
            f = t - k
            out.append(seg[k] * (1 - f) + seg[k + 1] * f)
        return out

    def limb(pts, r0, r1):
        """A tapered stroke: circles down the curve, wide at the root and fine at
        the tip. A constant-width line is a wire; a limb thins as it goes, and
        that taper is most of what makes it read as grown rather than drawn."""
        w = walk(pts)
        for i, q in enumerate(w):
            r = r0 + (r1 - r0) * (i / (len(w) - 1)) ** 0.75
            d2.ellipse([px(q[0] - r, q[1] + r), px(q[0] + r, q[1] - r)], fill=255)

    def leaf(x, y, L, W, tilt):
        n = 16
        out = []
        for sgn in (1, -1):
            for k in range(n + 1):
                t = (-1 + 2 * k / n) * sgn
                out.append((t * L / 2, sgn * (1 - t * t) * W / 2))
        ct, st = np.cos(tilt), np.sin(tilt)
        d2.polygon([px(x + ex * ct - ey * st, y + ex * st + ey * ct)
                    for ex, ey in out], fill=255)

    # trunk: thick at the foot, thinning as it rises
    limb([(0, -0.430), (0.004, -0.300), (0, -0.180), (-0.003, 0.010)], 0.052, 0.030)
    for sgn in (-1, 1):                                   # limbs, rising
        limb([(0, -0.085), (sgn * 0.120, -0.030),
              (sgn * 0.235, 0.020), (sgn * 0.320, 0.115)], 0.030, 0.008)
    for sgn in (-1, 1):                                   # roots, falling
        limb([(0, -0.352), (sgn * 0.115, -0.404),
              (sgn * 0.215, -0.446), (sgn * 0.300, -0.500)], 0.028, 0.007)
    # leaves, off the limbs and unmatched left to right
    leaf(-0.372, 0.150, 0.088, 0.038, 0.75)
    leaf(-0.246, 0.096, 0.076, 0.033, 0.30)
    leaf(0.360, 0.176, 0.084, 0.036, -0.65)

    m2 = np.asarray(im2) > 127
    out = m2.copy()
    w2 = min(AXIS, N - AXIS)
    out[:, AXIS:AXIS + w2] = m2[:, AXIS - w2:AXIS][:, ::-1]
    out[:, :AXIS] = m2[:, :AXIS]
    return out


# A cedar, after the one on Lebanon's flag: tiers of branch spreading wider as
# they descend, a short bare trunk, a foot. Where the oracle-bone 木 is four
# strokes, this is a silhouette — so it is built from filled tiers rather than
# lines, and the tiers are kept apart by more than the 0.018 the blur closes, or
# they weld into one triangle and the layering is lost.
def _cedar():
    im3 = Image.new('L', (N, N), 0)
    d3 = ImageDraw.Draw(im3)

    def px(x, y):
        return (AXIS + x * em, CY0 - y * em)

    def tier(y, half, thick, droop):
        """one layer of branch: a long lens, pointed at the tips, dipping a
        little at the ends the way a cedar's boughs hang"""
        n = 26
        top, bot = [], []
        for k in range(n + 1):
            t = -1 + 2 * k / n
            x = t * half
            sag = droop * t * t
            e = (1 - t * t) ** 0.62 * thick / 2
            top.append((x, y - sag + e))
            bot.append((x, y - sag - e))
        d3.polygon([px(*q) for q in top + bot[::-1]], fill=255)

    for y, half, thick, droop in [
            (0.062, 0.052, 0.030, 0.004),
            (-0.010, 0.118, 0.036, 0.010),
            (-0.092, 0.184, 0.040, 0.018),
            (-0.178, 0.246, 0.043, 0.026),
            (-0.268, 0.300, 0.045, 0.034)]:
        tier(y, half, thick, droop)
    # trunk, and the foot it stands on
    d3.polygon([px(-0.028, -0.300), px(0.028, -0.300),
                px(0.042, -0.470), px(-0.042, -0.470)], fill=255)
    tier(-0.487, 0.108, 0.030, 0.0)

    m3 = np.asarray(im3) > 127
    out = m3.copy()
    w3 = min(AXIS, N - AXIS)
    out[:, AXIS:AXIS + w3] = m3[:, AXIS - w3:AXIS][:, ::-1]
    out[:, :AXIS] = m3[:, :AXIS]
    return out


# A tree grown rather than drawn: a trunk that splits, and splits again, five
# generations deep, with needle clusters massed on the outer twigs. Strokes laid
# out by hand give a diagram of a tree; the detail that makes a painting is in
# the *count* — some nine hundred segments here, none of them placed by me. Seeded,
# so the same tree comes out of every run.
def _grown_tree():
    R = 4                                   # supersample, then average down
    M = N * 1
    im4 = Image.new('L', (M, M), 0)
    d4 = ImageDraw.Draw(im4)
    rng = np.random.default_rng(20260829)
    px = lambda x, y: (AXIS + x * em, CY0 - y * em)

    def bough(x, y, ang, length, width, depth):
        if depth == 0 or length < 0.012:
            return
        n = max(3, int(length / 0.012))
        cx, cy, ca = x, y, ang
        for i in range(n):
            step = length / n
            ca += float(rng.normal(0, 0.10))          # the wander of real wood
            nx, ny = cx + step * np.cos(ca), cy + step * np.sin(ca)
            w = width * (1 - 0.55 * i / n)
            d4.line([px(cx, cy), px(nx, ny)], fill=255, width=max(1, int(w * em)))
            cx, cy = nx, ny
        # needles mass on the outer generations, not on the trunk
        if depth <= 2:
            for _ in range(int(26 * length / 0.10)):
                a = float(rng.uniform(0, 2 * np.pi))
                r = float(rng.uniform(0, 0.055)) ** 0.6 * 0.055
                lx, ly = cx + r * np.cos(a), cy + r * np.sin(a) * 0.8
                s2 = float(rng.uniform(0.004, 0.009))
                v = int(rng.uniform(150, 235))
                d4.ellipse([px(lx - s2, ly + s2), px(lx + s2, ly - s2)], fill=v)
        k = 2 if depth > 3 else int(rng.integers(2, 4))
        for j in range(k):
            spread = float(rng.uniform(0.42, 0.78)) * (1 if j % 2 else -1)
            bough(cx, cy, ca + spread + float(rng.normal(0, 0.12)),
                  length * float(rng.uniform(0.58, 0.76)),
                  width * 0.62, depth - 1)

    bough(0.0, -0.470, np.pi / 2, 0.185, 0.052, 6)
    return np.asarray(im4).astype(float)


lines_m = draw_group(WOOD + ROOF + CAO_LINES)
mism_lines = np.logical_xor(lines_m[:, AXIS - 300:AXIS],
                            lines_m[:, AXIS + 1:AXIS + 301][:, ::-1]).sum()
print(f'  木 as 4 lines: 一 half {bar_half/em:.3f}, 捺撇 from y {(CY0-branch_y)/em:+.3f} '
      f'at {ROOF_DEG}°, mirror mismatch {mism_lines} px')
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
    'cao': CAO,
    'roofDeg': ROOF_DEG,
    # where 一 sits inside 木, so the band can be solved to land it exactly on
    # the eaves rather than approximately near them
    'woodBarY': round(float(CY0 - bar_y) / em, 4),
    # and where 艹's crossbar sits inside 艹, for the same reason: the two
    # horizontals are carried right round the pot as rings
    'caoBarY': round(float(CY0 - cao_bar) / em, 4),
    # A revolution is only available to a character that is symmetric about a
    # vertical axis — the whole method rests on it — so the measurement travels
    # with the glyph and the canon can refuse an unsuitable one.
    'asym': round(float(ASYM[0]), 4),
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
    'groups': {**{k: encode(draw_group(v)) for k, v in
                  (('wood', WOOD), ('roof', ROOF), ('cao', CAO_LINES))},
               'tree': encode(_oracle_wood()), 'cedar': encode(_cedar()),
               'grown': encode(_grown_tree(), size=460, sigma=0.0016)},
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
# numpy scalars: float64 subclasses float and passes, int64 does not
body = json.dumps(data, ensure_ascii=False,
                  default=lambda o: o.item() if hasattr(o, 'item') else str(o))
open(OUT, 'w').write(
    '// Generated by tools/glyph.py — do not edit by hand.\n'
    f'export default {body}\n')
print(f'{CHAR}: grow {data["grow"]:.3f} em, seam y {data["seamY"]:.3f}, '
      f'body {len(data["body"])} contour(s) {[len(c) for c in data["body"]]}, '
      f'lid {len(data["lid"])} {[len(c) for c in data["lid"]]}')
