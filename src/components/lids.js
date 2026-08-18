import * as THREE from 'three'
import { loftGeometry } from '../geometry/loft.js'

/**
 * 盖 — lids. Every lid is a closed solid with a real thickness; the 气孔
 * (vent) is a bore through that thickness. Positioned at the rim height by
 * the assembler; profiles here are relative to y=0 = rim plane.
 */

export const LIDS = {
  none: { label: '无', params: {}, build: () => null, top: () => 0 },

  flatDisc: {
    label: '平盖',
    params: {
      overhang: { label: '盖沿', min: 0, max: 0.12, step: 0.002, default: 0.045 },
      thickness: { label: '盖厚', min: 0.02, max: 0.1, step: 0.002, default: 0.05 },
      crown: { label: '盖面', min: 0, max: 0.06, step: 0.002, default: 0.008 },
      vent: { label: '气孔', min: 0, max: 0.03, step: 0.001, default: 0.013 },
    },
    top: (p) => p.thickness + p.crown,
    build(p, mouthR, material) {
      const R = mouthR + p.overhang
      const v = Math.max(p.vent, 0.004)
      const T = p.thickness
      const pts = [
        [v, -0.002],
        [R * 0.55, -0.002],
        [R - 0.008, -0.004],
        [R, 0.006],
        [R, T - 0.012],
        [R * 0.6, T + p.crown * 0.6],
        [R * 0.25, T + p.crown * 0.95],
        [v + 0.03, T + p.crown],
        [v, T + p.crown - 0.003],
        [v, -0.002],
      ].map(([r, y]) => new THREE.Vector2(r, y))
      return new THREE.Mesh(loftGeometry({ profile: pts, capBottom: false }), material)
    },
  },

  dome: {
    label: '穹盖',
    params: {
      overhang: { label: '盖沿', min: 0, max: 0.12, step: 0.002, default: 0.045 },
      thickness: { label: '盖厚', min: 0.02, max: 0.1, step: 0.002, default: 0.04 },
      rise: { label: '穹高', min: 0.02, max: 0.3, step: 0.002, default: 0.13 },
      vent: { label: '气孔', min: 0, max: 0.03, step: 0.001, default: 0.013 },
    },
    top: (p) => p.thickness + p.rise,
    build(p, mouthR, material) {
      const R = mouthR + p.overhang
      const v = Math.max(p.vent, 0.004)
      const T = p.thickness
      const dome = new THREE.SplineCurve([
        new THREE.Vector2(R, T - 0.01),
        new THREE.Vector2(R * 0.66, T + p.rise * 0.45),
        new THREE.Vector2(R * 0.34, T + p.rise * 0.82),
        new THREE.Vector2(v + 0.03, T + p.rise),
        new THREE.Vector2(v, T + p.rise - 0.004),
      ]).getSpacedPoints(28)
      const pts = [
        new THREE.Vector2(v, -0.002),
        new THREE.Vector2(R * 0.55, -0.002),
        new THREE.Vector2(R - 0.008, -0.004),
        new THREE.Vector2(R, 0.006),
        ...dome,
        new THREE.Vector2(v, -0.002),
      ]
      return new THREE.Mesh(loftGeometry({ profile: pts, capBottom: false }), material)
    },
  },
}
