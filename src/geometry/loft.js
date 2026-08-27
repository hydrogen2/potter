import * as THREE from 'three'

/**
 * Generalized loft: sweep a profile curve along the Y axis with a
 * per-angle cross-section function.
 *
 * This is the one geometry primitive the whole studio is built on:
 *   圆器   — crossSection = circle (the default)
 *   方器   — crossSection = rounded n-gon
 *   筋纹器 — crossSection = lobed circle (cosine ripple)
 * (花器 are sculptural and enter the catalogue as imported meshes.)
 *
 * @param {Object}   opts
 * @param {THREE.Vector2[]} opts.profile  sampled (radius, y) points, bottom → top
 * @param {(theta:number, t:number, y:number)=>number} [opts.crossSection]
 *        radius multiplier at angle theta; t ∈ [0,1] is normalized position
 *        along the profile (lets lobes fade toward the foot/rim) and y is that
 *        point's height, which is what a relief placed *on the pot* needs — a
 *        shell's profile runs up the outside and back down the inside, so the
 *        same height occurs twice and t cannot tell you where you are.
 * @param {number}  [opts.radialSegments]
 * @param {boolean} [opts.capBottom]  close the base with a fan
 */
export function loftGeometry({
  profile,
  crossSection = () => 1,
  radialSegments = 160,
  capBottom = true,
}) {
  const rows = profile.length
  const cols = radialSegments + 1 // duplicate seam column for clean UVs

  const positions = []
  const uvs = []
  const indices = []

  // cumulative arc length along the profile → v coordinate
  const arc = [0]
  for (let i = 1; i < rows; i++) {
    arc.push(arc[i - 1] + profile[i].distanceTo(profile[i - 1]))
  }
  const totalArc = arc[rows - 1] || 1

  for (let i = 0; i < rows; i++) {
    const { x: r, y } = profile[i]
    const t = i / (rows - 1)
    for (let j = 0; j < cols; j++) {
      const theta = (j / radialSegments) * Math.PI * 2
      const m = crossSection(theta, t, y)
      positions.push(r * m * Math.cos(theta), y, r * m * Math.sin(theta))
      uvs.push(j / radialSegments, arc[i] / totalArc)
    }
  }

  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * cols + j
      const b = a + 1
      const c = a + cols
      const d = c + 1
      indices.push(a, c, b, b, c, d)
    }
  }

  // bottom cap: fan from a center vertex to the first profile row
  if (capBottom) {
    const centerIdx = positions.length / 3
    positions.push(0, profile[0].y, 0)
    uvs.push(0.5, 0)
    for (let j = 0; j < radialSegments; j++) {
      indices.push(centerIdx, j, j + 1)
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  weldSeamNormals(geo, rows, cols)
  return geo
}

/** average the duplicated seam column's normals so no lighting seam shows */
function weldSeamNormals(geo, rows, cols) {
  const n = geo.getAttribute('normal')
  for (let i = 0; i < rows; i++) {
    const a = i * cols
    const b = i * cols + (cols - 1)
    const nx = (n.getX(a) + n.getX(b)) / 2
    const ny = (n.getY(a) + n.getY(b)) / 2
    const nz = (n.getZ(a) + n.getZ(b)) / 2
    const len = Math.hypot(nx, ny, nz) || 1
    n.setXYZ(a, nx / len, ny / len, nz / len)
    n.setXYZ(b, nx / len, ny / len, nz / len)
  }
  n.needsUpdate = true
}

/** sample a smooth curve through (radius, y) control points */
export function sampleProfile(controlPoints, samples = 96) {
  const curve = new THREE.SplineCurve(
    controlPoints.map((p) => new THREE.Vector2(p[0], p[1])),
  )
  return curve.getSpacedPoints(samples)
}

// ---- cross-section library (for coming 器型) -------------------------------

/** rounded n-gon, for 方器. sharpness ∈ (0,1): 1 = crisp corners */
export function roundedPolygon(n, sharpness = 0.8) {
  // superellipse-style exponent mapped from sharpness
  const e = 2 + sharpness * 8
  return (theta) => {
    const a = Math.PI / n
    const phi = ((theta % (2 * a)) + 2 * a) % (2 * a) - a
    return Math.pow(Math.cos(a), 1 - 2 / e) / Math.pow(Math.cos(phi), 2 / e)
  }
}

/** lobed circle, for 筋纹器. depth fades with envelope(t) if given */
export function lobed(n, depth = 0.04, envelope = () => 1) {
  return (theta, t) => 1 + depth * envelope(t) * Math.cos(n * theta)
}

// ---- walled shell ------------------------------------------------------------

/**
 * Wall-thickness rule of the DSL: no surface without a back face.
 *
 * shellGeometry takes the OUTER profile of a vessel and a wall thickness and
 * emits one closed solid: outer surface, rim bridge, inner surface (offset
 * along the profile normal), interior floor. `wall` may be a number or
 * {base, belly, top} — real pots are thicker at the foot than the lip.
 *
 * @param {THREE.Vector2[]} outer   bottom→top (radius, y), starting on the
 *                                  base plane and ending at the rim
 * @param {number|{base:number,belly:number,top:number}} wall
 * @param {object} [opts]  crossSection / radialSegments as loftGeometry
 * @param {number} [opts.floor]  interior floor thickness (default = base wall)
 */
export function shellGeometry(outer, wall, opts = {}) {
  const n = outer.length
  const wallAt = (t) => {
    if (typeof wall === 'number') return wall
    const { base = 0.04, belly = base, top = belly } = wall
    return t < 0.5
      ? THREE.MathUtils.lerp(base, belly, t / 0.5)
      : THREE.MathUtils.lerp(belly, top, (t - 0.5) / 0.5)
  }
  const floor = opts.floor ?? wallAt(0)

  // inner surface: offset each outer point inward along the local normal
  const inner = []
  for (let i = 0; i < n; i++) {
    const prev = outer[Math.max(0, i - 1)]
    const next = outer[Math.min(n - 1, i + 1)]
    const tx = next.x - prev.x
    const ty = next.y - prev.y
    const len = Math.hypot(tx, ty) || 1
    // normal pointing inward (toward the axis)
    const nx = -ty / len
    const ny = tx / len
    const w = wallAt(i / (n - 1))
    const px = outer[i].x + nx * w
    const py = outer[i].y + ny * w
    inner.push(new THREE.Vector2(Math.max(px, 0.02), py))
  }

  // walk: outer bottom→top, then inner top→floor, then close at the axis
  const profile = [...outer]
  const floorY = outer[0].y + floor
  for (let i = n - 1; i >= 0; i--) {
    if (inner[i].y > floorY + 0.01) profile.push(inner[i])
  }
  profile.push(new THREE.Vector2(0.03, floorY))

  return loftGeometry({
    profile,
    crossSection: opts.crossSection,
    radialSegments: opts.radialSegments,
    capBottom: true,
  })
}

/**
 * 方器 — a regular n-gon cross-section with rounded corners.
 *
 * A convex polygon is the intersection of half-planes, so its radius at angle
 * theta is min over the facet normals of 1/cos(theta - phi_i). Replacing that
 * min with a p-norm rounds the corners by a controllable amount and stays
 * smooth everywhere, which matters because the corner is where every seam,
 * fillet and normal is going to be computed:
 *
 *   r(theta) = [ sum_i max(0, cos(theta - phi_i))^crisp ]^(-1/crisp)
 *
 * At a facet's centre this is exactly 1 — so the profile radius is the
 * *apothem*, the distance to a face, not to a corner. Corners stand at
 * 1/cos(pi/n) further out: 1.155 for a hexagon.
 */
export function ngonSection(facets, crisp) {
  const phi = []
  for (let i = 0; i < facets; i++) phi.push((i * 2 * Math.PI) / facets)
  return (theta) => {
    let sum = 0
    for (const f of phi) {
      const c = Math.cos(theta - f)
      if (c > 0) sum += Math.pow(c, crisp)
    }
    return sum > 0 ? Math.pow(sum, -1 / crisp) : 1
  }
}

/**
 * A rounded rectangle, as a radius function — the section of a flat clay strap,
 * and also the outline of a squared handle loop.
 *
 * Same construction as ngonSection: a convex shape is the intersection of its
 * half-planes, so its radius is min over faces of d_i/cos(theta - phi_i), and a
 * p-norm in place of the min rounds the corners smoothly. Here the four faces
 * carry different offsets, which is what makes it a rectangle rather than a
 * square: 1 across, `wide` along.
 */
export function rectSection(wide, crisp) {
  const faces = [
    [0, 1], [Math.PI, 1],
    [Math.PI / 2, wide], [-Math.PI / 2, wide],
  ]
  return (theta) => {
    let sum = 0
    for (const [phi, d] of faces) {
      const c = Math.cos(theta - phi) / d
      if (c > 0) sum += Math.pow(c, crisp)
    }
    return sum > 0 ? Math.pow(sum, -1 / crisp) : 1
  }
}

/**
 * 筋纹器 — a lobed cross-section: n equal ribs round the pot.
 *
 * Unlike 方器's facets this is a *surface treatment* on a round body rather
 * than a different profile family, which is what 菊瓣 and 合菱 actually are.
 *
 *   r(theta) = 1 + depth * (2 |cos(n theta / 2)|^sharp - 1)
 *
 * Ridge at theta = 0 and every 2pi/n after it, groove halfway between. `sharp`
 * shapes the section between them: above 1 narrows the ridges toward petals,
 * below 1 broadens them and cuts the grooves finer.
 *
 * The n-fold symmetry is exact, which is the whole point — 通转 means the lid
 * can be lifted, turned to any rib and set down still matching, and that is
 * only true if every division is identical.
 */
export function lobeSection(n, depth, sharp = 1) {
  return (theta) => {
    const c = Math.abs(Math.cos((n * theta) / 2))
    return 1 + depth * (2 * Math.pow(c, sharp) - 1)
  }
}
