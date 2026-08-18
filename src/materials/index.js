import * as THREE from 'three'

/**
 * Material registry — two families:
 *
 *   clay  — unglazed stoneware (紫砂, tokoname…). What sells it is 砂感:
 *           granular speckle in color + roughness, and the faint burnished
 *           sheen of 明针 work (a whisper of clearcoat).
 *   glaze — glassy coat over the body (tenmoku, celadon, Rockingham…):
 *           low roughness, strong clearcoat, soft color mottling.
 *
 * All textures are generated on a canvas at load time — no assets.
 */

export const MATERIALS = {
  zini: {
    label: '紫泥',
    family: 'clay',
    base: '#6e4a3f',
    grainDark: '#452e28',
    grainLight: '#94685a',
    grains: 34000,
    blotch: 0.05,
    roughness: 0.72,
    clearcoat: 0.12,
    clearcoatRoughness: 0.6,
  },
  zhuni: {
    label: '朱泥',
    family: 'clay',
    base: '#a64a2e',
    grainDark: '#7c3320',
    grainLight: '#c96a42',
    grains: 15000, // 朱泥 is finer and denser
    blotch: 0.035,
    roughness: 0.52,
    clearcoat: 0.22,
    clearcoatRoughness: 0.45,
  },
  duanni: {
    label: '段泥',
    family: 'clay',
    base: '#c2a06c',
    grainDark: '#7d6140',
    grainLight: '#e8cf98', // 金砂
    grains: 42000,
    blotch: 0.06,
    roughness: 0.7,
    clearcoat: 0.1,
    clearcoatRoughness: 0.65,
  },
  tenmoku: {
    label: '天目',
    family: 'glaze',
    base: '#241713',
    blotchColor: '#6b3a22', // iron-red break
    blotch: 0.16,
    roughness: 0.2,
  },
  celadon: {
    label: '青瓷',
    family: 'glaze',
    base: '#9dbfab',
    blotchColor: '#7ba28d',
    blotch: 0.08,
    roughness: 0.16,
  },
  rockingham: {
    label: 'Rockingham',
    family: 'glaze',
    base: '#4a2417',
    blotchColor: '#8a4a24', // the streaky manganese brown of a Brown Betty
    blotch: 0.2,
    roughness: 0.14,
  },
}

function rand(seedRef) {
  // small deterministic PRNG so a given material always looks identical
  seedRef.s = (seedRef.s * 1664525 + 1013904223) >>> 0
  return seedRef.s / 0xffffffff
}

function hexWithAlpha(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function baseCanvas(def, seed) {
  const S = 1024
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = S
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = def.base
  ctx.fillRect(0, 0, S, S)
  // low-frequency mottling (firing / glaze-flow variation)
  const blotchColors = def.family === 'clay'
    ? [def.grainDark, def.grainLight]
    : [def.blotchColor, def.base]
  for (let i = 0; i < 46; i++) {
    const x = rand(seed) * S
    const y = rand(seed) * S
    const r = 80 + rand(seed) * 240
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    const c = blotchColors[rand(seed) > 0.5 ? 0 : 1]
    g.addColorStop(0, hexWithAlpha(c, def.blotch))
    g.addColorStop(1, hexWithAlpha(c, 0))
    ctx.fillStyle = g
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }
  return { canvas, ctx, S }
}

function toTexture(canvas, { srgb = true, repeat = [3, 1.6] } = {}) {
  const tex = new THREE.CanvasTexture(canvas)
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(...repeat)
  tex.anisotropy = 8
  return tex
}

function makeClayMaterial(def) {
  const seed = { s: 7 }
  const { canvas, ctx, S } = baseCanvas(def, seed)

  // 砂感 speckle
  for (let i = 0; i < def.grains; i++) {
    const x = rand(seed) * S
    const y = rand(seed) * S
    const sz = 0.6 + rand(seed) * 1.9
    const pick = rand(seed)
    const c = pick < 0.45 ? def.grainDark : pick < 0.9 ? def.grainLight : '#f0e6d4'
    ctx.fillStyle = hexWithAlpha(c, 0.18 + rand(seed) * 0.42)
    ctx.fillRect(x, y, sz, sz)
  }
  const map = toTexture(canvas)

  // roughness: grain flecks scatter light differently than the burnished ground
  const rc = document.createElement('canvas')
  rc.width = rc.height = 512
  const rctx = rc.getContext('2d')
  const base = Math.round(def.roughness * 255)
  rctx.fillStyle = `rgb(${base},${base},${base})`
  rctx.fillRect(0, 0, 512, 512)
  for (let i = 0; i < 22000; i++) {
    const v = base + (rand(seed) - 0.4) * 70
    const vi = Math.max(0, Math.min(255, Math.round(v)))
    rctx.fillStyle = `rgb(${vi},${vi},${vi})`
    rctx.fillRect(rand(seed) * 512, rand(seed) * 512, 1.5, 1.5)
  }
  const roughnessMap = toTexture(rc, { srgb: false })

  return new THREE.MeshPhysicalMaterial({
    map,
    roughnessMap,
    roughness: 1, // fully driven by the map
    bumpMap: map, // reuse speckle luminance for micro-relief
    bumpScale: 0.6,
    clearcoat: def.clearcoat,
    clearcoatRoughness: def.clearcoatRoughness,
  })
}

function makeGlazeMaterial(def) {
  const seed = { s: 7 }
  const { canvas } = baseCanvas(def, seed)
  return new THREE.MeshPhysicalMaterial({
    map: toTexture(canvas),
    roughness: def.roughness,
    clearcoat: 0.65,
    clearcoatRoughness: 0.12,
  })
}

const cache = {}
export function getMaterial(key) {
  if (!cache[key]) {
    const def = MATERIALS[key]
    cache[key] = def.family === 'clay' ? makeClayMaterial(def) : makeGlazeMaterial(def)
  }
  return cache[key]
}
