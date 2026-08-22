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

  flush: {
    label: '截盖',
    // 西施 and its relatives take a lid cut from the body's own curve: closed,
    // the silhouette runs unbroken from foot to knob. An overhanging lid, however
    // well proportioned, reads as the wrong family.
    params: {
      thickness: { label: '盖厚', min: 0.02, max: 0.09, step: 0.002, default: 0.04 },
      rise: { label: '盖高', min: 0.3, max: 1.0, step: 0.01, default: 0.94 },  // fraction of the cap to the pole
      vent: { label: '气孔', min: 0, max: 0.03, step: 0.001, default: 0.012 },
    },
    top: (p, prof) => (prof?.capLimit ?? 0.18) * p.rise,
    build(p, mouthR, material, prof) {
      const v = Math.max(p.vent, 0.004)
      const T = p.thickness
      // `rise` is how far up the body's own curve the lid runs: near 1 the ball
      // is completed and the dome converges to a neck for the knob — a flat top
      // would read as the wrong family
      const rise = (prof?.capLimit ?? 0.18) * p.rise
      const cap = []
      const N = 26
      for (let i = 0; i <= N; i++) {
        const dy = (i / N) * rise
        const r = prof?.capAt ? prof.capAt(dy) : mouthR * Math.cos((i / N) * Math.PI / 2)
        cap.push(new THREE.Vector2(Math.max(r, v + 0.012), dy))
      }
      const pts = [
        new THREE.Vector2(v, -0.002),
        new THREE.Vector2(mouthR - 0.02, -0.002),      // seats into the mouth
        new THREE.Vector2(mouthR, 0.004),
        ...cap,
        new THREE.Vector2(v, rise - T * 0.5),
        new THREE.Vector2(v, -0.002),
      ]
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
        new THREE.Vector2(R * 0.88, T + p.rise * 0.28),   // stays full near the rim,
        new THREE.Vector2(R * 0.62, T + p.rise * 0.62),   // then turns over — a dome,
        new THREE.Vector2(R * 0.3, T + p.rise * 0.9),     // not a cone
        new THREE.Vector2(v + 0.03, T + p.rise),
        new THREE.Vector2(v, T + p.rise - 0.004),
      ]).getSpacedPoints(30)
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
