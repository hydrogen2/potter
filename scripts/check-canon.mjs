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

import { GLYPHS } from '../src/glyphs/index.js'

const CANON = {
  glyph: {
    label: '字·回旋',
    // A revolution of a character is not a style, it is a method with a
    // precondition: every stroke becomes a ring or a disc about one axis, so
    // the character has to be symmetric about that axis or the pot is simply
    // not the character any more. That is measurable, so it is checked rather
    // than remembered — pointing this body at an unsuitable glyph must fail
    // loudly, not quietly look wrong.
    body: (prof, p, spec) => {
      const G = GLYPHS[p.glyph ?? 'cha']
      const out = []
      const asym = G?.asym
      out.push(['glyph is symmetric enough to revolve',
        asym != null && asym <= 0.06, `${((asym ?? 1) * 100).toFixed(1)}% about its best axis`])
      // The mouth is the character's own feature, not a chosen number: 艹's two
      // verticals revolve into the lid's ring, and that ring has to land in the
      // mouth, so the mouth's radius IS their distance from the axis. Stated as a
      // *ratio* against the pot's own widest point, so it holds whatever the pot
      // is scaled to and whatever free lengths (the neck) it is given — an
      // absolute figure derived from the house's height silently became wrong the
      // moment the neck stopped being the glyph's own.
      const hx = (G?.body?.[0] ?? []).map((q) => Math.abs(q[0]))
      const houseHalf = Math.max(...hx, 1e-6)
      const top = prof.outer[prof.outer.length - 1]
      const maxR = Math.max(...prof.outer.map((v) => v.x))
      const got = top.x / maxR
      const want = (G?.cao?.ringR ?? 0) / houseHalf
      // The character states the mouth — 艹's two verticals — and for a long time
      // this rule asked for exactly that. A pot also has to be filled and
      // emptied, and that is a real claim on the design, not a lapse. So the
      // character's figure is the *floor* rather than the target: the mouth may
      // be opened for use, never closed below what 艹 says, and never opened so
      // far that the roof it is cut from stops existing. Both ends can fail,
      // and a departure is reported rather than passed over in silence.
      const open = got > want + 0.02
      out.push([`mouth is at least 艹's verticals${open ? ', opened for use' : ''}`,
        G?.cao != null && got >= want - 0.02 && got < 0.75,
        `mouth/width ${got.toFixed(3)}, 艹 says ${want.toFixed(3)}`
        + (open ? ` — opened by ${((got / want - 1) * 100).toFixed(0)}%` : '')])
      // The shoulder must run on the character's own roof slope. Measured on the
      // run that is actually the cone — the samples where the radius is falling —
      // and not on a fixed slice of the height, which stops being the cone as soon
      // as the pot's proportions change.
      const o = prof.outer
      const slopes = []
      for (let i = 1; i < o.length; i++) {
        const dy = o[i].y - o[i - 1].y
        if (dy <= 1e-9) continue
        const g = (o[i].x - o[i - 1].x) / dy
        if (g < -0.15) slopes.push(g)
      }
      slopes.sort((a, b) => a - b)
      const med = slopes.length ? slopes[Math.floor(slopes.length / 2)] : -1
      const deg = Math.atan(1 / Math.abs(med)) * 180 / Math.PI
      out.push(['shoulder runs on 𠆢\'s own slope',
        G?.roofDeg != null && Math.abs(deg - G.roofDeg) < 3,
        `${deg.toFixed(1)}° vs ${G?.roofDeg}° in the glyph (${slopes.length} samples)`])
      // The hips no longer have to be made to meet — the lid is the rest of the
      // cone, and meridians on a cone arrive at the apex by themselves. What has
      // to hold instead is that the lid really does carry the roof on: it must
      // close most of the way to the apex, and the knob must stand where the
      // hips arrive, so they run into the 宝顶 the way a 攒尖顶's hips do rather
      // than stopping in mid-air. Both ends of this can fail from a bad spec.
      // The handle attaches to the *body*, not to the neck the lid continues.
      // Its centreline can clear the neck while the tube around it does not —
      // which is what happened here: the root sat 0.013 below the neck with a
      // 0.062 tube, so the strap ran a clear 0.05 into it and read as growing
      // out of the lid. The clearance rule below could not see it, because the
      // handle passes *beside* the lid at a larger radius and never intrudes on
      // it. Measure the tube, not the line.
      const hp2 = spec.handle ?? {}
      if (hp2.type && hp2.type !== 'none' && hp2.topY != null) {
        let wi2 = 0
        for (let i = 0; i < o.length; i++) if (o[i].x > o[wi2].x) wi2 = i
        const maxR2 = o[wi2].x
        let eaves2 = 0
        for (const v of o) if (v.x > maxR2 * 0.998) eaves2 = Math.max(eaves2, v.y)
        let neckY = prof.height
        for (let i = 0; i < o.length; i++) {
          if (o[i].y > eaves2 && o[i].x <= top.x * 1.004) { neckY = o[i].y; break }
        }
        const rootY = prof.height * hp2.topY
        const reach = rootY + (hp2.tube ?? 0.05)
        out.push(['handle attaches below the neck', reach <= neckY,
          `root ${rootY.toFixed(3)} + tube ${(hp2.tube ?? 0.05).toFixed(3)} = `
          + `${reach.toFixed(3)} vs neck at ${neckY.toFixed(3)}`])
      }
      // The lid's side view has to *be* 艹. A revolved lid shows, from the side,
      // its rim as a rectangle with the crossbar-ring as one horizontal across
      // it and the two verticals where their azimuth projects. That is the
      // character only if the rectangle carries 艹's own proportions — otherwise
      // the strokes are right and the character is stretched. This is the rule
      // that makes the revolution worth doing: without 艹 and 𠆢 standing in the
      // silhouette, the pot is any pot with a character stuck on it.
      const cao2 = G?.cao
      const lp2 = spec.lid ?? {}
      if (cao2 && lp2.thickness != null) {
        const R2 = top.x + (lp2.overhang ?? 0)
        const want2 = (cao2.up + cao2.barH + cao2.down) / (2 * cao2.barHalf)
        const got2 = lp2.thickness / (2 * R2)
        out.push(['the lid in side view is 艹, in proportion',
          Math.abs(got2 - want2) < 0.02,
          `height/width ${got2.toFixed(4)} vs 艹's own ${want2.toFixed(4)}`])
      }
      const lidP = spec.lid ?? {}
      // Whichever way the roof is finished, it has to actually finish. With a
      // neck the hips are bent to meet inside it, and the neck must be at least
      // the apex rise or they are cut off at the rim — a coupling between two
      // parameters set in different places, invisible in any render, since
      // truncated hips look perfectly tidy from the front.
      if (lidP.type !== 'coneCap') {
        let wi = 0
        for (let i = 0; i < o.length; i++) if (o[i].x > o[wi].x) wi = i
        let mouthY = prof.height
        for (let i = wi; i < o.length; i++) {
          if (o[i].x <= top.x * 1.004) { mouthY = o[i].y; break }
        }
        const rise = top.x / Math.abs(med)
        const neckLen = prof.height - mouthY
        out.push(['the roof\'s hips meet inside the neck', rise <= neckLen,
          `apex stands ${rise.toFixed(3)} above the mouth, neck is ${neckLen.toFixed(3)}`
          + (rise <= neckLen ? ` — joins ${(rise / neckLen * 100).toFixed(0)}% up` : ' — CUT OFF')])
      }
      if (lidP.type === 'coneCap') {
        const tip = lidP.tip ?? 0.16
        const kR = lidP.knobR ?? 0.2
        const rTip = top.x * tip
        out.push(['the lid carries the roof on to its 宝顶',
          tip <= 0.30 && kR >= rTip,
          `cone closes ${((1 - tip) * 100).toFixed(0)}% of the way to the apex, `
          + `knob r ${kR.toFixed(3)} vs hips arriving at ${rTip.toFixed(3)}`])
      }
      return out
    },
    slots: {
      lid: (t) => [t === 'discRing' || t === 'discSlab' || t === 'coneCap',
        'lid carries 艹'],
      handle: (t) => [t === 'invertedEar', 'handle is an inverted ear'],
      base: (t) => [t === 'flat', 'flat base'],
    },
  },
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
      handle: (t) => [t === 'rearLoop' || t === 'squareEar', 'handle is a rear loop'],
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

CANON.jinwen = {
  label: '筋纹器',
  // 筋纹器 is not a profile family — it is a surface treatment on a round body,
  // which is why the body here is still a superellipse. What makes it the
  // family is the discipline of the ribs:
  //
  //   等分   the divisions are exactly equal;
  //   贯通   the ribs run unbroken from the knob, over the lid, down the body;
  //   通转   the lid lifts, turns to any rib, and sets down still matching.
  //
  // 通转 is the demanding one and the reason 等分 has to be exact rather than
  // close: it only holds if every one of the n divisions is identical, so the
  // check measures the disagreement between them rather than trusting it.
  body: (prof, p, spec) => {
    const n = p.lobes ?? 0
    const knob = resolveSlot(spec, 'knob').p
    const lidT = resolveSlot(spec, 'lid').p
    const sec = prof.crossSection
    let spread = 0, ridge = 0, groove = 0
    if (sec && n >= 3) {
      ridge = sec(0); groove = sec(Math.PI / n)
      for (let i = 0; i < n; i++) {
        spread = Math.max(spread, Math.abs(sec((i * 2 * Math.PI) / n) - ridge))
        spread = Math.max(spread, Math.abs(sec(((i + 0.5) * 2 * Math.PI) / n) - groove))
      }
    }
    const relief = ridge > 0 ? (ridge - groove) / ridge : 0
    const pts = prof.outer.filter((v) => v.y > 0.02 && v.y < prof.height - 0.02)
    let run = 0, worst = 0
    for (let i = 2; i < pts.length; i++) {
      const d2 = (pts[i].x - pts[i - 1].x) - (pts[i - 1].x - pts[i - 2].x)
      if (Math.abs(d2) < 1e-4) worst = Math.max(worst, ++run)
      else run = 0
    }
    return [
      ['ribs are equally divided (等分)', n >= 3 && spread < 1e-9,
       n >= 3 ? `${n} ribs, largest disagreement ${spread.toExponential(1)}` : 'no ribs'],
      // the lid can only turn to any rib if it carries the same count as the body
      ['lid and knob turn to any rib (通转)',
       (knob.lobes ?? 0) === n && n >= 3,
       `body ${n}, knob ${knob.lobes ?? 0}`],
      ['ribs run knob → lid → body unbroken (贯通)',
       (p.lobeDepth ?? 0) > 0 && (knob.lobeDepth ?? 0) > 0 && !lidT.brim && !lidT.bead,
       `body ${(p.lobeDepth ?? 0).toFixed(3)}, knob ${(knob.lobeDepth ?? 0).toFixed(3)}` +
       (lidT.brim || lidT.bead ? ' — a brim or bead would break the run' : '')],
      ['ribs deep enough to read', relief >= 0.04 && relief <= 0.22,
       `ridge to groove ${(relief * 100).toFixed(1)}% of the radius`],
      ['body is still a round ware underneath', worst < 6,
       `longest straight run ${worst} samples`],
    ]
  },
  slots: {
    knob: (t) => [t === 'button', 'knob is ribbed (筋纹之始)'],
    spout: (t) => [t === 'oneBend' || t === 'straightCone', 'spout is 一弯嘴 or 直流'],
    handle: (t) => [t === 'invertedEar', 'handle is an ear'],
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
    : spec.label?.includes('六方') ? 'liufang'
    : spec.label?.includes('菊瓣') ? 'jinwen' : null)
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
