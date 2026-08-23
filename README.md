# 陶 · 器 — parametric pottery studio

A design studio for pottery, built on one idea: **the beautiful unification of
function and form** — renderings that are nice to behold, describing vessels
that would be nice to hold once really made.

Every vessel is a *parametric shape spec*, not a static model. You adjust the
curves that connoisseurship actually argues about (the slope of a 石瓢's side,
the fullness of a chawan's belly), see the form respond in real time, and see
the **function respond with it**: capacity, weight, real-world dimensions,
computed live from the same curves.

## The potter's DSL

A vessel is a **spec** — a JSON file composing anatomical components, in the
vocabulary potters already use (身 口 盖 钮 流 把 足):

```jsonc
{
  "id": "gu-jingzhou-dashipiao",
  "label": "大石瓢 · 顾景舟",
  "material": "zini", "scaleCm": 7,
  "wall":   { "base": 0.045, "belly": 0.036, "top": 0.034 },
  "body":   { "type": "spline", "height": 0.75, "bellyR": 0.90, "bellyY": 0.40, ... },
  "lid":    { "type": "flatDisc", "overhang": 0.045, "thickness": 0.05, "vent": 0.013 },
  "knob":   { "type": "bridgeStrap", "span": 0.54, "rise": 0.16, "tube": 0.078 },
  "spout":  { "type": "straightCone", "length": 0.58, "angle": 32, "attachY": 0.5, ... },
  "handle": { "type": "rearLoop", "reach": 0.46, "topY": 0.85, "botY": 0.26, ... },
  "base":   { "type": "studs", "count": 3, ... },
  "expose": ["body.height", "body.bellyR", "knob.rise", ...]   // which get sliders
}
```

The spec is the artifact; the app is its viewer. Every parameter of every
component is named and documented in `src/components/*.js`; anything a spec
omits falls back to the component default. The archive (`src/specs/`) is a
folder of these files, and the *diff* between two files is the connoisseurship
("Gu's knob is a low wide strap; Ziye's is a taller narrow arch").

**Rules of the DSL**

- *No surface without a back face.* Every component is a closed solid with a
  real wall thickness (`wall` may vary base→belly→top). Lids have thickness
  and a bored 气孔; spouts show wall at the pour opening. This makes cutaways,
  weight, capacity and STL export honest by construction.
- *Slots may be empty* (`type: "none"`) — a chawan is body + base and nothing
  else; a shiboridashi has no lid.
- *Sculptural wares* (花器) enter as imported meshes with the same metadata.

Component vocabulary (growing):

| slot | types today | planned |
|---|---|---|
| body 身 | cone, superellipse, pear, spline, bowl | lerpBell, polyline (方器), lobed (筋纹), mesh |
| rim 口 | (`collar` on the superellipse body) | its own slot: plain, gallery, neck |
| lid 盖 | none, flatDisc, dome, flush (截盖), ballCap (压盖) | douli, inset (kyusu), saucer |
| knob 钮 | none, bridgeStrap, bead | bridgePlate, loop, figural |
| spout 流 | none, straightCone, curved (弯嘴) | formedLip, curved, 三弯 |
| handle 把 | none, rearLoop | sideStick (横手), overheadBail (提梁), rearStick |
| base 足 | flat, studs, ring | — |
| strainer 滤 | — | singleHole, 球孔, mesh (sasame), plate |
| surface | material | ornament: seal 印章, engraving, relief |

## Architecture

```
src/
  geometry/loft.js     the generative primitives:
                         loftGeometry  profile × cross-section → mesh
                         shellGeometry outer profile + wall → closed solid
  components/          one file per anatomical slot; typed constructors
                       with documented params  (bodies, lids, knobs, spouts,
                       handles, bases) + index.js: buildVessel / vesselMetrics
  specs/               the archive: one JSON per vessel + index
  materials/           procedural PBR, no texture assets
  main.js              scene, lighting, UI generated from spec.expose,
                       URL = archive id + diff, 拍照 path-traced photo mode
scripts/
  qc.mjs               render one entry from eight angles — side, both
                       three-quarters, spout-on, handle-on, from above, from
                       below, close. Faults hide in a side view: an attachment
                       colliding with the lid, a gap where the foot ring meets
                       the body, a fillet folded through a wall. Run it before
                       calling a shape done.
  screenshot.mjs       headless render check of every archive entry
  spec-shot.mjs        render one URL spec headlessly
  fit/                 photo→spec: analysis-by-synthesis constrained to the DSL
    render-many.mjs      batch silhouette renders in one browser session (~1.5 s each)
    optimize.py          multi-view coordinate descent on silhouette IoU over all
                         spec params + per-view camera (elev/az), with a camera
                         grid pre-search; analytic registration (lid width, knob top)
    diff.py              per-view IoU (overall / lid+knob / handle / spout / body)
                         + diff map (grey both, red photo-only, blue render-only)
    common.py            masks, landmark-free registration, and the profile
                         metric: silhouette radius compared row by row
    overlay.py           outline overlay of a render on a photo
```

Fitting results so far: 相明石瓢 (three photos: level / near-level / steep
3-4) mean IoU 0.909, level view 0.952 — cameras solved to 5.5°/6.5°, 1.5°/0°,
35°/23°. 大石瓢 (four photos: auction side + three exhibition angles) mean IoU 0.936 —
0.929 / 0.917 / 0.940 / 0.959, body 0.96-0.99 in every view; cameras
(elev/az/dist) 10°/−7.5°/10, 12°/−6°/10, 20°/38°/7, 25°/−32°/8.

Two measurement bugs found while fitting it, both worth knowing about:
a photo mask built on colour alone **swallows the pot's cast shadow**, which
widens the base and pulls the fitted body toward a barrel (`scripts/fit/mask.py`
now rejects shadow by saturation: clay holds R-G at 20-35% of its brightness at
any exposure, shadow and dark wood do not); and hand-measured landmarks put the
measurer's error into every score, so registration is now landmark-free —
scale/offset are seeded from area and centroid, then chosen to maximise IoU
(`scripts/fit/common.py`). Light backdrops with engraving need
generous `hole_px`; cluttered backdrops → precomputed masks (`"mask"` field).

URL grammar: `#id=<archive-id>&mat=<material>&<slot>.<param>=<value>...&cam=side&ui=hide`
— only params that differ from the archive entry are written, so a link *is*
a diff against a canonical pot. 导出 downloads the working spec as JSON.

## Run

```
npm install
npm run dev        # local dev server
npm run build      # static site in dist/ — deployable to any host
node scripts/screenshot.mjs   # headless render check → shots/
```

## Roadmap

- **Shapes**: 西施 / 仿古 (圆器), 六方 (方器 — cross-section already supported),
  菱花 (筋纹器), 急須 kyusu side-handle, Brown Betty, 供春 (花器, mesh import)
- **Function metrics v2**: center of mass / balance point, handle clearance,
  spout-vs-rim water line, pour angle
- **Cutaway view**: every surface is a true walled solid, so a section plane
  can expose wall cross-sections — and eventually microscopic material
  structure (pore density of 朱泥 vs 段泥) rendered in the cut face
- **印章**: user seal on the base — connects to calligraphy
- **Component vocabulary**: fill the "planned" column above; rim and strainer
  slots; 花器 mesh import
- **Photo→spec v2**: shading-based
  terms for features silhouettes can't see; use the base photo (feet, seal)
  as a fourth constraint
- **Fillets (润接)**: spout and handle roots on real pots blend into the body
  with wide concave fillets; the vocabulary attaches them crisply. A per-
  attachment `blend` radius is the next fidelity step — and now the *largest*
  measured error, since the body silhouette is settled

## Canon before pixels

A shape family is recognised by **features, not resemblance**: a face may have
larger or smaller eyes, but it has exactly two and they are level. 石瓢 is a
cone with the tip cut off — widest at the foot, flank never widening upward,
flat lid, bridge knob, straight spout, three feet. Those are assertions about
the geometry, so they are checked *analytically on the profile curve*, with no
rendering and no pixels:

```
node scripts/check-canon.mjs          # exits non-zero on any violation
```

It also carries one rule that belongs to no family: **the handle must clear the
lid**. A loop whose arc rises into the brim is a collision from every angle, but
it hides well in a single three-quarter render — so it is asserted, by sampling
the handle's vertices against a cylinder bounding the lid, rather than eyeballed.
Both 顾景舟 石瓢 failed it at 10.7% and 5.0% intrusion before the check existed.

This is the acceptance test; photo agreement is the tie-breaker within it, not
the other way round. The lesson that produced it: a body can sit at IoU 0.94
and profile-RMS 2% against a real photograph and still not be a 石瓢 at all —
the pixel metrics differed by 0.2% between the right character and the wrong
one. Nothing could fail, because nothing had been written down.

`src/components/bodies.js` therefore offers a `cone` body type whose character
is guaranteed by construction (`bow` 0 is dead straight), rather than a general
spline that *can* be a cone if the optimiser happens to land there.

Families so far:

| family | primitive | what makes it that family |
|---|---|---|
| 石瓢 | `cone` | a cone with the tip cut off: widest at the foot, flank never widening upward, straight within 3%; flat lid, bridge knob, straight spout, three feet |
| 潘壶 | `pear` | 口小肚大 with an **inflection** neither other family can make: convex round the belly, concave as it draws in to the neck. Belly in the middle third, foot narrower than the belly, a **弯嘴** curved spout, 环把 ring handle, 圆珠钮, and a flat base standing on a **底圈** foot ring. (The seal belongs on the lid rim — a decoration rule, recorded but not checkable geometrically.) |
| 掇球 | `superellipse` + `ballCap` | 掇 means *to stack*: body, lid and knob are three balls piled on one axis, each smaller than the one below. The identity is the proportions between them — the whole pot fits a circle (盖顶至底 ≈ 身径), the mouth is the golden part of the body (E/E2 = 0.618), the lid is a true spherical cap springing from inside a flat brim, and a projecting rim collar (唇) separates ball 1 from ball 2. 一弯嘴, 耳形环把, 圈足 |
| 西施 | `superellipse` | fuller than an ellipse and asymmetric top to bottom; widest near mid-height, wider than tall, no straight run anywhere in the flank; a wide mouth closed by a **截盖** lid that runs up the body's own curve until the ball is complete (a flat-topped lid reads as the wrong family), a bead knob on the neck it converges to, a **短流略粗** spout, a fully-round **倒耳把** thick at the shoulder and tapering to the belly, flat footless base |

掇球 is where the sources and the objects disagreed. The literature calls the
寿珍 lid 明显的半球状 — "a clear hemisphere". Measured off two near-level
photographs, both sit at **a third** of their rim diameter, not a half; the two
also agree on 1.03 / 1.05 for 盖顶至底 ÷ 身径 and 0.63 / 0.66 for the mouth,
bracketing the classical 0.618. The canon ranges come from the photographs, the
literature's claim is recorded next to them in the spec's notes, and the
measured values are printed by every check so a later correction has something
to argue with. This is the same discipline that caught the invented "mouth
45-70% of foot" bound: a number nobody measured is not canon.

The 西施 case is the interesting one: you cannot name its shape (it is not a
sphere, and an ellipse reads as cheap), but you *can* name its relations, and
those are what the check enforces. A Lamé curve with exponent ~2.2-2.5, cut
flat at both ends, gives the form; the lid continuing the body's own curve is
the feature that most decides whether it reads as 西施 at all.

`scripts/fit/shape_audit.py` is the same idea against a reference photograph:
it reports whether the body profile agrees within tolerance, widens toward the
foot, and puts the widest point where the reference does — pass/fail, exit code.

**On metrics.** Silhouette IoU is area-based and nearly blind to the thing
connoisseurship cares about: a body can be visibly the wrong character and
still score 0.94. `profile_rmse` in `scripts/fit/common.py` compares the
silhouette's radius row by row (taking the narrower side, since a handle or
spout only widens one of them, with a trimmed RMS so attachment rows cannot
dominate). Pass `--profile-weight 3` to `optimize.py` to use it. It also needs
a near-level reference: in a view looking down, the lower flank is
foreshortened and under-constrained, which is how a barrel once passed for a
cone.
