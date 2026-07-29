// Throwaway: horizontal luminance profile across a band of rows.
// usage: node scripts/_scan.mjs file.png y0frac y1frac x0frac x1frac [cols]
import { readPNG } from './_png.mjs'

const [file, y0f, y1f, x0f, x1f, colsArg] = process.argv.slice(2)
const img = readPNG(file)
const y0 = Math.round(+y0f * img.h), y1 = Math.round(+y1f * img.h)
const x0 = Math.round(+x0f * img.w), x1 = Math.round(+x1f * img.w)
const cols = +(colsArg || 100)
const prof = []
for (let x = x0; x < x1; x++) {
  let s = 0
  for (let y = y0; y < y1; y++) s += img.lum[y * img.w + x]
  prof.push(s / (y1 - y0))
}
console.log(`${file} ${img.w}x${img.h}  rows ${y0}..${y1}  cols ${x0}..${x1} (n=${prof.length})`)
// downsample to `cols` buckets for a readable ascii plot
const ramp = ' .:-=+*#%@'
let line = ''
const step = prof.length / cols
for (let i = 0; i < cols; i++) {
  const v = prof[Math.floor(i * step)]
  line += ramp[Math.min(9, Math.max(0, Math.round(v * 9)))]
}
console.log(line)
console.log(prof.map((v, i) => (i % 1 === 0 ? v.toFixed(3) : '')).join(' '))
