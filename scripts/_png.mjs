// Throwaway minimal PNG reader for measurement scripts (8-bit, non-interlaced).
import fs from 'node:fs'
import zlib from 'node:zlib'

export function readPNG(file) {
  const buf = fs.readFileSync(file)
  let p = 8
  let w = 0, h = 0, bitDepth = 0, colorType = 0
  const chunks = []
  while (p < buf.length) {
    const len = buf.readUInt32BE(p)
    const type = buf.toString('ascii', p + 4, p + 8)
    const data = buf.subarray(p + 8, p + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4)
      bitDepth = data[8]; colorType = data[9]
    } else if (type === 'IDAT') chunks.push(data)
    else if (type === 'IEND') break
    p += 12 + len
  }
  if (bitDepth !== 8) throw new Error('bit depth ' + bitDepth)
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType]
  if (!ch) throw new Error('color type ' + colorType)
  const raw = zlib.inflateSync(Buffer.concat(chunks))
  const stride = w * ch
  const out = Buffer.alloc(h * stride)
  let q = 0
  for (let y = 0; y < h; y++) {
    const f = raw[q++]
    const line = raw.subarray(q, q + stride); q += stride
    const o = y * stride
    const prev = o - stride
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? out[o + x - ch] : 0
      const b = y > 0 ? out[prev + x] : 0
      const c = x >= ch && y > 0 ? out[prev + x - ch] : 0
      let v = line[x]
      if (f === 1) v += a
      else if (f === 2) v += b
      else if (f === 3) v += (a + b) >> 1
      else if (f === 4) {
        const pp = a + b - c
        const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      out[o + x] = v & 255
    }
  }
  const lum = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const o = i * ch
    lum[i] = ch >= 3
      ? (0.2126 * out[o] + 0.7152 * out[o + 1] + 0.0722 * out[o + 2]) / 255
      : out[o] / 255
  }
  return { w, h, ch, data: out, lum }
}

export function writePNG(file, w, h, rgb) {
  const stride = w * 3
  const raw = Buffer.alloc(h * (stride + 1))
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  const crcT = []
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0 }
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td))
    return Buffer.concat([len, td, c])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]))
}
