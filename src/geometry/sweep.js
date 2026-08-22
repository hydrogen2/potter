import * as THREE from 'three'

/**
 * Tube of varying radius along a curve — three's TubeGeometry is fixed-radius,
 * but a hand-formed strap or spout is never a constant tube.
 */
export function sweptTube(curve, radiusAt, tubular = 72, radial = 16) {
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
