import * as THREE from 'three'
import { shellGeometry, ngonSection, lobeSection } from '../geometry/loft.js'
import { GLYPHS } from '../glyphs/index.js'

/**
 * 身 — body profile families. Each returns { outer: Vector2[], radiusAt(y) }
 * describing the OUTER silhouette (radius, y) bottom→top on the base plane;
 * the shell primitive adds the wall.
 *
 * spline    control points that ARE the connoisseurship vocabulary
 * lerpBell  base→mouth taper + belly bulge (the simple family)
 * polyline  raw points, straight segments (方器-style flat facets)
 */

function radiusFn(outer) {
  return (y) => {
    if (y <= outer[0].y) return outer[0].x
    for (let i = 1; i < outer.length; i++) {
      if (outer[i].y >= y) {
        const a = outer[i - 1]
        const b = outer[i]
        const t = (y - a.y) / (b.y - a.y || 1e-6)
        return a.x + (b.x - a.x) * t
      }
    }
    return outer[outer.length - 1].x
  }
}



export const BODIES = {
  // 方器. The geometry layer has taken a crossSection since the beginning and
  // nothing has ever used one — every body so far has been a surface of
  // revolution. This is the first that is not.
  //
  // The profile is deliberately straight-dominant: 以直线、横线为主，曲线、细线
  // 为辅. A 方器's authority comes from flat faces meeting at clean 棱线, so the
  // flank is a straight run with only a slight 鼓 (bow), and the shoulder is a
  // turn rather than a curve.
  faceted: {
    label: '方器',
    params: {
      facets: { label: '面数', min: 4, max: 8, step: 1, default: 6 },
      crisp: { label: '棱角', min: 3, max: 40, step: 1, default: 16 },
      height: { label: '身高', min: 0.3, max: 1.6, step: 0.01, default: 0.72 },
      maxR: { label: '身宽', min: 0.4, max: 1.3, step: 0.005, default: 0.95 },
      bellyY: { label: '腹高', min: 0.15, max: 0.7, step: 0.01, default: 0.40 },
      bow: { label: '鼓', min: 0, max: 0.14, step: 0.004, default: 0.035 },
      // how far the belly's turn is rounded. The flank is two straight runs
      // meeting at the widest point; left as a hard min they meet in a crease
      // and the pot reads as two cones stuck together. 方器 wants straight
      // faces and a *turn* at the belly, not a corner.
      belly: { label: '腹圆', min: 0.01, max: 0.4, step: 0.01, default: 0.12 },
      shoulderY: { label: '肩高', min: 0.5, max: 0.98, step: 0.01, default: 0.80 },
      shoulderR: { label: '肩宽', min: 0.3, max: 1.2, step: 0.005, default: 0.80 },
      mouthR: { label: '口径', min: 0.2, max: 0.9, step: 0.005, default: 0.60 },
      footR: { label: '底径', min: 0.2, max: 1.1, step: 0.005, default: 0.70 },
      footH: { label: '足高', min: 0, max: 0.14, step: 0.004, default: 0.045 },
    },
    profile(p) {
      const H = p.height
      const pts = []
      const V = (r, y) => pts.push(new THREE.Vector2(r, y))
      V(0.02, 0)
      V(p.footR * 0.7, 0)
      V(p.footR, 0.004)
      V(p.footR, p.footH)                       // the foot stands square
      // flank: a straight run to the belly and on to the shoulder, bowed
      // slightly outward so it does not read as machined
      const yB = H * p.bellyY, yS = H * p.shoulderY
      // the two straight runs, and a smooth minimum of them so the belly is a
      // turn rather than a crease
      const up = (y) => THREE.MathUtils.lerp(
        p.footR, p.maxR, (y - p.footH) / Math.max(yB - p.footH, 1e-6))
      const dn = (y) => THREE.MathUtils.lerp(
        p.maxR, p.shoulderR, (y - yB) / Math.max(yS - yB, 1e-6))
      const k = 1 / Math.max(p.belly ?? 0.12, 1e-3)
      const softMin = (a, b) => -Math.log(Math.exp(-k * a) + Math.exp(-k * b)) / k
      const N = 26
      for (let i = 1; i <= N; i++) {
        const y = THREE.MathUtils.lerp(p.footH, yS, i / N)
        const bow = p.bow * Math.sin(Math.PI * ((y - p.footH) / Math.max(yS - p.footH, 1e-6)))
        V(softMin(up(y), dn(y)) + bow, y)
      }
      // shoulder: a turn, not a curve — three points is enough to read as an edge
      V(THREE.MathUtils.lerp(p.shoulderR, p.mouthR, 0.45), THREE.MathUtils.lerp(yS, H, 0.55))
      V(p.mouthR, H * 0.97)
      V(p.mouthR, H)
      const outer = pts
      const section = ngonSection(p.facets, p.crisp)
      const rFn = radiusFn(outer)
      return {
        outer,
        // the apothem at this height, times the polygon's shape at this angle
        radiusAt: (y, theta = 0) => rFn(y) * section(theta),
        crossSection: (theta) => section(theta),
        facets: p.facets,
        height: H,
        mouthR: p.mouthR,
        bottomAt: () => 0,
      }
    },
  },

  // 茶 revolved. The pot is a cone; the character is a *deviation* from it.
  //
  // Revolving 茶 literally gives a wasp-waisted double cone — at 木's vertical
  // stroke there is nothing off the axis at all, so the profile pinches to
  // almost nothing and there is no pot there. Instead the form is a truncated
  // cone on a cylinder foot, and the revolved character is added as a fraction
  // of its difference from that cone: `relief` 0 leaves a plain cone, 1 gives
  // the literal revolution, and a tenth of the way gives soft rings tracing
  // where the strokes run. The symmetry the character already has is the whole
  // point, so nothing here breaks it.
  // 茶 revolved — and the silhouette *is* the character.
  //
  // Engraving 茶 on a pot shaped like something else is not this design: it is
  // a 石瓢 with writing on it. So the profile is the house the character itself
  // gives — the right half of the outline in cha_plan, turned about the axis.
  // 𠆢 is not drawn anywhere, because 𠆢 is the pot's own shoulder; the upright
  // sides are the cylinder; the mouth is the notch at the peak. Only 木 and its
  // two diagonals are drawn on, and drawn as *lines* — skeletons of the strokes
  // rather than a font's filled shapes, because what belongs on a pot is a
  // written character and not a typeset one.
  glyphRevolve: {
    label: '字·回旋',
    params: {
      height: { label: '身高', min: 0.4, max: 1.6, step: 0.01, default: 0.90 },
      soften: { label: '折圆', min: 0, max: 0.12, step: 0.002, default: 0.03 },
      face: { label: '字凸', min: 0, max: 0.10, step: 0.002, default: 0.020 },
      // 0 lets the span be derived so the character keeps its own proportions:
      // wrapped over too wide an arc it smears out sideways and stops reading.
      faceSpan: { label: '字宽', min: 0, max: 200, step: 2, default: 0 },
      faceAt: { label: '字位', min: -180, max: 180, step: 5, default: 90 },
      faceLo: { label: '字底', min: 0, max: 0.6, step: 0.01, default: 0.06 },
      faceHi: { label: '字顶', min: 0.4, max: 1.0, step: 0.01, default: 0.93 },
      glyph: { label: '字', min: 0, max: 0, step: 1, default: 'cha' },
    },
    profile(p) {
      const G = GLYPHS[p.glyph ?? 'cha']
      const half = (G?.body?.[0] ?? []).filter((q) => q[0] >= 0)
        .map((q) => [q[0], q[1]]).sort((a, b) => a[1] - b[1])
      const yMin = Math.min(...half.map((q) => q[1]))
      const raw = Math.max(...half.map((q) => q[1])) - yMin
      const k = p.height / (raw || 1)
      const key = half.map(([r, y]) => new THREE.Vector2(r * k, (y - yMin) * k))

      // walk the corners, rounding each by `soften` — a thrown or beaten pot
      // has no knife edges, and a razor-sharp eave reads as cardboard
      const pts = [new THREE.Vector2(0.03, 0), new THREE.Vector2(key[0].x * 0.7, 0)]
      const r0 = p.soften
      for (let i = 0; i < key.length; i++) {
        const A = key[i - 1] ?? new THREE.Vector2(key[0].x, -1)
        const V = key[i]
        const B = key[i + 1] ?? new THREE.Vector2(V.x, V.y + 1)
        const d1 = A.clone().sub(V), d2 = B.clone().sub(V)
        const l1 = d1.length(), l2 = d2.length()
        if (l1 < 1e-6 || l2 < 1e-6) { pts.push(V.clone()); continue }
        d1.divideScalar(l1); d2.divideScalar(l2)
        const half2 = Math.acos(Math.min(1, Math.max(-1, d1.dot(d2)))) / 2
        const r = Math.min(r0, Math.tan(half2) * Math.min(l1, l2) * 0.45)
        // Two degeneracies, not one. half2 -> 0 is a spike, which was guarded.
        // half2 -> pi/2 is the opposite: the edges are collinear, so there is no
        // corner to round at all — and there the bisector is the zero vector, it
        // normalises to nothing, the arc centre collapses onto the vertex, and
        // the "arc" comes out as a ring of radius `soften` *around* V, moving the
        // point outward by exactly that. It happens at the top of the mouth,
        // where B is the synthetic vertical continuation, so every glyph pot's
        // mouth has been `soften` too wide and the lid's ring could never sit in
        // it. Caught by the canon rule, which measures the mouth against 艹.
        if (!(r > 1e-5) || half2 < 1e-3 || Math.PI / 2 - half2 < 1e-3) {
          pts.push(V.clone()); continue
        }
        const t = r / Math.tan(half2)
        const T1 = V.clone().addScaledVector(d1, t)
        const T2 = V.clone().addScaledVector(d2, t)
        const bis = d1.clone().add(d2).normalize()
        const C = V.clone().addScaledVector(bis, r / Math.sin(half2))
        const a1 = Math.atan2(T1.y - C.y, T1.x - C.x)
        let a2 = Math.atan2(T2.y - C.y, T2.x - C.x)
        while (a2 - a1 > Math.PI) a2 -= Math.PI * 2
        while (a2 - a1 < -Math.PI) a2 += Math.PI * 2
        for (let j = 0; j <= 8; j++) {
          const a = a1 + ((a2 - a1) * j) / 8
          pts.push(new THREE.Vector2(C.x + r * Math.cos(a), C.y + r * Math.sin(a)))
        }
      }
      // Resample the whole profile at a fine, even spacing. The corners supply
      // very few points along the straight runs, and the drawn character needs
      // rows to be drawn *on* — at the coarse spacing only its longest stroke
      // survived and the rest vanished into the shading.
      const dense = [pts[0]]
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i]
        const n = Math.max(1, Math.ceil(a.distanceTo(b) / 0.006))
        for (let j = 1; j <= n; j++) dense.push(a.clone().lerp(b, j / n))
      }
      const outer = dense
      const rFn = radiusFn(outer)
      const H = outer[outer.length - 1].y
      const eaves = key[1] ? key[1].y : H * 0.5

      // The three groups of 茶 are placed on the three parts of the pot the
      // character itself names, and the house polygon's own corners say where
      // each part is: 木 on the cylinder, 𠆢 on the cone whose slope it is, 艹
      // at the mouth. Drawn as one block they can only be placed as a block,
      // and then 𠆢 lands on the cylinder rather than on the slope it describes.
      const GS = G?.groups
      const bands = []
      if (GS && p.face > 0) {
        const decode = (o) => {
          const bin = atob(o.data)
          const a = new Uint8Array(bin.length)
          for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i)
          return a
        }
        const sampler = (o, grid) => (gx, gy) => {
          const u = (gx - o.x0) / (o.x1 - o.x0)
          const v = (o.y1 - gy) / (o.y1 - o.y0)
          if (u < 0 || u > 1 || v < 0 || v > 1) return 0
          const i = Math.min(o.size - 1, Math.floor(u * o.size))
          const j = Math.min(o.size - 1, Math.floor(v * o.size))
          return grid[j * o.size + i] / 255
        }
        const eavesY = key[1] ? key[1].y : H * 0.55
        const mouthY = key[2] ? key[2].y : H * 0.86
        const parts = [
          ['wood', H * p.faceLo, eavesY - H * 0.02],
          ['roof', eavesY, mouthY],
          ['cao', mouthY, H],
        ]
        // Each group is held undistorted — its arc width is its own aspect times
        // its band's height — but capped, because a group placed where the pot
        // has narrowed would otherwise wrap past the front face and out of view.
        const cap = THREE.MathUtils.degToRad(p.faceSpan > 0 ? p.faceSpan : 70)
        for (const [k, lo, hi] of parts) {
          const o = GS[k]
          if (!o || !(hi > lo)) continue
          const bb = o.bbox
          const aspect = (bb[1] - bb[0]) / Math.max(bb[3] - bb[2], 1e-6)
          const rMid = Math.max(rFn((lo + hi) / 2), 1e-6)
          bands.push({ lo, hi, bb, span: Math.min(cap, ((hi - lo) * aspect) / rMid),
            sample: sampler(o, decode(o)) })
        }
      }
      const at = THREE.MathUtils.degToRad(p.faceAt)
      const crossSection = bands.length
        ? (theta, _t, y) => {
            let d = theta - at
            while (d > Math.PI) d -= Math.PI * 2
            while (d < -Math.PI) d += Math.PI * 2
            for (const b of bands) {
              if (y < b.lo || y > b.hi || Math.abs(d) > b.span / 2) continue
              const gx = (d / b.span) * (b.bb[1] - b.bb[0]) + (b.bb[0] + b.bb[1]) / 2
              const gy = ((y - b.lo) / (b.hi - b.lo)) * (b.bb[3] - b.bb[2]) + b.bb[2]
              const v = b.sample(gx, gy)
              if (v > 0) return 1 + p.face * v
            }
            return 1
          }
        : undefined

      return {
        outer,
        radiusAt: (y, theta = 0) => rFn(y),
        crossSection,
        glyphFace: bands.length ? 1 : 0,
        height: H,
        mouthR: outer[outer.length - 1].x,
        boreR: outer[outer.length - 1].x,
        bottomAt: () => 0,
      }
    },
  },

  spline: {
    label: '样条',
    params: {
      height: { label: '身高', min: 0.4, max: 1.4, step: 0.005, default: 0.8 },
      baseR: { label: '底径', min: 0.2, max: 1.0, step: 0.005, default: 0.8 },
      bellyR: { label: '身宽', min: 0.3, max: 1.1, step: 0.005, default: 0.85 },
      bellyY: { label: '腹位', min: 0.15, max: 0.7, step: 0.005, default: 0.42 },
      shoulder: { label: '肩弧', min: -0.5, max: 2, step: 0.01, default: 0.3 },
      lowerFull: { label: '下腹弧', min: -0.04, max: 0.18, step: 0.002, default: 0.008 },
      mouthR: { label: '口径', min: 0.15, max: 0.9, step: 0.005, default: 0.4 },
      underDome: { label: '底弧', min: 0, max: 0.12, step: 0.002, default: 0 },
      cornerR: { label: '底角', min: 0.01, max: 0.15, step: 0.002, default: 0.03 },
    },
    profile(p) {
      // y=0 is the lowest point of the body (dome centre); the outer corner
      // ring sits at y=underDome, then the flank rises to the rim at
      // underDome+height. Real 石瓢 bottoms are gently convex — hence feet.
      const H = p.height
      const d = p.underDome
      const c = p.cornerR
      // The foot is built as an explicit tangent fillet, not as spline control
      // points: a Catmull-Rom through an underside point and a corner point
      // overshoots between them and extrudes a small skirt above the foot —
      // which reads as a barrel/bell, not as the clean corner a 石瓢 has.
      const cornerY = d + c
      const bottom = [
        new THREE.Vector2(0.03, 0),
        new THREE.Vector2(p.baseR * 0.55, d * 0.5),
      ]
      const FILLET_STEPS = 10
      for (let i = 0; i <= FILLET_STEPS; i++) {
        const a = -Math.PI / 2 + (i / FILLET_STEPS) * (Math.PI / 2)
        bottom.push(
          new THREE.Vector2(p.baseR - c + c * Math.cos(a), d + c + c * Math.sin(a)),
        )
      }
      const bellyY = Math.max(d + H * p.bellyY, cornerY + 0.02)
      const ctrl = [
        new THREE.Vector2(p.baseR, cornerY),   // flank starts at the fillet's top
        new THREE.Vector2(
          Math.min(THREE.MathUtils.lerp(p.baseR, p.bellyR, 0.5) + (p.lowerFull ?? 0.008), p.baseR),
          THREE.MathUtils.lerp(cornerY, bellyY, 0.5),
        ),
        new THREE.Vector2(p.bellyR, bellyY),
        new THREE.Vector2(
          THREE.MathUtils.lerp(p.bellyR, p.mouthR, 0.55) + p.shoulder * 0.12,
          THREE.MathUtils.lerp(bellyY, d + H, 0.58),
        ),
        new THREE.Vector2(p.mouthR, d + H),
      ]
      const outer = [...bottom, ...new THREE.SplineCurve(ctrl).getSpacedPoints(90).slice(1)]
      return {
        outer, radiusAt: radiusFn(outer), height: d + H, mouthR: p.mouthR,
        bottomAt: (r) => d * Math.pow(Math.min(r / p.baseR, 1), 2), // underside height
      }
    },
  },

  cone: {
    label: '锥形',
    // 石瓢 and its relatives are a cone with the tip cut off. Saying so in the
    // vocabulary guarantees the character — widest at the foot, flank never
    // widening upward — instead of hoping a general spline lands on it.
    params: {
      height: { label: '身高', min: 0.3, max: 1.4, step: 0.005, default: 0.7 },
      baseR: { label: '底径', min: 0.3, max: 1.2, step: 0.005, default: 0.93 },
      mouthR: { label: '口径', min: 0.15, max: 0.9, step: 0.005, default: 0.53 },
      bow: { label: '腹弧', min: -0.02, max: 0.10, step: 0.002, default: 0.012 },
      shoulder: { label: '肩收', min: 0, max: 0.25, step: 0.005, default: 0.05 },
      underDome: { label: '底弧', min: 0, max: 0.12, step: 0.002, default: 0.015 },
      cornerR: { label: '底角', min: 0.01, max: 0.16, step: 0.002, default: 0.08 },
    },
    profile(p) {
      const H = p.height
      const d = p.underDome
      const c = p.cornerR
      const cornerY = d + c
      const outer = [
        new THREE.Vector2(0.03, 0),
        new THREE.Vector2(p.baseR * 0.55, d * 0.5),
      ]
      const FILLET = 10
      for (let i = 0; i <= FILLET; i++) {
        const th = -Math.PI / 2 + (i / FILLET) * (Math.PI / 2)
        outer.push(new THREE.Vector2(p.baseR - c + c * Math.cos(th), d + c + c * Math.sin(th)))
      }
      const topY = d + H
      const N = 70
      for (let i = 1; i <= N; i++) {
        const t = i / N
        const y = THREE.MathUtils.lerp(cornerY, topY, t)
        let r = THREE.MathUtils.lerp(p.baseR, p.mouthR, t)
        r += p.bow * 4 * t * (1 - t) * p.baseR          // gentle belly, 0 = dead straight
        r -= p.shoulder * Math.pow(Math.max(0, t - 0.7) / 0.3, 2) * p.baseR  // turn in at the shoulder
        outer.push(new THREE.Vector2(Math.max(r, 0.05), y))
      }
      return {
        outer, radiusAt: radiusFn(outer), height: topY, mouthR: outer[outer.length - 1].x,
        bottomAt: (r) => d * Math.pow(Math.min(r / p.baseR, 1), 2),
      }
    },
  },

  superellipse: {
    label: '超椭圆',
    // For the full round wares (西施, 掇球, 仿古). A sphere is wrong and an
    // ellipse is nearly right — what makes 西施 read as 西施 is that it is
    // *fuller* than an ellipse (a Lamé curve with exponent > 2) and that its
    // lower half is fuller than its upper half. Both halves are cut flat: the
    // bottom gives the foot, the top gives the mouth the 截盖 lid sits into.
    params: {
      maxR: { label: '身宽', min: 0.4, max: 1.2, step: 0.005, default: 0.95 },
      // bellyY only positions the curve before the foot is normalised to y=0,
      // so it translates and never changes the form — the belly's *relative*
      // height comes from lowerAxis vs upperAxis. Kept internal, not tunable.
      bellyY: { label: '腹高', min: 0.44, max: 0.44, step: 0.005, default: 0.44 },
      lowerAxis: { label: '下半高', min: 0.2, max: 1.2, step: 0.005, default: 0.56 },
      upperAxis: { label: '上半高', min: 0.2, max: 1.2, step: 0.005, default: 0.52 },
      // exponent 2 is an ellipse; below 2 the curve pinches to a point and the
      // pot reads as a teardrop, never as 西施. The floor is part of the family.
      lowerFull: { label: '下丰满', min: 2.0, max: 4.0, step: 0.02, default: 2.45 },
      upperFull: { label: '上丰满', min: 2.0, max: 4.0, step: 0.02, default: 2.15 },
      mouthR: { label: '口径', min: 0.15, max: 0.9, step: 0.005, default: 0.42 },
      footR: { label: '底径', min: 0.15, max: 0.9, step: 0.005, default: 0.45 },
      basePress: { label: '捺底', min: 0, max: 0.12, step: 0.002, default: 0.03 },
      // 唇 — a rim collar projecting beyond the mouth, with a short neck under
      // it. 掇球 needs it: the ledge is what separates the body ball from the
      // lid ball, and without it the two read as one continuous egg. 0 (the
      // default) leaves the mouth cut flat, as 西施 wants it.
      collar: { label: '唇宽', min: 0, max: 0.16, step: 0.004, default: 0 },
      // 筋纹器: ribs round the body. 0 leaves it plain, which is every round
      // ware so far. The ribs must run unbroken from knob to foot (贯通), so
      // there is deliberately no fade — the lid and knob carry the same count.
      lobes: { label: '筋数', min: 0, max: 24, step: 1, default: 0 },
      lobeDepth: { label: '筋深', min: 0, max: 0.12, step: 0.002, default: 0.03 },
      lobeSharp: { label: '筋形', min: 0.4, max: 3, step: 0.05, default: 1 },
      collarH: { label: '唇高', min: 0.01, max: 0.14, step: 0.004, default: 0.05 },
      // 颈 — a short upright run lifting the mouth clear of the shoulder. The
      // collar needs something to stand on; grown straight out of the shoulder
      // curve it reads as a flange rather than a ring.
      neck: { label: '颈高', min: 0, max: 0.18, step: 0.004, default: 0 },
    },
    profile(p) {
      // quarter Lamé curve: r = maxR * (1 - u^n)^(1/n), u = distance from the
      // belly along the axis, normalised by that half's axis length
      const at = (dy, axis, n) => {
        const u = Math.min(Math.abs(dy) / axis, 1)
        return p.maxR * Math.pow(Math.max(0, 1 - Math.pow(u, n)), 1 / n)
      }
      const N = 46
      // the lower curve is cut at the foot radius, not run to the pole: a 西施
      // stands on a real flat base (一捺底), it is not a ball resting on a point
      const footR = Math.min(p.footR ?? 0.45, p.maxR * 0.95)
      const uFoot = Math.pow(
        Math.max(0, 1 - Math.pow(footR / p.maxR, p.lowerFull)), 1 / p.lowerFull,
      )
      const dyFoot = uFoot * p.lowerAxis
      const lower = []
      for (let i = N; i >= 1; i--) {
        const dy = (i / N) * dyFoot
        lower.push(new THREE.Vector2(at(dy, p.lowerAxis, p.lowerFull), p.bellyY - dy))
      }
      const upper = []
      for (let i = 1; i <= N; i++) {
        const dy = (i / N) * p.upperAxis
        const r = at(dy, p.upperAxis, p.upperFull)
        if (r >= p.mouthR) upper.push(new THREE.Vector2(r, p.bellyY + dy))
        else break
      }
      // cut both ends flat: a foot to stand on, a mouth for the lid
      const foot = new THREE.Vector2(footR, p.bellyY - dyFoot)
      // 一捺底: the base is pressed in, so the pot rests on a ring at the foot
      // radius and the centre of the underside sits slightly higher
      const press = p.basePress ?? 0
      const rim = upper.length ? upper[upper.length - 1] : new THREE.Vector2(p.mouthR, p.bellyY + p.upperAxis * 0.8)
      // the rim: either cut flat at the mouth, or drawn in to a neck and flared
      // back out into a projecting collar (唇) for the lid to sit on
      const collar = p.collar ?? 0
      const cH = p.collarH ?? 0.05
      // Sampled as a rounded bead rather than stepped out with corner points:
      // square corners here stack with the lid's rim and read as a staircase.
      // It swells past the ledge radius in the middle and rounds back to it at
      // the top, which is the seat the lid sits on.
      const neck = p.neck ?? 0
      const top = []
      if (collar > 0) {
        // the neck: upright, drawing in very slightly
        const NN = 8
        for (let i = 0; i <= NN; i++) {
          const t = i / NN
          top.push(new THREE.Vector2(p.mouthR * (1 - 0.03 * t), rim.y + neck * t))
        }
        // the collar: a ring that stands *proud*. sin(pi t) takes the radius
        // out and all the way back, which is what puts a shadow line under the
        // ring; the smoothstep term leaves it finishing wider than the neck, at
        // the seat the lid rests on. A profile that only swells and stays wide
        // is a flange, and reads as one.
        const y1 = rim.y + neck
        const NB = 22
        for (let i = 1; i <= NB; i++) {
          const t = i / NB
          const proud = Math.pow(Math.sin(Math.PI * t), 0.7)
          const seat = 0.45 * t * t * (3 - 2 * t)
          top.push(new THREE.Vector2(
            p.mouthR * 0.97 + collar * (proud * 0.75 + seat),
            y1 + cH * t,
          ))
        }
      } else {
        top.push(new THREE.Vector2(p.mouthR, rim.y))
      }
      const seatR = collar > 0 ? p.mouthR * 0.97 + collar * 0.45 : p.mouthR
      const ribs = p.lobes >= 3 ? lobeSection(p.lobes, p.lobeDepth, p.lobeSharp) : () => 1
      const outer = [
        new THREE.Vector2(0.03, foot.y + press),
        new THREE.Vector2(footR * 0.5, foot.y + press * 0.78),
        new THREE.Vector2(footR * 0.85, foot.y + press * 0.28),
        new THREE.Vector2(footR, foot.y),
        ...lower,
        new THREE.Vector2(p.maxR, p.bellyY),
        ...upper,
        ...top,
      ]
      // capture the curve's own coordinates before standing the foot on y = 0,
      // otherwise capAt() below subtracts the offset a second time
      const rimAbove = rim.y - p.bellyY           // how far the cut sits above the belly
      const y0 = outer[0].y
      for (const v of outer) v.y -= y0            // stand the foot on y = 0
      return {
        // rim.y is a reference into `outer`, so it is already relative to the
        // foot; with a collar the body's top is the ledge, not the mouth cut
        outer,
        radiusAt: (y, theta = 0) => radiusFn(outer)(y) * ribs(theta),
        crossSection: p.lobes >= 3 ? (theta) => ribs(theta) : undefined,
        lobes: p.lobes >= 3 ? p.lobes : 0,
        height: rim.y + (collar > 0 ? neck + cH : 0),
        mouthR: seatR,               // what the lid seats on
        boreR: p.mouthR,             // the actual opening, which the 子口 drops into
        bottomAt: (r) => press * Math.pow(Math.max(0, 1 - r / Math.max(foot.x, 1e-3)), 1.6),
        // the curve the body *would* follow above the mouth: a 截盖 lid is a
        // cut section of it, so the silhouette runs unbroken to the knob
        capAt: (dyAboveRim) => {
          const dy = rimAbove + dyAboveRim
          const u = Math.min(Math.abs(dy) / p.upperAxis, 1)
          return p.maxR * Math.pow(Math.max(0, 1 - Math.pow(u, p.upperFull)), 1 / p.upperFull)
        },
        capLimit: Math.max(0, p.upperAxis - rimAbove),
      }
    },
  },

  pear: {
    label: '梨形',
    // 潘壶 and the other 梨形 wares: 口小肚大. Unlike the cone or the
    // superellipse this profile has an inflection — convex round the belly,
    // then *concave* as it draws in to the neck, with a slight flare at the
    // rim. That change of sign is the family's signature.
    params: {
      height: { label: '身高', min: 0.4, max: 1.6, step: 0.005, default: 1.0 },
      bellyR: { label: '腹径', min: 0.4, max: 1.2, step: 0.005, default: 0.86 },
      bellyY: { label: '腹位', min: 0.18, max: 0.75, step: 0.005, default: 0.34 },
      footR: { label: '底径', min: 0.15, max: 0.8, step: 0.005, default: 0.46 },
      neckR: { label: '颈径', min: 0.15, max: 0.8, step: 0.005, default: 0.5 },
      neckY: { label: '颈位', min: 0.6, max: 1.0, step: 0.005, default: 0.9 },
      flare: { label: '口侈', min: 0, max: 0.12, step: 0.002, default: 0.02 },
      lowerFull: { label: '下丰满', min: 2.0, max: 3.6, step: 0.02, default: 2.4 },
      shoulder: { label: '肩收', min: 0.3, max: 3.0, step: 0.02, default: 1.4 },
    },
    profile(p) {
      const H = p.height
      const bellyY = H * p.bellyY
      const neckY = H * p.neckY
      const pts = [new THREE.Vector2(p.footR, 0)]
      // belly: a proper Lamé quarter between foot and widest point, so the wall
      // *rounds into* the belly instead of snapping to it
      const NL = 30
      const n = p.lowerFull
      for (let i = 1; i <= NL; i++) {
        const t = i / NL
        const u = 1 - t                                   // 1 at the foot, 0 at the belly
        const r = p.footR + (p.bellyR - p.footR) * Math.pow(Math.max(0, 1 - Math.pow(u, n)), 1 / n)
        pts.push(new THREE.Vector2(r, bellyY * t))
      }
      // shoulder: draws in to the neck. Eased at *both* ends — leaving the
      // belly and arriving at the neck — or the wall meets the lip at an angle
      // and the pot creases where a thrown pot flows.
      const NU = 34
      for (let i = 1; i <= NU; i++) {
        const t = i / NU
        const e = (1 - Math.cos(Math.PI * Math.pow(t, p.shoulder))) / 2
        pts.push(new THREE.Vector2(
          THREE.MathUtils.lerp(p.bellyR, p.neckR, e),
          THREE.MathUtils.lerp(bellyY, neckY, t),
        ))
      }
      // a short flared lip above the neck
      if (H - neckY > 1e-3) {
        pts.push(new THREE.Vector2(p.neckR + p.flare * 0.6, THREE.MathUtils.lerp(neckY, H, 0.55)))
        pts.push(new THREE.Vector2(p.neckR + p.flare, H))
      }
      return {
        outer: pts, radiusAt: radiusFn(pts), height: H, mouthR: p.neckR + p.flare,
        bottomAt: () => 0,
      }
    },
  },

  bowl: {
    label: '碗形',
    params: {
      height: { label: '碗高', min: 0.3, max: 1.0, step: 0.005, default: 0.6 },
      mouthR: { label: '口径', min: 0.3, max: 0.9, step: 0.005, default: 0.58 },
      footR: { label: '足径', min: 0.1, max: 0.4, step: 0.005, default: 0.21 },
      fullness: { label: '腹', min: 0, max: 0.2, step: 0.002, default: 0.07 },
    },
    profile(p) {
      const H = p.height
      const y0 = 0.1
      const rAt = (y) => {
        if (y <= y0) return p.footR + 0.02
        const t = THREE.MathUtils.clamp((y - y0) / (H - y0), 0, 1)
        const r = THREE.MathUtils.lerp(p.footR + 0.06, p.mouthR, Math.pow(t, 0.72))
        return r + p.fullness * Math.sin(Math.PI * Math.pow(t, 0.85))
      }
      const ctrl = [
        [p.footR, 0],
        [p.footR + 0.008, 0.055],
        [p.footR - 0.03, 0.085],
        [rAt(H * 0.35), H * 0.35],
        [rAt(H * 0.6), H * 0.6],
        [rAt(H * 0.85), H * 0.85],
        [p.mouthR, H],
      ].map(([r, y]) => new THREE.Vector2(r, y))
      const outer = new THREE.SplineCurve(ctrl).getSpacedPoints(90)
      return { outer, radiusAt: radiusFn(outer), height: H, mouthR: p.mouthR }
    },
  },
}

/** build the walled body mesh from a profile object */
export function bodyMesh(prof, wall, material, opts = {}) {
  const geo = shellGeometry(prof.outer, wall, opts)
  return new THREE.Mesh(geo, material)
}

export { ngonSection }
