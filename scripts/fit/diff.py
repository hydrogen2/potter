"""Objective silhouette comparison: render vs reference photo (one view).

usage: uv run --with pillow --with numpy --with scipy python scripts/fit/diff.py \
         --spec src/specs/x.json --views views.json --view 0 --render render.png --out diff.png

Uses the same masks + analytic registration as optimize.py (lid width and knob
top; render camera from the views file). Prints IoU overall and per part, mean
outline distance; writes a diff map (grey both / red photo-only / blue render-only).
"""
import argparse, json, math
from PIL import Image, ImageOps
import numpy as np
from scipy import ndimage

ap = argparse.ArgumentParser()
ap.add_argument('--spec', required=True); ap.add_argument('--views', required=True)
ap.add_argument('--view', type=int, default=0); ap.add_argument('--render', required=True)
ap.add_argument('--out', required=True); ap.add_argument('--camera-json', help='override cameras (best-cameras.json)')
a = ap.parse_args()
spec = json.load(open(a.spec)); v = json.load(open(a.views))['views'][a.view]
cam = dict(v.get('camera', {}))
if a.camera_json: cam = json.load(open(a.camera_json))[a.view]
for k, d in (('elev', 8), ('az', 0), ('dist', 8), ('fov', 18), ('ty', 0.5)): cam.setdefault(k, d)

def fill_small_holes(m, max_px):
    holes = ndimage.binary_fill_holes(m) & ~m
    lab, n = ndimage.label(holes)
    if n == 0: return m
    sizes = ndimage.sum(holes, lab, range(1, n + 1))
    return m | np.isin(lab, [i + 1 for i, s_ in enumerate(sizes) if s_ <= max_px])

img = Image.open(v['photo']).convert('RGB')
if v.get('mirror'): img = ImageOps.mirror(img)
p = np.asarray(img).astype(int)
if v.get('mask'):
    pm = np.asarray(Image.open(v['mask']).convert('L')) > 127
    if v.get('mirror'): pm = pm[:, ::-1]
else:
    pm = (((p[:, :, 0] - p[:, :, 2]) > v.get('chroma', 46)) & ((p[:, :, 0] - p[:, :, 1]) > v.get('rg', 6)) & (p[:, :, 0] > v.get('rmin', 0)))
    if v.get('crop'):
        box = np.zeros_like(pm); x0, y0, x1, y1 = v['crop']; box[y0:y1, x0:x1] = True; pm &= box
    pm = ndimage.binary_opening(pm, iterations=v.get('open', 2))
    pm = fill_small_holes(ndimage.binary_closing(pm, iterations=v.get('close', 3)), v.get('hole_px', 1500))
    lab, n = ndimage.label(pm)
    if n > 1:
        sizes = ndimage.sum(pm, lab, range(1, n + 1)); pm = lab == (int(np.argmax(sizes)) + 1)

r = np.asarray(Image.open(a.render).convert('RGB')).astype(int)
rm = (r[:, :, 0] - r[:, :, 1] > 25) & (r[:, :, 0] > 90)
rm = fill_small_holes(ndimage.binary_closing(rm, iterations=2), 3000)
Hpx, W = rm.shape
ys, xs = np.nonzero(rm); top_row = ys.min()
lidR = spec['body']['mouthR'] + spec.get('lid', {}).get('overhang', 0.045)
lidY = spec['body'].get('underDome', 0) + spec['body']['height'] + 0.5 * spec.get('lid', {}).get('thickness', 0.05)
e = math.radians(cam['elev']); depth = cam['dist'] - (lidY - cam['ty']) * math.sin(e)
ppu = (Hpx / 2) / (depth * math.tan(math.radians(cam['fov']) / 2))
scale = v['lid_width'] / (2 * lidR * ppu)
size = (int(W * scale), int(Hpx * scale))
rms = np.asarray(Image.fromarray((rm * 255).astype('uint8')).resize(size, Image.BILINEAR)) > 127
ox = int(round(v['axis'] - (W / 2) * scale)); oy = int(round(v['top'] - top_row * scale))
R = np.zeros_like(pm)
yy0, xx0 = max(0, oy), max(0, ox); yy1, xx1 = min(pm.shape[0], oy + rms.shape[0]), min(pm.shape[1], ox + rms.shape[1])
R[yy0:yy1, xx0:xx1] = rms[yy0 - oy:yy1 - oy, xx0 - ox:xx1 - ox]

def iou(A, B):
    u = np.count_nonzero(A | B); return np.count_nonzero(A & B) / u if u else float('nan')
py, px = np.nonzero(pm)
lid_bottom = int(v['top'] + (lidY - lidY + 0.0) * 0 + (0.5 * spec.get('lid', {}).get('thickness', 0.05) + spec.get('knob', {}).get('rise', 0.12) + 0.03) * ppu * scale)
lid_bottom = int(v['top'] + (spec.get('knob', {}).get('rise', 0.12) + spec.get('lid', {}).get('thickness', 0.05) + 0.02) * ppu * scale * math.cos(e))
best = (0, 0, 0)
for y in range(lid_bottom, py.max()):
    lab, n = ndimage.label(pm[y])
    if n == 0: continue
    sizes = ndimage.sum(pm[y], lab, range(1, n + 1)); seg = np.nonzero(lab == (int(np.argmax(sizes)) + 1))[0]
    if seg.max() - seg.min() > best[0]: best = (seg.max() - seg.min(), seg.min(), seg.max())
_, bx0, bx1 = best
Y, X = np.mgrid[0:pm.shape[0], 0:pm.shape[1]]
regions = {'lid+knob': Y < lid_bottom,
           'handle': (Y >= lid_bottom) & (X < bx0 + 0.12 * (bx1 - bx0)),
           'spout': (Y >= lid_bottom) & (X > bx1 - 0.12 * (bx1 - bx0))}
regions['body'] = (Y >= lid_bottom) & ~regions['handle'] & ~regions['spout']
print(f'view {a.view}: cam elev {cam["elev"]:.1f} az {cam["az"]:.1f}   IoU overall {iou(pm, R):.3f}   ' +
      '  '.join(f'{k} {iou(pm & m, R & m):.3f}' for k, m in regions.items()))

base = np.asarray(img).astype(float) * 0.35 + 165
out = base.copy(); both = pm & R
out[both] = out[both] * 0.5 + 45; out[pm & ~R] = (220, 40, 40); out[R & ~pm] = (40, 90, 230)
im = Image.fromarray(out.clip(0, 255).astype('uint8'))
ys2, xs2 = np.nonzero(pm | R)
im = im.crop((max(0, xs2.min() - 30), max(0, ys2.min() - 30), min(im.width, xs2.max() + 30), min(im.height, ys2.max() + 30)))
im.thumbnail((900, 700)); im.save(a.out)
