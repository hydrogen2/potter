// Verify 拍照 path-traced mode headlessly (SwiftShader: slow, small viewport).
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
page.setDefaultTimeout(240000)
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning')
    console.log(`[${m.type()}]`, m.text().slice(0, 250))
})

await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' })
await page.waitForTimeout(3000)
await page.click('#photo', { force: true })
console.log('photo mode entered, sampling…')
await page.waitForTimeout(45000)
console.log('status:', await page.textContent('#photo-status'))
console.log(
  'crash-ladder state:',
  await page.evaluate(() => ({
    attempt: localStorage.getItem('taoqi-photo-attempt'),
    level: localStorage.getItem('taoqi-photo-crash-level'),
  })),
)
await page.screenshot({ path: path.join(root, 'shots', 'shot-photo.png') })
console.log('saved shots/shot-photo.png')

await browser.close()
await server.close()
process.exit(0)
