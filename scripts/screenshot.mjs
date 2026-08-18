// Headless render check: boots the dev server, screenshots each shape.
// Usage: node scripts/screenshot.mjs [outDir]
// Needs a chromium; set CHROMIUM_PATH or have a playwright-cached one.
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = process.argv[2] || path.join(root, 'shots')
fs.mkdirSync(outDir, { recursive: true })

const executablePath =
  process.env.CHROMIUM_PATH ||
  '/home/supper-user/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell'

const server = await createServer({ root, server: { port: 5199 } })
await server.listen()

const browser = await chromium.launch({
  executablePath,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.setDefaultTimeout(120000)
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[console.error]', m.text())
})

await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

const shapeButtons = await page.$$('.shape-btn')
for (let i = 0; i < shapeButtons.length; i++) {
  if (i > 0) {
    await shapeButtons[i].click()
    await page.waitForTimeout(1500)
  }
  const label = await shapeButtons[i].evaluate((el) => el.querySelector('strong').textContent)
  const file = path.join(outDir, `shot-${i}-${label}.png`)
  await page.screenshot({ path: file })
  console.log('saved', file)
}

await browser.close()
await server.close()
process.exit(0)
