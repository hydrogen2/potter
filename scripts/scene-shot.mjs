// Render a pot composited into a scene. Usage:
//   node scripts/scene-shot.mjs '<hash>' out.png [width height]
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const hash = process.argv[2] || ''
const out = process.argv[3] || 'scene.png'
const W = parseInt(process.argv[4] || '1280', 10)
const H = parseInt(process.argv[5] || '720', 10)

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const server = await createServer({ root, server: { port: 5197 }, logLevel: 'silent' })
await server.listen()
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ||
    '/home/supper-user/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: W, height: H } })
page.setDefaultTimeout(180000)
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 200)) })
await page.goto(`http://localhost:5197/#${hash}`, { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 180000 })
await page.waitForTimeout(2500)
await page.screenshot({ path: out })
console.log('saved', out)
await browser.close(); await server.close(); process.exit(0)
