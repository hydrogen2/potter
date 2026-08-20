"""Segment a pot from a photo, rejecting its cast shadow.

usage: uv run --with opencv-python-headless --with numpy --with pillow python \
         scripts/fit/mask.py photo.jpg out_mask.png --rect X Y W H [--preview p.png]

Cast shadow is the trap: it touches the pot, and on a warm backdrop it is dark
but still brownish, so a plain colour threshold swallows it and the fitted body
comes out barrel-shaped instead of conical. Fired zisha is strongly red-shifted
(R-G ~20-60, i.e. 20-35% of V) at any brightness; cast shadow, dark wood and
cloth are all far less saturated on that axis. Those tests separate them;
GrabCut then snaps to the real edge.
"""
import argparse
import cv2
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument('photo'); ap.add_argument('out')
ap.add_argument('--rect', type=int, nargs=4, required=True, help='X Y W H around the pot')
ap.add_argument('--preview')
ap.add_argument('--shadow-v', type=int, default=32, help='below this value + neutral hue = shadow')
ap.add_argument('--highlight-v', type=int, default=205,
                help='pixels brighter than this are exempt from the neutral test (specular)')
ap.add_argument('--neutral-ratio', type=float, default=0.12,
                help='reject pixels whose R-G is below this fraction of V (clay sits at 0.20-0.35)')
ap.add_argument('--shadow-rg', type=int, default=12, help='R-G below this is neutral (not clay)')
ap.add_argument('--clay-rg', type=int, default=34, help='R-G above this (and bright) is certainly clay')
ap.add_argument('--clay-v', type=int, default=85)
ap.add_argument('--ring', type=int, default=22, help='dilation (px) used to inspect a hole surroundings')
ap.add_argument('--ring-pot', type=float, default=0.92, help='ring this much pot ⇒ fill the hole')
ap.add_argument('--iters', type=int, default=6)
a = ap.parse_args()

img = cv2.imread(a.photo)
B, G, R = img[:, :, 0].astype(int), img[:, :, 1].astype(int), img[:, :, 2].astype(int)
V = img.max(axis=2).astype(int)
rg, gb = R - G, G - B
x, y, w, h = a.rect

trimap = np.full(img.shape[:2], cv2.GC_BGD, np.uint8)
inside = np.zeros(img.shape[:2], bool); inside[y:y + h, x:x + w] = True
trimap[inside] = cv2.GC_PR_FGD

# clay keeps R-G at 20-35% of its brightness whether lit or shaded; cast
# shadow, dark wood and cloth all fall well below that
# specular highlights wash out toward white, so exempt the brightest pixels
neutral = (rg < a.neutral_ratio * np.maximum(V, 1)) & (V < a.highlight_v)
shadow = ((V < a.shadow_v) & (rg < a.shadow_rg)) | neutral
cloth = (gb > 32) & (rg < 26)                        # yellow-green backdrop
trimap[inside & (shadow | cloth)] = cv2.GC_BGD

core = np.zeros(img.shape[:2], bool)
core[y + h // 6:y + 5 * h // 6, x + w // 6:x + 5 * w // 6] = True
trimap[core & (rg > a.clay_rg) & (V > a.clay_v)] = cv2.GC_FGD

bgd, fgd = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
cv2.grabCut(img, trimap, None, bgd, fgd, a.iters, cv2.GC_INIT_WITH_MASK)
m = ((trimap == cv2.GC_FGD) | (trimap == cv2.GC_PR_FGD)).astype(np.uint8)
m[shadow] = 0                                        # never keep deep shadow

n, lab, stats, _ = cv2.connectedComponentsWithStats(m)
if n > 1:
    m = (lab == 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))).astype(np.uint8)
m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
# Fill interior holes (specular highlights, engraving) but keep the handle
# opening. Colour cannot separate them — a blown highlight looks like a pale
# backdrop — but their surroundings differ: a highlight is ringed entirely by
# pot, while the handle opening's ring crosses the thin loop into background.
holes = (cv2.floodFill(m.copy(), None, (0, 0), 1)[1] == 0).astype(np.uint8)
hn, hlab, hstats, _ = cv2.connectedComponentsWithStats(holes)
k = np.ones((3, 3), np.uint8)
for i in range(1, hn):
    sel = (hlab == i).astype(np.uint8)
    if hstats[i, cv2.CC_STAT_AREA] < 150:
        m[sel > 0] = 1
        continue
    ring = (cv2.dilate(sel, k, iterations=a.ring) - sel) > 0
    if ring.sum() and (m[ring] > 0).mean() > a.ring_pot:
        m[sel > 0] = 1        # surrounded by pot → misclassified pot, fill it

cv2.imwrite(a.out, m * 255)
ys, xs = np.nonzero(m)
print(f'{a.photo}: mask bbox x[{xs.min()},{xs.max()}] y[{ys.min()},{ys.max()}] area={int(m.sum())}')
if a.preview:
    vis = img.copy()
    edge = m - cv2.erode(m, np.ones((3, 3), np.uint8))
    vis[edge > 0] = (255, 255, 0)
    cv2.imwrite(a.preview, vis)
