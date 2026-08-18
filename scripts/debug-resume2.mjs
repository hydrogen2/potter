// Label trajectory around a drag: does sampling reset and climb again?
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
await page.click('#photo', { force: true })

for (let i = 0; i < 4; i++) {
  await page.waitForTimeout(6000)
  console.log(`t+${(i + 1) * 6}s:`, await page.textContent('#photo'))
}

console.log('--- drag ---')
await page.mouse.move(450, 400)
await page.mouse.down()
for (let x = 450; x <= 560; x += 10) {
  await page.mouse.move(x, 400)
  await page.waitForTimeout(30)
}
await page.mouse.up()

for (let i = 0; i < 5; i++) {
  await page.waitForTimeout(6000)
  console.log(`post+${(i + 1) * 6}s:`, await page.textContent('#photo'))
}

await browser.close()
await server.close()
process.exit(0)
