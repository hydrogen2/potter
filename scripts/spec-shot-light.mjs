// Render one URL spec headlessly, cheaply. spec-shot.mjs captures at 2x device
// pixel ratio for crisp seams, which the software rasteriser cannot sustain on
// a heavy pot — 菊瓣's 16 ribs come to ~190k triangles and the screenshot times
// out. This is the same thing at 1x and a smaller viewport.
// Usage: node scripts/spec-shot-light.mjs '<hash>' out.png
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const hash = process.argv[2] || ''
const out = process.argv[3] || 'shot.png'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const server = await createServer({ root, server: { port: 5203 }, logLevel: 'silent' })
await server.listen()
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ||
    '/home/supper-user/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
await page.goto(`http://localhost:5203/#${hash}`, { waitUntil: 'networkidle' })
await page.evaluate(() => document.body.classList.add('ui-hidden'))
await page.waitForTimeout(4000)
// The glyph pots carry a 900-segment relief band; swiftshader needs well over
// the 240s default to compose one, and the failure looks like a hang, not a
// geometry error, so it is worth the long leash.
await page.screenshot({ path: out, timeout: 900000, animations: 'disabled', caret: 'hide' })
console.log('saved', out)
await browser.close(); await server.close(); process.exit(0)
