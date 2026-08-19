import * as THREE from 'three'
import { canvas, toTexture, memo, blotchCanvas, scratchCanvas, noiseCanvas, withBlur } from './textures'
import { CAP_UV } from './keycapGeometry'
import { COARSE } from './quality'

// Cap "finishes" — a colour/legend map baked per legend string, plus shared
// roughness and normal detail so every cap on the board feels like the same
// batch of second-hand plastic.
//
// Two finishes exist. `abs` is the aged cream: unevenly yellowed, greasy and
// polished where thumbs land, dirty in the rim gutter and corners, with a thin
// clearcoat so the polished centre throws a small hard specular. `rubber` is the
// charcoal modifier plastic: no clearcoat, coarser grain, a soft sheen that
// wraps the shoulders instead of a hotspot. Choosing between them is automatic
// from the base colour, so callers don't have to say.

const S = 512

// --- deterministic noise ----------------------------------------------------
// Wear must be identical on every reload; screenshots are how this scene is
// judged and a reshuffled scuff pattern reads as a regression.
function hash(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}
function mulberry(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function luminance(c) {
  const col = new THREE.Color(c)
  return 0.2126 * col.r + 0.7152 * col.g + 0.0722 * col.b
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath()
  g.roundRect(x, y, w, h, r)
}

// --- wear ------------------------------------------------------------------

// Only the true vertical WALL is allowed to go dark. The chamfer between the
// wall and the dished face is the brightest band on a real cap — it is the one
// surface whose normal points back at the key — so painting it with the wall's
// multiply (which is what a face rect at 0.13 used to do) is what collapsed the
// whole rim into a soft dark nothing and left the caps floating in moats.
//
// The rect therefore runs to `CAP_UV.wall`, the wall/chamfer crease, and the
// falloff is tight: the wall band is only ~3% of the map wide, so a 2.8% blur
// smeared half the step onto the chamfer.
function shadeWall(g, wall, light, edge) {
  const [mc, mg] = canvas(S)
  mg.fillStyle = light ? '#6b5f4c' : '#6a666e'
  mg.fillRect(0, 0, S, S)
  withBlur(mg, Math.max(2, Math.round(S * 0.008)), (bg) => {
    bg.fillStyle = '#ffffff'
    roundRect(bg, wall.x, wall.y, wall.w, wall.h, wall.r)
    bg.fill()
  })

  g.save()
  g.globalCompositeOperation = 'multiply'
  g.globalAlpha = light ? Math.min(1, edge * 1.15) : edge * 0.6
  g.drawImage(mc, 0, 0)
  g.restore()
}

function drawWear(g, o, rand) {
  const { grime = 0.18, edge = 0.5, inset = CAP_UV.face, light = true } = o
  const m = inset * S
  // `face` is the rim crease (dirt packs in it); `wall` is the outer crease,
  // below which the geometry turns vertical.
  const face = { x: m, y: m, w: S - m * 2, h: S - m * 2, r: S * 0.13 }
  const wm = (o.wallInset ?? CAP_UV.wall) * S
  const wall = { x: wm, y: wm, w: S - wm * 2, h: S - wm * 2, r: S * 0.1 }
  const cx = S / 2
  const cy = S / 2

  // greasy polished centre — hands rub the middle bright and slightly warm
  const polish = g.createRadialGradient(cx, cy * 1.02, 0, cx, cy, S * 0.46)
  polish.addColorStop(0, light ? 'rgba(255,251,241,0.15)' : 'rgba(196,198,206,0.09)')
  polish.addColorStop(0.6, light ? 'rgba(255,249,238,0.06)' : 'rgba(184,186,194,0.035)')
  polish.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = polish
  g.fillRect(0, 0, S, S)

  shadeWall(g, wall, light, edge)

  // The chamfer is burnished back to bare plastic: fingernails and shirt cuffs
  // ride the rim every day, so it never yellows and never holds grime. That
  // lighter albedo is the other half of why the reference's rim out-reads its
  // own face — geometry alone only buys ~25% and the reference is at ~48%.
  const cham = (CAP_UV.wall + CAP_UV.face) / 2
  withBlur(g, Math.max(2, Math.round(S * 0.01)), (bg) => {
    bg.strokeStyle = light
      ? `rgba(255,252,243,${0.34 + edge * 0.22})`
      : `rgba(158,160,168,${0.16 + edge * 0.12})`
    bg.lineWidth = (CAP_UV.face - CAP_UV.wall) * S * 1.15
    roundRect(bg, cham * S, cham * S, S * (1 - cham * 2), S * (1 - cham * 2), S * 0.11)
    bg.stroke()
  })

  // dirt collects in the gutter right at the rim crease, and packs into the
  // corners. It sits just *inside* the face rim so it never touches the chamfer.
  withBlur(g, Math.round(S * 0.014), (bg) => {
    bg.strokeStyle = light ? `rgba(52,41,29,${0.15 + edge * 0.13})` : `rgba(14,13,14,${0.15 + edge * 0.13})`
    bg.lineWidth = S * 0.022
    roundRect(bg, face.x + S * 0.016, face.y + S * 0.016, face.w - S * 0.032, face.h - S * 0.032, face.r)
    bg.stroke()
    const corners = [[face.x, face.y], [face.x + face.w, face.y], [face.x, face.y + face.h], [face.x + face.w, face.y + face.h]]
    for (const [x, y] of corners) {
      const a = 0.1 + rand() * 0.12
      bg.fillStyle = light ? `rgba(48,37,25,${a})` : `rgba(10,10,12,${a})`
      bg.beginPath()
      bg.ellipse(x, y, S * (0.055 + rand() * 0.04), S * (0.055 + rand() * 0.04), 0, 0, 6.29)
      bg.fill()
    }
  })

  // grime blotches — uneven handling, not a uniform tint
  withBlur(g, Math.round(S * 0.034), (bg) => {
    for (let i = 0; i < 26; i++) {
      const x = rand() * S
      const y = rand() * S
      // The centre gets wiped clean and grime survives toward the rim — but it
      // stops AT the rim crease. Past that is the burnished chamfer, and letting
      // blotches run out over it was quietly re-darkening the band that shadeWall
      // and the polish stroke had just been fixed to leave alone.
      const away = Math.max(Math.abs(x - cx), Math.abs(y - cy)) / (S / 2)
      const rimA = 1 - 2 * inset
      const fall = away > rimA ? Math.max(0.1, 1 - (away - rimA) / (1 - rimA)) : 1
      bg.globalAlpha = grime * (0.08 + 0.92 * Math.min(1, (away / rimA) * 1.35) ** 1.7) * fall
      const r = S * (0.03 + rand() * 0.13)
      bg.fillStyle = rand() > 0.45
        ? (light ? '#4c4030' : '#191a1e')
        : (light ? '#f6f2e8' : '#8e9098')
      bg.beginPath()
      bg.ellipse(x, y, r, r * (0.6 + rand()), rand() * 3.14, 0, 6.29)
      bg.fill()
    }
  })

  // hairline scuffs, biased to the wipe direction of a thumb
  for (let i = 0; i < 46; i++) {
    const x = rand() * S
    const y = rand() * S
    const len = S * (0.03 + rand() * 0.24)
    const a = (rand() - 0.5) * 1.1 + (rand() < 0.25 ? 1.57 : 0)
    const bright = rand() < 0.3
    g.strokeStyle = bright
      ? `rgba(255,252,244,${0.05 + rand() * 0.1})`
      : `rgba(52,42,32,${0.05 + rand() * 0.15})`
    g.lineWidth = rand() < 0.8 ? 0.8 : 1.7
    g.beginPath()
    g.moveTo(x, y)
    g.quadraticCurveTo(
      x + Math.cos(a) * len * 0.5 + (rand() - 0.5) * 7,
      y + Math.sin(a) * len * 0.5 + (rand() - 0.5) * 7,
      x + Math.cos(a) * len,
      y + Math.sin(a) * len,
    )
    g.stroke()
  }

  // tiny nicks on the rim — knocked plastic shows a lighter unweathered core
  for (let i = 0; i < 13; i++) {
    const t = rand() * 4
    const s = rand()
    const side = Math.floor(t)
    const px = side === 0 ? face.x + face.w * s : side === 1 ? face.x + face.w : side === 2 ? face.x + face.w * s : face.x
    const py = side === 0 ? face.y : side === 1 ? face.y + face.h * s : side === 2 ? face.y + face.h : face.y + face.h * s
    const r = S * (0.004 + rand() * 0.009)
    g.fillStyle = rand() < 0.6
      ? (light ? `rgba(255,253,246,${0.18 + rand() * 0.24})` : `rgba(150,150,158,${0.12 + rand() * 0.2})`)
      : `rgba(30,24,18,${0.16 + rand() * 0.22})`
    g.beginPath()
    g.ellipse(px, py, r, r * (0.6 + rand() * 0.8), rand() * 3.14, 0, 6.29)
    g.fill()
  }
}

// Plastic yellows unevenly — UV, cigarette smoke, whatever this thing lived
// through. Big soft warm patches under the print, never a flat tint.
function drawAging(g, base, amount, rand) {
  if (amount <= 0) return
  // an already-saturated cap (the tan one) must not be pushed further; only
  // near-neutral plastic reads as *yellowed* rather than just orange
  const hsl = new THREE.Color(base).getHSL({})
  const warmK = hsl.s > 0.22 ? 0.25 : 1
  withBlur(g, Math.round(S * 0.13), (bg) => {
    for (let i = 0; i < 9; i++) {
      const x = rand() * S
      const y = rand() * S
      const r = S * (0.16 + rand() * 0.3)
      bg.fillStyle = rand() > 0.4
        ? `rgba(${198 + rand() * 24 | 0},${176 + rand() * 22 | 0},130,${(0.02 + rand() * 0.035) * amount * warmK})`
        : `rgba(230,232,238,${(0.02 + rand() * 0.04) * amount})`
      bg.beginPath()
      bg.ellipse(x, y, r, r * (0.7 + rand() * 0.7), rand() * 3.14, 0, 6.29)
      bg.fill()
    }
  })
  // one edge of the cap always cops more sun than the other
  const g2 = g.createLinearGradient(0, 0, S * 0.7, S)
  g2.addColorStop(0, `rgba(210,186,134,${0.045 * amount * warmK})`)
  g2.addColorStop(1, 'rgba(180,178,172,0)')
  g.fillStyle = g2
  g.fillRect(0, 0, S, S)
}

// The legends are pad-printed and half worn off: eroded ink, a hair of print
// misregistration, never crisp vector type.
function drawLegend(g, legend, opts, rand) {
  const [lc, lg] = canvas(S)
  if (typeof legend === 'function') {
    legend(lg, S)
  } else {
    lg.fillStyle = opts.ink ?? 'rgba(24,20,18,0.9)'
    lg.font = `${opts.weight ?? 400} ${opts.size ?? 210}px ${opts.font ?? '"Helvetica Neue", Arial'}`
    lg.textAlign = 'center'
    lg.textBaseline = 'middle'
    lg.save()
    lg.translate(S / 2, S * (opts.y ?? 0.5))
    lg.rotate(opts.rot ?? 0)
    lg.fillText(legend, 0, 0)
    lg.restore()
  }

  // ink breakup — speckle the print away, plus a couple of wipe streaks
  const wear = opts.inkWear ?? 0.45
  lg.globalCompositeOperation = 'destination-out'
  withBlur(lg, 1.4, (bg) => {
    for (let i = 0; i < 150 * wear; i++) {
      const r = S * (0.004 + rand() * 0.016)
      bg.fillStyle = `rgba(0,0,0,${0.25 + rand() * 0.6})`
      bg.beginPath()
      bg.ellipse(rand() * S, rand() * S, r, r * (0.5 + rand()), rand() * 3.14, 0, 6.29)
      bg.fill()
    }
  })
  for (let i = 0; i < 3; i++) {
    const y = rand() * S
    lg.strokeStyle = `rgba(0,0,0,${0.2 + rand() * 0.45})`
    lg.lineWidth = 1 + rand() * 3.5
    lg.beginPath()
    lg.moveTo(-10, y)
    lg.quadraticCurveTo(S * 0.5, y + (rand() - 0.5) * 60, S + 10, y + (rand() - 0.5) * 40)
    lg.stroke()
  }
  lg.globalCompositeOperation = 'source-over'

  g.save()
  g.globalAlpha = opts.inkAlpha ?? 1
  // print misregistration: a fraction of a degree and a fraction of a mm
  g.translate(S / 2 + (rand() - 0.5) * 5, S / 2 + (rand() - 0.5) * 5)
  g.rotate((rand() - 0.5) * 0.02)
  g.drawImage(lc, -S / 2, -S / 2)
  g.restore()
}

function drawCleanLegend(g, legend, opts) {
  if (typeof legend === 'function') {
    legend(g, S)
    return
  }

  g.fillStyle = opts.ink ?? 'rgba(24,20,18,0.9)'
  g.font = `${opts.weight ?? 400} ${opts.size ?? 210}px ${opts.font ?? '"Helvetica Neue", Arial'}`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.save()
  g.translate(S / 2, S * (opts.y ?? 0.5))
  g.rotate(opts.rot ?? 0)
  g.fillText(legend, 0, 0)
  g.restore()
}

// A legend is drawn by a callback so callers can do glyphs, engravings or art.
export function capColorMap(base, legend, opts = {}) {
  const key = `cap:${base}:${opts.key ?? legend ?? ''}:${opts.grime ?? ''}:${opts.clean ? 'clean' : 'worn'}`
  return memo(key, () => {
    // The cache key can change with a dynamic legend while wearKey remains
    // tied to the physical cap. That lets a pad swap 0/1 printing without its
    // underlying stains, scratches, yellowing, or chipped edges reshuffling.
    const rand = mulberry(hash(opts.wearKey ?? key))
    const light = opts.light ?? luminance(base) > 0.22
    const [c, g] = canvas(S)
    g.fillStyle = base
    g.fillRect(0, 0, S, S)
    if (opts.clean) {
      if (legend) drawCleanLegend(g, legend, opts)
      return toTexture(c, { srgb: true })
    }
    drawAging(g, base, opts.age ?? (light ? 1 : 0.3), rand)
    if (legend) drawLegend(g, legend, opts, rand)
    drawWear(g, { ...opts, light }, rand)
    return toTexture(c, { srgb: true })
  })
}

// --- shared surface detail --------------------------------------------------

export const capRoughness = (finish = 'abs') =>
  memo(`cap:rough:${finish}`, () => {
    const rubber = finish === 'rubber'
    const [c, g] = canvas(S)
    g.fillStyle = rubber ? '#d2d2d2' : '#b8b8b8'
    g.fillRect(0, 0, S, S)
    g.globalAlpha = rubber ? 0.4 : 0.55
    g.drawImage(blotchCanvas(S, 34, 30, 0.7), 0, 0)
    g.globalAlpha = rubber ? 0.18 : 0.35
    g.drawImage(scratchCanvas(S, 70, 0.6), 0, 0)
    g.globalAlpha = 1
    if (!rubber) {
      // polished centre = smoother; rubber caps never take a shine. Kept modest
      // on purpose — a hard shine in the middle of the face competes with the
      // rim, and the rim has to win.
      const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S * 0.36)
      grad.addColorStop(0, 'rgba(56,56,56,0.42)')
      grad.addColorStop(1, 'rgba(0,0,0,0)')
      g.fillStyle = grad
      g.fillRect(0, 0, S, S)
      // The rim chamfer is the SMOOTHEST part of a used cap, not the roughest:
      // it is the edge fingernails and shirt cuffs burnish every day, and it is
      // why the reference's rim reads as a hard blown specular stripe rather
      // than a diffuse band. Stroke it dark (low roughness).
      const cham = (CAP_UV.wall + CAP_UV.face) / 2
      withBlur(g, Math.max(2, Math.round(S * 0.008)), (bg) => {
        bg.strokeStyle = 'rgba(0,0,0,0.62)'
        bg.lineWidth = (CAP_UV.face - CAP_UV.wall) * S * 1.05
        roundRect(bg, cham * S, cham * S, S * (1 - cham * 2), S * (1 - cham * 2), S * 0.11)
        bg.stroke()
        // the added roughness belongs out on the wall, which is never touched and
        // still carries its mould texture and grime
        bg.strokeStyle = 'rgba(255,255,255,0.55)'
        bg.lineWidth = CAP_UV.wall * S * 1.4
        roundRect(bg, CAP_UV.wall * S * 0.4, CAP_UV.wall * S * 0.4,
          S * (1 - CAP_UV.wall * 0.8), S * (1 - CAP_UV.wall * 0.8), S * 0.09)
        bg.stroke()
      })
    }
    return toTexture(c)
  })

export const capNormal = (finish = 'abs') =>
  memo(`cap:normal:${finish}`, () => {
    const rubber = finish === 'rubber'
    // Moulded plastic is *smooth*; the only surface relief is a tight grain plus
    // whatever the wipe cloth left. A blotchy low-frequency heightfield here
    // (the old behaviour) turns every cap into a marbled pebble.
    const [hc, hg] = canvas(S)
    hg.drawImage(noiseCanvas(S, 1, rubber ? 0.5 : 0.3), 0, 0)
    withBlur(hg, rubber ? 0.7 : 1.3, (bg) => bg.drawImage(hc, 0, 0))
    hg.globalAlpha = 0.28
    hg.drawImage(scratchCanvas(S, 60, 0.4), 0, 0)
    hg.globalAlpha = 1
    const data = hg.getImageData(0, 0, S, S).data
    const [c, g] = canvas(S)
    const out = g.createImageData(S, S)
    const amp = rubber ? 26 : 14
    const at = (x, y) => data[((y & (S - 1)) * S + (x & (S - 1))) * 4]
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const dx = (at(x + 1, y) - at(x - 1, y)) / 255
        const dy = (at(x, y + 1) - at(x, y - 1)) / 255
        const i = (y * S + x) * 4
        out.data[i] = 128 - dx * amp
        out.data[i + 1] = 128 - dy * amp
        out.data[i + 2] = 255
        out.data[i + 3] = 255
      }
    }
    g.putImageData(out, 0, 0)
    return toTexture(c)
  })

// --- material ---------------------------------------------------------------

const matCache = new Map()

export function capMaterial({
  color = '#ffffff',
  map,
  roughness = 0.62,
  metalness = 0.05,
  finish,                 // 'abs' | 'rubber' — inferred from colour if unset
  ...rest
}) {
  const f = finish ?? (luminance(color) > 0.22 ? 'abs' : 'rubber')
  const key = `${color}|${map?.uuid ?? '-'}|${roughness}|${metalness}|${f}|${Object.keys(rest).join(',')}`
  if (matCache.has(key) && !Object.keys(rest).length) return matCache.get(key)

  const rubber = f === 'rubber'
  const m = new THREE.MeshPhysicalMaterial({
    color,
    map,
    // Mobile ships clean caps (see finishes.js): the blotchy wear roughness
    // reads as splotches at phone size, and skipping the maps also skips the
    // per-pixel normal bake at startup.
    roughnessMap: COARSE ? null : capRoughness(f),
    roughness,
    metalness,
    normalMap: COARSE ? null : capNormal(f),
    normalScale: new THREE.Vector2(rubber ? 0.55 : 0.3, rubber ? 0.55 : 0.3),
    // aged ABS keeps a thin greasy film; rubber-feel plastic has none
    clearcoat: rubber ? 0 : 0.28,
    clearcoatRoughness: rubber ? 1 : 0.5,
    // dark rubber picks up its shape from a broad sheen, not a hotspot
    sheen: rubber ? 0.5 : 0.12,
    sheenRoughness: rubber ? 0.85 : 0.6,
    sheenColor: new THREE.Color(rubber ? '#9aa2b4' : '#fff0d8'),
    ...rest,
  })
  if (!Object.keys(rest).length) matCache.set(key, m)
  return m
}
