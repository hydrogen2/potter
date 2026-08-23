import * as THREE from 'three'
import { sweptTube } from '../geometry/sweep.js'

/**
 * 钮 — knobs. Positioned by the assembler at the lid's top surface;
 * geometry here is relative to y=0 = lid top.
 */

export const KNOBS = {
  none: { label: '无', params: {}, build: () => null },

  bridgeStrap: {
    label: '桥钮',
    params: {
      span: { label: '跨度', min: 0.2, max: 0.8, step: 0.005, default: 0.54 },
      rise: { label: '拱高', min: 0.06, max: 0.35, step: 0.005, default: 0.16 },
      tube: { label: '条粗', min: 0.03, max: 0.12, step: 0.002, default: 0.078 },
    },
    build(p, material) {
      // a thick clay strap bent into an arch: round section, feet buried
      const arc = new THREE.EllipseCurve(
        0, 0, p.span / 2, p.rise, Math.PI * 1.06, -Math.PI * 0.06, true,
      )
      const curve = new THREE.CatmullRomCurve3(
        arc.getSpacedPoints(32).map((v) => new THREE.Vector3(v.x, v.y, 0)),
      )
      return new THREE.Mesh(new THREE.TubeGeometry(curve, 64, p.tube, 16), material)
    },
  },

  bridgeMound: {
    label: '桥钮·矮',
    // A rolled strap of clay bent into a low wide arch: round in section, so
    // the top is a curve you can hook a finger under. An extruded outline gives
    // a flat-topped plate instead — correct in silhouette, wrong from above.
    params: {
      span: { label: '跨度', min: 0.2, max: 0.9, step: 0.005, default: 0.58 },
      rise: { label: '拱高', min: 0.05, max: 0.3, step: 0.005, default: 0.15 },
      tube: { label: '条粗', min: 0.02, max: 0.12, step: 0.002, default: 0.055 },
      width: { label: '条宽', min: 0.8, max: 3.0, step: 0.05, default: 1.7 },
    },
    build(p, material) {
      const arc = new THREE.EllipseCurve(
        0, 0, p.span / 2, p.rise, Math.PI * 1.04, -Math.PI * 0.04, true,
      )
      const curve = new THREE.CatmullRomCurve3(
        arc.getSpacedPoints(36).map((v) => new THREE.Vector3(v.x, v.y, 0)),
      )
      const mesh = new THREE.Mesh(sweptTube(curve, () => p.tube, 56, 18), material)
      mesh.scale.z = p.width          // a strap is wider than it is thick
      return mesh
    },
  },

  bead: {
    label: '珠钮',
    params: {
      radius: { label: '珠径', min: 0.04, max: 0.16, step: 0.002, default: 0.09 },
      squash: { label: '扁度', min: 0.5, max: 1.2, step: 0.02, default: 0.85 },
    },
    build(p, material) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(p.radius, 28, 20), material)
      m.scale.y = p.squash
      m.position.y = p.radius * p.squash * 0.7
      return m
    },
  },
}
