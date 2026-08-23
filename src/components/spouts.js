import * as THREE from 'three'
import { loftGeometry } from '../geometry/loft.js'
import { sweptTube, filletCollar, surfaceCrossing } from '../geometry/sweep.js'

/**
 * 流 — spouts. Built along +Y from the base (y=0) to the tip; the
 * assembler rotates and plants it in the body wall at attach.y.
 * The pour opening always shows real wall thickness.
 */

export const SPOUTS = {
  none: { label: '无', params: {}, build: () => null },

  curved: {
    label: '弯流',
    // 潘壶's 弯嘴: leaves the belly low, sweeps out and up in an S and finishes
    // slender. Built as a swept tube of falling radius, so the taper is part of
    // the curve rather than a cone stuck on the side.
    params: {
      length: { label: '流长', min: 0.3, max: 1.2, step: 0.005, default: 0.72 },
      attachY: { label: '接身', min: 0.1, max: 0.7, step: 0.01, default: 0.32 },
      rise: { label: '流升', min: 0.1, max: 1.0, step: 0.01, default: 0.55 },
      bend: { label: '弯度', min: -0.3, max: 0.6, step: 0.01, default: 0.26 },
      rootR: { label: '根径', min: 0.05, max: 0.22, step: 0.002, default: 0.115 },
      tipR: { label: '口径', min: 0.02, max: 0.1, step: 0.002, default: 0.042 },
      wall: { label: '壁厚', min: 0.005, max: 0.03, step: 0.001, default: 0.012 },
      blend: { label: '润接', min: 0, max: 0.2, step: 0.005, default: 0.06 },
      // How vertical the last run is. On a real 一弯嘴 the final third turns up
      // and the lip faces the sky; at 0 the spout runs out on the diagonal,
      // which is what 潘壶 has, so this defaults off.
      tipUp: { label: '流口上扬', min: 0, max: 1, step: 0.02, default: 0 },
    },
    build(p, material, prof) {
      const H = prof?.height ?? 1
      const y0 = H * p.attachY
      // How deep the curve starts inside the body has to scale with the root:
      // a tube of radius R centred on a curve that starts only 0.13 in will
      // have its underside outside a convex belly, and the root opens a notch.
      // The floor keeps the slimmer spouts (潘壶) where they were.
      const embed = Math.max(0.13, p.rootR + 0.02)
      const x0 = (prof?.radiusAt ? prof.radiusAt(y0) : 0.8)
      const tipY = y0 + H * p.rise
      const tipX = x0 + p.length
      // control points: out of the belly, through the bend, up to the lip
      const u = p.tipUp ?? 0
      const ctrl = [
        new THREE.Vector3(x0 - embed, y0 - 0.02, 0),
        new THREE.Vector3(x0 + p.length * 0.32, y0 + H * p.rise * 0.16, 0),
        new THREE.Vector3(x0 + p.length * 0.68, y0 + H * p.rise * (0.42 + p.bend * 0.4), 0),
      ]
      if (u > 0) {
        // stack a knee almost directly under the lip: the curve then has to
        // climb steeply over very little horizontal distance, and the tube's
        // end cap — the 流口 — ends up facing upward
        // set the knee well back from the lip: crowding it under the tip makes
        // Catmull-Rom turn a corner rather than a curve
        ctrl.push(new THREE.Vector3(
          tipX - p.length * 0.30 * u,
          tipY - H * p.rise * 0.50 * u,
          0,
        ))
      }
      ctrl.push(new THREE.Vector3(tipX, tipY, 0))
      const curve = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal')
      const outerAt = (t) => THREE.MathUtils.lerp(p.rootR, p.tipR, Math.pow(t, 0.8))
      const tube = new THREE.Mesh(
        sweptTube(curve, outerAt, 72, 18, (t) => Math.max(outerAt(t) - p.wall, 0.006)),
        material,
      )
      if (!p.blend) return tube
      // 润接: the root flows into the belly instead of being butted against it
      const group = new THREE.Group()
      const onBody = (P) => {
        const r = Math.hypot(P.x, P.z) || 1e-6
        const target = prof.radiusAt(P.y)
        return new THREE.Vector3(P.x * target / r, P.y, P.z * target / r)
      }
      const { point, tangent, t } = surfaceCrossing(curve, prof, true)
      const rootR = THREE.MathUtils.lerp(p.rootR, p.tipR, Math.pow(t, 0.8))
      group.add(tube, new THREE.Mesh(filletCollar(point, tangent, rootR, p.blend, 26, 12, onBody), material))
      return group
    },
  },

  straightCone: {
    label: '直流',
    params: {
      length: { label: '流长', min: 0.3, max: 0.9, step: 0.005, default: 0.58 },
      angle: { label: '仰角', min: 15, max: 60, step: 1, default: 32 },
      attachY: { label: '接身', min: 0.2, max: 0.8, step: 0.01, default: 0.5 },
      rootR: { label: '根径', min: 0.05, max: 0.16, step: 0.002, default: 0.095 },
      tipR: { label: '口径', min: 0.03, max: 0.09, step: 0.002, default: 0.05 },
      wall: { label: '壁厚', min: 0.006, max: 0.03, step: 0.001, default: 0.014 },
    },
    build(p, material) {
      const L = p.length
      const pts = [
        [p.rootR, 0],
        [THREE.MathUtils.lerp(p.rootR, p.tipR, 0.4), L * 0.35],
        [THREE.MathUtils.lerp(p.rootR, p.tipR, 0.9), L * 0.8],
        [p.tipR * 0.94, L * 0.94],
        [p.tipR, L], // slight 炮口 flare
        [p.tipR - p.wall, L], // rim: visible wall
        [p.tipR - p.wall - 0.004, L * 0.82], // inner bore
      ].map(([r, y]) => new THREE.Vector2(r, y))
      return new THREE.Mesh(
        loftGeometry({ profile: pts, radialSegments: 48, capBottom: false }),
        material,
      )
    },
  },
}
