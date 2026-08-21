import * as THREE from 'three'
import { shellGeometry } from '../geometry/loft.js'

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
      basePress: { label: '捺底', min: 0, max: 0.12, step: 0.002, default: 0.03 },
    },
    profile(p) {
      // quarter Lamé curve: r = maxR * (1 - u^n)^(1/n), u = distance from the
      // belly along the axis, normalised by that half's axis length
      const at = (dy, axis, n) => {
        const u = Math.min(Math.abs(dy) / axis, 1)
        return p.maxR * Math.pow(Math.max(0, 1 - Math.pow(u, n)), 1 / n)
      }
      const N = 46
      const lower = []
      for (let i = N; i >= 1; i--) {
        const dy = (i / N) * p.lowerAxis
        const r = at(dy, p.lowerAxis, p.lowerFull)
        if (r > 0.06) lower.push(new THREE.Vector2(r, p.bellyY - dy))
      }
      const upper = []
      for (let i = 1; i <= N; i++) {
        const dy = (i / N) * p.upperAxis
        const r = at(dy, p.upperAxis, p.upperFull)
        if (r >= p.mouthR) upper.push(new THREE.Vector2(r, p.bellyY + dy))
        else break
      }
      // cut both ends flat: a foot to stand on, a mouth for the lid
      const foot = lower.length ? lower[0] : new THREE.Vector2(p.maxR * 0.4, 0)
      // 一捺底: the base is pressed in, so the pot rests on a ring at the foot
      // radius and the centre of the underside sits slightly higher
      const press = p.basePress ?? 0
      const rim = upper.length ? upper[upper.length - 1] : new THREE.Vector2(p.mouthR, p.bellyY + p.upperAxis * 0.8)
      const outer = [
        new THREE.Vector2(0.03, foot.y + press),
        new THREE.Vector2(foot.x * 0.45, foot.y + press * 0.82),
        new THREE.Vector2(foot.x * 0.78, foot.y + press * 0.42),
        new THREE.Vector2(foot.x, foot.y),
        ...lower,
        new THREE.Vector2(p.maxR, p.bellyY),
        ...upper,
        new THREE.Vector2(p.mouthR, rim.y),
      ]
      // capture the curve's own coordinates before standing the foot on y = 0,
      // otherwise capAt() below subtracts the offset a second time
      const rimAbove = rim.y - p.bellyY           // how far the cut sits above the belly
      const y0 = outer[0].y
      for (const v of outer) v.y -= y0            // stand the foot on y = 0
      return {
        outer, radiusAt: radiusFn(outer), height: rim.y, mouthR: p.mouthR,  // rim.y is already relative to the foot
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
