// The studio film: a keynote flash through the archive, then the new pair.
//
// Rendered once; both language cuts share these pictures and differ only in the
// voice, which is what keeps them the same film. Frames come out of the
// framebuffer as JPEG (see __studio.grab) because Playwright's screenshot costs
// forty times as much, and a held shot is rendered once and repeated — hard cuts
// on stills are the look anyway, and it turns 171 frames of part one into 24.
//
//   node scripts/studio-keynote.mjs [width]
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const W = parseInt(process.argv[2] || '640', 10)
// --resume <dir> --from <frame>: a render that dies partway should not cost the
// frames that were already good. This box has 3.8GB and the renderer loses its
// GL context after enough rebuilds and 2k environment maps; when that happens
// every later frame comes out black, so the guard below stops rather than
// filling the film with them.
const RESUME = process.argv.includes('--resume')
  ? process.argv[process.argv.indexOf('--resume') + 1] : null
const FROM = process.argv.includes('--from')
  ? parseInt(process.argv[process.argv.indexOf('--from') + 1], 10) : 0
const H = Math.round((W * 9) / 16)
const TL = JSON.parse(fs.readFileSync('film/timeline.json', 'utf8'))
const FPS = TL.fps
const LOD = 'body.detail=0.011&body.seg=210'
const DIR = RESUME || fs.mkdtempSync('/tmp/keynote-')
const at = (id) => TL.beats.find((b) => b.id === id)
const ENVS = ['valley_of_desolation', 'blouberg_sunrise_1', 'alps_field',
  'birchwood', 'goegap', 'blue_grotto']
const FORMS = ['jingzhou-shipiao', 'xishi', 'duoqiu', 'jubian', 'liufang',
  'gaopan', 'ziye-shipiao', 'chawan']
const CLAYS = ['zini', 'duanni', 'zhuni', 'tenmoku', 'celadon', 'rockingham']

// --- the shot list ---------------------------------------------------------
// Part one cuts every 7 frames, each cut a different form, clay and place at
// once — the three axes turning together is the point of it. Part two holds one
// setting and lets the pots move.
const shots = []
const p1 = at('b1').start
const p1end = at('b3').start + at('b3').dur
const CUT = 11                                    // 0.92s a cut, not 0.58 — the
for (let i = 0, t = p1; t < p1end; i++, t += CUT / FPS) {   // eye needs to land
  shots.push({
    n: Math.min(CUT, Math.round((p1end - t) * FPS)),
    pot: FORMS[i % FORMS.length], mat: CLAYS[i % CLAYS.length],
    env: ENVS[i % ENVS.length], every: 999,        // one render, held
    // framed from the pot's own box: a distance that suits 西施 crops 掇球
    fit: { az: -26 + (i * 29) % 96, elev: 6 + (i % 3) * 4, margin: 1.45 },
  })
}
const span = (id) => Math.round(at(id).dur * FPS)
// Part two holds one quiet ground and lets the pots move. `z` is a zoom factor
// on the fitted distance, so a push never crops what the fit just framed.
const seq = [
  { id: 'b4', pair: 1, plain: 1, every: 1, fit: { margin: 1.22 },
    a: { az: -3, elev: 7, z: 1.02 }, b: { az: 7, elev: 8, z: 0.99 } },
  { id: 'b5', pair: 1, plain: 1, every: 2, fit: { margin: 1.22 },
    a: { az: 7, elev: 8, z: 0.99 }, b: { az: 16, elev: 12, z: 0.88 } },
  { id: 'b6', pot: 'chazihu', mat: 'duanni', plain: 1, every: 1, fit: { margin: 1.34 },
    a: { az: -40, elev: 14, z: 1.04 }, b: { az: 16, elev: 5, z: 0.94 } },
  { id: 'b7', pot: 'huzihu', mat: 'zini', plain: 1, every: 1, fit: { margin: 1.34 },
    a: { az: -34, elev: 13, z: 1.04 }, b: { az: 18, elev: 5, z: 0.94 } },
  { id: 'b8', pot: 'chazihu', mat: 'duanni', plain: 1, every: 1, fit: { margin: 1.30 },
    a: { az: 0, elev: 6, z: 1.0 }, b: { az: 200, elev: 6, z: 1.0 } },
  { id: 'b9', pot: 'huzihu', mat: 'zini', plain: 1, every: 1, fit: { margin: 1.30 },
    a: { az: 0, elev: 6, z: 1.0 }, b: { az: 200, elev: 6, z: 1.0 } },
  { id: 'b10', pair: 1, plain: 1, every: 2, fit: { margin: 1.22 },
    a: { az: 14, elev: 10, z: 0.90 }, b: { az: -4, elev: 8, z: 1.06 } },
]
for (const s of seq) shots.push({ ...s, n: span(s.id) })

// --- render ----------------------------------------------------------------
const server = await createServer({ root: process.cwd(), server: { port: 5214 }, logLevel: 'silent' })
await server.listen()
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ||
    '/home/supper-user/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
let page = await browser.newPage({ viewport: { width: W, height: H } })
page.on('pageerror', (e) => console.log('[page]', e.message))
await page.goto(`http://localhost:5214/#id=${FORMS[0]}&ui=hide&${LOD}`, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
await page.evaluate(() => window.__studio.film(true, true))

let frame = 0, renders = 0, cur = { pot: null, pair: null, env: null, mat: null, plain: 0 }
// A fresh page for every change of pot. Textures and geometry from twenty
// rebuilds and six 2k maps are what exhausted the context last time; starting
// clean costs about eight seconds and buys the rest of the render.
async function freshPage(startId) {
  if (page && !page.isClosed()) await page.close()
  page = await browser.newPage({ viewport: { width: W, height: H } })
  page.on('pageerror', (e) => console.log('[page]', e.message))
  await page.goto(`http://localhost:5214/#id=${startId}&ui=hide&${LOD}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2200)
  await page.evaluate(() => window.__studio.film(true, true))
  cur = { pot: startId, pair: null, env: null, mat: null, plain: 0 }
}
const started = Date.now()
const totalFrames = shots.reduce((a, s) => a + s.n, 0)
let cursor = 0
for (const s of shots) {
  if (cursor + s.n <= FROM) { cursor += s.n; frame += s.n; continue }
  cursor += s.n
  if (s.pair && cur.pair !== 1) {
    await freshPage('chazihu')
    await page.evaluate((l) => window.__studio.pair('chazihu', 'huzihu', 'duanni', 'zini',
      0.30, 0, Math.PI, l), { detail: 0.011, seg: 210 })
    cur = { ...cur, pot: null, pair: 1, mat: null, plain: 0 }
  } else if (s.pot && cur.pot !== s.pot) {
    await freshPage(s.pot)
  }
  if (s.mat && cur.mat !== s.mat) { await page.evaluate((m) => window.__studio.mat(m), s.mat); cur.mat = s.mat }
  if (s.env && s.env !== cur.env) { await page.evaluate((e) => window.__studio.env(e), s.env); cur.env = s.env; cur.plain = 0 }
  // rebuild() runs applyFitMode(), which puts scene.background back to the page's
  // cream — so this has to be re-applied after every pot change, not just once
  if (s.plain && !cur.plain) {
    // one calm HDRI for the light, a plain ground behind: part two is about
    // reading the pots, and a cliff behind them is competition, not setting
    if (cur.env !== 'alps_field') { await page.evaluate(() => window.__studio.env('alps_field')); cur.env = 'alps_field' }
    await page.evaluate(() => window.__studio.bg('#2b2723'))
    cur.plain = 1
  }
  let base = null
  if (s.fit) {
    base = await page.evaluate((f) => window.__studio.frame(f),
      { az: s.a ? s.a.az : s.fit.az, elev: s.a ? s.a.elev : s.fit.elev, margin: s.fit.margin })
  }
  let last = null
  for (let i = 0; i < s.n; i++) {
    const u = s.n > 1 ? i / (s.n - 1) : 0
    if (i % s.every === 0 || last === null) {
      if (s.a) {
        await page.evaluate((cc) => window.__studio.cam(cc), {
          az: s.a.az + (s.b.az - s.a.az) * u, elev: s.a.elev + (s.b.elev - s.a.elev) * u,
          dist: base.dist * (s.a.z + (s.b.z - s.a.z) * u), ty: base.ty, fov: 26,
        })
      }
      const url = await page.evaluate(() => window.__studio.grab(0.93))
      last = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')
      // a lost context still returns a JPEG — an all-black one, about 1.6KB
      if (last.length < 3500) {
        throw new Error(`frame ${frame} came back black (${last.length} bytes) — ` +
          `the GL context is gone. Resume with: --resume ${DIR} --from ${frame}`)
      }
      renders++
    }
    fs.writeFileSync(path.join(DIR, `f${String(frame++).padStart(5, '0')}.jpg`), last)
  }
  const el = (Date.now() - started) / 1000
  process.stdout.write(`  ${(s.id || s.pot || 'pair').padEnd(16)} ${String(frame).padStart(4)}/${totalFrames} frames, ` +
    `${renders} renders, ${el.toFixed(0)}s\n`)
}
await browser.close(); await server.close()

const silent = path.join(DIR, 'silent.mp4')
execFileSync('ffmpeg', ['-y', '-framerate', String(FPS), '-i', path.join(DIR, 'f%05d.jpg'),
  '-vf', `scale=${W * 2}:${H * 2}:flags=lanczos`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
  '-crf', '19', '-preset', 'slow', silent], { stdio: ['ignore', 'ignore', 'inherit'] })
for (const lang of ['en', 'zh']) {
  // Hold the last frame before -shortest trims: the shot spans round down to
  // slightly less than the timeline, and without the pad the final syllable of
  // the Mandarin cut is cut off with it.
  execFileSync('ffmpeg', ['-y', '-i', silent, '-i', `film/vo_${lang}.wav`,
    '-filter_complex', '[0:v]tpad=stop_mode=clone:stop_duration=3[v]',
    '-map', '[v]', '-map', '1:a',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '19', '-preset', 'medium',
    '-c:a', 'aac', '-b:a', '160k', '-shortest',
    `public/refs/studio_${lang}.mp4`], { stdio: ['ignore', 'ignore', 'inherit'] })
  console.log('wrote public/refs/studio_' + lang + '.mp4')
}
process.exit(0)
