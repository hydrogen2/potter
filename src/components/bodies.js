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
