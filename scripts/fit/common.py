"""Shared photo→spec pieces: masks, registration, IoU."""
import numpy as np
from PIL import Image, ImageOps
from scipy import ndimage


def fill_small_holes(m, max_px):
    holes = ndimage.binary_fill_holes(m) & ~m
    lab, n = ndimage.label(holes)
    if n == 0:
        return m
    sizes = ndimage.sum(holes, lab, range(1, n + 1))
    return m | np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s <= max_px])


def photo_mask(v):
    """Pot silhouette for a view. Prefer a precomputed mask (scripts/fit/mask.py,
    which rejects cast shadow); fall back to a chroma rule for clean backdrops."""
    if v.get('mask'):
        m = np.asarray(Image.open(v['mask']).convert('L')) > 127
        return m[:, ::-1] if v.get('mirror') else m
    img = Image.open(v['photo']).convert('RGB')
    if v.get('mirror'):
        img = ImageOps.mirror(img)
    p = np.asarray(img).astype(int)
    m = (((p[:, :, 0] - p[:, :, 2]) > v.get('chroma', 46))
         & ((p[:, :, 0] - p[:, :, 1]) > v.get('rg', 6))
         & (p[:, :, 0] > v.get('rmin', 0)))
    if v.get('crop'):
        box = np.zeros_like(m)
        x0, y0, x1, y1 = v['crop']
        box[y0:y1, x0:x1] = True
        m &= box
    m = ndimage.binary_opening(m, iterations=v.get('open', 2))
    m = fill_small_holes(ndimage.binary_closing(m, iterations=v.get('close', 3)),
                         v.get('hole_px', 1500))
    lab, n = ndimage.label(m)
    if n > 1:
        sizes = ndimage.sum(m, lab, range(1, n + 1))
        m = lab == (int(np.argmax(sizes)) + 1)
    return m


def render_mask(path):
    """Silhouette of a fit-mode render (flat unlit colour on white).

    Only antialiasing speckle is filled — never the handle opening, which is a
    real hole and must be compared against the photo's opening."""
    r = np.asarray(Image.open(path).convert('RGB')).astype(int)
    m = (r[:, :, 0] - r[:, :, 1] > 25) & (r[:, :, 0] > 90)
    return fill_small_holes(ndimage.binary_closing(m, iterations=2), 150)


def _place(src, shape, scale, dx, dy):
    """Scale src about its centroid and paste into a canvas of `shape`."""
    h, w = src.shape
    sw, sh = max(1, int(round(w * scale))), max(1, int(round(h * scale)))
    s = np.asarray(Image.fromarray(src.astype(np.uint8) * 255).resize((sw, sh), Image.BILINEAR)) > 127
    out = np.zeros(shape, bool)
    y0, x0 = int(round(dy)), int(round(dx))
    ys0, xs0 = max(0, y0), max(0, x0)
    ys1, xs1 = min(shape[0], y0 + sh), min(shape[1], x0 + sw)
    if ys1 > ys0 and xs1 > xs0:
        out[ys0:ys1, xs0:xs1] = s[ys0 - y0:ys1 - y0, xs0 - x0:xs1 - x0]
    return out


def iou(a, b):
    u = np.count_nonzero(a | b)
    return np.count_nonzero(a & b) / u if u else 0.0


def register(rm, pm, coarse=4, window=0.10, steps=7, shift=14):
    """Align a render silhouette to a photo silhouette without hand landmarks.

    Seeds scale from the area ratio and offset from centroids (both closed
    form), then maximises IoU over a small scale/offset window — so the score
    reflects shape agreement, not how well someone measured a lid.
    Returns (aligned_mask, scale, dx, dy).
    """
    if not rm.any() or not pm.any():
        return np.zeros_like(pm), 1.0, 0, 0
    scale0 = np.sqrt(np.count_nonzero(pm) / np.count_nonzero(rm))
    ry, rx = ndimage.center_of_mass(rm)
    py, px = ndimage.center_of_mass(pm)

    def offsets(scale):
        return px - rx * scale, py - ry * scale   # top-left of the scaled render

    # coarse pass on downscaled masks, then a fine pass at full resolution
    best = (-1, scale0, *offsets(scale0))
    for c, sw, sh, st in ((coarse, window, shift * 2, steps), (1, window / steps, shift / 2, 5)):
        pmc = pm[::c, ::c]
        rmc = rm[::c, ::c]
        _, s_c, dx_c, dy_c = best
        cand_s = s_c * np.linspace(1 - sw, 1 + sw, st)
        for s in cand_s:
            ox, oy = offsets(s)
            for ddx in np.linspace(-sh, sh, 5):
                for ddy in np.linspace(-sh, sh, 5):
                    m = _place(rmc, pmc.shape, s, (ox + ddx) / c, (oy + ddy) / c)
                    sc = iou(m, pmc)
                    if sc > best[0]:
                        best = (sc, s, ox + ddx, oy + ddy)
    _, s, dx, dy = best
    return _place(rm, pm.shape, s, dx, dy), s, dx, dy


def profile_curve(m, nrows=64):
    """Body half-width per row, sampled from base to top.

    Handles and spouts only ever widen *one* side, so the narrower side is the
    body — that makes the curve usable without segmenting the attachments.
    """
    ys, xs = np.nonzero(m)
    if len(ys) == 0:
        return np.full(nrows, np.nan), 0, 1
    top, bot = int(ys.min()), int(ys.max())
    band = m[top:top + max(2, int(0.2 * (bot - top)))]
    ax = int(np.median(np.nonzero(band)[1])) if band.any() else int(np.median(xs))
    out = []
    for i in range(nrows):
        y = int(top + (bot - top) * (i + 0.5) / nrows)
        row = m[y]
        if not row[ax]:
            out.append(np.nan)
            continue
        l = ax
        while l > 0 and row[l - 1]:
            l -= 1
        r = ax
        while r < row.size - 1 and row[r + 1]:
            r += 1
        out.append(min(ax - l, r - ax))
    return np.asarray(out, float), top, bot


def profile_rmse(a_mask, b_mask, nrows=64):
    """RMS difference of the two silhouette profiles, as a fraction of height.

    IoU is area-based and barely moves when a straight flank should be convex —
    the very thing that separates a 石瓢 from a lampshade. This does move.
    """
    a, ta, ba = profile_curve(a_mask, nrows)
    b, tb, bb = profile_curve(b_mask, nrows)
    ok = ~np.isnan(a) & ~np.isnan(b)
    if ok.sum() < nrows // 4:
        return 1.0
    d = np.abs(a[ok] - b[ok])
    # where the handle and spout merge into the silhouette on both sides the
    # min-side rule breaks down; trim the worst fifth so those rows cannot
    # dominate the score
    keep = d <= np.quantile(d, 0.8)
    h = max(ba - ta, 1)
    return float(np.sqrt(np.mean(d[keep] ** 2)) / h)
