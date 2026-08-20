"""Objective silhouette comparison: render vs reference photo (one view).

usage: uv run --with pillow --with numpy --with scipy python scripts/fit/diff.py \
         --views views.json --view 0 --render render.png --out diff.png

Registration is landmark-free (see common.register): scale/offset are chosen to
maximise IoU, so the number measures shape agreement rather than how well a
lid was measured by hand. Prints IoU overall and per part; writes a diff map
(grey = both, red = photo only, blue = render only).
"""
import argparse, json, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageOps
from scipy import ndimage

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import photo_mask, render_mask, register, iou

ap = argparse.ArgumentParser()
ap.add_argument('--views', required=True); ap.add_argument('--view', type=int, default=0)
ap.add_argument('--render', required=True); ap.add_argument('--out', required=True)
ap.add_argument('--spec'); ap.add_argument('--camera-json')   # accepted, unused (registration is landmark-free)
a = ap.parse_args()

v = json.load(open(a.views))['views'][a.view]
pm = photo_mask(v)
R, scale, dx, dy = register(render_mask(a.render), pm)

img = Image.open(v['photo']).convert('RGB')
if v.get('mirror'): img = ImageOps.mirror(img)

ys, xs = np.nonzero(pm)
top, bot = ys.min(), ys.max()
H = bot - top
# split by the photo silhouette itself: lid band on top, then handle / spout sides
lid_bottom = int(top + 0.30 * H)
best = (0, xs.min(), xs.max())
for y in range(lid_bottom, bot):
    lab, n = ndimage.label(pm[y])
    if n == 0: continue
    sizes = ndimage.sum(pm[y], lab, range(1, n + 1))
    seg = np.nonzero(lab == (int(np.argmax(sizes)) + 1))[0]
    if seg.max() - seg.min() > best[0]: best = (seg.max() - seg.min(), seg.min(), seg.max())
_, bx0, bx1 = best
Y, X = np.mgrid[0:pm.shape[0], 0:pm.shape[1]]
regions = {'lid+knob': Y < lid_bottom,
           'handle': (Y >= lid_bottom) & (X < bx0 + 0.14 * (bx1 - bx0)),
           'spout': (Y >= lid_bottom) & (X > bx1 - 0.14 * (bx1 - bx0))}
regions['body'] = (Y >= lid_bottom) & ~regions['handle'] & ~regions['spout']

print(f'view {a.view}: scale {scale:.3f}  IoU overall {iou(pm, R):.3f}   ' +
      '  '.join(f'{k} {iou(pm & m, R & m):.3f}' for k, m in regions.items()))

base = np.asarray(img).astype(float) * 0.35 + 165
out = base.copy(); both = pm & R
out[both] = out[both] * 0.5 + 45
out[pm & ~R] = (220, 40, 40)
out[R & ~pm] = (40, 90, 230)
im = Image.fromarray(out.clip(0, 255).astype('uint8'))
ys2, xs2 = np.nonzero(pm | R)
im = im.crop((max(0, xs2.min() - 30), max(0, ys2.min() - 30),
              min(im.width, xs2.max() + 30), min(im.height, ys2.max() + 30)))
im.thumbnail((900, 700)); im.save(a.out)
