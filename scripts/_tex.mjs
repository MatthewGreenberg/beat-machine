import { chromium } from 'playwright'
import fs from 'node:fs'
const BASE = 'http://localhost:5199'
const b = await chromium.launch()
const page = await b.newPage()
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)
const out = await page.evaluate(async () => {
  const m = await import('/src/scene/capMaterials.js')
  const grab = (t) => (t.image?.toDataURL ? t.image.toDataURL() : null)
  return {
    color: grab(m.capColorMap('#efe9dc', '1', { key: 'step-1-0', size: 240, y: 0.53, ink: 'rgba(30,26,22,0.86)', grime: 0.16, edge: 0.5 })),
    rough: grab(m.capRoughness('abs')),
  }
})
for (const [k, v] of Object.entries(out)) {
  if (!v) { console.log(k, 'MISSING'); continue }
  fs.writeFileSync(`shots/_tex-${k}.png`, Buffer.from(v.split(',')[1], 'base64'))
  console.log('shots/_tex-' + k + '.png')
}
await b.close()
