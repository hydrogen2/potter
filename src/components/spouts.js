import * as THREE from 'three'
import { loftGeometry } from '../geometry/loft.js'
import { sweptTube, filletBlend, filletCollar, surfaceCrossing } from '../geometry/sweep.js'

/**
 * 流 — spouts. Built along +Y from the base (y=0) to the tip; the
 * assembler rotates and plants it in the body wall at attach.y.
 * The pour opening always shows real wall thickness.
 */

export const SPOUTS = {
  none: { label: '无', params: {}, build: () => null },

  // 一弯嘴 proper. `curved` places control points and hopes for a shape; that
  // gives a U — the spout leaves the body pointing *down*, sags, and swings up,
  // with no inflection anywhere. A real one is an inverse S: it leaves the belly
  // already rising, the middle flattens, and the lip turns up again.
  //
  // So this builds the centreline from its *tangent angle* instead of from
  // control points. theta(t) runs from the root angle to the lip angle with a
  // sine dip subtracted, and the centreline is the integral of (cos, sin) of it:
  //
  //   theta(t) = rootAngle + (tipAngle - rootAngle) t - sBend sin(pi t)
  //
  // theta'(t) = (tipAngle - rootAngle) - sBend pi cos(pi t) changes sign exactly
  // once whenever sBend*pi exceeds the angle span — and a single sign change of
  // theta' *is* a single inflection. The S is therefore guaranteed by
  // construction rather than tuned for, and no corner is possible because theta
  // is smooth.
  oneBend: {
    label: '一弯嘴',
    // built along the body's own axes, so the assembler must not re-place it
    bodySpace: true,
    params: {
      attachY: { label: '接身', min: 0.1, max: 0.8, step: 0.01, default: 0.46 },
      length: { label: '流长', min: 0.2, max: 1.2, step: 0.01, default: 0.62 },
      // measured *from the body's own surface normal* at the attachment, not
      // from horizontal: 0 leaves straight out of the belly. Absolute angles
      // make the buried run cut across the surface obliquely, and the tube then
      // grazes it and exits as a thin fin instead of a round root.
      rootAngle: { label: '起角', min: -25, max: 45, step: 1, default: 4 },
      // where the *lip* points, measured from horizontal. Small: on the real
      // pots the outer half of the spout runs nearly flat.
      tipAngle: { label: '口角', min: -10, max: 60, step: 1, default: 14 },
      // How front-loaded the turning is. The spout leaves the belly already
      // curving hard and then straightens — steep first, flattening after, the
      // shape of a log curve. Above 1 concentrates the bend at the root; at 1
      // the angle changes at a constant rate and the spout reads as a straight
      // run with a knee in it.
      bend: { label: '弯度', min: 1, max: 4, step: 0.1, default: 2.2 },
      // the short upward flick of the lip itself
      lip: { label: '口上扬', min: 0, max: 45, step: 1, default: 20 },
      // 流口: how obliquely the tip is cut. 0 is a square cut across the axis,
      // which no potter would leave; the real ones open upward and forward so
      // the underside finishes as the thin edge the stream leaves from.
      bevel: { label: '口斜', min: 0, max: 0.3, step: 0.01, default: 0.12 },
      // how far back the rim rolls over. A square or knife-edged lip is the one
      // sharp thing on an otherwise round pot and it shows.
      lipRoll: { label: '口圆', min: 0, max: 0.2, step: 0.005, default: 0.06 },
      rootR: { label: '根径', min: 0.05, max: 0.26, step: 0.002, default: 0.155 },
      tipR: { label: '口径', min: 0.02, max: 0.12, step: 0.002, default: 0.058 },
      wall: { label: '壁厚', min: 0.005, max: 0.03, step: 0.001, default: 0.014 },
      // How fast the root narrows. A real spout is not a tube of slowly falling
      // bore stuck on the belly — it flares wide where it meets the body and
      // thins away within the first fraction of its length, so it reads as
      // growing out of the shoulder rather than butted against it. 1 is a
      // straight taper; 3 puts almost all the flare at the root.
      flare: { label: '根张', min: 1, max: 4, step: 0.1, default: 2.6 },
      blend: { label: '润接', min: 0, max: 0.2, step: 0.005, default: 0.08 },
    },
    build(p, material, prof) {
      const H = prof?.height ?? 1
      let y0 = H * p.attachY
      const embed = Math.max(0.13, p.rootR + 0.02)
      const rad = (d) => (d * Math.PI) / 180
      // the outward normal of the body profile at the attachment height
      const rr = (yy) => (prof?.radiusAt ? prof.radiusAt(yy) : 0.8)
      const dh = 0.012
      const slope = (rr(y0 + dh) - rr(y0 - dh)) / (2 * dh)
      const nAng = Math.atan2(-slope, 1)
      const a0 = nAng + rad(p.rootAngle), a1 = rad(p.tipAngle)
      // start the buried run back along that normal, so the tube meets the
      // surface square rather than slicing across it
      const x0 = rr(y0) - embed * Math.cos(nAng)
      y0 -= embed * Math.sin(nAng)
      // The turn must not be spent on the buried run — roughly a quarter of the
      // curve is inside the belly — so the shaping starts at the surface.
      const tE = Math.min(0.6, embed / Math.max(p.length, 1e-3))
      const g = p.bend ?? 2.2
      const lip = rad(p.lip ?? 0)
      const theta = (t) => {
        const u = Math.min(1, Math.max(0, (t - tE) / (1 - tE)))
        // decay from the root angle to the lip angle, front-loaded by g, plus
        // a flick that only bites over the last stretch. theta' is negative
        // almost throughout and turns positive right at the end: one
        // inflection, at the lip, which is where the real ones have it.
        return a1 + (a0 - a1) * Math.pow(1 - u, g) + lip * Math.pow(u, 6)
      }
      const N = 88
      const pts = [new THREE.Vector3(x0, y0, 0)]
      let x = x0, y = y0
      for (let i = 1; i <= N; i++) {
        const th = theta((i - 0.5) / N)
        x += (p.length / N) * Math.cos(th)
        y += (p.length / N) * Math.sin(th)
        pts.push(new THREE.Vector3(x, y, 0))
      }
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal')
      const outerAt = (t) =>
        p.tipR + (p.rootR - p.tipR) * Math.pow(1 - t, p.flare ?? 2.6)
      const tube = new THREE.Mesh(
        sweptTube(curve, outerAt, 96, 24,
          (t) => Math.max(outerAt(t) - p.wall, 0.005), p.bevel ?? 0, p.lipRoll ?? 0),
        material,
      )
      tube.userData.centreline = curve.getPoints(160)
      if (!p.blend) return tube
      const group = new THREE.Group()
      group.userData.centreline = tube.userData.centreline
      group.add(tube, new THREE.Mesh(
        filletBlend(curve, outerAt, prof, p.blend, true), material,
      ))
      return group
    },
  },

  curved: {
    label: '弯流',
    bodySpace: true,
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
      wall: { label: '壁厚', min: 0.005, max: 0.03, step: 0.001, default: 0.012 },
      blend: { label: '润接', min: 0, max: 0.2, step: 0.005, default: 0.06 },
      // How vertical the last run is. On a real 一弯嘴 the final third turns up
      // and the lip faces the sky; at 0 the spout runs out on the diagonal,
      // which is what 潘壶 has, so this defaults off.
      tipUp: { label: '流口上扬', min: 0, max: 1, step: 0.02, default: 0 },
    },
    build(p, material, prof) {
      const H = prof?.height ?? 1
      let y0 = H * p.attachY
      // How deep the curve starts inside the body has to scale with the root:
      // a tube of radius R centred on a curve that starts only 0.13 in will
      // have its underside outside a convex belly, and the root opens a notch.
      // The floor keeps the slimmer spouts (潘壶) where they were.
      const embed = Math.max(0.13, p.rootR + 0.02)
      const x0 = (prof?.radiusAt ? prof.radiusAt(y0) : 0.8)
      const tipY = y0 + H * p.rise
      const tipX = x0 + p.length
      // control points: out of the belly, through the bend, up to the lip
      const u = p.tipUp ?? 0
      const ctrl = [
        new THREE.Vector3(x0 - embed, y0 - 0.02, 0),
        new THREE.Vector3(x0 + p.length * 0.32, y0 + H * p.rise * 0.16, 0),
        new THREE.Vector3(x0 + p.length * 0.68, y0 + H * p.rise * (0.42 + p.bend * 0.4), 0),
      ]
      if (u > 0) {
        // stack a knee almost directly under the lip: the curve then has to
        // climb steeply over very little horizontal distance, and the tube's
        // end cap — the 流口 — ends up facing upward
        // set the knee well back from the lip: crowding it under the tip makes
        // Catmull-Rom turn a corner rather than a curve
        ctrl.push(new THREE.Vector3(
          tipX - p.length * 0.30 * u,
          tipY - H * p.rise * 0.50 * u,
          0,
        ))
      }
      ctrl.push(new THREE.Vector3(tipX, tipY, 0))
      const curve = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal')
      const outerAt = (t) => THREE.MathUtils.lerp(p.rootR, p.tipR, Math.pow(t, 0.8))
      const tube = new THREE.Mesh(
        sweptTube(curve, outerAt, 72, 18, (t) => Math.max(outerAt(t) - p.wall, 0.006)),
        material,
      )
      tube.userData.centreline = curve.getPoints(160)
      if (!p.blend) return tube
      // 润接: the root flows into the belly instead of being butted against it
      const group = new THREE.Group()
      group.userData.centreline = tube.userData.centreline
      const onBody = (P) => {
        const r = Math.hypot(P.x, P.z) || 1e-6
        const target = prof.radiusAt(P.y)
        return new THREE.Vector3(P.x * target / r, P.y, P.z * target / r)
      }
      const { point, tangent, t } = surfaceCrossing(curve, prof, true)
      const rootR = THREE.MathUtils.lerp(p.rootR, p.tipR, Math.pow(t, 0.8))
      group.add(tube, new THREE.Mesh(filletCollar(point, tangent, rootR, p.blend, 26, 12, onBody), material))
      return group
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
