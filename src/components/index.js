import * as THREE from 'three'
import { BODIES, bodyMesh } from './bodies.js'
import { LIDS } from './lids.js'
import { KNOBS } from './knobs.js'
import { SPOUTS } from './spouts.js'
import { HANDLES } from './handles.js'
import { BASES } from './bases.js'

/**
 * The potter's DSL: a vessel is a composition of anatomical components.
 *
 *   spec = {
 *     id, label, category, categoryLabel, material, scaleCm,
 *     wall: number | {base, belly, top},
 *     body:   { type, ...params },
 *     lid:    { type, ...params },
 *     knob:   { type, ...params },
 *     spout:  { type, ...params },
 *     handle: { type, ...params },
 *     base:   { type, ...params },
 *     expose: ['body.height', 'lid.rise', ...]   // which params get sliders
 *   }
 *
 * Every component's params are documented in its registry; anything not
 * given in the spec falls back to the component's default.
 */

export const REGISTRY = {
  body: BODIES,
  lid: LIDS,
  knob: KNOBS,
  spout: SPOUTS,
  handle: HANDLES,
  base: BASES,
}
export const SLOTS = ['body', 'lid', 'knob', 'spout', 'handle', 'base']
export const SLOT_LABELS = {
  body: '身', lid: '盖', knob: '钮', spout: '流', handle: '把', base: '足',
}

const CLAY_DENSITY = 2.3 // g/cm³ fired stoneware

/** resolve a slot's params: spec values over component defaults */
export function resolveSlot(spec, slot) {
  const given = spec[slot] || { type: 'none' }
  const type = given.type ?? Object.keys(REGISTRY[slot])[0]
  const def = REGISTRY[slot][type]
  if (!def) throw new Error(`unknown ${slot} type: ${type}`)
  const p = { type }
  for (const [k, d] of Object.entries(def.params)) p[k] = given[k] ?? d.default
  return { def, p }
}

/** deep-copy a spec so UI edits never touch the archive entry */
export function cloneSpec(spec) {
  return JSON.parse(JSON.stringify(spec))
}

export function buildVessel(spec, material) {
  const body = resolveSlot(spec, 'body')
  const lid = resolveSlot(spec, 'lid')
  const knob = resolveSlot(spec, 'knob')
  const spout = resolveSlot(spec, 'spout')
  const handle = resolveSlot(spec, 'handle')
  const base = resolveSlot(spec, 'base')

  const prof = body.def.profile(body.p)
  const wall = spec.wall ?? 0.04

  const vessel = new THREE.Group()
  const raised = new THREE.Group()

  raised.add(bodyMesh(prof, wall, material, {
    crossSection: prof.crossSection,
    // a 棱线 only reads as an edge if there are enough segments across it
    radialSegments: prof.facets ? 288 : undefined,
  }))

  const lidMesh = lid.def.build(lid.p, prof.mouthR, material, prof)
  if (lidMesh) {
    // a lid seats with a hair of clearance; that gap *is* the seam line. With
    // the surfaces coincident the seam z-fights and draws as a dotted line —
    // conspicuous on a 截盖, where the seam is the feature you look at.
    const seam = lid.p.seam ?? 0.005
    lidMesh.position.y = prof.height + seam
    raised.add(lidMesh)
    // the lid's own surface, so a knob can fillet onto a dome rather than
    // assume it is standing on something flat
    const drop = lid.def.drop ? lid.def.drop(lid.p, prof) : () => 0
    const knobMesh = knob.def.build(knob.p, material, drop)
    if (knobMesh) {
      knobMesh.position.y += prof.height + seam + lid.def.top(lid.p, prof) - 0.006
      raised.add(knobMesh)
    }
  }

  const spoutMesh = spout.def.build(spout.p, material, prof)
  // Swept spouts come back already in body coordinates; cone spouts are built
  // at the origin and placed here. The component says which it is — keying this
  // off the type name meant a new swept type fell into the placement branch,
  // read an `angle` it does not have, and was positioned at NaN. It vanished
  // from the render without any error.
  if (spoutMesh && spout.def.bodySpace) {
    raised.add(spoutMesh)
  } else if (spoutMesh) {
    const angle = THREE.MathUtils.degToRad(spout.p.angle)
    const yAttach = prof.height * spout.p.attachY
    const embed = 0.06
    spoutMesh.rotation.z = -(Math.PI / 2 - angle)
    spoutMesh.position.set(
      prof.radiusAt(yAttach) - 0.02 - embed * Math.cos(angle),
      yAttach - embed * Math.sin(angle),
      0,
    )
    raised.add(spoutMesh)
  }

  const handleMesh = handle.def.build(handle.p, prof, material)
  if (handleMesh) raised.add(handleMesh)

  const { mesh: baseMesh, lift } = base.def.build(base.p, prof, material)
  raised.position.y = lift
  vessel.add(raised)
  if (baseMesh) vessel.add(baseMesh)

  vessel.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true
      o.receiveShadow = true
    }
  })
  return vessel
}

/** 用 — function readout computed from the same profile as the geometry */
export function vesselMetrics(spec) {
  const body = resolveSlot(spec, 'body')
  const prof = body.def.profile(body.p)
  const S = spec.scaleCm ?? 7
  const wall = spec.wall ?? 0.04
  const wallAt = (t) =>
    typeof wall === 'number'
      ? wall
      : t < 0.5
        ? THREE.MathUtils.lerp(wall.base, wall.belly ?? wall.base, t / 0.5)
        : THREE.MathUtils.lerp(wall.belly ?? wall.base, wall.top ?? wall.belly ?? wall.base, (t - 0.5) / 0.5)

  const n = 80
  let vol = 0
  let shell = 0
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n
    const y = t * prof.height
    const rOut = prof.radiusAt(y)
    const rIn = Math.max(0, rOut - wallAt(t))
    vol += Math.PI * rIn * rIn * (prof.height / n)
    shell += Math.PI * (rOut * rOut - rIn * rIn) * (prof.height / n)
  }
  const ml = vol * S ** 3
  // attachments add roughly a third again on a teapot, little on a bowl
  const attachFactor = spec.spout?.type && spec.spout.type !== 'none' ? 1.45 : 1.15
  const grams = shell * S ** 3 * CLAY_DENSITY * attachFactor
  const lid = resolveSlot(spec, 'lid')
  const lidTop = lid.def.top ? lid.def.top(lid.p, prof) : 0
  const base = resolveSlot(spec, 'base')
  const lift = base.def.build(base.p, prof, null).lift
  const knob = resolveSlot(spec, 'knob')
  const knobH = knob.p.rise ?? (knob.p.radius ? knob.p.radius * 1.5 : 0)

  let maxR = 0
  for (const v of prof.outer) maxR = Math.max(maxR, v.x)

  return [
    { label: '容量', value: `≈ ${Math.round(ml / 10) * 10} ml` },
    { label: '重量', value: `≈ ${Math.round(grams / 10) * 10} g` },
    { label: '口径', value: `${(prof.mouthR * 2 * S).toFixed(1)} cm` },
    { label: '身宽', value: `${(maxR * 2 * S).toFixed(1)} cm` },
    { label: '通高', value: `${((prof.height + lidTop + knobH + lift) * S).toFixed(1)} cm` },
  ]
}
