// Throwaway: luminance stats (median, p90, min, max) for a rectangular crop.
// usage: node scripts/_stats.mjs file.png x0frac y0frac x1frac y1frac
import { readPNG } from './_png.mjs'

const [file, x0f, y0f, x1f, y1f] = process.argv.slice(2)
const img = readPNG(file)
const x0 = Math.round(+x0f * img.w), x1 = Math.round(+x1f * img.w)
const y0 = Math.round(+y0f * img.h), y1 = Math.round(+y1f * img.h)
const vals = []
for (let y = y0; y < y1; y++) {
  for (let x = x0; x < x1; x++) vals.push(img.lum[y * img.w + x] * 255)
}
vals.sort((a, b) => a - b)
const pct = (p) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))]
console.log(`${file}  crop ${x0},${y0}..${x1},${y1} (n=${vals.length})`)
console.log(`  min=${vals[0].toFixed(1)} p10=${pct(0.1).toFixed(1)} median=${pct(0.5).toFixed(1)} p90=${pct(0.9).toFixed(1)} max=${vals[vals.length - 1].toFixed(1)}`)
