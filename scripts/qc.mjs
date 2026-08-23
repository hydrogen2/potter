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
const VIEWS = [
  ['side', 3, 0, 14], ['three-quarter', 18, 38, 14], ['spout-on', 8, 88, 14],
  ['back', 6, 180, 14], ['handle-on', 8, -88, 14], ['above', 55, 30, 15],
  ['low', -12, 20, 14], ['close', 6, 15, 8],
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

const url = (v) => `http://localhost:5196/#id=${id}&cam=side&elev=${v[1]}&az=${v[2]}&dist=${v[3]}&fov=20&ty=0.5&ui=hide`
await page.goto(url(VIEWS[0]), { waitUntil: 'networkidle' })
await page.evaluate(() => document.body.classList.add('ui-hidden'))
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
