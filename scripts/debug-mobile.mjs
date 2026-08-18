// Verify landscape-phone layout: panel fits/scrolls, tap toggles UI.
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const server = await createServer({ root, server: { port: 5199 } })
await server.listen()

const browser = await chromium.launch({
  executablePath:
    '/home/supper-user/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
// fat phone, landscape (e.g. iPhone-ish 19.5:9 → ~844x390)
const page = await browser.newPage({ viewport: { width: 844, height: 390 }, hasTouch: true })
page.setDefaultTimeout(120000)
page.on('pageerror', (e) => console.log('[pageerror]', e.message))

await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
await page.screenshot({ path: path.join(root, 'shots', 'mobile-1-controls.png') })

// can we reach 拍照 by scrolling the panel?
const visible = await page.evaluate(() => {
  const panel = document.querySelector('.panel')
  panel.scrollTop = panel.scrollHeight
  const r = document.querySelector('#photo').getBoundingClientRect()
  return r.top >= 0 && r.bottom <= window.innerHeight
})
console.log('拍照 reachable after panel scroll:', visible)
await page.screenshot({ path: path.join(root, 'shots', 'mobile-2-scrolled.png') })

// tap canvas → UI hides
await page.touchscreen.tap(300, 195)
await page.waitForTimeout(400)
console.log('ui hidden after tap:', await page.evaluate(() => document.body.classList.contains('ui-hidden')))
await page.screenshot({ path: path.join(root, 'shots', 'mobile-3-fullscreen.png') })

// tap again → UI returns
await page.touchscreen.tap(300, 195)
await page.waitForTimeout(400)
console.log('ui restored after tap:', await page.evaluate(() => !document.body.classList.contains('ui-hidden')))

await browser.close()
await server.close()
process.exit(0)
