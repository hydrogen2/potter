// Render many URL specs in ONE browser session (fast: ~1-3 s each).
// usage: node scripts/fit/render-many.mjs jobs.json
//   jobs.json = { "out": "dir", "camera": "cam=side&elev=9&...", "jobs": [{ "name": "a", "hash": "id=..&body.height=0.7" }, ...] }
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const jobsFile = process.argv[2]
const { out, camera, jobs, width = 900, height = 600 } = JSON.parse(fs.readFileSync(jobsFile, 'utf8'))
fs.mkdirSync(out, { recursive: true })
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const server = await createServer({ root, server: { port: 5198 }, logLevel: 'silent' })
await server.listen()
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ||
    '/home/supper-user/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
page.setDefaultTimeout(120000)
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
await page.goto(`http://localhost:5198/#${jobs[0].hash}&${camera}&ui=hide&fit=1`, { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__potReady >= 1)
await page.waitForTimeout(800)
let t0 = Date.now()
for (let i = 0; i < jobs.length; i++) {
  const j = jobs[i]
  // A long batch can lose its WebGL context (headless SwiftShader); recover by
  // reloading straight into the candidate's URL rather than dropping the run.
  const url = `http://localhost:5198/#${j.hash}&${camera}&ui=hide&fit=1&_=${i}`
  let dataUrl = null
  for (let attempt = 0; attempt < 2 && dataUrl === null; attempt++) {
    try {
      if (i > 0 && attempt === 0) {
        const before = await page.evaluate(() => window.__potReady)
        // `_` guarantees a hashchange even when two candidates are identical
        await page.evaluate((h) => { location.hash = h }, `${j.hash}&${camera}&ui=hide&fit=1&_=${i}`)
        await page.waitForFunction((b) => window.__potReady > b, before, { timeout: 30000 })
      } else if (attempt > 0) {
        await page.goto(url, { waitUntil: 'networkidle' })
        await page.waitForFunction(() => window.__potReady >= 1)
        await page.waitForTimeout(500)
      }
      dataUrl = await page.evaluate(() => window.__snap())
    } catch (err) {
      console.log(`[retry ${j.name}] ${String(err).split('\n')[0]}`)
      dataUrl = null
    }
  }
  if (dataUrl === null) throw new Error(`render failed: ${j.name}`)
  fs.writeFileSync(path.join(out, `${j.name}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'))
}
console.log(`rendered ${jobs.length} in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
await browser.close(); await server.close(); process.exit(0)
