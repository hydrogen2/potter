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
ap.add_argument('--profile-weight', type=float, default=0.0,
                help='penalise silhouette profile mismatch (RMS radius / height); 3 is a strong prior')
ap.add_argument('--node', default=os.path.expanduser('~/.local/opt/node-v22.17.0-linux-x64/bin/node'))
a = ap.parse_args()
OUT = Path(a.out); OUT.mkdir(parents=True, exist_ok=True)
VIEWS = json.load(open(a.views))['views']

# ---- masks / registration / scoring -------------------------------------------
sys.path.insert(0, str(HERE))
from common import photo_mask, render_mask, register, iou, profile_rmse  # noqa: E402

for v in VIEWS:
    v['_pm'] = photo_mask(v)
    v['camera'] = dict(v.get('camera', {}))
    for k, d in (('elev', 8), ('az', 0), ('dist', 8), ('fov', 18), ('ty', 0.5)):
        v['camera'].setdefault(k, d)


def iou_view(png, v, spec=None, cam=None):
    if not os.path.exists(png):
        return -1.0          # a render that never arrived cannot win
    R, *_ = register(render_mask(png), v['_pm'])
    score = iou(R, v['_pm'])
    if a.profile_weight and v.get('profile', True):
        score -= a.profile_weight * profile_rmse(R, v['_pm'])
    return score


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
    per = [iou_view(p, v) for p, v in zip(pngs, VIEWS)]
    return float(np.mean(per)), per

# ---- optional camera grid pre-search per view --------------------------------
best = State(copy.deepcopy(spec0), [dict(v['camera']) for v in VIEWS])
if a.cameras:
    seeded = json.load(open(a.cameras))
    for vi in range(min(len(seeded), len(best.cams))):   # a views file may use a subset
        best.cams[vi].update(seeded[vi])
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
