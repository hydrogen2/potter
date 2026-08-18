// Verify the on-canvas render status chip stays visible with UI hidden.
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
const page = await browser.newPage({
  viewport: { width: 1000, height: 800 },
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (Linux; Android 13; SM-F926B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36',
})
page.setDefaultTimeout(120000)
page.on('pageerror', (e) => console.log('[pageerror]', e.message))

await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

console.log('chip hidden before photo:', await page.evaluate(() => document.querySelector('#render-status').hidden))
await page.click('#photo', { force: true })
console.log('button label in photo mode:', await page.textContent('#photo'))
await page.waitForTimeout(12000)
console.log('chip text:', await page.textContent('#render-status'))

// hide UI with a tap — chip must stay
await page.touchscreen.tap(300, 300)
await page.waitForTimeout(400)
const state = await page.evaluate(() => ({
  uiHidden: document.body.classList.contains('ui-hidden'),
  chipVisible: !document.querySelector('#render-status').hidden,
}))
console.log('after tap:', state)
await page.screenshot({ path: path.join(root, 'shots', 'status-chip.png') })

await browser.close()
await server.close()
process.exit(0)
