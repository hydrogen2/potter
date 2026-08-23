// Quality check: render one archive entry from many angles, so faults that
// hide in a side view (attachments colliding, geometry poking through, holes
// in a fillet) show up somewhere. Usage: node scripts/qc.mjs <specId> [outDir]
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const id = process.argv[2] || 'gaopan'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = process.argv[3] || path.join(root, 'shots', `qc-${id}`)
fs.mkdirSync(out, { recursive: true })

// side, both three-quarters, spout-on, handle-on, from above, and low —
// the low one catches the foot, the high one catches the lid and knob
// [name, elev, az, dist, tyFraction]
// The last four are close-ups on the junctions. Whole-pot views at this size
// cannot show them, and junction faults are the ones that give a pot away: a
// collar that is a flange rather than a ring, a spout that sags into a U, a
// strap that kinks where it meets the belly, an attachment that fell off. A
// belly a few percent fat is forgivable; these are not.
const VIEWS = [
  ['side', 3, 0, 14, 0.42], ['three-quarter', 18, 38, 14, 0.42],
  ['spout-on', 8, 88, 14, 0.42], ['back', 6, 180, 14, 0.42],
  ['handle-on', 8, -88, 14, 0.42], ['above', 55, 30, 15, 0.42],
  ['low', -12, 20, 14, 0.42], ['close', 6, 15, 8, 0.42],
  // near-profile, so each junction is read against the silhouette where a
  // step, a gap or a reversal shows; swung round far enough to keep it off
  // the exact edge
  ['detail-lid', 2, 14, 5.2, 0.86],
  ['detail-spout-root', 2, 22, 7.2, 0.50],
  ['detail-handle-top', 2, -22, 7.2, 0.60],
  ['detail-handle-foot', 2, -22, 7.2, 0.24],
]

const server = await createServer({ root, server: { port: 5196 }, logLevel: 'silent' })
await server.listen()
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ||
    '/home/supper-user/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 700, height: 560 } })
page.setDefaultTimeout(120000)
page.on('pageerror', (e) => console.log('[pageerror]', e.message))

let potTop = 1.8
const url = (v) =>
  `http://localhost:5196/#id=${id}&cam=side&elev=${v[1]}&az=${v[2]}&dist=${v[3]}` +
  `&fov=20&ty=${(potTop * v[4]).toFixed(3)}&ui=hide`
await page.goto(url(VIEWS[0]), { waitUntil: 'networkidle' })
await page.evaluate(() => document.body.classList.add('ui-hidden'))
potTop = (await page.evaluate(() => window.__potTop)) || 1.8
await page.evaluate((h) => { location.hash = h }, url(VIEWS[0]).split('#')[1])
await page.waitForTimeout(600)
for (let i = 0; i < VIEWS.length; i++) {
  const v = VIEWS[i]
  if (i > 0) {
    const before = await page.evaluate(() => window.__potReady)
    await page.evaluate((h) => { location.hash = h }, url(v).split('#')[1] + `&_=${i}`)
    await page.waitForFunction((b) => window.__potReady > b, before, { timeout: 30000 })
  }
  await page.waitForTimeout(900)
  await page.screenshot({ path: path.join(out, `${i}-${v[0]}.png`) })
  console.log('  ', v[0])
}
await browser.close(); await server.close()
console.log('qc sheet →', out)
process.exit(0)
