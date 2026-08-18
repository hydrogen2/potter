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
| body 身 | spline, bowl | lerpBell, polyline (方器), lobed (筋纹), mesh |
| rim 口 | — | plain, gallery, neck |
| lid 盖 | none, flatDisc, dome | douli, inset (kyusu), saucer |
| knob 钮 | none, bridgeStrap, bead | bridgePlate, loop, figural |
| spout 流 | none, straightCone | formedLip, curved, 三弯 |
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
  screenshot.mjs       headless render check of every archive entry
  spec-shot.mjs        render one URL spec headlessly
  fit/                 photo→spec: analysis-by-synthesis constrained to the DSL
    render-many.mjs      batch silhouette renders in one browser session (~1.5 s each)
    optimize.py          multi-view coordinate descent on silhouette IoU over all
                         spec params + per-view camera (elev/az), with a camera
                         grid pre-search; analytic registration (lid width, knob top)
    diff.py              per-view IoU (overall / lid+knob / handle / spout / body)
                         + diff map (grey both, red photo-only, blue render-only)
    overlay.py           outline overlay of a render on a photo
```

Fitting results so far: 相明石瓢 (three photos: level / near-level / steep
3-4) mean IoU 0.909, level view 0.952 — cameras solved to 5.5°/6.5°, 1.5°/0°,
35°/23°. 大石瓢 (four photos: auction side + three exhibition angles, GrabCut masks
in fit/refs/masks) mean IoU 0.882 — 0.917 / 0.867 / 0.932 / 0.813; cameras
10°/−8°, 10°/−24°, 30°/32°, 7.5°/−42°. Light backdrops with engraving need
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
- **Photo→spec v2**: tune per-view `dist` (perspective) too; shading-based
  terms for features silhouettes can't see; use the base photo (feet, seal)
  as a fourth constraint
- **Fillets (润接)**: spout and handle roots on real pots blend into the body
  with wide concave fillets; the vocabulary attaches them crisply. A per-
  attachment `blend` radius is the next fidelity step
