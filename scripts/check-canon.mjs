// Canonical-form check, in the DSL's own terms — no rendering, no pixels.
//
// A shape family is recognised by features, not by resemblance: a face may
// have larger or smaller eyes, but it has exactly two and they are level.
// 石瓢 is "a cone with the tip cut off": widest at the foot, a straight flank,
// a flat lid, a bridge knob, three feet. Those are assertions we can make on
// the profile curve the DSL already computes.
//
// usage: node scripts/check-canon.mjs [specId ...]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import { resolveSlot } from '../src/components/index.js'

// read the archive as data (Vite resolves JSON imports; plain node needs this)
const specDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'specs')
const SPECS = fs.readdirSync(specDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(fs.readFileSync(path.join(specDir, f), 'utf8')))

const CANON = {
  shipiao: {
    label: '石瓢',
    body: (prof, p) => {
      const H = prof.height
      const pts = prof.outer
      const maxR = Math.max(...pts.map((v) => v.x))
      const footY = pts[Math.floor(pts.length * 0.12)].y
      const widest = pts.reduce((a, b) => (b.x > a.x ? b : a))
      // the flank: from just above the foot fillet to just below the rim
      const flank = pts.filter((v) => v.y > H * 0.18 && v.y < H * 0.86)
      const a = flank[0]
      const b = flank[flank.length - 1]
      let sag = 0
      for (const v of flank) {
        const t = (v.y - a.y) / (b.y - a.y || 1)
        sag = Math.max(sag, Math.abs(v.x - (a.x + (b.x - a.x) * t)))
      }
      // monotone: radius must not grow as we rise
      let grows = 0
      for (let i = 1; i < flank.length; i++) {
        if (flank[i].x > flank[i - 1].x + 1e-4) grows++
      }
      return [
        ['widest at the foot', widest.y <= H * 0.25,
         `widest at ${(widest.y / H * 100).toFixed(0)}% of height`],
        ['flank never widens upward', grows === 0,
         `${grows} of ${flank.length} samples widen`],
        ['flank straight within 3%', sag / maxR <= 0.03,
         `max bow ${(sag / maxR * 100).toFixed(2)}%`],
        // provisional bound: measured 0.80 on 相明石瓢; tighten once more pots
        // are fitted rather than guessing a range
        ['mouth 45-85% of foot', p.mouthR / p.baseR >= 0.45 && p.mouthR / p.baseR <= 0.85,
         `mouth/foot ${(p.mouthR / p.baseR).toFixed(3)}`],
      ]
    },
    slots: {
      lid: (t) => [t === 'flatDisc', 'lid is a flat disc'],
      knob: (t) => [t.startsWith('bridge'), 'knob is a bridge'],
      spout: (t) => [t === 'straightCone', 'spout is straight (直流)'],
      handle: (t) => [t === 'rearLoop', 'handle is a rear loop'],
      base: (t) => [t === 'studs', 'stands on studs (围棋足)'],
    },
  },
}

CANON.xishi = {
  label: '西施',
  // You cannot describe 西施 as a solid of revolution of anything simple — it is
  // not a sphere, and an ellipse is nearly right but reads as cheap. What makes
  // it 西施 is a set of relations, and those are checkable:
  //   fuller than an ellipse, widest near mid-height, wider than it is tall,
  //   a wide mouth closed by a 截盖 lid cut from the body's own curve, so the
  //   silhouette never breaks, and a bead knob on a footless flat base.
  body: (prof, p) => {
    const pts = prof.outer.filter((v) => v.y > 0.02 && v.y < prof.height - 0.02)
    const maxR = Math.max(...pts.map((v) => v.x))
    const widest = pts.reduce((a, b) => (b.x > a.x ? b : a))
    // convexity: r(y) must never have a straight run or a hollow
    let straightRun = 0, worstRun = 0
    for (let i = 2; i < pts.length; i++) {
      const d2 = (pts[i].x - pts[i - 1].x) - (pts[i - 1].x - pts[i - 2].x)
      if (Math.abs(d2) < 1e-4) worstRun = Math.max(worstRun, ++straightRun)
      else straightRun = 0
    }
    return [
      ['widest near mid-height', widest.y / prof.height >= 0.28 && widest.y / prof.height <= 0.58,
       `widest at ${(widest.y / prof.height * 100).toFixed(0)}% of height`],
      ['wider than tall', (2 * maxR) / prof.height >= 1.15 && (2 * maxR) / prof.height <= 1.75,
       `width/height ${((2 * maxR) / prof.height).toFixed(2)}`],
      ['no straight run in the flank', worstRun < 6, `longest flat run ${worstRun} samples`],
      ['wide mouth (55-80% of body)', p.mouthR / maxR >= 0.55 && p.mouthR / maxR <= 0.80,
       `mouth/body ${(p.mouthR / maxR).toFixed(3)}`],
      // a Lamé exponent below 2 pinches the curve to a point: the silhouette can
      // still match a photograph closely while the pot reads as a teardrop
      ['stands on a real flat base (一捺底)', (p.footR ?? 0) / maxR >= 0.35,
       `foot/body ${((p.footR ?? 0) / maxR).toFixed(3)}`],
      ['neither half pinched (fullness >= 2)', (p.lowerFull ?? 2) >= 2 && (p.upperFull ?? 2) >= 2,
       `lower ${(p.lowerFull ?? 0).toFixed(2)}, upper ${(p.upperFull ?? 0).toFixed(2)}`],
    ]
  },
  slots: {
    lid: (t) => [t === 'flush', 'lid is 截盖 (cut from the body curve)'],
    knob: (t) => [t === 'bead', 'knob is a bead (珠钮)'],
    spout: (t) => [t === 'straightCone', 'spout is short and straight'],
    handle: (t) => [t === 'invertedEar', 'handle is an inverted ear (倒耳把)'],
    base: (t) => [t === 'flat', 'flat base, no feet'],
  },
}

CANON.panhu = {
  label: '潘壶',
  // 潘仕成's form: 口小肚大, 弯嘴, 环把, 圆珠钮, 平底带底圈. The signature is an
  // inflection the earlier families cannot make — the wall is convex round the
  // belly and *concave* as it draws in to the neck.
  body: (prof, p) => {
    const pts = prof.outer.filter((v) => v.y > 0.02 && v.y < prof.height - 0.02)
    const widest = pts.reduce((a, b) => (b.x > a.x ? b : a))
    const maxR = widest.x
    const curv = (seg) => {
      let sum = 0
      for (let i = 2; i < seg.length; i++) {
        sum += (seg[i].x - seg[i - 1].x) - (seg[i - 1].x - seg[i - 2].x)
      }
      return sum
    }
    const below = pts.filter((v) => v.y < widest.y)
    const above = pts.filter((v) => v.y > widest.y)
    const cb = curv(below)
    const ca = curv(above)
    return [
      ['small mouth, big belly (口小肚大)', prof.mouthR / maxR <= 0.78,
       `mouth/belly ${(prof.mouthR / maxR).toFixed(3)}`],
      ['belly in the middle third', widest.y / prof.height >= 0.30 && widest.y / prof.height <= 0.62,
       `belly at ${(widest.y / prof.height * 100).toFixed(0)}% of height`],
      ['profile has an inflection', cb < 0 && ca < 0 === false ? true : Math.sign(cb) !== Math.sign(ca),
       `curvature below ${cb.toFixed(3)}, above ${ca.toFixed(3)}`],
      ['foot narrower than belly', (p.footR ?? 0) / maxR <= 0.8,
       `foot/belly ${((p.footR ?? 0) / maxR).toFixed(3)}`],
    ]
  },
  slots: {
    lid: (t) => [t === 'dome' || t === 'flatDisc', 'lid is a domed 压盖'],
    knob: (t) => [t === 'bead', 'knob is a round bead (圆珠钮)'],
    spout: (t) => [t === 'curved', 'spout is curved (弯嘴)'],
    handle: (t) => [t === 'invertedEar' || t === 'rearLoop', 'ring handle (环把)'],
    base: (t) => [t === 'ring', 'flat base with a foot ring (底圈)'],
  },
}

// A universal rule, family-independent: nothing may occupy the lid's own space.
// A handle whose loop rises into the brim reads as a collision from every angle
// but is easy to miss in a single render, so it is asserted rather than eyeballed:
// sample the attachment's vertices against a cylinder bounding the lid.
function clearsLid(spec, prof) {
  const lid = resolveSlot(spec, 'lid')
  const att = resolveSlot(spec, 'handle')
  if (lid.p.type === 'none' || att.p.type === 'none') return null
  const bottom = prof.height + (lid.p.seam ?? 0.005)
  const top = bottom + lid.def.top(lid.p, prof)
  const lidR = prof.mouthR + (lid.p.overhang ?? 0)
  // the handle is the one attachment built in body coordinates — the spout and
  // knob are positioned afterwards by buildVessel, so their raw vertices say nothing
  const mesh = att.def.build(att.p, prof, new THREE.MeshBasicMaterial())
  if (!mesh) return null
  let worst = 0
  mesh.traverse((o) => {
    if (!o.isMesh) return
    const a = o.geometry.getAttribute('position')
    for (let i = 0; i < a.count; i++) {
      const y = a.getY(i)
      if (y <= bottom || y >= top) continue
      worst = Math.max(worst, lidR - Math.hypot(a.getX(i), a.getZ(i)))
    }
  })
  return ['handle clears the lid', worst < 1e-4,
    worst < 1e-4 ? 'clear' : `intrudes ${(worst * 100).toFixed(1)}%`]
}

CANON.duoqiu = {
  label: '掇球',
  // 掇 means to stack. The name is the geometry: body, lid and knob are three
  // spheres piled on one axis, each smaller than the one under it. So the
  // checkable identity is a set of *proportions between the three balls*,
  // not the shape of any one of them.
  //
  // The numbers come from measuring two near-level photographs of 寿珍掇球
  // (zisha.com), not from the literature — the literature says the lid is
  // 明显的半球状, "a clear hemisphere", and both photographs put it at a third
  // of its rim diameter. Ranges are set wide enough to admit both, and the
  // measured values are recorded in the spec's notes so a later correction has
  // something to argue with.
  body: (prof, p, spec) => {
    const pts = prof.outer.filter((v) => v.y > 0.02 && v.y < prof.height - 0.02)
    const maxR = Math.max(...pts.map((v) => v.x))
    const widest = pts.reduce((a, b) => (b.x > a.x ? b : a))
    // The flank test must stop below the rim assembly: the neck is deliberately
    // upright and the collar deliberately steps, so running this over them fails
    // the pot for having exactly the features it is supposed to have.
    const rimTop = prof.height - ((p.neck ?? 0) + (p.collar > 0 ? p.collarH ?? 0.05 : 0))
    const flank = pts.filter((v) => v.y < rimTop - 0.01)
    let straightRun = 0, worstRun = 0
    for (let i = 2; i < flank.length; i++) {
      const d2 = (flank[i].x - flank[i - 1].x) - (flank[i - 1].x - flank[i - 2].x)
      if (Math.abs(d2) < 1e-4) worstRun = Math.max(worstRun, ++straightRun)
      else straightRun = 0
    }
    const lid = resolveSlot(spec, 'lid')
    const base = resolveSlot(spec, 'base')
    const rimR = prof.mouthR + (lid.p.overhang ?? 0)          // ball 2, at its equator
    const capRise = lid.def.top(lid.p, prof)
    const foot = base.p.type === 'ring' ? (base.p.height ?? 0) : 0
    const lidTop = foot + prof.height + (lid.p.seam ?? 0.005) + capRise
    const knobR = resolveSlot(spec, 'knob').p.radius ?? 0     // ball 3

    return [
      // the signature relation: 壶盖到壶底的距离近似壶身最大直径 — the pot fits a circle
      ['fits a circle (盖顶至底 ≈ 身径)', lidTop / (2 * maxR) >= 0.95 && lidTop / (2 * maxR) <= 1.15,
       `height/width ${(lidTop / (2 * maxR)).toFixed(2)}  (measured 1.03, 1.05)`],
      // 古法 E/E2 = 0.618; measured 0.63 and 0.66
      ['mouth is the golden part of the body', rimR / maxR >= 0.58 && rimR / maxR <= 0.70,
       `rim/body ${(rimR / maxR).toFixed(3)}  (0.618 by rule; measured 0.63, 0.66)`],
      ['three balls, each smaller than the last', maxR > rimR && rimR > knobR && knobR > 0,
       `${(2 * maxR).toFixed(2)} > ${(2 * rimR).toFixed(2)} > ${(2 * knobR).toFixed(2)}`],
      ['lid is a cap, not a hemisphere', capRise / (2 * rimR) >= 0.26 && capRise / (2 * rimR) <= 0.44,
       `rise/rim-dia ${(capRise / (2 * rimR)).toFixed(3)}  (measured 0.33, 0.35)`],
      ['body rounder than 西施 but still wider than tall',
       (2 * maxR) / prof.height >= 1.08 && (2 * maxR) / prof.height <= 1.40,
       `width/height ${((2 * maxR) / prof.height).toFixed(2)}  (measured 1.21, 1.22)`],
      ['widest near mid-height', widest.y / prof.height >= 0.32 && widest.y / prof.height <= 0.62,
       `widest at ${((widest.y / prof.height) * 100).toFixed(0)}% of height`],
      ['no straight run in the flank', worstRun < 6, `longest flat run ${worstRun} samples`],
      ['round, not pinched (fullness >= 2)', (p.lowerFull ?? 2) >= 2 && (p.upperFull ?? 2) >= 2,
       `lower ${(p.lowerFull ?? 0).toFixed(2)}, upper ${(p.upperFull ?? 0).toFixed(2)}`],
    ]
  },
  slots: {
    lid: (t) => [t === 'ballCap', 'lid is a 压盖 spherical cap (第二球)'],
    knob: (t) => [t === 'bead', 'knob is a ball (第三球)'],
    spout: (t) => [t === 'oneBend' || t === 'curved', 'spout is 一弯嘴'],
    handle: (t) => [t === 'invertedEar', 'handle is an ear-shaped ring (耳形环把)'],
    base: (t) => [t === 'ring', 'stands on a foot ring (圈足)'],
  },
}

CANON.liufang = {
  label: '六方',
  // 方器 is the first family here whose canon *inverts* the round wares'. For
  // 石瓢 or 西施 a straight run in the flank is a fault; here it is the point —
  // 以直线、横线为主，曲线、细线为辅. What makes a 方器 is flat faces meeting at
  // clean 棱线, equally divided, and every element carrying the same section.
  body: (prof, p, spec) => {
    const n = p.facets ?? 6
    // the section's corner-to-face ratio, against the ideal for a sharp n-gon.
    // Round the corners away and it is a barrel with creases drawn on it.
    const face = prof.radiusAt(prof.height * 0.5, 0)
    const corner = prof.radiusAt(prof.height * 0.5, Math.PI / n)
    const ideal = 1 / Math.cos(Math.PI / n)
    const sharp = (corner / face - 1) / (ideal - 1)
    // facets evenly divided: every face centre should sit at the same radius
    let spread = 0
    for (let i = 0; i < n; i++) {
      const r = prof.radiusAt(prof.height * 0.5, (i * 2 * Math.PI) / n)
      spread = Math.max(spread, Math.abs(r / face - 1))
    }
    // straight-dominant flank: the longest run whose radius changes at a
    // near-constant rate, as a fraction of the flank
    const pts = prof.outer.filter((v) => v.y > 0.08 && v.y < prof.height * 0.78)
    let run = 0, best = 0
    for (let i = 2; i < pts.length; i++) {
      const d2 = (pts[i].x - pts[i - 1].x) - (pts[i - 1].x - pts[i - 2].x)
      if (Math.abs(d2) < 6e-3) best = Math.max(best, ++run)
      else run = 0
    }
    const straight = pts.length > 3 ? best / (pts.length - 2) : 0
    return [
      ['six faces, evenly divided', n === 6 && spread < 0.005,
       `${n} faces, widest disagreement ${(spread * 100).toFixed(2)}%`],
      ['corners are 棱, not rounded away', sharp > 0.72,
       `corner/face ${(corner / face).toFixed(3)} of an ideal ${ideal.toFixed(3)} — ${(sharp * 100).toFixed(0)}% as crisp`],
      ['flank is straight-dominant (以直线为主)', straight > 0.55,
       `${(straight * 100).toFixed(0)}% of the flank runs straight`],
      ['stands on a squared foot', (p.footH ?? 0) > 0.01,
       `foot ${(p.footH ?? 0).toFixed(3)} tall`],
    ]
  },
  slots: {
    lid: (t) => [t === 'stepped', 'lid is a 台阶盖 carrying the same section'],
    knob: (t) => [t === 'button', 'knob is a 方钮'],
    spout: (t) => [t === 'oneBend', 'spout is 一弯嘴'],
    handle: (t) => [t === 'squareEar' || t === 'invertedEar', 'handle is an ear'],
    base: (t) => [t === 'flat' || t === 'ring', 'flat or ringed foot'],
  },
}

const want = process.argv.slice(2)
let failed = 0
for (const spec of SPECS) {
  const canonId = spec.canon ?? (spec.label?.includes('石瓢') ? 'shipiao'
    : spec.label?.includes('西施') ? 'xishi'
    : spec.label?.includes('潘') ? 'panhu'
    : spec.label?.includes('掇球') ? 'duoqiu'
    : spec.label?.includes('六方') ? 'liufang' : null)
  if (!canonId || !CANON[canonId]) continue
  if (want.length && !want.includes(spec.id)) continue
  const canon = CANON[canonId]
  console.log(`\n${spec.label}  (canon: ${canon.label})`)
  const { def, p } = resolveSlot(spec, 'body')
  const prof = def.profile(p)
  const checks = canon.body(prof, p, spec)
  for (const [slot, test] of Object.entries(canon.slots)) {
    const type = resolveSlot(spec, slot).p.type
    const [ok, name] = test(type)
    checks.push([name, ok, type])
  }
  const clearance = clearsLid(spec, prof)
  if (clearance) checks.push(clearance)
  for (const [name, ok, detail] of checks) {
    if (!ok) failed++
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(34)} ${detail}`)
  }
}
console.log(failed ? `\n${failed} canon violation(s)` : '\nall canon checks pass')
process.exit(failed ? 1 : 0)
