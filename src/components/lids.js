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
      seam: { label: '盖缝', min: 0.0, max: 0.02, step: 0.001, default: 0.005 },
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
      seam: { label: '盖缝', min: 0.0, max: 0.02, step: 0.001, default: 0.005 },
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

  // 压盖 for 掇球 — the *second ball*. Its dome is a true spherical cap, not a
  // tuned spline: the whole point of 掇球 is that lid and knob read as spheres
  // stacked on the body, so the surface has to be genuinely spherical. The rim
  // sits on (not into) the mouth and overhangs it, and a 子口 flange drops
  // inside to locate it.
  //
  // Measured off two near-level photographs of 寿珍掇球 (see README): the cap
  // rises about a third of its own rim diameter. The written sources call it
  // 明显的半球状 — a clear hemisphere, which would be a half — so `rise` is a
  // fraction of the rim *radius* and the canon range comes from the photographs.
  ballCap: {
    label: '压盖 (球冠)',
    params: {
      overhang: { label: '盖沿', min: 0, max: 0.12, step: 0.002, default: 0.03 },
      thickness: { label: '盖厚', min: 0.02, max: 0.1, step: 0.002, default: 0.038 },
      rise: { label: '穹高', min: 0.2, max: 1.0, step: 0.01, default: 0.68 },
      flange: { label: '子口', min: 0, max: 0.12, step: 0.004, default: 0.05 },
      // the lid rim is a flat annulus and the cap springs from *inside* it.
      // Without this the dome starts at the full rim radius and the lid reads
      // tall and hat-like; on the real pots it reads broad and low.
      brim: { label: '盖沿宽', min: 0, max: 0.12, step: 0.004, default: 0.03 },
      vent: { label: '气孔', min: 0, max: 0.03, step: 0.001, default: 0.013 },
      seam: { label: '盖缝', min: 0.0, max: 0.02, step: 0.001, default: 0.005 },
    },
    // rise is a fraction of the rim radius, so the cap keeps its shape when the
    // mouth is resized
    top: (p, prof) => (prof.mouthR + p.overhang - (p.brim ?? 0)) * p.rise,
    build(p, mouthR, material) {
      const R = mouthR + p.overhang          // the rim, ball 2's widest circle
      const Rd = Math.max(R - (p.brim ?? 0), R * 0.5)   // where the cap springs
      const h = Rd * p.rise
      const T = p.thickness
      const v = Math.max(p.vent, 0.004)
      // the sphere the cap is cut from: base radius R, height h
      const Rs = (Rd * Rd + h * h) / (2 * h)
      const cy = h - Rs                       // centre sits below the rim plane
      const arc = (radius, from, to, n) => {
        const out = []
        for (let i = 0; i <= n; i++) {
          const t = from + ((to - from) * i) / n
          out.push(new THREE.Vector2(radius * Math.sin(t), cy + radius * Math.cos(t)))
        }
        return out
      }
      const thOuter = Math.asin(Math.min(1, Rd / Rs))
      const thVent = Math.asin(Math.min(1, v / Rs))
      // the inner surface is the same sphere shrunk by the wall — for a sphere
      // an offset along the normal is exactly a smaller concentric radius
      const Ri = Rs - T
      const thInner = Math.acos(Math.min(1, Math.max(-1, -cy / Ri)))   // where it meets y = 0
      const rimEdge = T * 0.6                 // the rim has a visible vertical face
      const pts = [
        new THREE.Vector2(R, 0),
        new THREE.Vector2(R, T * 0.35),       // the flat brim…
        new THREE.Vector2(Rd, T * 0.5),       // …then the cap springs from inside it
        ...arc(Rs, thOuter, thVent, 34),      // over the dome
        new THREE.Vector2(v, h - T),          // down the bore of the 气孔
        ...arc(Ri, thVent, thInner, 34),      // and back under it
        new THREE.Vector2(R - T, -rimEdge),
        new THREE.Vector2(R, -rimEdge),
        new THREE.Vector2(R, 0),
      ]
      const g = new THREE.Group()
      g.add(new THREE.Mesh(loftGeometry({ profile: pts, capBottom: false }), material))
      // 子口: the flange that drops into the mouth and holds the lid in place
      if (p.flange > 0) {
        const fr = mouthR - 0.02
        const f = p.flange
        const ring = [
          new THREE.Vector2(fr, -rimEdge),
          new THREE.Vector2(fr, -rimEdge - f),
          new THREE.Vector2(fr - T * 0.7, -rimEdge - f),
          new THREE.Vector2(fr - T * 0.7, -rimEdge),
          new THREE.Vector2(fr, -rimEdge),
        ]
        g.add(new THREE.Mesh(loftGeometry({ profile: ring, capBottom: false }), material))
      }
      return g
    },
  },

  dome: {
    label: '穹盖',
    params: {
      overhang: { label: '盖沿', min: 0, max: 0.12, step: 0.002, default: 0.045 },
      thickness: { label: '盖厚', min: 0.02, max: 0.1, step: 0.002, default: 0.04 },
      rise: { label: '穹高', min: 0.02, max: 0.3, step: 0.002, default: 0.13 },
      vent: { label: '气孔', min: 0, max: 0.03, step: 0.001, default: 0.013 },
      seam: { label: '盖缝', min: 0.0, max: 0.02, step: 0.001, default: 0.005 },
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
