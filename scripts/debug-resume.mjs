// Verify auto-resume photo mode: sample → drag (raster preview) → auto-restart.
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
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } })
page.setDefaultTimeout(120000)
page.on('pageerror', (e) => console.log('[pageerror]', e.message))

await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

await page.click('#photo', { force: true })
await page.waitForTimeout(25000)
console.log('label after sampling:', await page.textContent('#photo'))

// drag on the canvas → should flip to 取景中 raster preview
await page.mouse.move(450, 400)
await page.mouse.down()
for (let x = 450; x <= 560; x += 10) {
  await page.mouse.move(x, 400)
  await page.waitForTimeout(30)
}
console.log('label mid-drag:', await page.textContent('#photo'))
await page.mouse.up()

// settle → sampling should auto-restart from a low count
await page.waitForTimeout(20000)
console.log('label after settle:', await page.textContent('#photo'))
console.log('photo still active:', await page.evaluate(() => document.querySelector('#photo').classList.contains('active')))

// exit via the toggle
await page.click('#photo', { force: true })
console.log('label after exit:', await page.textContent('#photo'))

await browser.close()
await server.close()
process.exit(0)
