"""Overlay a rendered spec's silhouette outline on a reference photo.

usage: uv run --with pillow --with numpy --with scipy python scripts/fit/overlay.py \
         render.png photo.jpg out.png --top 272 --base 507 --axis 511 [--crop x0 y0 x1 y1]

--top/--base/--axis are photo pixel coords of the pot's topmost point (knob),
the ground contact (foot bottom) and the vertical axis. The render (from
scripts/spec-shot.mjs with cam=side&ui=hide) is masked by pot colour, scaled
so its top→base matches, and its outline drawn in cyan.
"""
import argparse
from PIL import Image
import numpy as np
from scipy import ndimage

ap = argparse.ArgumentParser()
ap.add_argument('render'); ap.add_argument('photo'); ap.add_argument('out')
ap.add_argument('--top', type=int, required=True)
ap.add_argument('--base', type=int, help='photo y of lowest pot pixel (scale by height)')
ap.add_argument('--lid-width', type=float, help='photo px width of the lid plate (scale by lid; preferred)')
ap.add_argument('--axis', type=int, required=True)
ap.add_argument('--crop', type=int, nargs=4)
ap.add_argument('--zoom', type=float, default=2.0)
ap.add_argument('--lid-band', type=float, nargs=2, default=[0.16, 0.22],
                help='fraction of total height (from top) spanning the lid plate')
a = ap.parse_args()

photo = Image.open(a.photo).convert('RGB')
render = Image.open(a.render).convert('RGB')
r = np.asarray(render).astype(int)
mask = (r[:, :, 0] - r[:, :, 1] > 25) & (r[:, :, 0] > 90)   # pot colour, not shadow
mask = ndimage.binary_opening(mask, iterations=2)
ys, xs = np.nonzero(mask)
top_row, base_row = ys.min(), ys.max()

# axis = median centre of the longest run per row across the lid-plate band
# (the plate is symmetric and nothing attaches to its edges; the belly is
# contaminated by the handle/spout roots)
Ht = base_row - top_row
lo, hi = top_row + a.lid_band[0] * Ht, top_row + a.lid_band[1] * Ht
centres, widths_ = [], []
for y in range(int(lo), int(hi)):
    lab, n = ndimage.label(mask[y])
    if n == 0:
        continue
    sizes = ndimage.sum(mask[y], lab, range(1, n + 1))
    seg = np.nonzero(lab == (int(np.argmax(sizes)) + 1))[0]
    centres.append((seg.min() + seg.max()) / 2)
    widths_.append(seg.max() - seg.min())
# lid plate width = the widest run in the band (the plate's horizontal extremes)
if widths_:
    widths_ = [max(widths_)]
r_axis = float(np.median(centres))
r_lidw = float(np.median(widths_)) if widths_ else None

if a.lid_width and r_lidw:
    scale = a.lid_width / r_lidw
else:
    scale = (a.base - a.top) / (base_row - top_row)
edge = mask & ~ndimage.binary_erosion(mask, iterations=2)
size = (int(render.width * scale), int(render.height * scale))
e = np.asarray(Image.fromarray((edge * 255).astype('uint8')).resize(size, Image.BILINEAR)) > 60
arr = np.asarray(photo).copy()
ox = int(round(a.axis - r_axis * scale)); oy = int(round(a.top - top_row * scale))
ey, ex = np.nonzero(e)
ok = (ey + oy >= 0) & (ey + oy < arr.shape[0]) & (ex + ox >= 0) & (ex + ox < arr.shape[1])
arr[ey[ok] + oy, ex[ok] + ox] = (0, 255, 255)
out = Image.fromarray(arr.astype('uint8'))
if a.crop:
    out = out.crop(tuple(a.crop))
out = out.resize((int(out.width * a.zoom), int(out.height * a.zoom)), Image.LANCZOS)
out.save(a.out)
print('scale', round(scale, 4), 'render axis', r_axis, 'render lid px', r_lidw, '→', a.out)
