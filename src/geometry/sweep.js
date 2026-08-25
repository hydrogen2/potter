import * as THREE from 'three'

/**
 * Tube of varying radius along a curve — three's TubeGeometry is fixed-radius,
 * but a hand-formed strap or spout is never a constant tube.
 */
export function sweptTube(curve, radiusAt, tubular = 72, radial = 16, innerAt = null, bevel = 0) {
  // With innerAt the sweep is a *walled* tube: an outer surface, an inner bore
  // and an annulus closing them at the tip. Without a bore a spout has no wall
  // at the pour opening, which the DSL forbids — no surface without a back face.
  //
  // `bevel` cuts the tip obliquely instead of square across the axis, as a
  // fraction of the curve. A real 流口 is cut so the opening faces up and
  // forward: the underside runs out past the top and finishes as a thin edge,
  // which is the edge the stream leaves from. Rather than slicing the finished
  // tube, each meridian is simply run to a different parameter — the ends stay
  // matched between the outer surface and the bore, so the tip annulus closes
  // by construction however oblique the cut.
  const frames = curve.computeFrenetFrames(tubular, false)
  const cut = new Array(radial + 1).fill(0)
  if (bevel > 0) {
    const N = frames.normals[tubular], B = frames.binormals[tubular]
    let peak = 1e-6
    const up = []
    for (let j = 0; j <= radial; j++) {
      const v = (j / radial) * Math.PI * 2
      const y = -Math.cos(v) * N.y + Math.sin(v) * B.y
      up.push(y)
      peak = Math.max(peak, Math.abs(y))
    }
    // Cut the *upper* meridians back so the underside runs out to the forward
    // edge — that thin lower edge is what the stream leaves from, and the
    // opening then faces up and forward. Cutting the other way makes the top
    // the extremity, which pours down its own outside.
    // (Which sign does that is not obvious from a shaded render: measure it.
    // scripts/check-details.mjs asserts it.)
    for (let j = 0; j <= radial; j++) cut[j] = bevel * (0.5 + (0.5 * up[j]) / peak)
  }
  // the cut only bites over the last stretch, so the root is untouched
  const ramp = (t) => {
    const u = Math.min(1, Math.max(0, (t - 0.55) / 0.45))
    return u * u * (3 - 2 * u)
  }
  const param = (t, j) => Math.min(1, Math.max(0, t - cut[j] * ramp(t)))
  const pos = [], nor = [], idx = []
  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular
    const N = frames.normals[i]
    const B = frames.binormals[i]
    for (let j = 0; j <= radial; j++) {
      const tt = param(t, j)
      const P = curve.getPointAt(tt)
      const r = radiusAt(tt)
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
  if (innerAt) {
    const base = (tubular + 1) * (radial + 1)
    for (let i = 0; i <= tubular; i++) {
      const t = i / tubular
      const N = frames.normals[i]
      const B = frames.binormals[i]
      for (let j = 0; j <= radial; j++) {
        const tt = param(t, j)
        const P = curve.getPointAt(tt)
        const r = Math.max(innerAt(tt), 0.004)
        const v = (j / radial) * Math.PI * 2
        const sn = Math.sin(v), cs = -Math.cos(v)
        const nx = cs * N.x + sn * B.x
        const ny = cs * N.y + sn * B.y
        const nz = cs * N.z + sn * B.z
        nor.push(-nx, -ny, -nz)                    // the bore faces inward
        pos.push(P.x + r * nx, P.y + r * ny, P.z + r * nz)
      }
    }
    for (let i = 1; i <= tubular; i++) {
      for (let j = 1; j <= radial; j++) {
        const a = base + (radial + 1) * (i - 1) + (j - 1)
        const b = base + (radial + 1) * i + (j - 1)
        const c = base + (radial + 1) * i + j
        const d = base + (radial + 1) * (i - 1) + j
        idx.push(a, d, b, b, d, c)                 // reversed winding
      }
    }
    // annulus at the tip: this is the wall you see when you look into the spout
    const oTip = (radial + 1) * tubular
    const iTip = base + (radial + 1) * tubular
    for (let j = 1; j <= radial; j++) {
      idx.push(oTip + j - 1, iTip + j - 1, oTip + j)
      idx.push(oTip + j, iTip + j - 1, iTip + j)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setIndex(idx)
  // where the tip ring sits, so the detail checks can inspect the 流口 cut.
  // Which way round a bevel falls is not readable off a shaded render — I got
  // it backwards once by eye — so it is measured instead.
  g.userData.tipRing = { start: (radial + 1) * tubular, count: radial + 1 }
  return g
}


/**
 * 润接 — the concave collar where a spout or handle root flows into the body.
 *
 * Real attachments are not tubes butted against a wall: the potter works a
 * fillet of clay around the joint, so the surface leaves the body tangentially
 * and turns into the attachment. The profile here is a quarter circle, flaring
 * from the attachment's own radius out to `blend` where it meets the body.
 *
 * @param {THREE.Vector3} anchor  where the attachment axis meets the body
 * @param {THREE.Vector3} dir     unit vector pointing away from the body
 * @param {number} r0             the attachment's radius at its root
 * @param {number} blend          fillet size
 */
export function filletCollar(anchor, dir, r0, blend, radial = 24, steps = 12, onBody = null) {
  // `onBody(point)` pulls a point onto the body surface. Without it the collar
  // is a free-floating flange: a circle round the attachment axis does not lie
  // on the body when the attachment meets it obliquely, which is exactly the
  // case that needs a fillet.
  const d = dir.clone().normalize()
  let up = Math.abs(d.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
  const p1 = new THREE.Vector3().crossVectors(d, up).normalize()
  const p2 = new THREE.Vector3().crossVectors(d, p1).normalize()

  const pos = [], nor = [], idx = []
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * (Math.PI / 2)
    const rad = r0 + blend * (1 - Math.cos(a))
    const along = blend - blend * Math.sin(a)      // blend at the tube end, 0 at the body
    for (let j = 0; j <= radial; j++) {
      const th = (j / radial) * Math.PI * 2
      const c = Math.cos(th), s2 = Math.sin(th)
      const nx = p1.x * c + p2.x * s2
      const ny = p1.y * c + p2.y * s2
      const nz = p1.z * c + p2.z * s2
      const P = new THREE.Vector3(
        anchor.x + d.x * along + nx * rad,
        anchor.y + d.y * along + ny * rad,
        anchor.z + d.z * along + nz * rad,
      )
      if (onBody) {
        const proj = onBody(P)
        const here = Math.hypot(P.x, P.z)
        const wall = Math.hypot(proj.x, proj.z)
        if (here < wall) {
          P.copy(proj)                            // never sink into the wall
        } else {
          P.lerp(proj, Math.pow(Math.sin(a), 2))  // ease onto it at the far edge
        }
      }
      pos.push(P.x, P.y, P.z)
      // the surface turns from radial (at the tube) toward axial (at the body)
      const w = Math.sin(a)
      nor.push(
        nx * (1 - w) + d.x * w,
        ny * (1 - w) + d.y * w,
        nz * (1 - w) + d.z * w,
      )
    }
  }
  for (let i = 1; i <= steps; i++) {
    for (let j = 1; j <= radial; j++) {
      const a = (radial + 1) * (i - 1) + (j - 1)
      const b = (radial + 1) * i + (j - 1)
      const c = (radial + 1) * i + j
      const dd = (radial + 1) * (i - 1) + j
      idx.push(a, b, dd, b, c, dd)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setIndex(idx)
  return g
}


/**
 * Where an attachment's centreline crosses the body surface — the collar must
 * sit there, not at the curve's endpoint, which is buried inside the wall.
 * Returns {point, tangent} with the tangent pointing away from the body.
 */
export function surfaceCrossing(curve, prof, fromStart = true, samples = 60) {
  let prev = null
  for (let i = 0; i <= samples; i++) {
    const t = fromStart ? i / samples : 1 - i / samples
    const P = curve.getPointAt(t)
    const rHere = Math.hypot(P.x, P.z)
    const rBody = prof.radiusAt(P.y)
    if (prev !== null && rHere >= rBody) {
      const tan = curve.getTangentAt(t)
      return { point: P, tangent: fromStart ? tan : tan.multiplyScalar(-1), t }
    }
    prev = rHere - rBody
  }
  const t = fromStart ? 0 : 1
  const tan = curve.getTangentAt(t)
  return { point: curve.getPointAt(t), tangent: fromStart ? tan : tan.multiplyScalar(-1), t }
}
