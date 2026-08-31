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
const H = Math.round((W * 9) / 16)
const TL = JSON.parse(fs.readFileSync('film/timeline.json', 'utf8'))
const FPS = TL.fps
const LOD = 'body.detail=0.011&body.seg=210'
const DIR = fs.mkdtempSync('/tmp/keynote-')
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
for (let i = 0, t = p1; t < p1end; i++, t += 7 / FPS) {
  shots.push({
    n: Math.min(7, Math.round((p1end - t) * FPS)),
    pot: FORMS[i % FORMS.length], mat: CLAYS[i % CLAYS.length],
    env: ENVS[i % ENVS.length], every: 999,          // one render, held
    cam: { az: -28 + (i * 23) % 90, elev: 6 + (i % 3) * 4, dist: 3.5, ty: 0.42, fov: 26 },
  })
}
const span = (id) => Math.round(at(id).dur * FPS)
const seq = [
  { id: 'b4', pair: 1, env: 'alps_field', every: 1,
    a: { az: -24, elev: 8, dist: 6.4, ty: 0.55 }, b: { az: 6, elev: 8, dist: 6.0, ty: 0.55 } },
  { id: 'b5', pair: 1, env: 'alps_field', every: 2,
    a: { az: 6, elev: 8, dist: 6.0, ty: 0.55 }, b: { az: 16, elev: 11, dist: 5.2, ty: 0.55 } },
  { id: 'b6', pot: 'chazihu', mat: 'duanni', env: 'valley_of_desolation', every: 1,
    a: { az: -40, elev: 14, dist: 3.6, ty: 0.55 }, b: { az: 18, elev: 5, dist: 3.3, ty: 0.52 } },
  { id: 'b7', pot: 'huzihu', mat: 'zini', env: 'blouberg_sunrise_1', every: 1,
    a: { az: -34, elev: 13, dist: 3.9, ty: 0.62 }, b: { az: 20, elev: 5, dist: 3.6, ty: 0.60 } },
  { id: 'b8', pot: 'chazihu', mat: 'duanni', env: 'birchwood', every: 1,
    a: { az: 0, elev: 6, dist: 3.4, ty: 0.54 }, b: { az: 200, elev: 6, dist: 3.4, ty: 0.54 } },
  { id: 'b9', pot: 'huzihu', mat: 'zini', env: 'goegap', every: 1,
    a: { az: 0, elev: 6, dist: 3.7, ty: 0.60 }, b: { az: 200, elev: 6, dist: 3.7, ty: 0.60 } },
  { id: 'b10', pair: 1, env: 'alps_field', every: 2,
    a: { az: 14, elev: 10, dist: 5.4, ty: 0.55 }, b: { az: -6, elev: 8, dist: 6.6, ty: 0.55 } },
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
const page = await browser.newPage({ viewport: { width: W, height: H } })
page.on('pageerror', (e) => console.log('[page]', e.message))
await page.goto(`http://localhost:5214/#id=${FORMS[0]}&ui=hide&${LOD}`, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
await page.evaluate(() => window.__studio.film(true, true))

let frame = 0, renders = 0, cur = { pot: null, pair: null, env: null, mat: null }
const started = Date.now()
const totalFrames = shots.reduce((a, s) => a + s.n, 0)
for (const s of shots) {
  if (s.pair && cur.pair !== 1) {
    await page.evaluate(() => window.__studio.pair())
    cur = { pot: null, pair: 1, env: cur.env, mat: null }
  } else if (s.pot && cur.pot !== s.pot) {
    await page.evaluate(([id, lod]) => window.__studio.pot(id, '&' + lod), [s.pot, LOD])
    await page.waitForTimeout(700)
    cur = { pot: s.pot, pair: null, env: cur.env, mat: null }
  }
  if (s.mat && cur.mat !== s.mat) { await page.evaluate((m) => window.__studio.mat(m), s.mat); cur.mat = s.mat }
  if (s.env !== cur.env) { await page.evaluate((e) => window.__studio.env(e), s.env); cur.env = s.env }
  let last = null
  for (let i = 0; i < s.n; i++) {
    const u = s.n > 1 ? i / (s.n - 1) : 0
    if (i % s.every === 0 || last === null) {
      const c = s.cam ? s.cam : {
        az: s.a.az + (s.b.az - s.a.az) * u, elev: s.a.elev + (s.b.elev - s.a.elev) * u,
        dist: s.a.dist + (s.b.dist - s.a.dist) * u, ty: s.a.ty + (s.b.ty - s.a.ty) * u, fov: 26,
      }
      await page.evaluate((cc) => window.__studio.cam(cc), c)
      const url = await page.evaluate(() => window.__studio.grab(0.93))
      last = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')
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
