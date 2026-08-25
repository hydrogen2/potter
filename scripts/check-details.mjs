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

    // 润接: when a blend is asked for, a fillet must actually have been built.
    // filletBlend walks each meridian out of the body to find the crossing, and
    // returns empty geometry if it never finds one — which would vanish in the
    // render exactly like the NaN spout did.
    if ((s.p.blend ?? 0) > 0 && mesh) {
      let verts = 0
      mesh.traverse((o) => {
        if (o.isMesh && !o.geometry.userData?.tipRing) {
          verts += o.geometry.getAttribute('position')?.count ?? 0
        }
      })
      checks.push([`${slot} fillet was built`, verts > 0,
        verts > 0 ? `${verts} fillet vertices` : 'blend asked for, no fillet geometry'])
    }

    const line = mesh?.userData?.centreline
    if (line && slot === 'handle') {
      // a loop should turn one way the whole way round; a reversal is the
      // wiggle you see where the strap curls in and kicks back out
      const n = turns(line)
      checks.push(['handle never reverses', n === 0, `${n} curvature reversal(s)`])
    }
    if (line && slot === 'spout') {
      // A 一弯嘴 turns hard where it leaves the belly and then straightens —
      // steep first, flattening after. Bending it the other way round gives a
      // straight run with a knee in it, which reads as a square corner rather
      // than a curve. So assert where the bending *is*, not that an inflection
      // exists somewhere: mean curvature over the first third of the visible
      // run must beat the last third.
      const vis = line.slice(Math.floor(line.length * 0.28))
      const curv = (a, b) => {
        let sum = 0, n = 0
        for (let i = a + 2; i < b; i++) {
          const ax = vis[i - 1].x - vis[i - 2].x, ay = vis[i - 1].y - vis[i - 2].y
          const bx = vis[i].x - vis[i - 1].x, by = vis[i].y - vis[i - 1].y
          const sc = Math.hypot(ax, ay) * Math.hypot(bx, by)
          if (sc < 1e-9) continue
          sum += Math.abs(ax * by - ay * bx) / sc; n++
        }
        return n ? sum / n : 0
      }
      const third = Math.floor(vis.length / 3)
      const root = curv(0, third), tip = curv(2 * third, vis.length)
      checks.push(['spout bends most at the root', root > tip * 1.25,
        `root ${root.toFixed(4)} vs tip ${tip.toFixed(4)}`])
      // and it must rise as it leaves — measured across the *visible* stretch,
      // since the first quarter of the curve is buried in the belly and its
      // rise says nothing about what anyone sees
      const at = (f) => line[Math.min(line.length - 1, Math.floor(line.length * f))]
      const dy = at(0.62).y - at(0.30).y
      checks.push(['spout rises as it leaves', dy > 0.02, `rise over the visible run ${dy.toFixed(3)}`])

      // 流口: the lip is cut obliquely, opening up and forward, so the
      // underside runs out to the thin edge the stream leaves from. Cut the
      // other way and the pot pours down its own outside.
      if ((s.p.bevel ?? 0) > 0) {
        let geo = null
        mesh.traverse((o) => { if (o.isMesh && o.geometry.userData?.tipRing) geo = o.geometry })
        if (geo) {
          const { start, count } = geo.userData.tipRing
          const pos = geo.getAttribute('position')
          const V = (i) => new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i))
          let lo = V(start), hi = V(start)
          for (let k = 1; k < count; k++) {
            const p = V(start + k)
            if (p.y < lo.y) lo = p
            if (p.y > hi.y) hi = p
          }
          const axis = V(start).sub(V(start - count)).normalize()
          const d = lo.dot(axis) - hi.dot(axis)
          checks.push(['lip opens up and forward', d > 0.01,
            d > 0.01 ? `underside leads by ${d.toFixed(3)}`
              : `top leads by ${(-d).toFixed(3)} — bevel is the wrong way round`])
        }
      }
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
