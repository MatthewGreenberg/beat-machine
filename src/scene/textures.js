import * as THREE from 'three'

// Procedural canvas textures — no external asset pipeline, everything is
// generated once at module scope and shared.
const cache = new Map()
export function memo(key, make) {
  if (!cache.has(key)) cache.set(key, make())
  return cache.get(key)
}

export function canvas(size = 512) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  return [c, c.getContext('2d')]
}

// Safari has never shipped CanvasRenderingContext2D.filter (WebKit bug
// 198416): every `g.filter = 'blur(…)'` silently no-ops there and the soft
// grime/wear blotches bake as hard-edged ellipses. Detect by actually
// blurring a pixel — property sniffing can't tell "parsed" from "works".
export const CANVAS_FILTER_OK = (() => {
  if (typeof document === 'undefined') return true
  const c = document.createElement('canvas')
  c.width = c.height = 8
  const g = c.getContext('2d')
  g.filter = 'blur(2px)'
  g.fillRect(3, 3, 2, 2)
  return g.getImageData(1, 4, 1, 1).data[3] > 0
})()

// Approximate gaussian: progressive half-res downscale then upscale — each
// bilinear resample is a small blur, and the chain compounds. All drawImage,
// so it stays GPU-side; a JS pixel-loop blur here cost ~2s of Safari startup
// across the ~160 texture bakes. Bake-time only, fallback-path only.
function approxBlurCanvas(c, g, radius) {
  const steps = Math.max(1, Math.round(Math.log2(Math.max(2, radius))))
  const chain = []
  let src = c
  let w = c.width
  let h = c.height
  for (let i = 0; i < steps; i++) {
    w = Math.max(1, Math.ceil(w / 2))
    h = Math.max(1, Math.ceil(h / 2))
    const t = document.createElement('canvas')
    t.width = w
    t.height = h
    const tg = t.getContext('2d')
    tg.imageSmoothingQuality = 'high'
    tg.drawImage(src, 0, 0, w, h)
    chain.push(t)
    src = t
  }
  // walk back up 2x per step — one giant upscale shows bilinear diamonds
  for (let i = chain.length - 2; i >= 0; i--) {
    const t = chain[i]
    const tg = t.getContext('2d')
    tg.save()
    tg.globalCompositeOperation = 'copy'
    tg.imageSmoothingQuality = 'high'
    tg.drawImage(src, 0, 0, t.width, t.height)
    tg.restore()
    src = t
  }
  g.save()
  g.globalCompositeOperation = 'copy'
  g.imageSmoothingQuality = 'high'
  g.drawImage(src, 0, 0, c.width, c.height)
  g.restore()
}

// Draw-with-blur: native ctx.filter where it works, temp-layer + box blur
// where it doesn't. The callback gets the context to draw into and must set
// its own styles; the layer composites back through g's current
// globalAlpha/composite op, so destination-out erasure etc. still works.
export function withBlur(g, radius, draw) {
  if (CANVAS_FILTER_OK) {
    g.filter = `blur(${radius}px)`
    draw(g)
    g.filter = 'none'
    return
  }
  const t = document.createElement('canvas')
  t.width = g.canvas.width
  t.height = g.canvas.height
  const tg = t.getContext('2d')
  draw(tg)
  approxBlurCanvas(t, tg, radius)
  g.drawImage(t, 0, 0)
}

export function toTexture(c, { srgb = false, repeat = 1, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(repeat, repeat)
  t.anisotropy = aniso
  t.needsUpdate = true
  return t
}

// Fine value noise, used as a base for roughness/wear maps.
export function noiseCanvas(size = 512, scale = 1, contrast = 1) {
  const [c, g] = canvas(size)
  const img = g.createImageData(size, size)
  for (let i = 0; i < size * size; i++) {
    const n = Math.random()
    const v = 128 + (n - 0.5) * 255 * contrast * scale
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v
    img.data[i * 4 + 3] = 255
  }
  g.putImageData(img, 0, 0)
  return c
}

// Blurred blotches — grime, uneven finish, mould-flow variation.
export function blotchCanvas(size = 512, count = 40, blur = 26, dark = 0.5) {
  const [c, g] = canvas(size)
  g.fillStyle = '#808080'
  g.fillRect(0, 0, size, size)
  withBlur(g, blur, (bg) => {
    for (let i = 0; i < count; i++) {
      const x = Math.random() * size
      const y = Math.random() * size
      const r = size * (0.04 + Math.random() * 0.16)
      const light = Math.random() > 0.5
      bg.fillStyle = light
        ? `rgba(255,255,255,${0.10 + Math.random() * 0.18})`
        : `rgba(0,0,0,${dark * (0.10 + Math.random() * 0.2)})`
      bg.beginPath()
      bg.ellipse(x, y, r, r * (0.5 + Math.random()), Math.random() * Math.PI, 0, Math.PI * 2)
      bg.fill()
    }
  })
  return c
}

// Rust blooms + paint chips/dings for beat-up painted metal. Mid-gray base so
// it can double as a bump map (dings read as depressions, rust as crust).
export function rustCanvas(size = 512, patches = 26, dings = 70, strength = 1) {
  const [c, g] = canvas(size)
  const k = Math.max(0, strength)
  g.fillStyle = '#808080'
  g.fillRect(0, 0, size, size)
  // all blooms in one blurred layer (one blur, not one per patch), then the
  // crusty speckle over the top
  const spots = Array.from({ length: patches }, () => ({
    x: Math.random() * size,
    y: Math.random() * size,
    r: size * (0.02 + Math.random() * 0.08),
  }))
  withBlur(g, 6, (bg) => {
    for (const { x, y, r } of spots) {
      bg.fillStyle = `rgba(${120 + Math.random() * 60 | 0},${55 + Math.random() * 30 | 0},${20 + Math.random() * 15 | 0},${(0.25 + Math.random() * 0.4) * k})`
      bg.beginPath()
      bg.ellipse(x, y, r, r * (0.4 + Math.random()), Math.random() * Math.PI, 0, Math.PI * 2)
      bg.fill()
    }
  })
  for (const { x, y, r } of spots) {
    for (let j = 0; j < 24; j++) {
      const a = Math.random() * Math.PI * 2
      const d = Math.random() * r
      g.fillStyle = `rgba(${90 + Math.random() * 70 | 0},${40 + Math.random() * 30 | 0},15,${(0.3 + Math.random() * 0.5) * k})`
      g.fillRect(x + Math.cos(a) * d, y + Math.sin(a) * d, 1 + Math.random() * 2, 1 + Math.random() * 2)
    }
  }
  // dings: small dark chips with a bright catch-light lip
  for (let i = 0; i < dings; i++) {
    const x = Math.random() * size
    const y = Math.random() * size
    const r = 1 + Math.random() * 3.5
    g.fillStyle = `rgba(20,18,16,${(0.5 + Math.random() * 0.4) * k})`
    g.beginPath()
    g.arc(x, y, r, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = `rgba(255,255,255,${(0.25 + Math.random() * 0.3) * k})`
    g.beginPath()
    g.arc(x - r * 0.4, y - r * 0.4, r * 0.5, 0, Math.PI * 2)
    g.fill()
  }
  return c
}

// Hairline scratches for worn plastic / anodised metal.
export function scratchCanvas(size = 512, count = 90, opacity = 0.5) {
  const [c, g] = canvas(size)
  g.fillStyle = '#808080'
  g.fillRect(0, 0, size, size)
  for (let i = 0; i < count; i++) {
    const x = Math.random() * size
    const y = Math.random() * size
    const len = size * (0.02 + Math.random() * 0.3)
    const a = Math.random() * Math.PI * 2
    g.strokeStyle = Math.random() > 0.4
      ? `rgba(255,255,255,${opacity * Math.random() * 0.6})`
      : `rgba(0,0,0,${opacity * Math.random() * 0.5})`
    g.lineWidth = Math.random() < 0.85 ? 0.7 : 1.6
    g.beginPath()
    g.moveTo(x, y)
    g.quadraticCurveTo(
      x + Math.cos(a) * len * 0.5 + (Math.random() - 0.5) * 8,
      y + Math.sin(a) * len * 0.5 + (Math.random() - 0.5) * 8,
      x + Math.cos(a) * len,
      y + Math.sin(a) * len,
    )
    g.stroke()
  }
  return c
}

// Transparent, directional scratches for a painted metal faceplate. Each mark
// has a dark groove and a slightly offset bright lip, so the damage reads as a
// cut through paint instead of a gray line printed on top. A local seeded PRNG
// keeps the wear pattern stable between reloads and screenshot passes.
export function plateScratchOverlayCanvas(width = 1024, height = 552) {
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  const g = c.getContext('2d')
  let seed = 0x6b34a1f2
  const random = () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = seed
    t = Math.imul(t ^ (t >>> 15), 1 | t)
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  const stroke = (x, y, length, angle, weight, strength) => {
    const dx = Math.cos(angle) * length
    const dy = Math.sin(angle) * length
    const bend = (random() - 0.5) * Math.min(15, length * 0.12)
    const nx = -Math.sin(angle)
    const ny = Math.cos(angle)

    const path = (offset = 0) => {
      g.beginPath()
      g.moveTo(x + nx * offset, y + ny * offset)
      g.quadraticCurveTo(
        x + dx * 0.48 + nx * (bend + offset),
        y + dy * 0.48 + ny * (bend + offset),
        x + dx + nx * offset,
        y + dy + ny * offset,
      )
      g.stroke()
    }

    // Oxidised/grimy floor of the cut.
    g.lineCap = 'round'
    g.strokeStyle = `rgba(35,28,24,${0.24 + strength * 0.5})`
    g.lineWidth = weight
    path()

    // Exposed metal on the upper edge catches the key light.
    g.strokeStyle = `rgba(232,225,207,${0.16 + strength * 0.46})`
    g.lineWidth = Math.max(0.45, weight * 0.36)
    path(-Math.max(0.65, weight * 0.42))

    // Deep scratches occasionally tear a fleck of paint loose at one end.
    if (weight > 1.6 && random() > 0.42) {
      g.fillStyle = `rgba(50,35,26,${0.32 + strength * 0.34})`
      g.beginPath()
      g.ellipse(x + dx, y + dy, weight * 1.3, weight * 0.72, angle, 0, Math.PI * 2)
      g.fill()
    }
  }

  // Handling scuffs mostly follow the plate's horizontal brushing direction,
  // with a minority of crossed marks from tools and loose hardware.
  for (let i = 0; i < 115; i++) {
    const x = width * (0.025 + random() * 0.91)
    const y = height * (0.04 + random() * 0.9)
    const crossed = random() < 0.2
    const angle = crossed
      ? (-0.85 + random() * 1.7)
      : (-0.16 + random() * 0.32)
    stroke(
      x,
      y,
      width * (0.012 + random() ** 2 * 0.09),
      angle,
      random() < 0.9 ? 0.7 : 1.15,
      0.08 + random() * 0.22,
    )
  }

  // A few authored gouges guarantee readable accents in the open strips around
  // the knob, labels, and display instead of leaving placement entirely to luck.
  const gouges = [
    [0.06, 0.16, 0.105, 0.12],
    [0.31, 0.11, 0.085, -0.09],
    [0.57, 0.2, 0.072, 0.2],
    [0.79, 0.12, 0.11, -0.05],
    [0.12, 0.83, 0.082, -0.15],
    [0.45, 0.88, 0.115, 0.08],
    [0.72, 0.82, 0.09, -0.12],
    [0.88, 0.68, 0.075, 0.34],
    [0.52, 0.48, 0.064, -0.42],
  ]
  for (const [x, y, length, angle] of gouges) {
    stroke(x * width, y * height, length * width, angle, 1.7 + random() * 1.1, 0.55 + random() * 0.24)
  }

  // Curved rub marks from fingers/tools orbiting the rotary control.
  for (let i = 0; i < 7; i++) {
    g.strokeStyle = `rgba(45,34,28,${0.12 + random() * 0.12})`
    g.lineWidth = 0.7 + random() * 0.5
    g.beginPath()
    const start = 3.4 + random() * 0.8
    g.ellipse(
      width * 0.235,
      height * 0.52,
      width * (0.14 + i * 0.006),
      height * (0.29 + i * 0.009),
      -0.04,
      start,
      start + 0.35 + random() * 0.65,
    )
    g.stroke()
  }

  return c
}
