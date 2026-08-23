// Render a URL spec headlessly. Usage: node scripts/spec-shot.mjs '<hash>' out.png
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const hash = process.argv[2] || ''
const out = process.argv[3] || 'spec-shot.png'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const server = await createServer({ root, server: { port: 5199 } })
await server.listen()

const browser = await chromium.launch({
  executablePath:
    process.env.CHROMIUM_PATH ||
    '/home/supper-user/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
// 2x pixel ratio: a hairline seam aliases into dashes at 1x
const page = await browser.newPage({ viewport: { width: 1100, height: 700 }, deviceScaleFactor: 2 })
page.setDefaultTimeout(120000)
page.on('pageerror', (e) => console.log('[pageerror]', e.message))

await page.goto(`http://localhost:5199/#${hash}`, { waitUntil: 'networkidle' })
// the app rewrites the hash to record the spec diff, which can drop ui=hide
await page.evaluate(() => document.body.classList.add('ui-hidden'))
await page.waitForTimeout(3000)
await page.screenshot({ path: out })
console.log('saved', out)

await browser.close()
await server.close()
process.exit(0)
