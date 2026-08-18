import * as THREE from 'three'

/**
 * 把 — handles. Each returns a mesh positioned relative to the body:
 * the builder receives the body profile (radiusAt / height) so the loop
 * meets the wall wherever the wall is.
 */

export const HANDLES = {
  none: { label: '无', params: {}, build: () => null },

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
