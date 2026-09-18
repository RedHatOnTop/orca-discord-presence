import { chromium } from "playwright"
import path from "node:path"
import { fileURLToPath } from "node:url"

const dir = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(dir, "..")
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 720, height: 280 } })
await page.goto(`file://${root}/assets/preview.html`)
await page.screenshot({ path: `${root}/assets/preview.png` })
await browser.close()
