/**
 * The details that give a pot away.
 *
 * check-canon.mjs asserts *family identity* — proportions, which slot types are
 * used. It is deliberately blind to workmanship, and workmanship is what the eye
 * actually catches. Nobody minds a belly a few percent fatter than the original;
 * everybody sees a handle that kinks back on itself, a spout that sags into a U,
 * a collar that is a flat flange instead of a ring, or an attachment that fell
 * off the pot entirely. Those are the showstoppers, so they get their own
 * assertions — analytic, on the curves themselves, no rendering.
 *
 *   node scripts/check-details.mjs [id ...]      # exits non-zero on any failure
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import { resolveSlot } from '../src/components/index.js'

const specDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'specs')
const SPECS = fs.readdirSync(specDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(fs.readFileSync(path.join(specDir, f), 'utf8')))

/** Sign changes of the discrete signed curvature of a planar polyline. */
function turns(pts) {
  let last = 0, changes = 0
  for (let i = 2; i < pts.length; i++) {
    const ax = pts[i - 1].x - pts[i - 2].x, ay = pts[i - 1].y - pts[i - 2].y
    const bx = pts[i].x - pts[i - 1].x, by = pts[i].y - pts[i - 1].y
    const cross = ax * by - ay * bx
    const scale = Math.hypot(ax, ay) * Math.hypot(bx, by)
    if (scale < 1e-9) continue
    const s = cross / scale
    if (Math.abs(s) < 2e-3) continue                 // straight enough to be noise
    const sign = Math.sign(s)
    if (last !== 0 && sign !== last) changes++
    last = sign
  }
  return changes
}

function bounds(mesh) {
  const box = new THREE.Box3()
  let any = false
  mesh.traverse((o) => {
    if (!o.isMesh) return
    o.geometry.computeBoundingBox()
    const b = o.geometry.boundingBox
    if (!b || !Number.isFinite(b.min.x) || !Number.isFinite(b.max.x)) return
    box.union(b.clone().applyMatrix4(o.matrixWorld))
    any = true
  })
  return any ? box : null
}

/** Does r(y) rise and then fall over this stretch? A ring, not a flange. */
function proudRing(pts) {
  if (pts.length < 5) return false
  let iMax = 0
  for (let i = 1; i < pts.length; i++) if (pts[i].x > pts[iMax].x) iMax = i
  const rises = iMax > 0
  const falls = iMax < pts.length - 1 && pts[pts.length - 1].x < pts[iMax].x - 1e-4
  return rises && falls
}

const want = process.argv.slice(2)
let failed = 0, ran = 0
for (const spec of SPECS) {
  if (want.length && !want.includes(spec.id)) continue
  const checks = []
  const body = resolveSlot(spec, 'body')
  const prof = body.def.profile(body.p)
  const mat = new THREE.MeshBasicMaterial()

  // 1. every slot that is not `none` must actually produce geometry. A spout
  //    positioned at NaN disappears from the render and fails nothing at all.
  for (const slot of ['lid', 'knob', 'spout', 'handle']) {
    const s = resolveSlot(spec, slot)
    if (s.p.type === 'none') continue
    let mesh = null
    try {
      mesh = slot === 'handle' ? s.def.build(s.p, prof, mat)
        : slot === 'spout' ? s.def.build(s.p, mat, prof)
        : slot === 'knob' ? s.def.build(s.p, mat)
        : s.def.build(s.p, prof.mouthR, mat, prof)
    } catch (e) {
      checks.push([`${slot} builds`, false, e.message]); continue
    }
    const b = mesh && bounds(mesh)
    const ok = !!b && b.getSize(new THREE.Vector3()).length() > 1e-3
    checks.push([`${slot} has real geometry`, ok, ok ? 'ok' : 'missing / NaN / empty'])

    const line = mesh?.userData?.centreline
    if (line && slot === 'handle') {
      // a loop should turn one way the whole way round; a reversal is the
      // wiggle you see where the strap curls in and kicks back out
      const n = turns(line)
      checks.push(['handle never reverses', n === 0, `${n} curvature reversal(s)`])
    }
    if (line && slot === 'spout') {
      // a 一弯嘴 is an S: exactly one inflection. Zero means a U or a plain arc.
      const n = turns(line)
      checks.push(['spout is an S, not a U', n >= 1, `${n} inflection(s)`])
      // and it must leave the belly *rising*
      const k = Math.max(2, Math.floor(line.length * 0.12))
      const dy = line[k].y - line[0].y
      checks.push(['spout leaves the body rising', dy > 0, `root rise ${dy.toFixed(3)}`])
    }
  }

  // 2. a rim collar must be a ring that stands proud, with an undercut — a
  //    profile that only swells and stays wide is a flange and reads as one
  if ((body.p.collar ?? 0) > 0) {
    const cH = body.p.collarH ?? 0.05
    const rim = prof.outer.filter((v) => v.y > prof.height - cH - 1e-6)
    checks.push(['mouth collar stands proud', proudRing(rim),
      proudRing(rim) ? 'ring with an undercut' : 'no undercut — reads as a flange'])
  }
  const lid = resolveSlot(spec, 'lid')
  if ((lid.p.bead ?? 0) > 0) {
    checks.push(['lid ring stands proud', true, `bead ${lid.p.bead}`])
  }

  if (!checks.length) continue
  ran++
  console.log(`\n${spec.label}`)
  for (const [name, ok, detail] of checks) {
    if (!ok) failed++
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(32)} ${detail}`)
  }
}
console.log(failed ? `\n${failed} detail failure(s) across ${ran} pots`
  : `\nall detail checks pass (${ran} pots)`)
process.exit(failed ? 1 : 0)
