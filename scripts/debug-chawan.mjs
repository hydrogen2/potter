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
const page = await browser.newPage({ viewport: { width: 900, height: 600 } })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
page.on('console', (m) => console.log('[console]', m.type(), m.text().slice(0, 300)))

await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' })
await page.waitForTimeout(2000)

// build chawan directly inside the page and see what happens
const result = await page.evaluate(async () => {
  try {
    const { SHAPES } = await import('/src/shapes/index.js')
    const { getMaterial } = await import('/src/materials/index.js')
    const shape = SHAPES.chawan
    const p = {}
    for (const [k, d] of Object.entries(shape.params)) p[k] = d.default
    const t0 = performance.now()
    const pot = shape.build(p, getMaterial('tenmoku'))
    const t1 = performance.now()
    return { ok: true, ms: t1 - t0, children: pot.children.length, metrics: shape.metrics(p) }
  } catch (e) {
    return { ok: false, error: e.message, stack: e.stack?.slice(0, 500) }
  }
})
console.log(JSON.stringify(result, null, 2))

await browser.close()
await server.close()
process.exit(0)
