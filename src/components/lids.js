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
    // the same control points the top surface is lofted from, as a drop below
    // the apex — a 平盖 is not perfectly flat and a knob's fillet should land on
    // the crown it actually has
    drop(p, prof) {
      const R = prof.mouthR + p.overhang
      const T = p.thickness, c = p.crown
      const pts = [
        [0, 0], [Math.max(p.vent, 0.004) + 0.03, 0],
        [R * 0.25, c * 0.05], [R * 0.6, c * 0.4], [R, c + 0.012],
      ]
      return (r) => {
        if (r <= pts[1][0]) return 0
        for (let i = 1; i < pts.length; i++) {
          if (r <= pts[i][0]) {
            const [r0, d0] = pts[i - 1], [r1, d1] = pts[i]
            return d0 + ((d1 - d0) * (r - r0)) / Math.max(r1 - r0, 1e-6)
          }
        }
        return pts[pts.length - 1][1]
      }
    },
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

  // 台阶盖 for 方器. The lid has to carry the body's own cross-section or the
  // 棱线 die at the seam, so it takes `prof.crossSection` and lofts with it —
  // the same machinery the body uses. Stepped in tiers, as the references are:
  // a flat brim, a raised middle, and the knob on top of that.
  stepped: {
    label: '台阶盖',
    params: {
      overhang: { label: '盖沿', min: 0, max: 0.12, step: 0.002, default: 0.028 },
      thickness: { label: '盖厚', min: 0.02, max: 0.1, step: 0.002, default: 0.042 },
      tiers: { label: '台阶', min: 1, max: 3, step: 1, default: 2 },
      step: { label: '阶宽', min: 0.06, max: 0.4, step: 0.01, default: 0.22 },
      rise: { label: '阶高', min: 0.01, max: 0.12, step: 0.002, default: 0.034 },
      flange: { label: '子口', min: 0, max: 0.12, step: 0.004, default: 0.05 },
      vent: { label: '气孔', min: 0, max: 0.03, step: 0.001, default: 0.013 },
      seam: { label: '盖缝', min: 0.0, max: 0.02, step: 0.001, default: 0.005 },
    },
    top: (p) => p.thickness + p.rise * p.tiers,
    drop(p, prof) {
      // the knob stands on the topmost tier, which is flat
      return () => 0
    },
    build(p, mouthR, material, prof) {
      const R = mouthR + p.overhang
      const v = Math.max(p.vent, 0.004)
      const T = p.thickness
      const pts = []
      const V = (r, y) => pts.push(new THREE.Vector2(r, y))
      // underside, out to the rim
      V(v, -0.002)
      V(R * 0.6, -0.002)
      V(R - 0.006, -0.004)
      V(R, 0.006)
      V(R, T)                                   // the rim's own face
      let r = R, y = T
      for (let i = 0; i < p.tiers; i++) {
        const rn = Math.max(v + 0.06, r - p.step * R)
        V(rn, y)                                // in across the step
        V(rn, y + p.rise)                       // and up its face
        r = rn; y += p.rise
      }
      V(v + 0.03, y)
      V(v, y - 0.004)
      V(v, -0.002)
      const g = new THREE.Group()
      g.add(new THREE.Mesh(loftGeometry({
        profile: pts,
        crossSection: prof?.crossSection,
        radialSegments: prof?.facets ? 288 : undefined,
        capBottom: false,
      }), material))
      if (p.flange > 0) {
        const fr = (prof?.boreR ?? mouthR) - 0.02
        const ring = [
          new THREE.Vector2(fr, -0.002),
          new THREE.Vector2(fr, -0.002 - p.flange),
          new THREE.Vector2(fr - T * 0.7, -0.002 - p.flange),
          new THREE.Vector2(fr - T * 0.7, -0.002),
          new THREE.Vector2(fr, -0.002),
        ]
        g.add(new THREE.Mesh(loftGeometry({
          profile: ring,
          crossSection: prof?.crossSection,
          radialSegments: prof?.facets ? 288 : undefined,
          capBottom: false,
        }), material))
      }
      return g
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
      rise: { label: '穹高', min: 0.2, max: 1.2, step: 0.01, default: 0.68 },
      flange: { label: '子口', min: 0, max: 0.12, step: 0.004, default: 0.05 },
      // the lid rim is a flat annulus and the cap springs from *inside* it.
      // Without this the dome starts at the full rim radius and the lid reads
      // tall and hat-like; on the real pots it reads broad and low.
      brim: { label: '盖沿宽', min: 0, max: 0.28, step: 0.004, default: 0.03 },
      // 压盖 means the lid presses down *over* the mouth: the rim continues
      // below the seating plane as a hanging skirt that covers the body's
      // collar. Without it the lid just perches on the ledge.
      skirt: { label: '盖裙', min: 0, max: 0.14, step: 0.004, default: 0.03 },
      // 盖唇 — the lid's own ring, standing proud at the foot of the dome. On
      // the real pots this ring and the body's collar read as a stacked pair,
      // each with its own shadow line; a lid that simply meets the body in a
      // flat flange gives that away immediately.
      bead: { label: '盖唇', min: 0, max: 0.10, step: 0.002, default: 0 },
      beadH: { label: '盖唇高', min: 0.01, max: 0.10, step: 0.002, default: 0.035 },
      vent: { label: '气孔', min: 0, max: 0.03, step: 0.001, default: 0.013 },
      seam: { label: '盖缝', min: 0.0, max: 0.02, step: 0.001, default: 0.005 },
    },
    // How far the lid's outer surface falls below its own apex at radius r.
    // The knob sits on that apex, so this is the surface its fillet has to meet.
    drop(p, prof) {
      const R = prof.mouthR + p.overhang
      const Rd = Math.max(R - (p.brim ?? 0), R * 0.5)
      const h = Rd * p.rise
      const Rs = (Rd * Rd + h * h) / (2 * h)
      const brimTop = p.thickness * 0.42
      const domeBase = brimTop + p.thickness * 0.16 + (p.bead ? p.beadH ?? 0.035 : 0)
      const apex = h + domeBase
      return (r) => (r <= Rd
        ? Rs - Math.sqrt(Math.max(0, Rs * Rs - r * r))
        : apex - brimTop)
    },
    // rise is a fraction of the rim radius, so the cap keeps its shape when the
    // mouth is resized
    // the cap springs from the top of the brim, not from the seating plane
    top: (p, prof) =>
      (prof.mouthR + p.overhang - (p.brim ?? 0)) * p.rise
      + p.thickness * 0.58
      + (p.bead ? p.beadH ?? 0.035 : 0),
    build(p, mouthR, material, prof) {
      const R = mouthR + p.overhang          // the rim, ball 2's widest circle
      const Rd = Math.max(R - (p.brim ?? 0), R * 0.5)   // where the cap springs
      const h = Rd * p.rise
      const T = p.thickness
      const v = Math.max(p.vent, 0.004)
      // the sphere the cap is cut from: base radius R, height h
      const Rs = (Rd * Rd + h * h) / (2 * h)
      const cy = h - Rs                       // centre sits below the rim plane
      const arc = (radius, from, to, n, lift = 0) => {
        const out = []
        for (let i = 0; i <= n; i++) {
          const t = from + ((to - from) * i) / n
          out.push(new THREE.Vector2(radius * Math.sin(t), cy + radius * Math.cos(t) + lift))
        }
        return out
      }
      const thOuter = Math.asin(Math.min(1, Rd / Rs))
      const thVent = Math.asin(Math.min(1, v / Rs))
      // the inner surface is the same sphere shrunk by the wall — for a sphere
      // an offset along the normal is exactly a smaller concentric radius
      const Ri = Rs - T
      const rimEdge = Math.max(p.skirt ?? 0, T * 0.6)   // how far the skirt hangs
      const brimTop = T * 0.42
      // The brim is *flat*: a level annulus from the rim in to where the cap
      // springs. It was sloped for a while, which was compensating for a dome
      // that was too tall — a wide shelf under a tall dome reads as a flying
      // saucer. With the cap brought down to size the slope stopped earning its
      // place, and on the real pots the brim is plainly level.
      const domeBase = brimTop + T * 0.16 + (p.bead ? p.beadH ?? 0.035 : 0)
      const thInner = Math.acos(
        Math.min(1, Math.max(-1, (Rs - h - domeBase) / Ri)),
      )
      // Corners here are what the eye reads as a staircase, so the rim is a
      // rounded band rather than a stack of square steps: a quarter-round at
      // the bottom of the outer face, one at the top, and an eased ramp in to
      // where the dome springs. The dome arc is lifted by domeBase — springing
      // it from the seating plane left a vertical drop behind the brim.
      const rr = Math.min(T * 0.5, Math.max((p.brim ?? 0.03) * 0.55, 0.006))
      const quarter = (cx, cyy, a0, a1, n = 7) => {
        const out = []
        for (let i = 0; i <= n; i++) {
          const a = a0 + ((a1 - a0) * i) / n
          out.push(new THREE.Vector2(cx + rr * Math.cos(a), cyy + rr * Math.sin(a)))
        }
        return out
      }
      // out and all the way back, so the ring has an undercut and therefore a
      // shadow line — the thing that makes it read as extruded rather than flat
      const beadRing = (n = 18) => {
        const b = p.bead ?? 0
        if (b <= 0) return []
        const hB = p.beadH ?? 0.035
        const out = []
        for (let i = 0; i <= n; i++) {
          const t = i / n
          out.push(new THREE.Vector2(
            R - rr + b * Math.pow(Math.sin(Math.PI * t), 0.7),
            brimTop + hB * t,
          ))
        }
        return out
      }
      const ease = (n = 8) => {
        const out = []
        for (let i = 1; i <= n; i++) {
          const t = i / n
          const k = t * t * (3 - 2 * t)
          out.push(new THREE.Vector2(
            THREE.MathUtils.lerp(R - rr, Rd, k),
            THREE.MathUtils.lerp(brimTop + (p.bead ? p.beadH ?? 0.035 : 0), domeBase, k),
          ))
        }
        return out
      }
      const pts = [
        new THREE.Vector2(R - T, -rimEdge),
        ...quarter(R - rr, -rimEdge + rr, -Math.PI / 2, 0),   // round under the rim
        ...quarter(R - rr, brimTop - rr, 0, Math.PI / 2),     // round over the rim
        ...beadRing(),                                        // the lid's own proud ring
        ...ease(),                                            // ramp in to the cap
        ...arc(Rs, thOuter, thVent, 34, domeBase),            // over the dome
        new THREE.Vector2(v, h - T + domeBase),               // the bore of the 气孔
        ...arc(Ri, thVent, thInner, 34, domeBase),            // and back under it
        new THREE.Vector2(R - T, -rimEdge),
      ]
      const g = new THREE.Group()
      // 贯通: on a 筋纹器 the ribs must run unbroken from the knob, over the lid
      // and down the body, so the lid is lofted with the body's own section
      g.add(new THREE.Mesh(loftGeometry({
        profile: pts,
        crossSection: prof?.crossSection,
        radialSegments: (prof?.facets || prof?.lobes) ? 288 : undefined,
        capBottom: false,
      }), material))
      // 子口: the flange that drops into the mouth and holds the lid in place
      if (p.flange > 0) {
        // the bore, not the seat: with a rim collar those differ, and sizing
        // the 子口 off the seat put it outside the opening and through the collar
        const fr = (prof?.boreR ?? mouthR) - 0.02
        const f = p.flange
        const ring = [
          new THREE.Vector2(fr, -rimEdge),
          new THREE.Vector2(fr, -rimEdge - f),
          new THREE.Vector2(fr - T * 0.7, -rimEdge - f),
          new THREE.Vector2(fr - T * 0.7, -rimEdge),
          new THREE.Vector2(fr, -rimEdge),
        ]
        g.add(new THREE.Mesh(loftGeometry({
          profile: ring,
          crossSection: prof?.crossSection,
          radialSegments: (prof?.facets || prof?.lobes) ? 288 : undefined,
          capBottom: false,
        }), material))
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
