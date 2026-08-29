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
      overhang: { label: '盖沿', min: 0, max: 0.35, step: 0.002, default: 0.045 },
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
      overhang: { label: '盖沿', min: 0, max: 0.35, step: 0.002, default: 0.028 },
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

  // 艹 revolved — the lid for 茶字壶.
  //
  // The revolved profile of 艹 is a wide bar at r 0.48 with its two verticals at
  // r 0.24 standing *both above and below* it. Revolved, that is not a disc with
  // a knob stuck on: it is one ring passing straight through a disc. The part
  // above is the knob, the part below is the 子口 that drops into the mouth, and
  // they are the same ring. The character supplies the whole lid.
  discRing: {
    label: '艹盖',
    params: {
      overhang: { label: '盖沿', min: 0, max: 0.35, step: 0.002, default: 0.02 },
      thickness: { label: '盖厚', min: 0.02, max: 0.1, step: 0.002, default: 0.05 },
      ringR: { label: '环径', min: 0.1, max: 0.7, step: 0.005, default: 0.30 },
      ringW: { label: '环厚', min: 0.02, max: 0.14, step: 0.002, default: 0.05 },
      up: { label: '环高', min: 0.02, max: 0.4, step: 0.005, default: 0.15 },
      down: { label: '子口', min: 0, max: 0.2, step: 0.005, default: 0.06 },
      round: { label: '环圆', min: 0, max: 0.5, step: 0.02, default: 0.4 },
      vent: { label: '气孔', min: 0, max: 0.03, step: 0.001, default: 0.012 },
      seam: { label: '盖缝', min: 0.0, max: 0.02, step: 0.001, default: 0.005 },
    },
    top: (p) => p.thickness + p.up,
    drop: (p) => () => 0,
    build(p, mouthR, material, prof) {
      const R = mouthR + p.overhang
      const T = p.thickness
      const v = Math.max(p.vent, 0.004)
      const ro = p.ringR + p.ringW / 2
      const ri = Math.max(v + 0.02, p.ringR - p.ringW / 2)
      const rr = Math.min(p.round * p.ringW, p.up * 0.45)
      const pts = []
      const V = (r, y) => pts.push(new THREE.Vector2(r, y))
      // underside of the disc, out to the rim
      V(ri, -p.down)
      V(ri, -0.002)
      V(R * 0.6, -0.002)
      V(R - 0.006, -0.004)
      V(R, 0.006)
      V(R, T - 0.008)
      V(R - 0.012, T)
      V(ro, T)
      // the ring standing on it, rounded over the top
      V(ro, T + p.up - rr)
      const N = 7
      for (let i = 1; i <= N; i++) {
        const a = (i / N) * Math.PI
        V(p.ringR + Math.cos(a) * p.ringW / 2, T + p.up - rr + Math.sin(a) * rr)
      }
      V(ri, T + p.up - rr)
      V(ri, -p.down)                       // straight down: the same ring, below

      // 艹 drawn on the lid, because the lid is what 艹 is. The relief only has
      // a radius to move, so it lands on the upright runs — the disc's rim, the
      // ring's wall, the 子口 — and slides along the flats, which is the right
      // place for it anyway: those uprights are the strokes.
      const gl = prof?.glyph
      const cao = gl?.groups?.cao
      let cross
      let rows = pts
      // the glyph alone gates the drawing; the depths gate the displacement
      if (cao) {
        const bin = atob(cao.data)
        const grid = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) grid[i] = bin.charCodeAt(i)
        const bb = cao.bbox
        const lo = -p.down, hi = T + p.up
        const aspect = (bb[1] - bb[0]) / Math.max(bb[3] - bb[2], 1e-6)
        const span = Math.min(THREE.MathUtils.degToRad(110),
          ((hi - lo) * aspect) / Math.max(R, 1e-6))
        // the lathe profile has too few rows for a drawn line to survive; the
        // body resamples for the same reason
        rows = [pts[0]]
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1], b = pts[i]
          const n = Math.max(1, Math.ceil(a.distanceTo(b) / 0.004))
          for (let j = 1; j <= n; j++) rows.push(a.clone().lerp(b, j / n))
        }
        cross = (theta, _t, y) => {
          let d = theta - gl.at
          while (d > Math.PI) d -= Math.PI * 2
          while (d < -Math.PI) d += Math.PI * 2
          if (y < lo || y > hi || Math.abs(d) > span / 2) return 1
          const gx = (d / span) * (bb[1] - bb[0]) + (bb[0] + bb[1]) / 2
          const gy = ((y - lo) / (hi - lo)) * (bb[3] - bb[2]) + bb[2]
          const u = (gx - cao.x0) / (cao.x1 - cao.x0)
          const v = (cao.y1 - gy) / (cao.y1 - cao.y0)
          if (u < 0 || u > 1 || v < 0 || v > 1) return 1
          const i = Math.min(cao.size - 1, Math.floor(u * cao.size))
          const j = Math.min(cao.size - 1, Math.floor(v * cao.size))
          return 1 + gl.face * (grid[j * cao.size + i] / 255)
        }
      }
      let tint
      if (cross) {
        const T2 = [0.60, 0.47, 0.34]                 // the same 泥绘 as the body
        tint = (theta, _t, y) => {
          const v = (cross(theta, _t, y) - 1) / Math.max(gl.face, 1e-6)
          if (v <= 0) return null
          return [THREE.MathUtils.lerp(1, T2[0], v), THREE.MathUtils.lerp(1, T2[1], v),
            THREE.MathUtils.lerp(1, T2[2], v)]
        }
      }
      const geo = loftGeometry({
        profile: rows, capBottom: false,
        crossSection: cross, colorAt: tint, radialSegments: cross ? 600 : 160,
      })
      return new THREE.Mesh(geo,
        tint ? Object.assign(material.clone(), { vertexColors: true }) : material)
    },
  },

  discSlab: {
    label: '艹盘盖',
    // A disc with enough height to carry 艹 on its rim, and nothing else. The
    // ring-on-a-disc version put the crossbar on one surface and the two
    // verticals on another, so the strokes had to step across a corner to stay
    // together and read as two stacked discs instead of as a character. One
    // upright band holds the whole of 艹 at once.
    params: {
      overhang: { label: '盖沿', min: 0, max: 0.35, step: 0.002, default: 0.13 },
      thickness: { label: '盖高', min: 0.06, max: 0.34, step: 0.005, default: 0.20 },
      down: { label: '子口', min: 0, max: 0.2, step: 0.005, default: 0.06 },
      round: { label: '棱圆', min: 0, max: 0.06, step: 0.002, default: 0.014 },
      ringRelief: { label: '弦纹', min: 0, max: 0.05, step: 0.002, default: 0.022 },
      // 0 = the character's own stroke width, scaled with the lid. Any other
      // value holds the line to that weight instead: a larger 艹 drawn at its own
      // proportions carries proportionally fatter strokes, which is correct for
      // the character but makes the lid's lines heavier than the body's.
      strokeW: { label: '笔宽', min: 0, max: 0.05, step: 0.001, default: 0 },
      vent: { label: '气孔', min: 0, max: 0.03, step: 0.001, default: 0.012 },
      seam: { label: '盖缝', min: 0.0, max: 0.02, step: 0.001, default: 0.005 },
    },
    top: (p) => p.thickness,
    drop: (p) => () => 0,
    build(p, mouthR, material, prof) {
      const R = mouthR + p.overhang
      const T = p.thickness
      const v = Math.max(p.vent, 0.004)
      const ri = Math.max(v + 0.02, mouthR - 0.03)
      const rr = Math.min(p.round, T * 0.3)
      const pts = []
      const V = (r, y) => pts.push(new THREE.Vector2(r, y))
      V(ri, -p.down)
      V(ri, -0.002)
      V(R * 0.6, -0.002)
      V(R - rr, -0.004)
      V(R, rr)
      V(R, T - rr)
      V(R - rr, T)
      V(ri, T)
      V(ri, -p.down)

      // 艹 on the rim, and only on the rim: the band is [0, T], so no stroke
      // runs off onto the flat top or the underside, where a radial relief has
      // nothing to push against anyway.
      // 艹 built from its own measurements rather than mapped from a raster, so
      // that the lid *in side view* is the character and not an approximation of
      // it. Seen from the side a revolved lid shows: its rim as a rectangle, the
      // crossbar-ring as one horizontal line right across it, and the two
      // verticals wherever their azimuth projects to. Make those projections
      // land on 艹's own figures and the silhouette is 艹 exactly:
      //
      //   lid height / lid width = (up + barH + down) / 2·barHalf = 0.2954
      //   verticals at azimuth     asin(ringR / barHalf) = 26.60°
      //   bar centre at            (down + barH/2) / height = 0.5372 up the lid
      //
      // The stroke width falls out of the same scaling at 0.0185 against 木's
      // 0.0182 — the character's own proportions give one line weight for free.
      const gl = prof?.glyph
      const C = gl?.cao
      let cross
      let shape
      let rows = pts
      if (C) {
        const kLid = R / Math.max(C.barHalf, 1e-6)
        const charH = (C.up + C.barH + C.down) * kLid
        const barY = ((C.down + C.barH / 2) / (C.up + C.barH + C.down)) * T
        const hw = p.strokeW > 0 ? p.strokeW : (C.barH / 2) * kLid
        const vTheta = Math.asin(Math.min(1, C.ringR / Math.max(C.barHalf, 1e-6)))
        const lo = 0, hi = T
        const wrap = (x) => {
          let d = x
          while (d > Math.PI) d -= Math.PI * 2
          while (d < -Math.PI) d += Math.PI * 2
          return d
        }
        // the same plateau the hips use, so every line on the pot has one profile
        const prof1 = (a, w) => {
          if (a > w) return 0
          const u = a / w
          if (u < 0.54) return 1
          const e = (u - 0.54) / 0.46
          return 1 - e * e
        }
        shape = (theta, y) => {
          if (y < lo || y > hi) return { ring: 0, chars: 0, all: 0 }
          const ring = prof1(Math.abs(y - barY), hw)
          const aw = hw / Math.max(R, 1e-6)
          let chars = 0
          for (const base of [gl.at, gl.at + Math.PI]) {
            const d = Math.abs(wrap(theta - base))
            chars = Math.max(chars, prof1(Math.abs(d - vTheta), aw))
          }
          return { ring, chars, all: Math.max(ring, chars) }
        }
        rows = [pts[0]]
        for (let k = 1; k < pts.length; k++) {
          const a = pts[k - 1], b = pts[k]
          const n = Math.max(1, Math.ceil(a.distanceTo(b) / 0.004))
          for (let q = 1; q <= n; q++) rows.push(a.clone().lerp(b, q / n))
        }
        // The ring and the strokes carry their own depths, and where they cross
        // the displacement is whichever is greater — not the sum, or the
        // crossbar would bulge where the verticals pass through it.
        const ringD = p.ringRelief ?? 0
        const charD = gl.face ?? 0
        cross = (ringD > 0 || charD > 0)
          ? (theta, _t, y) => {
              const v = shape(theta, y)
              const d = Math.max(v.ring * ringD, v.chars * charD)
              return d > 0 ? 1 + d / Math.max(R, 0.05) : 1
            }
          : undefined
        if (Math.abs(charH - T) > 0.002) {
          // not fatal — the canon rule states it — but say so rather than let a
          // stretched 艹 pass for the character
          if (typeof console !== 'undefined' && console.debug) {
            console.debug(`艹 lid: height ${T.toFixed(4)} vs exact ${charH.toFixed(4)}`)
          }
        }
      }
      let tint
      if (shape) {
        const T2 = [0.60, 0.47, 0.34]
        tint = (theta, _t, y) => {
          const a = shape(theta, y).all
          if (a <= 0) return null
          return [THREE.MathUtils.lerp(1, T2[0], a), THREE.MathUtils.lerp(1, T2[1], a),
            THREE.MathUtils.lerp(1, T2[2], a)]
        }
      }
      return new THREE.Mesh(loftGeometry({
        profile: rows, capBottom: false,
        crossSection: cross, colorAt: tint, radialSegments: shape ? 600 : 160,
      }), tint ? Object.assign(material.clone(), { vertexColors: true }) : material)
    },
  },

  shiLid: {
    label: '士盖',
    // 壺's 士 is the lid, not a decoration on one. Its two 一 are set against
    // each other rather than held apart by the 竖: as a character the stroke
    // passes between them, but revolved, a 0.04-radius waist between two discs
    // is a stem holding up a plate. Stacked, they are one stepped lid — the
    // wider disc over the narrower — which is what 士 reads as anyway. The 竖
    // above them becomes the knob.
    params: {
      scale: { label: '盖率', min: 0.5, max: 1.4, step: 0.01, default: 1 },
      knobR: { label: '钮径', min: 0.04, max: 0.30, step: 0.005, default: 0.11 },
      drop: { label: '子口', min: 0, max: 0.12, step: 0.005, default: 0.04 },
      round: { label: '棱圆', min: 0, max: 0.03, step: 0.001, default: 0.007 },
      vent: { label: '气孔', min: 0, max: 0.03, step: 0.001, default: 0.012 },
      seam: { label: '盖缝', min: 0.0, max: 0.02, step: 0.001, default: 0.005 },
    },
    top(p, prof) {
      const S = prof?.glyph?.shi
      if (!S) return 0.2
      const k0 = prof.glyph.k ?? 1
      const k = ((prof.mouthR ?? S.kouR * k0) / Math.max(S.kouR * k0, 1e-6)) * k0 * p.scale
      return (S.kouH + S.brimH + S.pegH) * k
    },
    // This lid is wider than the mouth it seats in — the brim overhangs the 子口
    // — so a clearance check cannot assume mouthR + overhang and has to ask.
    widest(p, prof) {
      const S = prof?.glyph?.shi
      if (!S) return prof?.mouthR ?? 0.3
      const k0 = prof.glyph.k ?? 1
      const k = ((prof.mouthR ?? S.kouR * k0) / Math.max(S.kouR * k0, 1e-6)) * k0 * p.scale
      return S.brimR * k
    },
    drop: () => () => 0,
    build(p, mouthR, material, prof) {
      const S = prof?.glyph?.shi
      if (!S) return null
      // The lid's size is not chosen: its 子口 has to fit the mouth, so the scale
      // is read back off the pot. `scale` multiplies that, it does not replace it.
      const k0 = prof?.glyph?.k ?? 1
      const k = (mouthR / Math.max(S.kouR * k0, 1e-6)) * k0 * p.scale
      const rKou = S.kouR * k, hKou = S.kouH * k
      const rBrim = S.brimR * k, hBrim = S.brimH * k
      // the 竖 as a knob: a small disc rather than the character's 0.04 peg,
      // which revolved is a rod too thin to grip and too thin to fire
      const rKnob = Math.max(p.knobR * k, 0.02), hKnob = S.pegH * k
      const v = Math.max(p.vent, 0.004)
      const rr = p.round
      const spig = Math.max(v + 0.02, Math.min(rKou, mouthR) - 0.022)
      const pts = []
      const V = (r, y) => pts.push(new THREE.Vector2(r, y))
      let y = 0
      V(spig, -p.drop)
      V(spig, -0.002)
      V(rKou - rr, -0.002)
      V(rKou, rr)
      y = hKou
      V(rKou, y - rr)                            // the 子口 disc's rim
      V(rKou + rr, y)                            // out onto the brim's underside
      V(rBrim - rr, y)
      V(rBrim, y + rr)
      y += hBrim
      V(rBrim, y - rr); V(rBrim - rr, y)         // the brim's top
      V(rKnob + rr, y); V(rKnob, y + rr)         // in to the knob
      y += hKnob
      V(rKnob, y - rr); V(rKnob - rr, y)
      V(Math.max(v, 0.008), y)
      V(Math.max(v, 0.008), -p.drop)
      return new THREE.Mesh(loftGeometry({ profile: pts, capBottom: false }), material)
    },
  },

  coneCap: {
    label: '截盖·艹钮',
    // 截盖 in the strict sense: the lid is the rest of the cone. The body is cut
    // off partway up the roof, and this carries the same slope on to the apex,
    // so the silhouette runs unbroken from foot to tip and the roof's hips —
    // meridians — arrive at the apex and meet there of their own accord. The 艹
    // disc sits at the tip as the knob.
    params: {
      tip: { label: '收至', min: 0.04, max: 0.6, step: 0.01, default: 0.16 },
      knobR: { label: '钮径', min: 0.06, max: 0.5, step: 0.005, default: 0.20 },
      knobH: { label: '钮高', min: 0.04, max: 0.26, step: 0.005, default: 0.11 },
      down: { label: '子口', min: 0, max: 0.2, step: 0.005, default: 0.05 },
      round: { label: '棱圆', min: 0, max: 0.05, step: 0.002, default: 0.012 },
      vent: { label: '气孔', min: 0, max: 0.03, step: 0.001, default: 0.012 },
      seam: { label: '盖缝', min: 0.0, max: 0.02, step: 0.001, default: 0.005 },
    },
    top(p, prof) {
      const m = prof?.cone?.slope ?? 1
      const rise = ((prof?.mouthR ?? 0.3) * (1 - p.tip)) / Math.max(m, 1e-6)
      return rise + p.knobH
    },
    drop: () => () => 0,
    build(p, mouthR, material, prof) {
      const cone = prof?.cone
      const m = Math.max(cone?.slope ?? 1, 1e-6)
      const rTip = mouthR * p.tip
      const rise = (mouthR - rTip) / m          // the cone carried on, same slope
      const kR = Math.max(p.knobR, rTip + 0.01)
      const v = Math.max(p.vent, 0.004)
      const ri = Math.max(v + 0.02, mouthR - 0.03)
      const rr = Math.min(p.round, rise * 0.2)
      const pts = []
      const V = (r, y) => pts.push(new THREE.Vector2(r, y))
      V(ri, -p.down)
      V(ri, -0.002)
      V(mouthR - 0.012, -0.002)
      V(mouthR, 0.006)                          // the cut, seated on the mouth
      V(rTip + rr * m, rise - rr)               // up the cone
      V(rTip, rise)
      V(kR - rr, rise)                          // the 艹 disc, sitting at the tip
      V(kR, rise + rr)
      V(kR, rise + p.knobH - rr)
      V(kR - rr, rise + p.knobH)
      V(Math.max(v, 0.01), rise + p.knobH)
      V(Math.max(v, 0.01), -p.down)
      let rows = pts

      const gl = prof?.glyph
      const cao = gl?.groups?.cao
      let cross
      // the glyph alone gates the drawing; the depths gate the displacement
      if (cao) {
        const bin = atob(cao.data)
        const grid = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) grid[i] = bin.charCodeAt(i)
        const bb = cao.bbox
        const lo = rise + rr, hi = rise + p.knobH - rr
        const aspect = (bb[1] - bb[0]) / Math.max(bb[3] - bb[2], 1e-6)
        const span = Math.min(THREE.MathUtils.degToRad(110),
          ((hi - lo) * aspect) / Math.max(kR, 1e-6))
        const barY = lo + ((gl.caoBarY - bb[2]) / Math.max(bb[3] - bb[2], 1e-6)) * (hi - lo)
        const bw = (hi - lo) * 0.08
        rows = [pts[0]]
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1], b = pts[i]
          const n = Math.max(1, Math.ceil(a.distanceTo(b) / 0.004))
          for (let j = 1; j <= n; j++) rows.push(a.clone().lerp(b, j / n))
        }
        const wrap = (x) => {
          let d = x
          while (d > Math.PI) d -= Math.PI * 2
          while (d < -Math.PI) d += Math.PI * 2
          return d
        }
        const face = (d, y) => {
          if (y < lo || y > hi || Math.abs(d) > span / 2) return 0
          const gx = (d / span) * (bb[1] - bb[0]) + (bb[0] + bb[1]) / 2
          const gy = ((y - lo) / (hi - lo)) * (bb[3] - bb[2]) + bb[2]
          const u = (gx - cao.x0) / (cao.x1 - cao.x0)
          const w = (cao.y1 - gy) / (cao.y1 - cao.y0)
          if (u < 0 || u > 1 || w < 0 || w > 1) return 0
          const i = Math.min(cao.size - 1, Math.floor(u * cao.size))
          const j = Math.min(cao.size - 1, Math.floor(w * cao.size))
          return grid[j * cao.size + i] / 255
        }
        // the hips, carried on across the seam at the same azimuth and the same
        // physical width, so the roof's ridges do not stop at the cut
        const hip = (theta, y, r) => {
          if (y < 0 || y > rise || !cone) return 0
          const aw = cone.roofW / Math.max(r, 1e-6)
          let best = 0
          for (const base of [cone.at, cone.at + Math.PI]) {
            const a = Math.abs(Math.abs(wrap(theta - base)) - cone.roofAt)
            if (a > aw) continue
            const u = a / aw
            best = Math.max(best, 1 - u * u)
          }
          return best
        }
        cross = (theta, _t, y) => {
          const rHere = y <= rise ? mouthR - m * Math.max(y, 0) : kR
          const a = Math.abs(y - barY)
          const ring = (y >= lo && y <= hi && a <= bw) ? 1 - (a / bw) * (a / bw) : 0
          const val = Math.max(ring, hip(theta, y, rHere),
            face(wrap(theta - gl.at), y), face(wrap(theta - gl.at - Math.PI), y))
          return val > 0 ? 1 + (gl.face * val) / Math.max(rHere, 0.05) : 1
        }
      }
      let tint
      if (cross) {
        const T2 = [0.60, 0.47, 0.34]
        tint = (theta, _t, y) => {
          // the same radius the crossSection used at this height — the cone is
          // still narrowing here, so a single R would be wrong
          const rHere = y <= rise ? mouthR - m * Math.max(y, 0) : kR
          const a = Math.min(1, ((cross(theta, _t, y) - 1) * Math.max(rHere, 0.05))
            / Math.max(gl.face, 1e-6))
          if (a <= 0) return null
          return [THREE.MathUtils.lerp(1, T2[0], a), THREE.MathUtils.lerp(1, T2[1], a),
            THREE.MathUtils.lerp(1, T2[2], a)]
        }
      }
      return new THREE.Mesh(loftGeometry({
        profile: rows, capBottom: false,
        crossSection: cross, colorAt: tint, radialSegments: cross ? 600 : 160,
      }), tint ? Object.assign(material.clone(), { vertexColors: true }) : material)
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
      overhang: { label: '盖沿', min: 0, max: 0.35, step: 0.002, default: 0.03 },
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
      overhang: { label: '盖沿', min: 0, max: 0.35, step: 0.002, default: 0.045 },
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
