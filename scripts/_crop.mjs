// node scripts/_crop.mjs in.png out.png x0 y0 x1 y1 [scale]  (fractions)
import { readPNG, writePNG } from './_png.mjs'
const [inf, outf, a, b, c, d, sc] = process.argv.slice(2)
const img = readPNG(inf)
const x0 = Math.round(+a * img.w), y0 = Math.round(+b * img.h)
const x1 = Math.round(+c * img.w), y1 = Math.round(+d * img.h)
const s = Math.max(1, Math.round(+(sc || 1)))
const w = (x1 - x0) * s, h = (y1 - y0) * s
const out = Buffer.alloc(w * h * 3)
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const sx = x0 + Math.floor(x / s), sy = y0 + Math.floor(y / s)
  const so = (sy * img.w + sx) * img.ch, o = (y * w + x) * 3
  out[o] = img.data[so]; out[o + 1] = img.data[so + (img.ch >= 3 ? 1 : 0)]; out[o + 2] = img.data[so + (img.ch >= 3 ? 2 : 0)]
}
writePNG(outf, w, h, out)
console.log(outf, w + 'x' + h)
