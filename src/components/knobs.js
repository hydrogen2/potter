import * as THREE from 'three'

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
    params: {
      span: { label: '跨度', min: 0.2, max: 0.9, step: 0.005, default: 0.58 },
      rise: { label: '拱高', min: 0.05, max: 0.3, step: 0.005, default: 0.15 },
      holeW: { label: '孔宽', min: 0.04, max: 0.4, step: 0.005, default: 0.16 },
      holeH: { label: '孔高', min: 0.02, max: 0.2, step: 0.005, default: 0.087 },
      depth: { label: '厚度', min: 0.08, max: 0.4, step: 0.005, default: 0.2 },
    },
    build(p, material) {
      // a low wide mound with splayed feet melting into the lid, thin over
      // the crown, small tunnel through — the classic 桥钮 (see 顾景舟 大石瓢)
      const hs = p.span / 2
      // superellipse-ish arch: broad feet, soft rounded crown (no apex point)
      const outer = new THREE.SplineCurve([
        new THREE.Vector2(-hs - 0.05, -0.02),
        new THREE.Vector2(-hs * 0.88, p.rise * 0.22),
        new THREE.Vector2(-hs * 0.64, p.rise * 0.6),
        new THREE.Vector2(-hs * 0.34, p.rise * 0.9),
        new THREE.Vector2(-hs * 0.12, p.rise * 0.99),
        new THREE.Vector2(hs * 0.12, p.rise * 0.99),
        new THREE.Vector2(hs * 0.34, p.rise * 0.9),
        new THREE.Vector2(hs * 0.64, p.rise * 0.6),
        new THREE.Vector2(hs * 0.88, p.rise * 0.22),
        new THREE.Vector2(hs + 0.05, -0.02),
      ]).getPoints(48)
      const hw = p.holeW / 2
      const inner = new THREE.SplineCurve([
        new THREE.Vector2(hw, -0.02),
        new THREE.Vector2(hw * 0.92, p.holeH * 0.55),
        new THREE.Vector2(hw * 0.5, p.holeH * 0.93),
        new THREE.Vector2(0, p.holeH),
        new THREE.Vector2(-hw * 0.5, p.holeH * 0.93),
        new THREE.Vector2(-hw * 0.92, p.holeH * 0.55),
        new THREE.Vector2(-hw, -0.02),
      ]).getPoints(24)
      const shape = new THREE.Shape([...outer, ...inner])
      const geo = new THREE.ExtrudeGeometry(shape, {
        depth: p.depth,
        curveSegments: 24,
        bevelEnabled: true,
        bevelThickness: p.depth * 0.3,
        bevelSize: 0.028,
        bevelSegments: 8,
      })
      geo.translate(0, 0, -p.depth / 2)
      return new THREE.Mesh(geo, material)
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
