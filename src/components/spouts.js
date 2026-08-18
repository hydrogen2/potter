import * as THREE from 'three'
import { loftGeometry } from '../geometry/loft.js'

/**
 * 流 — spouts. Built along +Y from the base (y=0) to the tip; the
 * assembler rotates and plants it in the body wall at attach.y.
 * The pour opening always shows real wall thickness.
 */

export const SPOUTS = {
  none: { label: '无', params: {}, build: () => null },

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
