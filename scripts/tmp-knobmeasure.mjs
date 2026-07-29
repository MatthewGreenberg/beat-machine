#!/usr/bin/env node
// throwaway: crop a normalised region from PNGs and report luminance stats.
// usage: node scripts/tmp-knobmeasure.mjs x0,y0,x1,y1 file.png [file2.png ...]
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'

const [box, ...files] = process.argv.slice(2)
const [x0, y0, x1, y1] = box.split(',').map(Number)

const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto('about:blank')

for (const f of files) {
  const b64 = readFileSync(f).toString('base64')
  const r = await page.evaluate(async ({ b64, x0, y0, x1, y1 }) => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + b64
    await img.decode()
    const W = img.naturalWidth, H = img.naturalHeight
    const cx0 = Math.round(x0 * W), cx1 = Math.round(x1 * W)
    const cy0 = Math.round(y0 * H), cy1 = Math.round(y1 * H)
    const w = cx1 - cx0, h = cy1 - cy0
    const c = document.createElement('canvas')
    c.width = w; c.height = h
    const g = c.getContext('2d', { willReadFrequently: true })
    g.drawImage(img, cx0, cy0, w, h, 0, 0, w, h)
    const d = g.getImageData(0, 0, w, h).data
    const lum = []
    let rs = 0, gs = 0, bs = 0
    for (let i = 0; i < w * h; i++) {
      const R = d[i * 4], G = d[i * 4 + 1], B = d[i * 4 + 2]
      rs += R; gs += G; bs += B
      lum.push(0.2126 * R + 0.7152 * G + 0.0722 * B)
    }
    const sorted = [...lum].sort((a, b) => a - b)
    const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
    const mean = lum.reduce((a, b) => a + b, 0) / lum.length
    const sd = Math.sqrt(lum.reduce((a, b) => a + (b - mean) ** 2, 0) / lum.length)
    // 12-bucket histogram
    const hist = new Array(12).fill(0)
    for (const l of lum) hist[Math.min(11, Math.floor(l / 256 * 12))]++
    // row means (10 bands top->bottom) to see depth planes
    const bands = []
    for (let k = 0; k < 10; k++) {
      let s = 0, n = 0
      for (let y = Math.floor(k * h / 10); y < Math.floor((k + 1) * h / 10); y++)
        for (let x = 0; x < w; x++) { s += lum[y * w + x]; n++ }
      bands.push(s / n)
    }
    return {
      size: [W, H, w, h], mean, sd,
      p05: q(0.05), p25: q(0.25), p50: q(0.5), p75: q(0.75), p95: q(0.95), max: sorted[sorted.length - 1],
      rgb: [rs / lum.length, gs / lum.length, bs / lum.length],
      hist: hist.map((v) => +(v / lum.length * 100).toFixed(1)),
      bands: bands.map((v) => +v.toFixed(1)),
    }
  }, { b64, x0, y0, x1, y1 })
  const f2 = (n) => (+n).toFixed(1)
  console.log(`\n${f}  [${r.size[0]}x${r.size[1]} crop ${r.size[2]}x${r.size[3]}]`)
  console.log(`  mean ${f2(r.mean)}  sd ${f2(r.sd)}  p05 ${f2(r.p05)} p25 ${f2(r.p25)} p50 ${f2(r.p50)} p75 ${f2(r.p75)} p95 ${f2(r.p95)} max ${f2(r.max)}`)
  console.log(`  rgb  ${r.rgb.map(f2).join(' / ')}`)
  console.log(`  hist ${r.hist.join(' ')}`)
  console.log(`  rows ${r.bands.join(' ')}`)
}
await browser.close()
