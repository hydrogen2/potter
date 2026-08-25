import * as THREE from 'three'

/**
 * Tube of varying radius along a curve — three's TubeGeometry is fixed-radius,
 * but a hand-formed strap or spout is never a constant tube.
 */
export function sweptTube(curve, radiusAt, tubular = 72, radial = 16, innerAt = null, bevel = 0, lipRoll = 0) {
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

  // A rolled lip. Cut square (or worse, cut oblique to a long point) the rim is
  // a knife edge, and on a pot whose whole character is roundness that one
  // sharp detail carries. Over the last `lipRoll` of the curve the outer
  // surface turns in and the bore turns out along a quarter circle, so the wall
  // finishes as a rounded rim — the end of a thick straw rather than a blade.
  // Stopping just short of closing leaves a sliver of annulus, which keeps the
  // tip triangles non-degenerate.
  const rollPhi = (t) => {
    if (lipRoll <= 0) return 0
    const u = Math.max(0, (t - (1 - lipRoll)) / lipRoll)
    return u * (Math.PI / 2) * 0.86
  }
  const rolled = (t, rOut, rIn) => {
    const phi = rollPhi(t)
    if (phi <= 0) return [rOut, rIn]
    const mid = (rOut + rIn) / 2, half = (rOut - rIn) / 2
    return [mid + half * Math.cos(phi), mid - half * Math.cos(phi)]
  }
  const pos = [], nor = [], idx = []
  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular
    const N = frames.normals[i]
    const B = frames.binormals[i]
    for (let j = 0; j <= radial; j++) {
      const tt = param(t, j)
      const P = curve.getPointAt(tt)
      const r = innerAt ? rolled(tt, radiusAt(tt), Math.max(innerAt(tt), 0.004))[0] : radiusAt(tt)
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
        const r = rolled(tt, radiusAt(tt), Math.max(innerAt(tt), 0.004))[1]
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
  g.userData.legacyCollar = true
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

/**
 * 润接 — a real fillet between a swept attachment and the body.
 *
 * `filletCollar` (below) was never a fillet: it built a collar of revolution
 * about the tube's own axis and then *projected* its far edge onto the body.
 * A circle about the tube axis does not lie on a curved belly, so the
 * projection had to snap some vertices and ease others, and that split showed
 * as a boxy tab at every root.
 *
 * This walks the actual intersection instead. For each meridian of the tube it
 * finds where that meridian crosses the body, then builds a cross-section that
 * leaves the tube tangentially, arrives at the body tangentially, and bridges
 * the two with a quadratic Bezier through the intersection of those tangents.
 * Sweeping that around the tube gives a surface that meets both sides smoothly
 * by construction — the clay gathered in the crevice, which is what 润接 is.
 *
 *   curve      the attachment's centreline
 *   radiusAt   its radius along that centreline
 *   prof       the body profile (radiusAt(y))
 *   blend      how far the fillet reaches, along the tube and across the body
 *   fromStart  true if the buried root is at t = 0 (both ends for a handle)
 */
export function filletBlend(curve, radiusAt, prof, blend, fromStart = true,
                            radial = 72, steps = 14) {
  const N = 256
  const frames = curve.computeFrenetFrames(N, false)
  const frameAt = (t) => {
    const i = Math.min(N, Math.max(0, Math.round(t * N)))
    return { Nv: frames.normals[i], Bv: frames.binormals[i] }
  }
  const dirAt = (t, v) => {
    const { Nv, Bv } = frameAt(t)
    const c = -Math.cos(v), s = Math.sin(v)
    return new THREE.Vector3(c * Nv.x + s * Bv.x, c * Nv.y + s * Bv.y, c * Nv.z + s * Bv.z)
  }
  const surf = (t, v) => curve.getPointAt(Math.min(1, Math.max(0, t)))
    .addScaledVector(dirAt(t, v), radiusAt(Math.min(1, Math.max(0, t))))
  const inside = (P) => Math.hypot(P.x, P.z) < prof.radiusAt(P.y)

  // body outward normal at a point, for a surface of revolution r(y)
  const bodyNormal = (P) => {
    const h = 0.008
    const slope = (prof.radiusAt(P.y + h) - prof.radiusAt(P.y - h)) / (2 * h)
    const rho = Math.hypot(P.x, P.z) || 1e-6
    const n = new THREE.Vector3(P.x / rho, -slope, P.z / rho)
    return n.normalize()
  }
  const onBody = (P) => {
    const rho = Math.hypot(P.x, P.z) || 1e-6
    const target = prof.radiusAt(P.y)
    return new THREE.Vector3((P.x * target) / rho, P.y, (P.z * target) / rho)
  }

  const L = curve.getLength() || 1
  const step = blend / L
  const rows = []
  for (let j = 0; j <= radial; j++) {
    const v = (j / radial) * Math.PI * 2
    // march out of the body along this meridian and bisect the crossing
    let lo = fromStart ? 0 : 1
    let hi = fromStart ? 1 : 0
    const dir = fromStart ? 1 : -1
    let found = false
    for (let k = 1; k <= 90; k++) {
      const t = lo + dir * (k / 90) * Math.abs(hi - lo)
      if (!inside(surf(t, v))) { hi = t; lo = t - dir * (Math.abs(hi - lo) / 90); found = true; break }
    }
    if (!found) { rows.push(null); continue }
    for (let k = 0; k < 24; k++) {
      const mid = (lo + hi) / 2
      if (inside(surf(mid, v))) lo = mid; else hi = mid
    }
    const tc = hi
    const Pc = surf(tc, v)

    // A: back along the tube, away from the body, still on the tube surface
    const tA = Math.min(1, Math.max(0, tc + dir * step))
    const A = surf(tA, v)
    // tangent at A pointing back toward the body
    const tAe = Math.min(1, Math.max(0, tA - dir * 0.004))
    const tanA = surf(tAe, v).sub(A).normalize()

    // B: across the body, away from the tube, snapped onto the surface
    const nb = bodyNormal(Pc)
    const axial = surf(Math.min(1, Math.max(0, tc + dir * 0.004)), v).sub(Pc).normalize()
    const w = axial.clone().negate()
    w.addScaledVector(nb, -w.dot(nb))
    if (w.lengthSq() < 1e-9) { rows.push(null); continue }
    w.normalize()
    const B = onBody(Pc.clone().addScaledVector(w, blend))
    const tanB = w

    // Q: where the two tangent lines meet. Closest approach if they are skew.
    const r0 = A, d0 = tanA, r1 = B, d1 = tanB.clone().negate()
    const rr = r1.clone().sub(r0)
    const a = d0.dot(d0), b = d0.dot(d1), c2 = d1.dot(d1)
    const d = d0.dot(rr), e = d1.dot(rr)
    const den = a * c2 - b * b
    let Q
    if (Math.abs(den) < 1e-8) {
      Q = A.clone().add(B).multiplyScalar(0.5)
    } else {
      const s0 = (b * e - c2 * d) / -den
      const s1 = (a * e - b * d) / -den
      Q = A.clone().addScaledVector(d0, s0).add(B.clone().addScaledVector(d1, s1)).multiplyScalar(0.5)
    }
    const row = []
    for (let k = 0; k <= steps; k++) {
      const u = k / steps
      const p = A.clone().multiplyScalar((1 - u) * (1 - u))
        .addScaledVector(Q, 2 * (1 - u) * u)
        .addScaledVector(B, u * u)
      row.push(p)
    }
    rows.push(row)
  }

  const pos = [], idx = []
  const valid = rows.map((r) => r !== null)
  const fallback = rows.find((r) => r !== null)
  if (!fallback) return new THREE.BufferGeometry()
  for (let j = 0; j <= radial; j++) {
    const row = rows[j] ?? fallback
    for (const p of row) pos.push(p.x, p.y, p.z)
  }
  const W = steps + 1
  for (let j = 1; j <= radial; j++) {
    if (!valid[j] || !valid[j - 1]) continue
    for (let k = 1; k <= steps; k++) {
      const a2 = W * (j - 1) + (k - 1), b2 = W * j + (k - 1)
      const c3 = W * j + k, d3 = W * (j - 1) + k
      idx.push(a2, b2, d3, b2, c3, d3)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  g.userData.fillet = true          // so the checks can tell a fillet from the part it blends
  return g
}

/**
 * A fillet where both sides share the pot's axis — a knob sitting on a lid.
 *
 * filletBlend has to hunt for the intersection because a spout meets a belly
 * obliquely. A knob centred on a domed lid does not: the whole junction is a
 * surface of revolution, so the fillet is one tangent arc in the (r, y) plane
 * swept round. That is exact rather than approximated, and much cheaper.
 *
 *   shapeAt(s)   the knob's outline, s from 0 at its lowest point upward → (r, y)
 *   surfaceY(r)  the supporting surface's height at radius r, same origin
 *   blend        how far the fillet reaches up the knob and out across the lid
 */
export function axisFillet(shapeAt, surfaceY, blend, radial = 72, steps = 14) {
  const inside = (p) => p.y < surfaceY(p.x)
  let lo = 0, hi = 1, found = false
  for (let k = 1; k <= 200; k++) {
    const s = k / 200
    if (!inside(shapeAt(s))) { hi = s; lo = (k - 1) / 200; found = true; break }
  }
  if (!found) return new THREE.BufferGeometry()
  for (let k = 0; k < 30; k++) {
    const mid = (lo + hi) / 2
    if (inside(shapeAt(mid))) lo = mid; else hi = mid
  }
  const Pc = shapeAt(hi)

  // A: up the knob by `blend` of arc, and the direction back down toward the lid
  let sA = hi, walked = 0
  let prev = Pc.clone()
  for (let k = 1; k <= 400 && walked < blend; k++) {
    const s = Math.min(1, hi + (k / 400) * (1 - hi))
    const p = shapeAt(s)
    walked += p.distanceTo(prev)
    prev = p; sA = s
    if (s >= 1) break
  }
  const A = shapeAt(sA)
  const tanA = shapeAt(Math.max(hi, sA - 0.004)).sub(A).normalize()

  // B: out across the lid by `blend`, and the direction continuing outward
  const B = new THREE.Vector2(Pc.x + blend, surfaceY(Pc.x + blend))
  const tanB = new THREE.Vector2(
    blend, surfaceY(Pc.x + blend) - surfaceY(Pc.x),
  ).normalize()

  // Q: where the two tangents meet, in 2D
  const det = tanA.x * -tanB.y - tanA.y * -tanB.x
  let Q
  if (Math.abs(det) < 1e-9) {
    Q = A.clone().add(B).multiplyScalar(0.5)
  } else {
    const rx = B.x - A.x, ry = B.y - A.y
    const u = (rx * -tanB.y - ry * -tanB.x) / det
    Q = A.clone().addScaledVector(tanA, u)
  }

  const section = []
  for (let k = 0; k <= steps; k++) {
    const u = k / steps
    section.push(new THREE.Vector2(
      (1 - u) * (1 - u) * A.x + 2 * (1 - u) * u * Q.x + u * u * B.x,
      (1 - u) * (1 - u) * A.y + 2 * (1 - u) * u * Q.y + u * u * B.y,
    ))
  }

  const pos = [], idx = []
  for (let j = 0; j <= radial; j++) {
    const a = (j / radial) * Math.PI * 2
    const c = Math.cos(a), s2 = Math.sin(a)
    for (const p of section) pos.push(p.x * c, p.y, p.x * s2)
  }
  const W = steps + 1
  for (let j = 1; j <= radial; j++) {
    for (let k = 1; k <= steps; k++) {
      const a2 = W * (j - 1) + (k - 1), b2 = W * j + (k - 1)
      const c3 = W * j + k, d3 = W * (j - 1) + k
      idx.push(a2, d3, b2, b2, d3, c3)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  g.userData.fillet = true          // so the checks can tell a fillet from the part it blends
  return g
}
