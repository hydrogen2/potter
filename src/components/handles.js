import * as THREE from 'three'

/** tube of varying radius along a curve (three's TubeGeometry is fixed-radius) */
function sweptTube(curve, radiusAt, tubular = 72, radial = 16) {
  const frames = curve.computeFrenetFrames(tubular, false)
  const pos = [], nor = [], idx = []
  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular
    const P = curve.getPointAt(t)
    const N = frames.normals[i]
    const B = frames.binormals[i]
    const r = radiusAt(t)
    for (let j = 0; j <= radial; j++) {
      const v = (j / radial) * Math.PI * 2
      const sn = Math.sin(v), cs = -Math.cos(v)
      const nx = cs * N.x + sn * B.x
      const ny = cs * N.y + sn * B.y
      const nz = cs * N.z + sn * B.z
      nor.push(nx, ny, nz)
      pos.push(P.x + r * nx, P.y + r * ny, P.z + r * nz)
    }
  }
  for (let i = 1; i <= tubular; i++) {
    for (let j = 1; j <= radial; j++) {
      const a = (radial + 1) * (i - 1) + (j - 1)
      const b = (radial + 1) * i + (j - 1)
      const c = (radial + 1) * i + j
      const d = (radial + 1) * (i - 1) + j
      idx.push(a, b, d, b, c, d)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setIndex(idx)
  return g
}

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
    label: '倒耳把',
    // 西施's 倒把: a thick clay strap rolled into a round ear — thick where it
    // meets the shoulder, tapering as it sweeps down to a thinner tail at the
    // belly. Built on a true circular arc so no straight segment can appear.
    params: {
      tube: { label: '把粗', min: 0.03, max: 0.12, step: 0.002, default: 0.075 },
      taper: { label: '把梢', min: 0.35, max: 1.0, step: 0.02, default: 0.6 },
      outerX: { label: '外缘', min: 0.8, max: 2.0, step: 0.01, default: 1.30 },
      topY: { label: '上接', min: 0.45, max: 1.0, step: 0.01, default: 0.78 },
      botY: { label: '下接', min: 0.08, max: 0.6, step: 0.01, default: 0.30 },
      loopY: { label: '环心高', min: 0.2, max: 0.9, step: 0.01, default: 0.52 },
    },
    build(p, prof, material) {
      const H = prof.height
      const A = new THREE.Vector2(-(prof.radiusAt(H * p.topY) - 0.035), H * p.topY)
      const B = new THREE.Vector2(-(prof.radiusAt(H * p.botY) - 0.035), H * p.botY)
      const C = new THREE.Vector2(-p.outerX, H * p.loopY)
      const { centre, radius } = circleThrough(A, B, C)
      const ang = (v) => Math.atan2(v.y - centre.y, v.x - centre.x)
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
      const pts = []
      const N = 64
      for (let i = 0; i <= N; i++) {
        const a = a0 + delta * (i / N)
        pts.push(new THREE.Vector3(centre.x + radius * Math.cos(a), centre.y + radius * Math.sin(a), 0))
      }
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal')
      const geo = sweptTube(curve, (t) => p.tube * (1 - (1 - p.taper) * t * t))
      return new THREE.Mesh(geo, material)
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
