import * as THREE from 'three'
import { sweptTube, axisFillet, filletBlend, heightField, filletCollar } from '../geometry/sweep.js'
import { loftGeometry, ngonSection } from '../geometry/loft.js'

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
      blend: { label: '润接', min: 0, max: 0.1, step: 0.005, default: 0.03 },
    },
    build(p, material, drop) {
      // a thick clay strap bent into an arch: round section, feet buried
      const arc = new THREE.EllipseCurve(
        0, 0, p.span / 2, p.rise, Math.PI * 1.16, -Math.PI * 0.16, true,
      )
      const curve = new THREE.CatmullRomCurve3(
        arc.getSpacedPoints(32).map((v) => new THREE.Vector3(v.x, v.y, 0)),
      )
      const strap = new THREE.Mesh(new THREE.TubeGeometry(curve, 64, p.tube, 16), material)
      if (!p.blend) return strap
      // Both feet land on the lid *off* the axis, so this is neither the body
      // case nor the axis-symmetric one: the lid is a height field and each
      // foot gets its own fillet.
      const group = new THREE.Group()
      group.add(strap)
      const lid = heightField((r) => -(drop ? drop(r) : 0))
      for (const fromStart of [true, false]) {
        group.add(new THREE.Mesh(
          filletBlend(curve, () => p.tube, lid, p.blend, fromStart), material,
        ))
      }
      return group
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
      blend: { label: '润接', min: 0, max: 0.1, step: 0.005, default: 0.03 },
    },
    build(p, material, drop) {
      const arc = new THREE.EllipseCurve(
        // swept well past the horizontal on purpose: a tube is open at its
        // ends, and a foot buried less deep than the strap is thick leaves that
        // opening showing above the lid as a dark crescent
        0, 0, p.span / 2, p.rise, Math.PI * 1.16, -Math.PI * 0.16, true,
      )
      const curve = new THREE.CatmullRomCurve3(
        arc.getSpacedPoints(36).map((v) => new THREE.Vector3(v.x, v.y, 0)),
      )
      const group = new THREE.Group()
      group.add(new THREE.Mesh(sweptTube(curve, () => p.tube, 56, 18), material))
      if (p.blend) {
        // 润接 at both feet. The lid is a height field and the feet land off
        // its axis, so this is the general case rather than the axis-symmetric
        // one. Built before the width scale below, in the strap's round frame —
        // the z stretch then carries the fillet with it, which is a shade wrong
        // wherever the lid is not level, and imperceptible on a 平盖's crown.
        const lid = heightField((r) => -(drop ? drop(r) : 0))
        for (const fromStart of [true, false]) {
          group.add(new THREE.Mesh(
            filletBlend(curve, () => p.tube, lid, p.blend, fromStart), material,
          ))
        }
      }
      group.scale.z = p.width          // a strap is wider than it is thick
      return group
    },
  },

  // 方器's knob: a low faceted button, not a ball. A round bead on a hexagonal
  // lid is the same mismatch as a round spout on a hexagonal body — the whole
  // point of a 方器 is that every element carries the same section.
  button: {
    label: '方钮',
    params: {
      radius: { label: '钮径', min: 0.05, max: 0.30, step: 0.005, default: 0.16 },
      height: { label: '钮高', min: 0.03, max: 0.20, step: 0.004, default: 0.075 },
      taper: { label: '收分', min: 0.5, max: 1.0, step: 0.02, default: 0.82 },
      facets: { label: '面数', min: 0, max: 8, step: 1, default: 6 },
      crisp: { label: '棱角', min: 3, max: 40, step: 1, default: 16 },
      round: { label: '顶圆', min: 0, max: 0.5, step: 0.02, default: 0.22 },
      blend: { label: '润接', min: 0, max: 0.1, step: 0.005, default: 0.025 },
    },
    build(p, material, drop) {
      const R = p.radius, H = p.height
      const rTop = R * p.taper
      const rr = Math.min(p.round * R, H * 0.6)
      const pts = []
      const V = (r, y) => pts.push(new THREE.Vector2(r, y))
      V(0.01, -0.004)
      V(R, -0.004)
      V(R, H - rr)
      // round the top edge so it catches light like a pressed clay button
      const N = 6
      for (let i = 1; i <= N; i++) {
        const a = (i / N) * (Math.PI / 2)
        V(THREE.MathUtils.lerp(R, rTop, Math.sin(a)) - rr * (1 - Math.cos(a)) * 0,
          H - rr + rr * Math.sin(a))
      }
      V(rTop * 0.5, H)
      V(0.01, H)
      V(0.01, -0.004)
      const section = p.facets >= 3 ? ngonSection(p.facets, p.crisp) : null
      const g = new THREE.Group()
      g.add(new THREE.Mesh(loftGeometry({
        profile: pts,
        crossSection: section ? (theta) => section(theta) : undefined,
        radialSegments: section ? 288 : undefined,
        capBottom: false,
      }), material))
      if (p.blend > 0) {
        const shapeAt = (s) => {
          const i = Math.min(pts.length - 1, Math.floor(s * (pts.length - 1)))
          return pts[i].clone()
        }
        g.add(new THREE.Mesh(
          axisFillet(shapeAt, (r) => -(drop ? drop(r) : 0), p.blend), material,
        ))
      }
      return g
    },
  },

  bead: {
    label: '珠钮',
    params: {
      radius: { label: '珠径', min: 0.04, max: 0.16, step: 0.002, default: 0.09 },
      squash: { label: '扁度', min: 0.5, max: 1.2, step: 0.02, default: 0.85 },
      blend: { label: '润接', min: 0, max: 0.1, step: 0.005, default: 0.025 },
    },
    build(p, material, drop) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(p.radius, 28, 20), material)
      m.scale.y = p.squash
      const yc = p.radius * p.squash * 0.7
      m.position.y = yc
      if (!p.blend) return m
      const group = new THREE.Group()
      group.add(m)
      // The bead is luted on, so clay gathers where it meets the lid. Knob and
      // lid share the pot's axis, so that gathering is one tangent arc revolved
      // — exact, where a spout on a belly has to be approximated.
      const R = p.radius, k = p.squash
      const beadAt = (s) => {
        const th = Math.PI * (1 - s)          // s = 0 at the bead's lowest point
        return new THREE.Vector2(R * Math.sin(th), yc + k * R * Math.cos(th))
      }
      const surfaceY = (r) => -(drop ? drop(r) : 0)
      group.add(new THREE.Mesh(axisFillet(beadAt, surfaceY, p.blend), material))
      return group
    },
  },
}
