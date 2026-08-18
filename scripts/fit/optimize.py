"""Fit a spec to one or more reference photos by maximizing silhouette IoU.

usage: uv run --with pillow --with numpy --with scipy python scripts/fit/optimize.py \
    --spec src/specs/x.json --views views.json --rounds 4 --out fitdir [--params body.height ...]

views.json:
{ "views": [
    { "photo": "a.jpg", "top": 272, "lid_width": 245, "axis": 508,
      "crop": [x0,y0,x1,y1], "chroma": 46, "mirror": false,
      "camera": { "elev": 9, "az": 0, "dist": 8, "fov": 18, "ty": 0.5 },
      "tune_camera": ["elev", "az"] },
    ...
  ] }

Multi-view analysis-by-synthesis, constrained to the potter's DSL: every view
is rendered from the SAME spec with its own camera; score = mean IoU over
views. Coordinate descent over spec params (+ optionally camera angles per
view), all candidates of a round rendered in one browser session.
"""
import argparse, json, subprocess, os, sys, copy
from pathlib import Path
import numpy as np
from PIL import Image, ImageOps
from scipy import ndimage

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent

ap = argparse.ArgumentParser()
ap.add_argument('--spec', required=True); ap.add_argument('--views', required=True)
ap.add_argument('--rounds', type=int, default=3); ap.add_argument('--out', default='fit-out')
ap.add_argument('--params', nargs='*', help='slot.param list to tune (default: all numeric)')
ap.add_argument('--step', type=float, default=0.06, help='initial relative step')
ap.add_argument('--cam-grid', action='store_true', help='coarse elev/az grid search per view before descent')
ap.add_argument('--cameras', help='seed per-view cameras from a best-cameras.json')
ap.add_argument('--node', default=os.path.expanduser('~/.local/opt/node-v22.17.0-linux-x64/bin/node'))
a = ap.parse_args()
OUT = Path(a.out); OUT.mkdir(parents=True, exist_ok=True)
VIEWS = json.load(open(a.views))['views']

# ---- masks ---------------------------------------------------------------------
def fill_small_holes(m, max_px):
    holes = ndimage.binary_fill_holes(m) & ~m
    lab, n = ndimage.label(holes)
    if n == 0: return m
    sizes = ndimage.sum(holes, lab, range(1, n + 1))
    return m | np.isin(lab, [i + 1 for i, s_ in enumerate(sizes) if s_ <= max_px])

def render_mask(path):
    r = np.asarray(Image.open(path).convert('RGB')).astype(int)
    m = (r[:, :, 0] - r[:, :, 1] > 25) & (r[:, :, 0] > 90)
    return fill_small_holes(ndimage.binary_closing(m, iterations=2), 3000)

def photo_mask(v):
    if v.get('mask'):  # precomputed mask PNG (e.g. GrabCut), white = pot
        m = np.asarray(Image.open(v['mask']).convert('L')) > 127
        if v.get('mirror'): m = m[:, ::-1]
        return m
    img = Image.open(v['photo']).convert('RGB')
    if v.get('mirror'): img = ImageOps.mirror(img)
    p = np.asarray(img).astype(int)
    m = (((p[:, :, 0] - p[:, :, 2]) > v.get('chroma', 46)) & ((p[:, :, 0] - p[:, :, 1]) > v.get('rg', 6))
         & (p[:, :, 0] > v.get('rmin', 0)))
    if v.get('crop'):
        box = np.zeros_like(m); x0, y0, x1, y1 = v['crop']; box[y0:y1, x0:x1] = True; m &= box
    m = ndimage.binary_opening(m, iterations=v.get('open', 2))
    m = fill_small_holes(ndimage.binary_closing(m, iterations=v.get('close', 3)), v.get('hole_px', 1500))
    lab, n = ndimage.label(m)
    if n > 1:
        sizes = ndimage.sum(m, lab, range(1, n + 1)); m = lab == (int(np.argmax(sizes)) + 1)
    return m

for v in VIEWS:
    v['_pm'] = photo_mask(v)
    v['camera'] = dict(v.get('camera', {}))
    v['camera'].setdefault('elev', 8); v['camera'].setdefault('az', 0)
    v['camera'].setdefault('dist', 8); v['camera'].setdefault('fov', 18); v['camera'].setdefault('ty', 0.5)

def lid_radius(spec):
    lid = spec.get('lid', {}); body = spec.get('body', {})
    return body.get('mouthR', 0.4) + lid.get('overhang', 0.045)

def lid_center_y(spec):
    b = spec['body']; lid = spec.get('lid', {})
    return b.get('underDome', 0) + b['height'] + 0.5 * lid.get('thickness', 0.05)

def register(rm, v, spec, cam, W, Hpx):
    """Analytic registration: the render's camera and spec are known, so the
    lid plate's projected diameter and the axis column are computed exactly;
    only the knob-top row is taken from the mask."""
    import math
    PM = v['_pm']
    ys, xs = np.nonzero(rm)
    if len(ys) == 0: return np.zeros_like(PM)
    top_row = ys.min()
    e = math.radians(cam['elev']); depth = cam['dist'] - (lid_center_y(spec) - cam['ty']) * math.sin(e)
    ppu = (Hpx / 2) / (depth * math.tan(math.radians(cam['fov']) / 2))   # px per unit at the lid
    r_lidw = 2 * lid_radius(spec) * ppu
    r_axis = W / 2
    scale = v['lid_width'] / r_lidw
    size = (int(rm.shape[1] * scale), int(rm.shape[0] * scale))
    rms = np.asarray(Image.fromarray((rm * 255).astype('uint8')).resize(size, Image.BILINEAR)) > 127
    ox = int(round(v['axis'] - r_axis * scale)); oy = int(round(v['top'] - top_row * scale))
    R = np.zeros_like(PM)
    yy0, xx0 = max(0, oy), max(0, ox)
    yy1, xx1 = min(PM.shape[0], oy + rms.shape[0]), min(PM.shape[1], ox + rms.shape[1])
    if yy1 > yy0 and xx1 > xx0:
        R[yy0:yy1, xx0:xx1] = rms[yy0 - oy:yy1 - oy, xx0 - ox:xx1 - ox]
    return R

def iou_view(png, v, spec, cam):
    rm = render_mask(png)
    R = register(rm, v, spec, cam, rm.shape[1], rm.shape[0]); PM = v['_pm']
    u = np.count_nonzero(PM | R)
    return np.count_nonzero(PM & R) / u if u else 0.0

# ---- state: spec params + per-view camera params -----------------------------
spec0 = json.load(open(a.spec))
SLOTS = ['body', 'lid', 'knob', 'spout', 'handle', 'base']
def spec_keys(spec):
    return [f'{s}.{k}' for s in SLOTS for k, v in spec.get(s, {}).items()
            if k != 'type' and isinstance(v, (int, float)) and not isinstance(v, bool)]
cam_keys = [f'view{i}.{c}' for i, v in enumerate(VIEWS) for c in v.get('tune_camera', [])]
KEYS = (a.params or spec_keys(spec0)) + cam_keys

bounds_js = """
import { REGISTRY } from '%s/src/components/index.js'
const out = {}
for (const [slot, reg] of Object.entries(REGISTRY)) for (const [t, def] of Object.entries(reg))
  for (const [k, d] of Object.entries(def.params)) out[`${slot}.${t}.${k}`] = [d.min, d.max, d.step]
console.log(JSON.stringify(out))
""" % ROOT
bjs = OUT / '_bounds.mjs'; bjs.write_text(bounds_js)
BOUNDS = json.loads(subprocess.check_output([a.node, str(bjs)], cwd=ROOT, stderr=subprocess.DEVNULL))
# integer-valued params (step >= 1, e.g. foot count) are not continuous — leave them alone
def _is_int_param(key):
    s_, k_ = key.split('.'); b_ = BOUNDS.get(f"{s_}.{spec0[s_]['type']}.{k_}")
    return bool(b_) and len(b_) > 2 and b_[2] is not None and b_[2] >= 1
KEYS = [k for k in KEYS if k.startswith('view') or not _is_int_param(k)]
CAM_BOUNDS = {'elev': [-5, 45], 'az': [-70, 70], 'dist': [3, 30], 'fov': [8, 40], 'ty': [0, 1.5]}

class State:
    def __init__(self, spec, cams): self.spec, self.cams = spec, cams
    def copy(self): return State(copy.deepcopy(self.spec), copy.deepcopy(self.cams))
    def get(self, key):
        s, k = key.split('.')
        return self.cams[int(s[4:])][k] if s.startswith('view') else self.spec[s][k]
    def set(self, key, v):
        s, k = key.split('.')
        if s.startswith('view'): self.cams[int(s[4:])][k] = v
        else: self.spec[s][k] = v
    def bound(self, key):
        s, k = key.split('.')
        if s.startswith('view'): return CAM_BOUNDS[k]
        return BOUNDS.get(f"{s}.{self.spec[s]['type']}.{k}", [-1e9, 1e9])
    def hash(self, vi):
        parts = [f"id={spec0['id']}"]
        for key in KEYS:
            if not key.startswith('view'): parts.append(f'{key}={self.get(key):.4f}')
        c = self.cams[vi]
        parts.append(f"cam=side&elev={c['elev']:.2f}&az={c['az']:.2f}&dist={c['dist']}&fov={c['fov']}&ty={c['ty']}")
        return '&'.join(parts)

def render_batch(cands, tag):
    """cands: list of (name, State). Renders every view of every candidate."""
    jobs = [{'name': f'{n}__v{vi}', 'hash': st.hash(vi)} for n, st in cands for vi in range(len(VIEWS))]
    jf = OUT / f'{tag}.json'; jf.write_text(json.dumps({'out': str(OUT / tag), 'camera': '', 'jobs': jobs}))
    r = subprocess.run([a.node, str(HERE / 'render-many.mjs'), str(jf)], cwd=ROOT, capture_output=True, text=True)
    if r.returncode != 0: print(r.stdout, r.stderr); sys.exit(1)
    return {n: [str(OUT / tag / f'{n}__v{vi}.png') for vi in range(len(VIEWS))] for n, _ in cands}

def score(pngs, st):
    per = [iou_view(p, v, st.spec, st.cams[i]) for i, (p, v) in enumerate(zip(pngs, VIEWS))]
    return float(np.mean(per)), per

# ---- optional camera grid pre-search per view --------------------------------
best = State(copy.deepcopy(spec0), [dict(v['camera']) for v in VIEWS])
if a.cameras:
    for vi, c in enumerate(json.load(open(a.cameras))): best.cams[vi].update(c)
if a.cam_grid:
    for vi, v in enumerate(VIEWS):
        tune = v.get('tune_camera', [])
        if not tune: continue
        elevs = np.arange(0, 36, 5) if 'elev' in tune else [best.cams[vi]['elev']]
        azs = np.arange(-40, 41, 8) if 'az' in tune else [best.cams[vi]['az']]
        cands = []
        for e_ in elevs:
            for z_ in azs:
                st = best.copy(); st.cams[vi]['elev'] = float(e_); st.cams[vi]['az'] = float(z_)
                cands.append((f'g{vi}_{e_}_{z_}', st))
        # render only this view for each candidate
        jobs = [{'name': n, 'hash': st.hash(vi)} for n, st in cands]
        jf = OUT / f'grid{vi}.json'; jf.write_text(json.dumps({'out': str(OUT / f'grid{vi}'), 'camera': '', 'jobs': jobs}))
        r = subprocess.run([a.node, str(HERE / 'render-many.mjs'), str(jf)], cwd=ROOT, capture_output=True, text=True)
        if r.returncode != 0: print(r.stdout, r.stderr); sys.exit(1)
        scored = [(iou_view(str(OUT / f'grid{vi}' / f'{n}.png'), v, st.spec, st.cams[vi]), n, st) for n, st in cands]
        scored.sort(key=lambda t: -t[0])
        s_best, n_best, st_best = scored[0]
        best.cams[vi] = dict(st_best.cams[vi])
        print(f'view {vi} camera grid: best {n_best} IoU {s_best:.4f}', flush=True)
        if 'dist' in tune:  # perspective sweep at the found elev/az
            cands = []
            for d_ in (3.5, 5, 6.5, 8, 10, 13, 17, 22, 28):
                st = best.copy(); st.cams[vi]['dist'] = float(d_); cands.append((f'd{vi}_{d_}', st))
            jobs = [{'name': n, 'hash': st.hash(vi)} for n, st in cands]
            jf = OUT / f'dist{vi}.json'; jf.write_text(json.dumps({'out': str(OUT / f'dist{vi}'), 'camera': '', 'jobs': jobs}))
            r = subprocess.run([a.node, str(HERE / 'render-many.mjs'), str(jf)], cwd=ROOT, capture_output=True, text=True)
            if r.returncode != 0: print(r.stdout, r.stderr); sys.exit(1)
            scored = [(iou_view(str(OUT / f'dist{vi}' / f'{n}.png'), v, st.spec, st.cams[vi]), n, st) for n, st in cands]
            scored.sort(key=lambda t: -t[0])
            s_best, n_best, st_best = scored[0]
            best.cams[vi]['dist'] = st_best.cams[vi]['dist']
            print(f'view {vi} dist sweep: best {n_best} IoU {s_best:.4f}', flush=True)
        json.dump(best.cams, open(OUT / 'best-cameras.json', 'w'), indent=1)

# ---- coordinate descent ------------------------------------------------------
best_s, per = score(render_batch([('base', best)], 'r0')['base'], best)
print(f'start IoU {best_s:.4f}  per-view {[round(x,3) for x in per]}  ({len(KEYS)} params)', flush=True)
log = [{'round': 0, 'iou': best_s, 'per': per}]
step = a.step
for rnd in range(1, a.rounds + 1):
    cands = []
    for key in KEYS:
        v = best.get(key); lo, hi = best.bound(key)[:2]
        d = max(abs(v) * step, 0.5 if (key.startswith('view') and not key.endswith('.dist')) else 0.005)
        for sgn, tag in ((+1, 'p'), (-1, 'm')):
            nv = min(hi, max(lo, v + sgn * d))
            if abs(nv - v) < 1e-6: continue
            st = best.copy(); st.set(key, round(nv, 4)); cands.append((f'{key}_{tag}', st))
    pngs = render_batch(cands, f'r{rnd}')
    scores = {n: score(pngs[n], cand_map_st)[0] for n, cand_map_st in cands}
    improving = sorted([(s, n) for n, s in scores.items() if s > best_s + 1e-4], reverse=True)
    applied = 0
    cand_map = dict(cands)
    for s, n in improving:
        key = n.rsplit('_', 1)[0]
        trial = best.copy(); trial.set(key, cand_map[n].get(key))
        sc, per = score(render_batch([(f'verify_{n}', trial)], f'v{rnd}')[f'verify_{n}'], trial)
        if sc > best_s + 1e-4:
            best, best_s = trial, sc; applied += 1
            print(f'  r{rnd}: {key} → {best.get(key)}  IoU {best_s:.4f}', flush=True)
    print(f'round {rnd}: IoU {best_s:.4f}, {applied} moves, step {step:.3f}', flush=True)
    log.append({'round': rnd, 'iou': best_s, 'moves': applied})
    if applied == 0: step *= 0.5
    out_spec = copy.deepcopy(best.spec)
    json.dump(out_spec, open(OUT / 'best.json', 'w'), ensure_ascii=False, indent=2)
    json.dump(best.cams, open(OUT / 'best-cameras.json', 'w'), indent=1)
json.dump(log, open(OUT / 'log.json', 'w'), indent=1)
print('best spec →', OUT / 'best.json', f'IoU {best_s:.4f}', 'cameras →', OUT / 'best-cameras.json', flush=True)
