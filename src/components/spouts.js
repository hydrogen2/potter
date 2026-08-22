import * as THREE from 'three'
import { loftGeometry } from '../geometry/loft.js'
import { sweptTube } from '../geometry/sweep.js'

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
    },
    build(p, material, prof) {
      const H = prof?.height ?? 1
      const y0 = H * p.attachY
      const x0 = (prof?.radiusAt ? prof.radiusAt(y0) : 0.8) - 0.05
      const tipY = y0 + H * p.rise
      const tipX = x0 + p.length
      // control points: out of the belly, through the bend, up to the lip
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(x0 - 0.08, y0 - 0.02, 0),
        new THREE.Vector3(x0 + p.length * 0.32, y0 + H * p.rise * 0.16, 0),
        new THREE.Vector3(x0 + p.length * 0.68, y0 + H * p.rise * (0.42 + p.bend * 0.4), 0),
        new THREE.Vector3(tipX, tipY, 0),
      ], false, 'centripetal')
      return new THREE.Mesh(
        sweptTube(curve, (t) => THREE.MathUtils.lerp(p.rootR, p.tipR, Math.pow(t, 0.8))),
        material,
      )
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
