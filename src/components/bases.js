import * as THREE from 'three'

/**
 * 足 — bases. Return { mesh, lift } — lift is how far the body sits above
 * the ground plane on this base.
 */

export const BASES = {
  flat: { label: '平底', params: {}, build: () => ({ mesh: null, lift: 0 }) },

  studs: {
    label: '围棋足',
    params: {
      count: { label: '足数', min: 3, max: 4, step: 1, default: 3 },
      radius: { label: '足径', min: 0.04, max: 0.14, step: 0.002, default: 0.085 },
      spread: { label: '足距', min: 0.4, max: 0.85, step: 0.01, default: 0.62 },
    },
    build(p, prof, material) {
      // feet sit on the underside (which may be a shallow dome); the pot is
      // lifted so the foot bottoms rest on the ground with the dome clear
      const group = new THREE.Group()
      const rMax = Math.max(...prof.outer.map((v) => v.x))
      const r = rMax * p.spread
      const under = prof.bottomAt ? prof.bottomAt(r) : 0
      const ry = p.radius * 0.62 // squashed sphere: bottom on the ground at y=0
      const lift = Math.max(0.01, 1.3 * ry - under) // underside meets the foot's upper half
      for (let i = 0; i < p.count; i++) {
        const a = THREE.MathUtils.degToRad(90 + (i * 360) / p.count)
        const foot = new THREE.Mesh(new THREE.SphereGeometry(p.radius, 20, 14), material)
        foot.scale.y = 0.62
        foot.position.set(r * Math.cos(a), ry, r * Math.sin(a))
        group.add(foot)
      }
      return { mesh: group, lift }
    },
  },

  ring: {
    label: '圈足',
    params: {
      height: { label: '足高', min: 0.02, max: 0.15, step: 0.002, default: 0.06 },
      inset: { label: '足缩', min: 0, max: 0.2, step: 0.005, default: 0.04 },
      wall: { label: '足厚', min: 0.02, max: 0.08, step: 0.002, default: 0.04 },
    },
    build(p, prof, material) {
      const R = prof.radiusAt(0.02) - p.inset
      const geo = new THREE.CylinderGeometry(R, R, p.height, 96, 1, true)
      const inner = new THREE.CylinderGeometry(R - p.wall, R - p.wall, p.height, 96, 1, true)
      const g = new THREE.Group()
      const outerM = new THREE.Mesh(geo, material)
      const innerM = new THREE.Mesh(inner, material)
      innerM.material = material
      // ring bottom face
      const ringGeo = new THREE.RingGeometry(R - p.wall, R, 96)
      ringGeo.rotateX(Math.PI / 2)
      const bottom = new THREE.Mesh(ringGeo, material)
      bottom.position.y = -p.height / 2
      g.add(outerM, innerM, bottom)
      g.position.y = p.height / 2
      return { mesh: g, lift: p.height }
    },
  },
}
