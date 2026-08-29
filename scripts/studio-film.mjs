// A turntable film of two pots, rendered frame by frame in one browser session.
//
// The screenshot path is the thing to avoid: a frame renders in about two
// seconds and Playwright's capture adds thirty on top of it, so frames are read
// straight out of the framebuffer instead (__studio.grab). A hashchange rebuilds
// the whole vessel, so the camera and the clay are driven through __studio too,
// and the geometry is only rebuilt once, when the second pot comes on.
//
//   node scripts/studio-film.mjs out.mp4 [frames] [width]
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const OUT = process.argv[2] || 'public/refs/pair.mp4'
const N = parseInt(process.argv[3] || '288', 10)
const W = parseInt(process.argv[4] || '800', 10)
const H = Math.round((W * 9) / 16)
const FPS = 24
const DIR = fs.mkdtempSync('/tmp/film-')

// Each pot gets half the film: one full turn, and the clay changing under it.
const SHOTS = [
  // dist and ty are measured off each pot's own bounding box, not guessed: 茶字壶
  // is 2.08 wide with its spout and handle and only 1.12 tall, so the *width*
  // frames it; 壺字壺 is 1.31 by 1.27 and its 提梁 makes height the constraint.
  { id: 'chazihu', mats: ['duanni', 'zini', 'celadon', 'tenmoku'], dist: 3.7, ty: 0.56 },
  { id: 'huzihu', mats: ['zini', 'duanni', 'rockingham', 'zhuni'], dist: 4.0, ty: 0.63 },
]
const LOD = 'body.detail=0.011&body.seg=220'

const server = await createServer({ root: process.cwd(), server: { port: 5211 }, logLevel: 'silent' })
await server.listen()
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ||
    '/home/supper-user/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: W, height: H } })
page.on('pageerror', (e) => console.log('[page]', e.message))

const half = Math.floor(N / 2)
let started = Date.now()
for (let i = 0; i < N; i++) {
  const shotIdx = i < half ? 0 : 1
  const shot = SHOTS[shotIdx]
  const local = i < half ? i / half : (i - half) / (N - half)
  if (i === 0 || (i === half)) {
    await page.goto(`http://localhost:5211/#id=${shot.id}&ui=hide&${LOD}`,
      { waitUntil: 'networkidle' })
    await page.waitForTimeout(i === 0 ? 2500 : 1500)
    await page.evaluate(() => { window.__studio.film(true, true); window.__studio.backdrop('studio') })
  }
  // one full turn, easing in and out so it does not start and stop abruptly
  const e = local < 0.5 ? 2 * local * local : 1 - Math.pow(-2 * local + 2, 2) / 2
  const az = 360 * e
  const elev = 6 + 6 * Math.sin(local * Math.PI)      // rise and settle
  const mat = shot.mats[Math.min(shot.mats.length - 1,
    Math.floor(local * shot.mats.length))]
  await page.evaluate(([az, elev, dist, ty, mat]) => {
    window.__studio.cam({ az, elev, dist, ty, fov: 26 })
    window.__studio.mat(mat)
  }, [az, elev, shot.dist, shot.ty, mat])
  const url = await page.evaluate(() => window.__studio.grab(0.94))
  fs.writeFileSync(path.join(DIR, `f${String(i).padStart(4, '0')}.jpg`),
    Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'))
  if (i % 12 === 0 || i === N - 1) {
    const el = (Date.now() - started) / 1000
    process.stdout.write(`  frame ${i + 1}/${N}  ${el.toFixed(0)}s elapsed, ` +
      `${(el / (i + 1) * (N - i - 1)).toFixed(0)}s left\n`)
  }
}
await browser.close()
await server.close()

fs.mkdirSync(path.dirname(OUT), { recursive: true })
execFileSync('ffmpeg', ['-y', '-framerate', String(FPS), '-i', path.join(DIR, 'f%04d.jpg'),
  '-vf', `scale=${W * 2}:${H * 2}:flags=lanczos`,
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow', OUT],
  { stdio: 'inherit' })
console.log('wrote', OUT)
process.exit(0)
