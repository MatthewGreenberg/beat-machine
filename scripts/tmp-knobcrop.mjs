#!/usr/bin/env node
// throwaway: write a normalised crop of a PNG out at a fixed size for eyeballing.
// usage: node scripts/tmp-knobcrop.mjs x0,y0,x1,y1 out.png in.png [outSize]
import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'

const [box, out, file, sizeArg] = process.argv.slice(2)
const [x0, y0, x1, y1] = box.split(',').map(Number)
const size = Number(sizeArg || 700)

const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto('about:blank')
const b64 = readFileSync(file).toString('base64')
const data = await page.evaluate(async ({ b64, x0, y0, x1, y1, size }) => {
  const img = new Image()
  img.src = 'data:image/png;base64,' + b64
  await img.decode()
  const W = img.naturalWidth, H = img.naturalHeight
  const sx = Math.round(x0 * W), sy = Math.round(y0 * H)
  const sw = Math.round((x1 - x0) * W), sh = Math.round((y1 - y0) * H)
  const c = document.createElement('canvas')
  c.width = size
  c.height = Math.round(size * sh / sw)
  const g = c.getContext('2d')
  g.imageSmoothingQuality = 'high'
  g.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height)
  return { url: c.toDataURL('image/png'), dims: [W, H, sw, sh] }
}, { b64, x0, y0, x1, y1, size })
console.log(file, data.dims.join('x'))
writeFileSync(out, Buffer.from(data.url.split(',')[1], 'base64'))
console.log(out)
await browser.close()
