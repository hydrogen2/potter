import * as THREE from 'three'
import { sweptTube, filletCollar, surfaceCrossing } from '../geometry/sweep.js'

/** the circle through three points, as centre + radius */
function circleThrough(A, B, C) {
  const d = 2 * (A.x * (B.y - C.y) + B.x * (C.y - A.y) + C.x * (A.y - B.y))
  const a2 = A.x * A.x + A.y * A.y, b2 = B.x * B.x + B.y * B.y, c2 = C.x * C.x + C.y * C.y
  const ux = (a2 * (B.y - C.y) + b2 * (C.y - A.y) + c2 * (A.y - B.y)) / d
  const uy = (a2 * (C.x - B.x) + b2 * (A.x - C.x) + c2 * (B.x - A.x)) / d
  const centre = new THREE.Vector2(ux, uy)
  return { centre, radius: centre.distanceTo(A) }
}

/**
 * 把 — handles. Each returns a mesh positioned relative to the body:
 * the builder receives the body profile (radiusAt / height) so the loop
 * meets the wall wherever the wall is.
 */

export const HANDLES = {
  none: { label: '无', params: {}, build: () => null },

  invertedEar: {
    label: '耳把',
    // A clay strap rolled into a round ear, built on a true circular arc so no
    // straight segment can appear. `taper` decides which end is thick: below 1
    // it is 西施's 倒把 (thin at the shoulder, thickest at the lower root);
    // near 1 it is the even 环把 that 掇球 wants. rearLoop is the other family
    // of handle — a D with a corner at the top — and is wrong for both.
    params: {
      tube: { label: '把粗', min: 0.03, max: 0.12, step: 0.002, default: 0.075 },
      // Which end is thick. Below 1 the strap is *thin* where it leaves the
      // shoulder and thickest at the lower root — that inversion is what 倒把
      // means and it is 西施's signature. Above 1 it is the ordinary ear that
      // 掇球 and most other 环把 have: thick at the shoulder, tapering down.
      taper: { label: '上梢', min: 0.35, max: 1.8, step: 0.02, default: 0.6 },
      outerX: { label: '外缘', min: 0.8, max: 2.0, step: 0.01, default: 1.30 },
      topY: { label: '上接', min: 0.45, max: 1.0, step: 0.01, default: 0.78 },
      botY: { label: '下接', min: 0.08, max: 0.6, step: 0.01, default: 0.30 },
      loopY: { label: '环心高', min: 0.2, max: 0.9, step: 0.01, default: 0.52 },
      stretch: { label: '环高扁', min: 0.6, max: 1.8, step: 0.02, default: 1.0 },
      blend: { label: '润接', min: 0, max: 0.16, step: 0.005, default: 0.045 },
      // A circle through three points has a single curvature everywhere, which
      // is what 西施's ear wants. 掇球's is a teardrop: full where it leaves the
      // shoulder, tighter where it tucks under the belly. See the note on the
      // modulation below for why this is a radius function and not extra
      // control points. 0 leaves the plain circle.
      teardrop: { label: '梨形', min: 0, max: 0.50, step: 0.01, default: 0 },
    },
    build(p, prof, material) {
      const H = prof.height
      // The ends have to start deeper inside the body than the strap is thick,
      // or the tube's flat end cap sits proud of a convex belly and reads as a
      // step at the root. Same failure as a spout root embedded too shallowly.
      const embed = Math.max(0.035, p.tube * 0.9)
      const A = new THREE.Vector2(-(prof.radiusAt(H * p.topY) - embed), H * p.topY)
      const B = new THREE.Vector2(-(prof.radiusAt(H * p.botY) - embed), H * p.botY)
      const C = new THREE.Vector2(-p.outerX, H * p.loopY)
      // Fit the circle in the *unstretched* frame — y divided by the stretch —
      // and stretch the sampled points back afterwards. Fitting first and
      // stretching after moves the curve off its own endpoints, which the old
      // code patched by pinning the first and last sample back onto the body.
      // That pin is a discontinuity: the strap curled in and kicked back out at
      // each root. Exactly the two curvature reversals check-details reports.
      const k = p.stretch ?? 1
      const un = (v) => new THREE.Vector2(v.x, v.y / k)
      const { centre, radius } = circleThrough(un(A), un(B), un(C))
      const ang = (v) => Math.atan2(un(v).y - centre.y, un(v).x - centre.x)
      const a0 = ang(A)
      const wrap = (x) => {
        while (x <= -Math.PI) x += Math.PI * 2
        while (x > Math.PI) x -= Math.PI * 2
        return x
      }
      // go the way round that passes through the outer point, not the short way
      // (the short way runs through the body and buries the handle inside it)
      let delta = wrap(ang(B) - a0)
      const dc = wrap(ang(C) - a0)
      if (!(Math.sign(dc) === Math.sign(delta) && Math.abs(dc) < Math.abs(delta))) {
        delta -= Math.sign(delta) * Math.PI * 2
      }
      // a circle through the three points is the base; `stretch` makes it an
      // oval, since a real 环把 is taller than it is wide
      // Teardrop by *radius modulation* rather than by adding control points.
      // Threading a spline through a peak and a tuck gives a curve with
      // near-straight runs between the anchors and abrupt turns at them — an
      // angular arm, not an ear. Multiplying the circle's radius by a smooth
      // function instead keeps curvature continuous by construction, so no
      // corner is possible at any parameter value.
      //
      // The modulation must be *non-negative*. sin(2*pi*t) was the obvious
      // choice — swell above, draw in below — but its negative lobe has to
      // climb back to zero at the lower root, and that climb-back is a
      // reversal: the strap curls inward and then kicks out again to meet the
      // body. A visible wiggle, and arithmetic, not bad luck.
      //
      // sin(pi * t^0.6) instead: zero at both roots, never negative, and peaked
      // early (t ~ 0.32) so the swell sits where the strap leaves the shoulder
      // and decays monotonically into the belly. Monotone decay cannot reverse.
      const drop = p.teardrop ?? 0
      const pts = []
      const N = 96
      for (let i = 0; i <= N; i++) {
        const t = i / N
        const a = a0 + delta * t
        const r = radius * (1 + drop * Math.sin(Math.PI * Math.pow(t, 0.6)))
        pts.push(new THREE.Vector3(
          centre.x + r * Math.cos(a),
          (centre.y + r * Math.sin(a)) * k,
          0,
        ))
      }
      // no end pinning: fitted unstretched, the arc already lands on A and B
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal')
      const rAt = (t) => p.tube * (p.taper + (1 - p.taper) * Math.pow(t, 1.4))
      const loop = new THREE.Mesh(sweptTube(curve, rAt), material)
      // keep the curve the strap was built from: the detail checks read it to
      // assert the loop never reverses, which no rendering can tell them
      loop.userData.centreline = curve.getPoints(160)
      if (!p.blend) return loop
      const group = new THREE.Group()
      group.userData.centreline = loop.userData.centreline
      group.add(loop)
      const onBody = (P) => {
        const r = Math.hypot(P.x, P.z) || 1e-6
        const target = prof.radiusAt(P.y)
        return new THREE.Vector3(P.x * target / r, P.y, P.z * target / r)
      }
      for (const fromStart of [true, false]) {
        const { point, tangent, t } = surfaceCrossing(curve, prof, fromStart)
        group.add(new THREE.Mesh(filletCollar(point, tangent, rAt(t), p.blend, 26, 12, onBody), material))
      }
      return group
    },
  },

  rearLoop: {
    label: '端把',
    params: {
      tube: { label: '把粗', min: 0.03, max: 0.1, step: 0.002, default: 0.056 },
      topX: { label: '上角', min: 0.6, max: 1.8, step: 0.005, default: 1.05 },
      outerX: { label: '外缘', min: 0.6, max: 1.8, step: 0.005, default: 1.3 },
      topY: { label: '上接', min: 0.5, max: 1.0, step: 0.01, default: 0.85 },
      botY: { label: '下接', min: 0.1, max: 0.5, step: 0.01, default: 0.26 },
      lift: { label: '把肩', min: 0.8, max: 1.3, step: 0.01, default: 1.0 },
      outerY: { label: '外缘高', min: 0.2, max: 0.8, step: 0.01, default: 0.5 },
    },
    build(p, prof, material) {
      // distances from the axis, so the loop's silhouette is specified
      // directly: top corner (topX, lift·H), outer extreme (outerX, outerY·H)
      const H = prof.height
      const rTop = prof.radiusAt(H * p.topY)
      const rBot = prof.radiusAt(H * p.botY)
      // smooth D-loop: top arm → rounded top corner → outer edge → rounded
      // lower corner → lower arm. Centripetal Catmull-Rom keeps it free of
      // overshoot without pinned segments (which made visible corners).
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-(rTop - 0.05), H * p.topY, 0),
        new THREE.Vector3(-(p.topX - 0.06), H * p.lift, 0),
        new THREE.Vector3(-p.topX, H * (p.lift - 0.08), 0),
        new THREE.Vector3(-p.outerX, H * p.outerY, 0),
        new THREE.Vector3(-(p.outerX - 0.1), H * p.botY + 0.07, 0),
        new THREE.Vector3(-(rBot - 0.05), H * p.botY, 0),
      ], false, 'centripetal')
      return new THREE.Mesh(new THREE.TubeGeometry(curve, 60, p.tube, 14), material)
    },
  },
}
