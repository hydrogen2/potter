import { chromium } from 'playwright-core'
import { createServer } from 'vite'
const server = await createServer({ root: process.cwd(), server: { port: 5217 }, logLevel: 'silent' })
await server.listen()
const browser = await chromium.launch({
  executablePath: '/home/supper-user/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 320, height: 180 } })
page.on('pageerror', e => console.log('[page]', e.message))
await page.goto('http://localhost:5217/#id=chazihu&ui=hide&body.detail=0.014&body.seg=120', { waitUntil: 'networkidle' })
await page.waitForTimeout(2000)
await page.evaluate(() => window.__studio.film(true, true))
const corner = async (label) => {
  const u = await page.evaluate(() => window.__studio.grab(0.9))
  // decode the top-left pixel by asking the page, simplest reliable route
  const px = await page.evaluate(async (d) => {
    const img = new Image(); img.src = d; await img.decode()
    const c = document.createElement('canvas'); c.width = c.height = 8
    c.getContext('2d').drawImage(img, 0, 0, 8, 8)
    const p = c.getContext('2d').getImageData(1, 1, 1, 1).data
    return [p[0], p[1], p[2]]
  }, u)
  console.log(' ', label.padEnd(38), 'corner rgb', px.join(','))
}
await page.evaluate(() => window.__studio.env('alps_field'))
await corner('after env(alps_field)')
await page.evaluate(() => window.__studio.bg('#2b2723'))
await corner('after bg(#2b2723)')
await page.evaluate((l) => window.__studio.pair('chazihu','huzihu','duanni','zini',0.30,0,Math.PI,l), {detail:0.014,seg:120})
await corner('after pair()  <-- rebuild happens here')
await page.evaluate(() => window.__studio.bg('#2b2723'))
await corner('after bg() again')
await page.evaluate(() => window.__studio.frame({ az: 0, elev: 7, margin: 1.22 }))
await corner('after frame()')
await browser.close(); await server.close(); process.exit(0)
