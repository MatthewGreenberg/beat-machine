// Throwaway rim/seam metrics. usage:
//   node scripts/_rim.mjs file.png y0 y1 x0 x1   (fractions)
import { readPNG } from './_png.mjs'

const [file, y0f, y1f, x0f, x1f] = process.argv.slice(2)
const img = readPNG(file)
const y0 = Math.round(+y0f * img.h), y1 = Math.round(+y1f * img.h)
const x0 = Math.round(+x0f * img.w), x1 = Math.round(+x1f * img.w)
const p = []
for (let x = x0; x < x1; x++) {
  let s = 0
  for (let y = y0; y < y1; y++) s += img.lum[y * img.w + x]
  p.push(s / (y1 - y0))
}
const max = Math.max(...p)
// seams: contiguous runs below 45% of max that contain a sample below 25%
const runs = []
let cur = null
for (let i = 0; i < p.length; i++) {
  if (p[i] < 0.45 * max) { if (!cur) cur = { a: i, b: i, min: p[i] }; cur.b = i; cur.min = Math.min(cur.min, p[i]) }
  else if (cur) { runs.push(cur); cur = null }
}
if (cur) runs.push(cur)
const seams = runs.filter((r) => r.min < 0.25 * max && r.a > 0 && r.b < p.length - 1)
const centres = seams.map((r) => (r.a + r.b) / 2)
const gaps = centres.slice(1).map((c, i) => c - centres[i])
gaps.sort((a, b) => a - b)
const pitch = gaps.length ? gaps[Math.floor(gaps.length / 2)] : NaN

const rows = seams.map((r) => {
  const w25 = p.slice(r.a, r.b + 1).filter((v) => v < 0.25 * max).length
  const w45 = r.b - r.a + 1
  return { c: ((r.a + r.b) / 2).toFixed(0), min: r.min.toFixed(3), w25, w45, pct25: (100 * w25 / pitch).toFixed(1), pct45: (100 * w45 / pitch).toFixed(1) }
})

// per-cap: between consecutive seams, rim peak (max in outer 25% of the span) vs face (median of middle 40%)
const caps = []
for (let i = 0; i + 1 < centres.length; i++) {
  const a = Math.round(centres[i]), b = Math.round(centres[i + 1])
  const seg = p.slice(a, b)
  const n = seg.length
  const outer = [...seg.slice(Math.round(n * 0.06), Math.round(n * 0.3)), ...seg.slice(Math.round(n * 0.7), Math.round(n * 0.94))]
  const mid = seg.slice(Math.round(n * 0.35), Math.round(n * 0.65)).slice().sort((x, y) => x - y)
  const rim = Math.max(...outer)
  const face = mid[Math.floor(mid.length / 2)]
  caps.push({ rim: rim.toFixed(3), face: face.toFixed(3), ratio: (rim / face).toFixed(2) })
}
const duty = (t) => (100 * p.filter((v) => v > t * max).length / p.length).toFixed(1)
// rim geometry per cap: argmax within the outer thirds, and their separation
const rimGeo = []
for (let i = 0; i + 1 < centres.length; i++) {
  const a = Math.round(centres[i]), b = Math.round(centres[i + 1])
  const seg = p.slice(a, b); const n = seg.length
  let li = 0, lv = -1, ri = 0, rv = -1
  for (let k = Math.round(n * 0.03); k < n * 0.4; k++) if (seg[k] > lv) { lv = seg[k]; li = k }
  for (let k = Math.round(n * 0.6); k < n * 0.97; k++) if (seg[k] > rv) { rv = seg[k]; ri = k }
  rimGeo.push(`L@${(100 * li / n).toFixed(0)}%=${lv.toFixed(3)} R@${(100 * ri / n).toFixed(0)}%=${rv.toFixed(3)} span=${(100 * (ri - li) / n).toFixed(0)}%`)
}
console.log(`${file}  rows ${y0}..${y1} cols ${x0}..${x1}  max=${max.toFixed(3)}  pitch=${pitch}px`)
console.log(`duty >50%=${duty(0.5)}%  >65%=${duty(0.65)}%  >80%=${duty(0.8)}%`)
console.log('rims :', rimGeo.join('\n       '))
console.log('seams:', rows.map((r) => `@${r.c} min=${r.min} w<25%=${r.w25}px(${r.pct25}%) w<45%=${r.w45}px(${r.pct45}%)`).join('\n       '))
console.log('caps :', caps.map((c) => `rim=${c.rim} face=${c.face} rim/face=${c.ratio}`).join('\n       '))
