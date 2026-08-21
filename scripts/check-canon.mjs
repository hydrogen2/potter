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

const want = process.argv.slice(2)
let failed = 0
for (const spec of SPECS) {
  const canonId = spec.canon ?? (spec.label?.includes('石瓢') ? 'shipiao'
    : spec.label?.includes('西施') ? 'xishi' : null)
  if (!canonId || !CANON[canonId]) continue
  if (want.length && !want.includes(spec.id)) continue
  const canon = CANON[canonId]
  console.log(`\n${spec.label}  (canon: ${canon.label})`)
  const { def, p } = resolveSlot(spec, 'body')
  const prof = def.profile(p)
  const checks = canon.body(prof, p)
  for (const [slot, test] of Object.entries(canon.slots)) {
    const type = resolveSlot(spec, slot).p.type
    const [ok, name] = test(type)
    checks.push([name, ok, type])
  }
  for (const [name, ok, detail] of checks) {
    if (!ok) failed++
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(34)} ${detail}`)
  }
}
console.log(failed ? `\n${failed} canon violation(s)` : '\nall canon checks pass')
process.exit(failed ? 1 : 0)
