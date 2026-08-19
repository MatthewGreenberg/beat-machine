import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { RoundedBox } from '@react-three/drei'
import * as THREE from 'three'
import { actions, useStore } from '../state/store'
import { filterFrequency } from '../audio/engine'
import { FINISHES, getFinish } from '../finishes'
import { BODY_H, BODY_W, PLATE_H, PLATE_Z, TOP_Y } from './layout'
import { canvas as makeCanvas, memo, toTexture } from './textures'
import { capNormal, capRoughness } from './capMaterials'
import { useControls } from 'leva'

// Shared across all four faders — leva merges identical schemas into one panel.
const useFxPanelControls = () =>
  useControls('FX Panel', {
    // The glow is a drawn additive halo sprite, NOT threshold bloom: crossing
    // the 1.85 luminance threshold means ACES has already desaturated the
    // accent to pastel before any halo appears. Keep emissive moderate so the
    // core stays saturated; glowStrength scales the halo.
    fillEmissive: { value: 1.6, min: 0, max: 6, step: 0.1 },
    fillRoughness: { value: 0.2, min: 0, max: 1, step: 0.05 },
    glowStrength: { value: 0.9, min: 0, max: 2, step: 0.05 },
    indexRest: { value: 1.8, min: 0, max: 6, step: 0.1 },
    indexHover: { value: 3.5, min: 0, max: 8, step: 0.1 },
    hoverScale: { value: 1.07, min: 1, max: 1.25, step: 0.01 },
  })

const EDITOR_W = BODY_W - 0.48
const EDITOR_H = BODY_H - 0.5
// The editor glass sits nearly flush in the chassis face — the machine's own
// face becomes the screen. Floating it further out reads as a separate slab.
const SURFACE_Z = PLATE_Z + 0.26
const SOURCE_W = BODY_W - 4.7
const SOURCE_H = 2.5
const CLOSED_X = BODY_W / 2 - SOURCE_W / 2 - 0.55
const CLOSED_Y = TOP_Y - PLATE_H + 1.8
const SOURCE_Z = PLATE_Z + 0.17
const CLOSED_SCALE = [SOURCE_W / EDITOR_W, SOURCE_H / EDITOR_H]
// Vertical fader columns, one card per effect (hardware-plugin layout).
const FADERS = [
  { key: 'filter', label: 'FILTER', x: -3.675 },
  { key: 'drive', label: 'DRIVE', x: -1.225 },
  { key: 'delay', label: 'ECHO', x: 1.225 },
  { key: 'space', label: 'SPACE', x: 3.675 },
]
const TRACK_Y0 = -2.15 // bottom of travel
const TRACK_Y1 = 2.45  // top of travel
const TRACK_LEN = TRACK_Y1 - TRACK_Y0
const HIT_H = TRACK_LEN + 0.5
// Finish keys sit on the same x grid as the fader columns — the footer reads
// as another row of the layout instead of a floating strip.
const FINISH_POS = [-3.675, -1.225, 1.225, 3.675]

// Soft radial contact shadow shared by every fader cap — the single biggest
// "it's really sitting on the panel" cue. Max alpha is baked into the texture
// so the reveal cascade can drive material.opacity all the way to 1.
const capShadow = () => memo('fx-cap-shadow', () => {
  const [c, g] = makeCanvas(128)
  const grad = g.createRadialGradient(64, 60, 6, 64, 60, 60)
  grad.addColorStop(0, 'rgba(12,10,8,0.42)')
  grad.addColorStop(0.55, 'rgba(12,10,8,0.16)')
  grad.addColorStop(1, 'rgba(12,10,8,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  return toTexture(c)
})

const VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const FRAGMENT = `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uReveal;
  uniform float uHide;
  uniform float uMorph;
  uniform float uEnergy;
  uniform vec3 uAccent;

  float roundedMask(vec2 uv, float radius) {
    vec2 p = abs(uv - 0.5) - vec2(0.5 - radius);
    return 1.0 - smoothstep(radius - 0.004, radius + 0.004, length(max(p, 0.0)) + min(max(p.x, p.y), 0.0));
  }

  void main() {
    vec2 uv = vUv;
    float morphPulse = sin(clamp(uMorph, 0.0, 1.0) * 3.14159265);
    uv.x += sin(uv.y * 34.0 + uTime * 2.2) * morphPulse * 0.008;
    uv.y += sin(uv.x * 21.0 - uTime * 1.7) * morphPulse * 0.004;
    float mask = roundedMask(uv, 0.025);

    // Morph-only membrane: a flat stand-in close to the lit backing's tone.
    // At full reveal uHide fades this plane out and the real lit face shows.
    vec3 col = vec3(0.93, 0.92, 0.9) * (0.985 + 0.03 * uv.y);

    // A soft transfer line runs down the membrane during the morph only.
    float transferY = mix(0.78, 0.12, uMorph);
    float transfer = exp(-abs(uv.y - transferY) * 85.0) * morphPulse;
    col = mix(col, uAccent, clamp(transfer * 0.4, 0.0, 1.0));

    float fade = smoothstep(0.08, 0.42, uReveal) * (1.0 - uHide);
    gl_FragColor = vec4(max(col, 0.0), mask * fade);
  }
`

function makeReadoutCanvas() {
  const c = document.createElement('canvas')
  // 1280 wide ≈ 1:1 texels-to-pixels at typical framing; 1024 was upscaling.
  c.width = 1280
  c.height = 1920
  return c
}

function filterFreq(value, mode) {
  const frequency = filterFrequency(value, mode)
  return frequency >= 1000
    ? `${(frequency / 1000).toFixed(1)} kHz`
    : `${Math.round(frequency)} Hz`
}

const pct = (value) => `${Math.round(value * 100)}%`

const SUBTITLES = {
  filter: (fx, mode) => `${mode} ${filterFreq(fx.filter, mode)}`,
  drive: (fx, mode) => (mode === 'FOLD' ? 'FOLD' : `${mode} CLIP`),
  delay: (fx, mode) => `${mode} SYNC`,
  space: (fx, mode) => mode,
}

// Tiny single-stroke glyph per effect, driven by the live value v (0..1):
// the LP knee slides with cutoff, the transfer curve hardens with drive,
// echo taps decay with feedback, the reverb bloom swells with space.
// Drawn as a glowing trace on the dark scope window — a mini display,
// matching the machine's LCD, not printed ink.
function drawIcon(g, key, cx, cy, w, h, v, mode, color, pass = 'core') {
  g.save()
  const k = g.canvas.width / 1024
  g.strokeStyle = color
  g.shadowColor = color
  if (pass === 'glow') {
    // wide dim under-stroke drawn before the crisp trace — the bloom halo.
    // Caller clips to the scope window so this never spills onto the panel.
    g.globalAlpha = 0.5
    g.shadowBlur = 30 * k
    g.lineWidth = 8 * k
  } else {
    g.shadowBlur = 9 * k
    g.lineWidth = 3.4 * k
  }
  g.lineJoin = 'round'
  g.lineCap = 'round'
  const x0 = cx - w / 2
  const base = cy + h / 2
  if (key === 'filter') {
    const knee = x0 + w * (0.12 + v * 0.68)
    g.beginPath()
    if (mode === 'HP') {
      // rises out of the low end, flat top to the right
      g.moveTo(Math.max(x0, knee - w * 0.26), base)
      g.quadraticCurveTo(knee - w * 0.16, base - h * 0.1, knee - w * 0.08, base - h * 0.55)
      g.quadraticCurveTo(knee - w * 0.02, base - h * 0.95, knee + w * 0.08, base - h * 0.72)
      g.lineTo(x0 + w, base - h * 0.72)
    } else if (mode === 'BP') {
      const center = x0 + w * (0.18 + v * 0.55)
      g.moveTo(Math.max(x0, center - w * 0.3), base)
      g.bezierCurveTo(
        center - w * 0.1, base - h * 1.1,
        center + w * 0.1, base - h * 1.1,
        Math.min(x0 + w, center + w * 0.3), base,
      )
    } else {
      g.moveTo(x0, base - h * 0.72)
      g.lineTo(knee - w * 0.08, base - h * 0.72)
      // small resonance bump at the knee, then the rolloff
      g.quadraticCurveTo(knee + w * 0.02, base - h * 0.95, knee + w * 0.08, base - h * 0.55)
      g.quadraticCurveTo(
        knee + w * 0.16, base - h * 0.1,
        Math.min(x0 + w, knee + w * 0.26), base,
      )
    }
    g.stroke()
  } else if (key === 'drive') {
    const shelf = 0.12 + v * 0.34 // longer shelves = harder clip
    g.beginPath()
    if (mode === 'HARD') {
      // sharp corners: straight ramp slammed into flat shelves
      g.moveTo(x0, base - h * 0.15)
      g.lineTo(x0 + w * shelf, base - h * 0.15)
      g.lineTo(x0 + w * (1 - shelf), base - h * 0.85)
      g.lineTo(x0 + w, base - h * 0.85)
    } else if (mode === 'FOLD') {
      const cycles = 1 + v * 2.5
      g.moveTo(x0, base - h * 0.5)
      for (let s = 1; s <= 32; s++) {
        const u = s / 32
        g.lineTo(x0 + w * u, base - h * (0.5 + 0.4 * Math.sin(u * Math.PI * 2 * cycles)))
      }
    } else {
      // SOFT: pure tanh sigmoid that steepens with drive — no straight
      // segments, so it can't be mistaken for HARD's angular ramp
      const gain = 1.2 + v * 4
      const norm = Math.tanh(gain)
      for (let s = 0; s <= 32; s++) {
        const u = s / 32
        const t = Math.tanh((u * 2 - 1) * gain) / norm
        const px = x0 + w * u
        const py = base - h * (0.5 + 0.36 * t)
        s === 0 ? g.moveTo(px, py) : g.lineTo(px, py)
      }
    }
    g.stroke()
  } else if (key === 'delay') {
    // tap spacing reads the sync division: 1/4 = few wide taps, 1/16 = a
    // tight comb. Decay per tap still follows the fader (feedback).
    const taps = { '1/16': 8, '1/8': 5, '1/4': 3 }[mode] ?? 5
    const decay = 0.22 + v * 0.66
    for (let i = 0; i < taps; i++) {
      const bx = x0 + i * (w / taps)
      g.beginPath()
      g.moveTo(bx, base)
      g.lineTo(bx, base - Math.max(3, h * 0.95 * Math.pow(decay, i * 5 / taps)))
      g.stroke()
    }
  } else if (key === 'space') {
    g.beginPath()
    if (mode === 'SPRING') {
      // decaying wobble — the boing. More space = bigger, longer bounces.
      const amp = 0.35 + v * 0.6
      for (let s = 0; s <= 48; s++) {
        const u = s / 48
        const env = amp * Math.pow(1 - u, 1.3)
        const py = base - h * env * (0.55 + 0.45 * Math.sin(u * Math.PI * 7))
        s === 0 ? g.moveTo(x0, py) : g.lineTo(x0 + w * u, py)
      }
    } else if (mode === 'PLATE') {
      // instant dense attack, exponential fall — flat metal, no bloom
      const peak = 0.5 + v * 0.5
      g.moveTo(x0, base)
      g.lineTo(x0 + w * 0.07, base - h * peak)
      for (let s = 1; s <= 32; s++) {
        const u = s / 32
        g.lineTo(x0 + w * (0.07 + 0.93 * u), base - h * peak * Math.exp(-u * (5.5 - v * 2.5)))
      }
    } else {
      // HALL: slow swell into a long tail
      const peak = 0.3 + v * 0.8
      const tail = 0.15 + v * 0.3
      g.moveTo(x0, base)
      g.quadraticCurveTo(cx - w * 0.1, base - h * peak * 1.35, cx + w * 0.2, base - h * peak * 0.5)
      g.quadraticCurveTo(cx + w * tail, base - h * 0.1, x0 + w, base)
    }
    g.stroke()
  }
  g.restore()
}

// Neumorphic inset: light lip below the opening, gradient floor, ambient
// shadow tucked under the top edge. This is what makes printed grooves read
// as machined recesses instead of grey rectangles.
function drawInset(g, px, py, w, h, r, floorTop, floorBottom, k) {
  g.save()
  g.beginPath()
  g.roundRect(px, py + 2.5 * k, w, h, r)
  g.fillStyle = 'rgba(255,255,255,0.6)'
  g.fill()
  g.beginPath()
  g.roundRect(px, py, w, h, r)
  const floor = g.createLinearGradient(0, py, 0, py + h)
  floor.addColorStop(0, floorTop)
  floor.addColorStop(1, floorBottom)
  g.fillStyle = floor
  g.fill()
  g.clip()
  const shade = g.createLinearGradient(0, py, 0, py + 12 * k)
  shade.addColorStop(0, 'rgba(0,0,0,0.35)')
  shade.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = shade
  g.fillRect(px, py, w, 12 * k)
  g.restore()
}

// Engraved hairline: dark groove with a light catch-lip just below it.
function engravedLine(g, x0, y0, x1, y1, k, strength = 1) {
  g.lineWidth = 2 * k
  g.strokeStyle = `rgba(40,38,33,${0.26 * strength})`
  g.beginPath()
  g.moveTo(x0, y0)
  g.lineTo(x1, y1)
  g.stroke()
  g.strokeStyle = `rgba(255,255,255,${0.55 * strength})`
  g.beginPath()
  g.moveTo(x0, y0 + 2 * k)
  g.lineTo(x1, y1 + 2 * k)
  g.stroke()
}

// Fine print grain, tiled over the whole face at the end of a redraw. Kills
// the flat digital white without reading as dirt. Pre-rendered once.
const grainPattern = () => memo('fx-grain', () => {
  const [c, g] = makeCanvas(256)
  const img = g.createImageData(256, 256)
  for (let i = 0; i < 256 * 256; i++) {
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = Math.random() > 0.5 ? 255 : 20
    // kept subtle: heavier grain reads as paper tooth, not anodised metal
    img.data[i * 4 + 3] = Math.random() * 6
  }
  g.putImageData(img, 0, 0)
  return c
})

// Machined pan-head screw with a rotated cross drive, set in a shallow bore.
function drawScrew(g, sx, sy, r, angle, k) {
  g.save()
  g.fillStyle = 'rgba(0,0,0,0.16)'
  g.beginPath()
  g.arc(sx, sy + 1.5 * k, r * 1.35, 0, Math.PI * 2)
  g.fill()
  const head = g.createLinearGradient(0, sy - r, 0, sy + r)
  head.addColorStop(0, '#dcd7ca')
  head.addColorStop(0.55, '#b7b1a2')
  head.addColorStop(1, '#8e897b')
  g.fillStyle = head
  g.beginPath()
  g.arc(sx, sy, r, 0, Math.PI * 2)
  g.fill()
  g.strokeStyle = 'rgba(255,255,255,0.55)'
  g.lineWidth = 1.5 * k
  g.beginPath()
  g.arc(sx, sy, r - 0.75 * k, Math.PI * 0.8, Math.PI * 1.7)
  g.stroke()
  g.translate(sx, sy)
  g.rotate(angle)
  g.strokeStyle = 'rgba(30,28,24,0.72)'
  g.lineWidth = 2.1 * k
  g.lineCap = 'round'
  for (const a of [0, Math.PI / 2]) {
    g.beginPath()
    g.moveTo(Math.cos(a) * -r * 0.6, Math.sin(a) * -r * 0.6)
    g.lineTo(Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6)
    g.stroke()
  }
  g.restore()
}

function drawLed(g, lx, ly, r, color, lit) {
  if (lit) {
    const halo = g.createRadialGradient(lx, ly, 0, lx, ly, r * 3.6)
    halo.addColorStop(0, `${color}8c`)
    halo.addColorStop(1, `${color}00`)
    g.fillStyle = halo
    g.fillRect(lx - r * 3.6, ly - r * 3.6, r * 7.2, r * 7.2)
  }
  // unlit LEDs keep a dim tint of their colour, like real dark-lens lamps
  g.fillStyle = lit ? color : `${color}59`
  g.beginPath()
  g.arc(lx, ly, r, 0, Math.PI * 2)
  g.fill()
  // glass glint
  g.fillStyle = `rgba(255,255,255,${lit ? 0.75 : 0.35})`
  g.beginPath()
  g.arc(lx - r * 0.32, ly - r * 0.32, r * 0.32, 0, Math.PI * 2)
  g.fill()
}

function drawReadout(canvas, texture, fx, fxMode, finishIndex) {
  const g = canvas.getContext('2d')
  const k = canvas.width / 1024
  const sx = canvas.width / EDITOR_W
  const sy = canvas.height / EDITOR_H
  const x = (worldX) => canvas.width / 2 + worldX * sx
  const y = (worldY) => canvas.height / 2 - worldY * sy
  const sans = '"Helvetica Neue", Helvetica, Arial, sans-serif'
  const accent = getFinish(finishIndex).accent
  // Full-alpha near-black: the ACES pass compresses contrast, so translucent
  // grey ink lands as pencil. Print like silk-screen, let the tone map soften.
  const INK = 'rgba(22,20,17,1)'

  g.clearRect(0, 0, canvas.width, canvas.height)
  g.textBaseline = 'middle'

  // header: wordmark left, master lamp right
  g.font = `600 ${44 * k}px ${sans}`
  g.letterSpacing = `${6 * k}px`
  g.fillStyle = INK
  g.textAlign = 'left'
  g.fillText('FX', x(-4.15), y(6.3))

  // engraved rule under the header, and four chassis screws in the corners
  engravedLine(g, x(-4.15), y(5.72), x(4.15), y(5.72), k, 0.8)
  const screwR = 0.125 * sx
  drawScrew(g, x(-4.35), y(6.78), screwR, 0.4, k)
  drawScrew(g, x(4.35), y(6.78), screwR, 1.9, k)
  drawScrew(g, x(-4.35), y(-6.78), screwR, 2.6, k)
  drawScrew(g, x(4.35), y(-6.78), screwR, 0.9, k)

  // soft shading creeping in from the panel perimeter seats the face in its
  // machined frame — the quiet cousin of the vignette we keep off this view
  const edge = 0.55 * sx
  for (const [x0, y0, x1, y1] of [
    [0, 0, 0, edge], [0, canvas.height, 0, canvas.height - edge],
  ]) {
    const grad = g.createLinearGradient(x0, y0, x1, y1)
    grad.addColorStop(0, 'rgba(52,48,40,0.10)')
    grad.addColorStop(1, 'rgba(52,48,40,0)')
    g.fillStyle = grad
    g.fillRect(0, Math.min(y0, y1), canvas.width, edge)
  }
  for (const [x0, x1] of [[0, edge], [canvas.width, canvas.width - edge]]) {
    const grad = g.createLinearGradient(x0, 0, x1, 0)
    grad.addColorStop(0, 'rgba(52,48,40,0.10)')
    grad.addColorStop(1, 'rgba(52,48,40,0)')
    g.fillStyle = grad
    g.fillRect(Math.min(x0, x1), 0, edge, canvas.height)
  }

  // cards are real 3D slabs now — only their silk-screened content is printed
  for (const col of FADERS) {
    const cx = col.x

    g.textAlign = 'center'
    g.font = `600 ${25 * k}px ${sans}`
    g.letterSpacing = `${3 * k}px`
    g.fillStyle = INK
    g.fillText(col.label, x(cx), y(4.5))

    // mode selector: a raised dark key with a drop shadow and catch-light lip
    // — the old ghost pill read as a caption, not a button
    const pillX = x(cx - 0.8)
    const pillY = y(4.23)
    const pillW = 1.6 * sx
    const pillH = 0.38 * sy
    const pillR = 0.19 * sy
    g.save()
    g.shadowColor = 'rgba(20,18,15,0.4)'
    g.shadowBlur = 7 * k
    g.shadowOffsetY = 3 * k
    g.beginPath()
    g.roundRect(pillX, pillY, pillW, pillH, pillR)
    const keyFill = g.createLinearGradient(0, pillY, 0, pillY + pillH)
    keyFill.addColorStop(0, 'rgba(64,60,52,0.97)')
    keyFill.addColorStop(1, 'rgba(38,35,30,0.97)')
    g.fillStyle = keyFill
    g.fill()
    g.restore()
    g.lineWidth = 1.5 * k
    g.strokeStyle = 'rgba(255,255,255,0.24)'
    g.beginPath()
    g.roundRect(pillX + 1.5 * k, pillY + 1.5 * k, pillW - 3 * k, pillH - 3 * k, pillR - 1.5 * k)
    g.stroke()
    g.font = `600 ${17 * k}px ${sans}`
    g.letterSpacing = `${1.5 * k}px`
    g.fillStyle = 'rgba(246,241,229,0.95)'
    g.fillText(SUBTITLES[col.key](fx, fxMode[col.key]), x(cx), y(4.03))
    g.font = `600 ${16 * k}px ${sans}`
    g.letterSpacing = '0px'
    g.fillStyle = accent
    g.fillText('‹', x(cx - 0.66), y(4.05))
    g.fillText('›', x(cx + 0.66), y(4.05))

    // scope window: a dark mini display the glowing response trace lives in
    drawInset(
      g,
      x(cx) - 0.87 * sx,
      y(3.74),
      1.74 * sx,
      0.88 * sy,
      0.12 * sx,
      'rgba(16,15,13,0.96)',
      'rgba(32,30,26,0.9)',
      k,
    )
    // glow pass then crisp trace, clipped to the scope window so the halo
    // blooms on the glass instead of printing ink over the panel face
    g.save()
    g.beginPath()
    g.roundRect(x(cx) - 0.87 * sx, y(3.74), 1.74 * sx, 0.88 * sy, 0.12 * sx)
    g.clip()
    drawIcon(g, col.key, x(cx), y(3.3), 1.5 * sx, 0.55 * sy, fx[col.key], fxMode[col.key], accent, 'glow')
    drawIcon(g, col.key, x(cx), y(3.3), 1.5 * sx, 0.55 * sy, fx[col.key], fxMode[col.key], accent)
    g.restore()

    // dark anodised travel plate: the high-contrast field the cream cap and
    // ticks ride on — cream-on-cream buried the whole fader section
    drawInset(
      g,
      x(cx) - 0.62 * sx,
      y(TRACK_Y1 + 0.35),
      1.24 * sx,
      (TRACK_LEN + 0.7) * sy,
      0.1 * sx,
      'rgba(38,35,30,0.94)',
      'rgba(60,56,48,0.9)',
      k,
    )

    // machined fader slot, near-black inside the plate
    drawInset(
      g,
      x(cx) - 0.1 * sx,
      y(TRACK_Y1 + 0.18),
      0.2 * sx,
      (TRACK_LEN + 0.36) * sy,
      0.1 * sx,
      'rgba(12,11,9,0.96)',
      'rgba(28,26,22,0.92)',
      k,
    )

    // pale ticks on the dark plate, majors at 0 / 50 / 100
    g.lineWidth = 2 * k
    for (let i = 0; i <= 8; i++) {
      const ty = y(THREE.MathUtils.lerp(TRACK_Y0, TRACK_Y1, i / 8))
      const major = i % 4 === 0
      const len = (major ? 0.2 : 0.12) * sx
      g.strokeStyle = `rgba(240,235,222,${major ? 0.6 : 0.32})`
      for (const side of [-1, 1]) {
        const tx = x(cx + side * 0.2)
        g.beginPath()
        g.moveTo(tx, ty)
        g.lineTo(tx + side * len, ty)
        g.stroke()
      }
    }

    g.font = `700 ${31 * k}px ${sans}`
    g.letterSpacing = `${1 * k}px`
    g.fillStyle = INK
    g.fillText(pct(fx[col.key]), x(cx), y(-2.95))
  }

  // footer: engraved divider, then the skin row
  engravedLine(g, x(-4.15), y(-4.05), x(4.15), y(-4.05), k)

  // quiet centred section title between the divider and the key row
  g.textAlign = 'center'
  g.font = `600 ${18 * k}px ${sans}`
  g.letterSpacing = `${5 * k}px`
  g.fillStyle = 'rgba(22,20,17,0.55)'
  g.fillText('SKIN', x(0), y(-4.33))

  // status LED above each key, name below. No printed well: the 3D keys sit
  // ~0.3 above the print plane and the rig's pointer parallax shifts them
  // against any printed opening — a tight well reads as misregistration.
  // The contact shadow (3D, moves with the key) does the seating instead.
  FINISHES.forEach((item, index) => {
    const px = FINISH_POS[index]
    drawLed(g, x(px), y(-4.22), 4.5 * k, item.accent, index === finishIndex)
    g.font = `600 ${16 * k}px ${sans}`
    g.letterSpacing = `${2.5 * k}px`
    g.fillStyle = index === finishIndex ? INK : 'rgba(22,20,17,0.4)'
    g.fillText(item.id.toUpperCase(), x(px), y(-5.28))
  })

  // print grain over everything — alpha is baked into the pattern
  g.fillStyle = g.createPattern(grainPattern(), 'repeat')
  g.fillRect(0, 0, canvas.width, canvas.height)

  // faint scanlines over the whole face — the tell that this is an emissive
  // display behind glass, not a painted panel. Kept near-subliminal.
  g.fillStyle = 'rgba(50,46,38,0.045)'
  const step = Math.round(4 * k)
  for (let ly = 0; ly < canvas.height; ly += step) {
    g.fillRect(0, ly, canvas.width, 1.2 * k)
  }

  texture.needsUpdate = true
}

// Soft halo sprite for the accent glow. White here; tinted per-finish via
// material color. Max alpha is baked in so the reveal cascade can drive
// material.opacity to 1 (same contract as the cap shadow).
const fillGlow = () => memo('fx-fill-glow', () => {
  const [c, g] = makeCanvas(128)
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grad.addColorStop(0, 'rgba(255,255,255,0.85)')
  grad.addColorStop(0.35, 'rgba(255,255,255,0.3)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  return toTexture(c)
})

function FxFader({ col, value, accent }) {
  const drag = useRef(false)
  const { camera, size } = useThree()
  const handle = useRef()
  const indexMaterial = useRef()
  const [hover, setHover] = useState(false)
  const { fillEmissive, fillRoughness, glowStrength, indexRest, indexHover, hoverScale } =
    useFxPanelControls()
  const glowColor = useMemo(
    () => new THREE.Color(accent).multiplyScalar(glowStrength),
    [accent, glowStrength],
  )
  const knobY = THREE.MathUtils.lerp(TRACK_Y0, TRACK_Y1, value)
  const fillHeight = Math.max(0.015, knobY - TRACK_Y0)
  const trackMid = (TRACK_Y0 + TRACK_Y1) / 2
  const shadowMap = capShadow()

  useFrame((_, dt) => {
    const mesh = handle.current
    const material = indexMaterial.current
    if (!mesh || !material) return
    const target = hover || drag.current ? hoverScale : 1
    const k = 1 - Math.exp(-14 * Math.min(dt, 0.05))
    mesh.scale.x = THREE.MathUtils.lerp(mesh.scale.x, target, k)
    mesh.scale.y = THREE.MathUtils.lerp(mesh.scale.y, target, k)
    // rest stays saturated below the bloom threshold; hover brightens the
    // line — the visible glow comes from the additive halo sprite, not bloom
    material.emissiveIntensity = THREE.MathUtils.lerp(
      material.emissiveIntensity,
      hover || drag.current ? indexHover : indexRest,
      k,
    )
  })

  // Drag tracks the POINTER in screen px, not the hit plane's uv: once the
  // cursor leaves the plane r3f keeps replaying the stale capture-time
  // intersection, which snapped the fader back at both ends of the travel.
  const start = useRef(null)

  const begin = (event) => {
    const v = event.uv
      ? THREE.MathUtils.clamp(
          ((event.uv.y - 0.5) * HIT_H + trackMid - TRACK_Y0) / TRACK_LEN, 0, 1)
      : value
    // px of screen travel per one world unit, so the drag keeps 1:1 with the cap
    const a = event.object.localToWorld(new THREE.Vector3(0, 0.5, 0)).project(camera)
    const b = event.object.localToWorld(new THREE.Vector3(0, -0.5, 0)).project(camera)
    const pxPerValue = Math.max(1, Math.abs(a.y - b.y) * size.height * 0.5 * TRACK_LEN)
    start.current = { y: event.clientY, v, pxPerValue }
    actions.setFxValue(col.key, v)
  }

  const update = (event) => {
    const s = start.current
    if (!s) return
    actions.setFxValue(
      col.key,
      THREE.MathUtils.clamp(s.v + (s.y - event.clientY) / s.pxPerValue, 0, 1),
    )
  }

  const finish = (event) => {
    if (!drag.current) return
    drag.current = false
    start.current = null
    event.target.releasePointerCapture?.(event.pointerId)
    document.body.style.cursor = hover ? 'ns-resize' : ''
  }

  return (
    <group>
      {/* additive halo behind the fill bar — the "glow" is this sprite, not
          post bloom (see the leva schema comment). Renders over the print
          plane (renderOrder 4) and reads against the dark travel well. */}
      <mesh
        position={[col.x, TRACK_Y0 + fillHeight / 2, 0.3]}
        scale={[1, fillHeight + 0.55, 1]}
        renderOrder={6}
      >
        <planeGeometry args={[0.55, 1]} />
        <meshBasicMaterial
          map={fillGlow()}
          color={glowColor}
          blending={THREE.AdditiveBlending}
          transparent
          opacity={0}
          depthWrite={false}
          userData={{ fxVisual: true }}
        />
      </mesh>
      {/* accent-lit filled run below the handle — the value readout against
          the dark travel plate, like a lit level strip */}
      <mesh position={[col.x, TRACK_Y0 + fillHeight / 2, 0.25]} scale={[1, fillHeight, 1]}>
        <boxGeometry args={[0.08, 1, 0.05]} />
        <meshStandardMaterial
          color={accent}
          emissive={accent}
          emissiveIntensity={fillEmissive}
          roughness={fillRoughness}
          transparent
          opacity={0}
          userData={{ fxVisual: true }}
        />
      </mesh>

      <group position={[col.x, knobY, 0]}>
        {/* contact shadow keeps the cap planted on the panel */}
        <mesh position={[0, -0.1, 0.25]} renderOrder={5}>
          <planeGeometry args={[1.18, 0.92]} />
          <meshBasicMaterial
            map={shadowMap}
            transparent
            opacity={0}
            depthWrite={false}
            userData={{ fxVisual: true }}
          />
        </mesh>
        {/* stem dropping into the slot */}
        <mesh position={[0, 0, 0.29]}>
          <boxGeometry args={[0.16, 0.22, 0.16]} />
          <meshStandardMaterial
            color="#211f1a"
            roughness={0.55}
            transparent
            opacity={0}
            userData={{ fxVisual: true }}
          />
        </mesh>
        {/* Two-tone stacked cap, mixer-hardware style: a dark machined riser
            hidden inside the cream top's silhouette (a skirt that peeked past
            the edges drew a dark outline ring — the "sticker" look), with a
            clean accent index line across the face. */}
        <group ref={handle}>
          <RoundedBox args={[0.56, 0.42, 0.14]} radius={0.05} smoothness={4} position={[0, 0, 0.37]}>
            <meshPhysicalMaterial
              color="#26241f"
              roughness={0.45}
              metalness={0.25}
              clearcoat={0.5}
              clearcoatRoughness={0.3}
              transparent
              opacity={0}
              userData={{ fxVisual: true }}
            />
          </RoundedBox>
          <RoundedBox args={[0.64, 0.5, 0.16]} radius={0.05} smoothness={4} position={[0, 0, 0.5]}>
            {/* same procedural maps as the keycaps — polished centre, burnished
                rim, tight grain. A flat uniform face reads as a cartoon at this
                framing no matter what the geometry does. */}
            <meshPhysicalMaterial
              color="#f5f2e9"
              roughness={0.34}
              roughnessMap={capRoughness('abs')}
              normalMap={capNormal('abs')}
              normalScale={[0.3, 0.3]}
              metalness={0.03}
              clearcoat={0.9}
              clearcoatRoughness={0.14}
              envMapIntensity={1.25}
              transparent
              opacity={0}
              userData={{ fxVisual: true }}
            />
            {/* accent index line, seated directly on the cream face */}
            <mesh position={[0, 0, 0.01]}>
              <boxGeometry args={[0.6, 0.045, 0.17]} />
              <meshStandardMaterial
                ref={indexMaterial}
                color={accent}
                emissive={accent}
                emissiveIntensity={indexRest}
                roughness={0.25}
                transparent
                opacity={0}
                userData={{ fxVisual: true }}
              />
            </mesh>
            {/* fine grip lines above and below the notch */}
            {[-0.17, 0.17].map((gy) => (
              <mesh key={gy} position={[0, gy, 0.082]}>
                <boxGeometry args={[0.44, 0.014, 0.008]} />
                <meshStandardMaterial
                  color="#8f887a"
                  roughness={0.7}
                  transparent
                  opacity={0}
                  userData={{ fxVisual: true }}
                />
              </mesh>
            ))}
          </RoundedBox>
        </group>
      </group>

      {/* Transparent WebGL hit surface: the visual, hit test and audio value
          all live in the same Three.js coordinate system. */}
      <mesh
        position={[col.x, trackMid, 0.48]}
        onPointerOver={(event) => {
          event.stopPropagation()
          setHover(true)
          document.body.style.cursor = 'ns-resize'
        }}
        onPointerOut={() => {
          setHover(false)
          document.body.style.cursor = drag.current ? 'grabbing' : ''
        }}
        onPointerDown={(event) => {
          event.stopPropagation()
          drag.current = true
          event.target.setPointerCapture(event.pointerId)
          document.body.style.cursor = 'grabbing'
          begin(event)
        }}
        onPointerMove={(event) => {
          if (!drag.current) return
          event.stopPropagation()
          update(event)
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
      >
        <planeGeometry args={[1.5, HIT_H]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} userData={{ fxInvisible: true }} />
      </mesh>
    </group>
  )
}

// Invisible hit plane over a column's printed mode pill: click cycles the
// effect's character (LP/HP/BP, SOFT/HARD/FOLD, ...).
function ModeButton({ col }) {
  return (
    <mesh
      position={[col.x, 4.03, 0.4]}
      onPointerOver={(event) => {
        event.stopPropagation()
        document.body.style.cursor = 'pointer'
      }}
      onPointerOut={() => { document.body.style.cursor = '' }}
      onPointerDown={(event) => {
        event.stopPropagation()
        actions.cycleFxMode(col.key)
      }}
    >
      <planeGeometry args={[1.7, 0.5]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} userData={{ fxInvisible: true }} />
    </mesh>
  )
}

function FinishSelector({ selected }) {
  // Each key wears its skin's actual step-keycap colour and finish (keys.step
  // is bright and chromatic; surface.body rendered as three flat black chips)
  // — the row is a swatch strip of the machines themselves. Status LED above,
  // printed name below (canvas), active key pressed into its well.
  // ponytail: keys.material transmission overrides are deliberately NOT
  // spread here — one transmissive material would force the transmission
  // pass every frame for a 0.9-unit key.
  return FINISHES.map((finish, index) => {
    const active = index === selected
    const keys = finish.keys
    return (
      <group
        key={finish.id}
        position={[FINISH_POS[index], -4.72, 0]}
        onPointerOver={(event) => {
          event.stopPropagation()
          document.body.style.cursor = 'pointer'
        }}
        onPointerOut={() => { document.body.style.cursor = '' }}
        onPointerDown={(event) => {
          event.stopPropagation()
          actions.setFinish(index)
        }}
      >
        {/* contact shadow plants the key in its well — same recipe as the
            fader caps; without it the key reads as a sticker on the panel */}
        <mesh position={[0, -0.06, 0.24]} renderOrder={5}>
          <planeGeometry args={[1.5, 0.9]} />
          <meshBasicMaterial
            map={capShadow()}
            transparent
            opacity={0}
            depthWrite={false}
            userData={{ fxVisual: true }}
          />
        </mesh>
        {/* dark machined riser hidden inside the top's silhouette — the
            stacked-cap depth cue, kept smaller than the key so it never
            draws an outline ring */}
        <RoundedBox
          args={[0.84, 0.36, 0.12]}
          radius={0.04}
          smoothness={4}
          position={[0, 0, active ? 0.19 : 0.24]}
        >
          <meshPhysicalMaterial
            color="#26241f"
            roughness={0.45}
            metalness={0.25}
            clearcoat={0.5}
            clearcoatRoughness={0.3}
            transparent
            opacity={0}
            userData={{ fxVisual: true }}
          />
        </RoundedBox>
        <RoundedBox
          args={[0.92, 0.44, 0.14]}
          radius={0.05}
          smoothness={4}
          position={[0, 0, active ? 0.25 : 0.3]}
        >
          <meshPhysicalMaterial
            color={keys.step}
            roughness={Math.min(keys.stepRough, 0.5)}
            roughnessMap={keys.clean ? null : capRoughness('abs')}
            normalMap={keys.clean ? null : capNormal('abs')}
            normalScale={[0.3, 0.3]}
            metalness={keys.metalness ?? 0.05}
            clearcoat={0.9}
            clearcoatRoughness={0.1}
            envMapIntensity={1.5}
            transparent
            opacity={0}
            userData={{ fxVisual: true }}
          />
        </RoundedBox>
      </group>
    )
  })
}

const phase = (progress, start, end) => {
  const value = THREE.MathUtils.clamp((progress - start) / (end - start), 0, 1)
  return value * value * (3 - 2 * value)
}

// easeOutBack with a restrained ~3% overshoot: the glass lands, breathes past
// its final size for a frame or two, and settles. That settle is the premium.
const settle = (value) => {
  const q = value - 1
  return 1 + 1.55 * q * q * q + 0.55 * q * q
}

export default function FxScreen({ morph }) {
  const { fx, fxMode, finish } = useStore()
  const activeFinish = getFinish(finish)
  // frame loop lerps toward this; allocating it per frame was GC churn
  const accentColor = useMemo(() => new THREE.Color(activeFinish.accent), [activeFinish.accent])
  const root = useRef()
  const visuals = useRef()
  const hitLayer = useRef()
  const backingMaterial = useRef()
  const shaderMaterial = useRef()

  const [readoutCanvas, readoutTexture] = useMemo(() => {
    const c = makeReadoutCanvas()
    const t = toTexture(c, { srgb: true, aniso: 16 })
    // No mipmaps: the print is only visible near full size (uiAlpha gates it
    // behind morph > 0.8), so mip sampling just blurs the text — and skipping
    // regeneration makes every drag-frame re-upload cheaper too.
    t.generateMipmaps = false
    t.minFilter = THREE.LinearFilter
    return [c, t]
  }, [])

  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uReveal: { value: 0 },
    uHide: { value: 0 },
    uMorph: { value: 0 },
    uEnergy: { value: 0 },
    uAccent: { value: new THREE.Color(activeFinish.accent) },
  // The material is intentionally stable; finish changes are eased in-frame.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [])

  useEffect(() => {
    drawReadout(readoutCanvas, readoutTexture, fx, fxMode, finish)
  }, [fx, fxMode, finish, readoutCanvas, readoutTexture])

  // The chassis wear decals (scratch overlay etc.) render at order 2 with no
  // depth write, so they'd draw across the editor. Lift every editor mesh
  // above them, preserving relative order within the panel.
  useEffect(() => {
    root.current?.traverse((item) => {
      if (item.isMesh) item.renderOrder += 10
    })
  }, [])

  useEffect(() => () => {
    readoutTexture.dispose()
    document.body.style.cursor = ''
  }, [readoutTexture])

  useFrame(({ clock }, dt) => {
    const frameTime = Math.min(dt, 0.05)
    const mix = morph.current
    // go-go-gadget extension: the LCD first telescopes HORIZONTALLY across
    // the faceplate, then extends VERTICALLY down over the face the key rows
    // vacated (rows finish sinking at 0.58 — see Keys.jsx FxSink). Two
    // distinct mechanical strokes, each with its own settle.
    const widthPhase = settle(phase(mix, 0.5, 0.68))
    const heightPhase = settle(phase(mix, 0.68, 0.92))
    const depthPhase = phase(mix, 0.5, 0.75)
    const shellAlpha = phase(mix, 0.015, 0.2)
    const uiAlpha = phase(mix, 0.8, 0.995)
    const group = root.current
    if (!group) return

    group.visible = mix > 0.002
    group.position.x = THREE.MathUtils.lerp(CLOSED_X, 0, widthPhase)
    group.position.y = THREE.MathUtils.lerp(CLOSED_Y, 0, heightPhase)
    group.position.z = THREE.MathUtils.lerp(SOURCE_Z, SURFACE_Z, depthPhase)
    group.scale.set(
      THREE.MathUtils.lerp(CLOSED_SCALE[0], 1, widthPhase),
      THREE.MathUtils.lerp(CLOSED_SCALE[1], 1, heightPhase),
      1,
    )

    if (backingMaterial.current) {
      backingMaterial.current.opacity = shellAlpha * 0.98
      // Write depth once the shell is solid: N8AO reads the depth buffer, and
      // without this it shades the panel with the AO of the key well BEHIND
      // it — a big soft grey blob across the cream face.
      backingMaterial.current.depthWrite = shellAlpha > 0.6
    }
    if (shaderMaterial.current) {
      shaderMaterial.current.uniforms.uTime.value = clock.elapsedTime
      shaderMaterial.current.uniforms.uReveal.value = shellAlpha
      shaderMaterial.current.uniforms.uHide.value = uiAlpha
      shaderMaterial.current.uniforms.uMorph.value = mix
      shaderMaterial.current.uniforms.uEnergy.value = (
        fx.filter + fx.drive + fx.delay + fx.space
      ) / 4
      shaderMaterial.current.uniforms.uAccent.value.lerp(
        accentColor,
        1 - Math.exp(-5 * frameTime),
      )
    }
    if (visuals.current) {
      visuals.current.visible = uiAlpha > 0.001
      visuals.current.traverse((item) => {
        const material = item.material
        if (!material || material.isShaderMaterial || material.userData.fxInvisible) return
        // Controls cascade in top-to-bottom instead of popping on together.
        const lag = THREE.MathUtils.clamp((6.55 - (item.position.y || 0)) / 13.1, 0, 1)
        material.opacity = phase(uiAlpha, lag * 0.45, lag * 0.45 + 0.55)
      })
    }
    if (hitLayer.current) hitLayer.current.visible = mix > 0.9
  })

  return (
    <group ref={root} visible={false}>
      <group>
        {/* The lit panel face: this backing IS the surface at full reveal —
            the shader plane above is morph-only. Key light, Lightformer
            reflections and the roughness streaks all land here; the ink stays
            on the unlit print plane so its contrast survives the lighting. */}
        <RoundedBox args={[EDITOR_W, EDITOR_H, 0.34]} radius={0.3} smoothness={5}>
          <meshPhysicalMaterial
            ref={backingMaterial}
            color="#e3ded2"
            metalness={0.08}
            // clean display glass: uniform smooth roughness (a mottled
            // roughness map read as fabric under the raking key light), the
            // clearcoat carrying the cover-glass reflection. A faint backlight
            // lifts the key-light falloff the way an emissive display does.
            // Keep emissive small — face luminance sits near the 1.85 bloom
            // threshold.
            roughness={0.45}
            emissive="#fff6e8"
            emissiveIntensity={0.12}
            clearcoat={0.45}
            clearcoatRoughness={0.15}
            envMapIntensity={1.1}
            transparent
            opacity={0}
            depthWrite={false}
            userData={{ fxVisual: true }}
          />
        </RoundedBox>

        <mesh position={[0, 0, 0.19]}>
          <planeGeometry args={[EDITOR_W - 0.18, EDITOR_H - 0.18]} />
          <shaderMaterial
            ref={shaderMaterial}
            vertexShader={VERTEX}
            fragmentShader={FRAGMENT}
            uniforms={uniforms}
            transparent
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>

        <group ref={visuals}>
          {/* real card slabs: edges catch the key/rim light and N8AO grounds
              them — the printed cards these replace couldn't do either */}
          {FADERS.map((col) => (
            <RoundedBox
              key={col.key}
              args={[2.16, 8.75, 0.3]}
              radius={0.15}
              smoothness={4}
              position={[col.x, 0.775, 0.07]}
            >
              <meshPhysicalMaterial
                color="#f5f2e9"
                roughness={0.32}
                clearcoat={0.3}
                clearcoatRoughness={0.25}
                transparent
                opacity={0}
                userData={{ fxVisual: true }}
              />
            </RoundedBox>
          ))}
          <mesh position={[0, 0, 0.24]} renderOrder={4}>
            <planeGeometry args={[EDITOR_W - 0.2, EDITOR_H - 0.2]} />
            <meshBasicMaterial
              map={readoutTexture}
              transparent
              opacity={0}
              depthWrite={false}
              toneMapped={false}
              userData={{ fxVisual: true }}
            />
          </mesh>

          {FADERS.map((col) => (
            <FxFader
              key={col.key}
              col={col}
              value={fx[col.key]}
              accent={activeFinish.accent}
            />
          ))}
          {FADERS.map((col) => (
            <ModeButton key={col.key} col={col} />
          ))}
          <FinishSelector selected={finish} />
        </group>
      </group>

      <group ref={hitLayer} visible={false}>
        {/* The blocker prevents the retracted physical keys from receiving
            events through the glass between the editor controls. */}
        <mesh
          position={[0, 0, 0.18]}
          onPointerDown={(event) => event.stopPropagation()}
          onPointerMove={(event) => event.stopPropagation()}
        >
          <planeGeometry args={[EDITOR_W, EDITOR_H]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      </group>
    </group>
  )
}
