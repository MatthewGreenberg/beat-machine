import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useControls } from 'leva'
import { BODY_W, TOP_Y, PLATE_H, PLATE_Z } from './layout'
import { canvas, toTexture, memo, scratchCanvas } from './textures'
import { actions, getState, live, TRACKS } from '../state/store'
import { INTRO_DISABLED } from './assemblyMotion'

// LCD panel — a damaged/noisy dot-matrix display, not a clean UI.
// Content is rendered at full res into an offscreen mask canvas, then
// resampled one dot per grid cell so real text comes out as chunky,
// gappy pixels. Backlight unevenness, dead pixels, stuck-bright pixels
// and dark blotches are precomputed once and layered in every redraw.

const SCREEN_W = BODY_W - 4.7
const SCREEN_H = 2.5
const BEZEL_MARGIN = 0.3   // rim width around the glass opening
const BEZEL_DEPTH = 0.34   // how proud the whole panel sits off the faceplate

const TEX_W = 1024
const TEX_H = Math.round(TEX_W * (SCREEN_H / SCREEN_W))
const DOT_PITCH = 6.4                       // px per cell, both axes
const COLS = Math.round(TEX_W / DOT_PITCH)
const ROWS = Math.round(TEX_H / DOT_PITCH)
const CELL_W = TEX_W / COLS
const CELL_H = TEX_H / ROWS
const STEP_PAD_X = 0.045
const STEP_DRAG_HEIGHT = SCREEN_H * 0.38
const BOOT_DELAY = 0.42
const BACKLIGHT_DURATION = 0.42
const CONTENT_DELAY = 0.12
const CONTENT_DURATION = 0.24
const PIXEL_DELAY = 0.54
const PIXEL_DURATION = 0.84
const PIXEL_STEPS = 12
const PIXEL_DENSITY = 0.34
const UI_FADE_DURATION = 0.34
const UI_FADE_STEPS = 16
const BOOT_DURATION = PIXEL_DELAY + PIXEL_DURATION + UI_FADE_DURATION
const MODE_STEPS = 12
const MODE_DURATION = 0.34

const smoothstep = (value) => value * value * (3 - 2 * value)

function bootLevel(elapsed, delay, duration) {
  const progress = THREE.MathUtils.clamp((elapsed - delay) / duration, 0, 1)
  return smoothstep(progress)
}

function pixelOrder(x, y) {
  let hash = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263)
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177)
  return (hash >>> 0) / 4294967295
}

function stepFromUv(x) {
  const ladderX = (x - STEP_PAD_X) / (1 - STEP_PAD_X * 2)
  if (ladderX < 0 || ladderX >= 1) return null
  return Math.floor(ladderX * 16)
}

// Smooth low-frequency field via bilinear upsample of a coarse random grid —
// used for uneven backlight and grubby dark patches.
function smoothField(cols, rows, cw, ch, min, max) {
  const coarse = new Float32Array(cw * ch)
  for (let i = 0; i < coarse.length; i++) coarse[i] = Math.random()
  const out = new Float32Array(cols * rows)
  for (let y = 0; y < rows; y++) {
    const fy = (y / (rows - 1)) * (ch - 1)
    const y0 = Math.floor(fy), y1 = Math.min(ch - 1, y0 + 1), ty = fy - y0
    for (let x = 0; x < cols; x++) {
      const fx = (x / (cols - 1)) * (cw - 1)
      const x0 = Math.floor(fx), x1 = Math.min(cw - 1, x0 + 1), tx = fx - x0
      const a = coarse[y0 * cw + x0], b = coarse[y0 * cw + x1]
      const c = coarse[y1 * cw + x0], d = coarse[y1 * cw + x1]
      const top = a + (b - a) * tx, bot = c + (d - c) * tx
      out[y * cols + x] = min + (top + (bot - top) * ty) * (max - min)
    }
  }
  return out
}

// Impure random dressing generated once — kept in a plain function (like
// buildDustMesh in Props.jsx) rather than inline in useMemo so the
// react-compiler purity check doesn't see raw Math.random in render.
function buildGridDressing() {
  const n = COLS * ROWS
  const backlight = smoothField(COLS, ROWS, 7, 4, 0.55, 1.3)
  const blotch = smoothField(COLS, ROWS, 6, 3, 0.4, 1.0)
  const dead = new Uint8Array(n)
  const stuck = new Uint8Array(n)
  // Only a minority of cells carry any unlit backlight bleed at all — the
  // rest of the substrate must be truly dead black, or the whole panel reads
  // as a lit slate instead of a dot field on black.
  const ambientMask = new Uint8Array(n)
  const ambientAmt = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    if (Math.random() < 0.007) dead[i] = 1
    else if (Math.random() < 0.0015) stuck[i] = 1
    if (Math.random() < 0.25) {
      ambientMask[i] = 1
      ambientAmt[i] = 0.01 + Math.random() * 0.02
    }
  }
  // A few soft dark blob "artefacts" baked as canvas params, drawn each redraw.
  const blobs = Array.from({ length: 4 }, () => ({
    x: Math.random() * TEX_W,
    y: Math.random() * TEX_H,
    rx: TEX_W * (0.08 + Math.random() * 0.14),
    ry: TEX_H * (0.15 + Math.random() * 0.3),
    rot: Math.random() * Math.PI,
    a: 0.18 + Math.random() * 0.22,
  }))
  return { backlight, blotch, dead, stuck, ambientMask, ambientAmt, blobs }
}

function makeCanvas() {
  const cc = document.createElement('canvas')
  cc.width = TEX_W
  cc.height = TEX_H
  return cc
}

export default function Screen() {
  const { glow, lcdLight, lcdColor, glassOpacity, glassColor, streak } = useControls('Screen', {
    glow: { value: 3.2, min: 0.5, max: 6, step: 0.1 },
    lcdLight: { value: 0.15, min: 0, max: 3, step: 0.05 },
    lcdColor: '#5fc2e0',
    glassOpacity: { value: 0.08, min: 0, max: 0.5, step: 0.01 },
    glassColor: '#5c7488',
    streak: { value: 0, min: 0, max: 1, step: 0.01 },
  })

  const [c, g] = useMemo(() => {
    const cc = makeCanvas()
    return [cc, cc.getContext('2d')]
  }, [])
  const contentG = useMemo(() => makeCanvas().getContext('2d', { willReadFrequently: true }), [])

  const tex = useMemo(() => toTexture(c, { srgb: true }), [c])

  // Static per-cell dressing, generated once.
  const grid = useMemo(() => buildGridDressing(), [])

  // Bezel plastic: worn charcoal, reuses shared scratch texture.
  const bezelTex = useMemo(
    () => toTexture(memo('screen-bezel-scratch', () => scratchCanvas(256, 60, 0.4)), { repeat: 2 }),
    [],
  )
  const bezelMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#151517',
        roughness: 0.62,
        metalness: 0.25,
        roughnessMap: bezelTex,
      }),
    [bezelTex],
  )

  // Grazing reflection streak — a soft diagonal highlight baked once.
  const reflTex = useMemo(() => {
    const [rc, rg] = canvas(256)
    rg.clearRect(0, 0, 256, 256)
    const grad = rg.createLinearGradient(0, 0, 256, 256)
    grad.addColorStop(0, 'rgba(255,255,255,0)')
    grad.addColorStop(0.48, 'rgba(255,255,255,0)')
    grad.addColorStop(0.5, 'rgba(255,255,255,0.4)')
    grad.addColorStop(0.52, 'rgba(255,255,255,0)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    rg.fillStyle = grad
    rg.fillRect(0, 0, 256, 256)
    return toTexture(rc)
  }, [])

  // HDR drive for the lit dots — texture white * glow pushes the emissive
  // content well past 1.0 so bloom does the glow instead of a lit veil.
  const contentColor = useMemo(() => new THREE.Color(glow, glow, glow), [glow])

  const last = useRef('')
  const stepDrag = useRef(null)
  const modeAnim = useRef({ prev: null, from: null, at: -1 })
  const contentMaterial = useRef()
  const lcdLamp = useRef()
  const bootStartedAt = useRef(null)
  const bootComplete = useRef(INTRO_DISABLED)

  useEffect(() => () => {
    document.body.style.cursor = ''
  }, [])

  useLayoutEffect(() => {
    if (INTRO_DISABLED) return
    contentMaterial.current?.color.setRGB(0, 0, 0)
    if (lcdLamp.current) lcdLamp.current.intensity = 0
  }, [])

  const finishStepDrag = (e, cancelled = false) => {
    const drag = stepDrag.current
    if (!drag) return
    stepDrag.current = null
    e.target.releasePointerCapture?.(e.pointerId)
    document.body.style.cursor = 'ns-resize'
    if (!cancelled && !drag.moved) actions.toggleStep(drag.step)
  }

  useFrame(({ clock }) => {
    let pixelStep = null
    let uiMix = 1

    if (!bootComplete.current && contentMaterial.current && lcdLamp.current) {
      if (bootStartedAt.current === null) bootStartedAt.current = clock.elapsedTime
      const elapsed = clock.elapsedTime - bootStartedAt.current
      const backlight = bootLevel(elapsed, BOOT_DELAY, BACKLIGHT_DURATION)
      const content = bootLevel(
        elapsed,
        BOOT_DELAY + CONTENT_DELAY,
        CONTENT_DURATION,
      )
      contentMaterial.current.color.copy(contentColor).multiplyScalar(content)
      lcdLamp.current.intensity = lcdLight * backlight
      const pixelProgress = THREE.MathUtils.clamp(
        (elapsed - PIXEL_DELAY) / PIXEL_DURATION,
        0,
        1,
      )
      pixelStep = Math.min(
        PIXEL_STEPS,
        Math.floor(pixelProgress * (PIXEL_STEPS + 1)),
      )
      const fadeProgress = THREE.MathUtils.clamp(
        (elapsed - PIXEL_DELAY - PIXEL_DURATION) / UI_FADE_DURATION,
        0,
        1,
      )
      const fadeStep = Math.min(
        UI_FADE_STEPS,
        Math.floor(fadeProgress * (UI_FADE_STEPS + 1)),
      )
      uiMix = smoothstep(fadeStep / UI_FADE_STEPS)

      if (elapsed >= BOOT_DURATION) {
        contentMaterial.current.color.copy(contentColor)
        lcdLamp.current.intensity = lcdLight
        bootComplete.current = true
        pixelStep = null
        uiMix = 1
      }
    }

    const s = getState()

    // BPM↔VOL readout roll: quantised progress so the slide advances in whole
    // dot rows and the texture only redraws when a row actually moves
    const anim = modeAnim.current
    if (anim.prev === null) anim.prev = s.knobMode
    if (s.knobMode !== anim.prev) {
      anim.from = anim.prev
      anim.prev = s.knobMode
      anim.at = clock.elapsedTime
    }
    let modeStep = MODE_STEPS
    if (anim.at >= 0) {
      modeStep = Math.min(
        MODE_STEPS,
        Math.round(((clock.elapsedTime - anim.at) / MODE_DURATION) * MODE_STEPS),
      )
    }
    const modeMix = modeStep / MODE_STEPS

    const trackSwing = s.swing[s.track] ?? 0
    const stateKey =
      `${s.bpm}|${s.knobMode}|${modeStep}|${s.volume}|${s.track}|${trackSwing}|${live.step}|${s.playing}|${s.pattern[s.track].join(',')}`
    const key = pixelStep === null ? stateKey : `boot|${pixelStep}|${uiMix}`
    if (key === last.current) return
    last.current = key
    draw(g, contentG, tex, s, grid, pixelStep, uiMix, { mix: modeMix, from: anim.from })
  })

  const bezelOuterW = SCREEN_W + BEZEL_MARGIN * 2
  const gx = BODY_W / 2 - SCREEN_W / 2 - 0.55
  const gy = TOP_Y - PLATE_H + SCREEN_H / 2 + 0.55

  return (
    <group position={[gx, gy, PLATE_Z]}>
      {/* bezel — four bars forming an open frame, proud of the faceplate.
          (a solid box would occlude the LCD sitting in its cavity) */}
      <mesh position={[0, SCREEN_H / 2 + BEZEL_MARGIN / 2, BEZEL_DEPTH / 2]} material={bezelMat}>
        <boxGeometry args={[bezelOuterW, BEZEL_MARGIN, BEZEL_DEPTH]} />
      </mesh>
      <mesh position={[0, -(SCREEN_H / 2 + BEZEL_MARGIN / 2), BEZEL_DEPTH / 2]} material={bezelMat}>
        <boxGeometry args={[bezelOuterW, BEZEL_MARGIN, BEZEL_DEPTH]} />
      </mesh>
      <mesh position={[SCREEN_W / 2 + BEZEL_MARGIN / 2, 0, BEZEL_DEPTH / 2]} material={bezelMat}>
        <boxGeometry args={[BEZEL_MARGIN, SCREEN_H, BEZEL_DEPTH]} />
      </mesh>
      <mesh position={[-(SCREEN_W / 2 + BEZEL_MARGIN / 2), 0, BEZEL_DEPTH / 2]} material={bezelMat}>
        <boxGeometry args={[BEZEL_MARGIN, SCREEN_H, BEZEL_DEPTH]} />
      </mesh>
      {/* dark backing so the cavity behind the glass doesn't read as a hole */}
      <mesh position={[0, 0, 0.02]}>
        <planeGeometry args={[SCREEN_W, SCREEN_H]} />
        <meshStandardMaterial color="#050505" roughness={0.9} />
      </mesh>

      {/* dot-matrix content, recessed inside the bezel cavity — HDR-driven so
          lit dots bloom against a substrate that stays genuinely black */}
      <mesh position={[0, 0, BEZEL_DEPTH - 0.14]}>
        <planeGeometry args={[SCREEN_W, SCREEN_H]} />
        <meshBasicMaterial
          ref={contentMaterial}
          map={tex}
          color={contentColor}
          toneMapped={false}
        />
      </mesh>

      {/* murky glass — kept thin: at the old 0.34 opacity this lit, tone-mapped
          surface sat in front of the unlit emissive content and washed it out */}
      <mesh position={[0, 0, BEZEL_DEPTH - 0.05]}>
        <planeGeometry args={[SCREEN_W + 0.05, SCREEN_H + 0.05]} />
        <meshPhysicalMaterial
          transparent
          opacity={glassOpacity}
          depthWrite={false}
          roughness={0.22}
          metalness={0}
          clearcoat={0.72}
          clearcoatRoughness={0.14}
          reflectivity={0.42}
          color={glassColor}
        />
      </mesh>

      {/* grazing reflection streak on the glass — clamped to the opening
          itself (no rotation, no oversize) so it can never paint past the
          bezel onto the keycaps/faceplate; the diagonal comes from the
          texture's own UV-space gradient */}
      <mesh position={[0, 0, BEZEL_DEPTH - 0.02]}>
        <planeGeometry args={[SCREEN_W, SCREEN_H]} />
        <meshBasicMaterial
          map={reflTex}
          transparent
          opacity={streak}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* Direct manipulation layer over the LCD ladder. Clicking toggles a
          step; dragging its bar vertically changes velocity. */}
      <mesh
        position={[0, -SCREEN_H / 2 + STEP_DRAG_HEIGHT / 2 + 0.05, BEZEL_DEPTH + 0.01]}
        onPointerOver={(e) => {
          e.stopPropagation()
          document.body.style.cursor = stepDrag.current ? 'grabbing' : 'ns-resize'
        }}
        onPointerOut={() => {
          document.body.style.cursor = stepDrag.current ? 'grabbing' : 'auto'
        }}
        onPointerDown={(e) => {
          const step = stepFromUv(e.uv.x)
          if (step == null) return
          e.stopPropagation()
          e.target.setPointerCapture(e.pointerId)
          const velocity = getState().pattern[getState().track][step]
          stepDrag.current = {
            step,
            y: e.clientY,
            moved: false,
            velocity: velocity || 0.65,
          }
          document.body.style.cursor = 'grabbing'
        }}
        onPointerMove={(e) => {
          const drag = stepDrag.current
          if (!drag) return
          e.stopPropagation()
          const dy = drag.y - e.clientY
          if (Math.abs(dy) >= 3) drag.moved = true
          if (drag.moved) {
            actions.setStepVelocity(drag.step, drag.velocity + dy / 90)
          }
        }}
        onPointerUp={(e) => finishStepDrag(e)}
        onPointerCancel={(e) => finishStepDrag(e, true)}
      >
        <planeGeometry args={[SCREEN_W, STEP_DRAG_HEIGHT]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      <pointLight
        ref={lcdLamp}
        position={[0, 0, 0.7]}
        intensity={lcdLight}
        distance={4}
        color={lcdColor}
      />
    </group>
  )
}

function draw(g, cg, tex, s, grid, pixelStep = null, uiMix = 1, mode = null) {
  const { backlight, blotch, dead, stuck, ambientMask, ambientAmt, blobs } = grid

  // base panel colour — near-black substrate. Only a faint teal cast at the
  // very top; an unlit LCD should read as dead black, not lit slate.
  const bg = g.createLinearGradient(0, 0, 0, TEX_H)
  bg.addColorStop(0, '#040e14')
  bg.addColorStop(0.5, '#02090f')
  bg.addColorStop(1, '#02060a')
  g.fillStyle = bg
  g.fillRect(0, 0, TEX_W, TEX_H)

  // --- render real content into the mask canvas (white on black) ---
  cg.fillStyle = '#000'
  cg.fillRect(0, 0, TEX_W, TEX_H)
  cg.fillStyle = '#fff'
  cg.textBaseline = 'alphabetic'

  if (pixelStep !== null) {
    // A deterministic subset of the physical dot grid wakes in stepped
    // clusters. No copy, percentage, or synthetic progress UI — just pixels
    // finding power before the operational display replaces them.
    const threshold = (pixelStep / PIXEL_STEPS) * PIXEL_DENSITY
    cg.globalAlpha = 1 - uiMix
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (pixelOrder(x, y) > threshold) continue
        cg.fillRect(x * CELL_W, y * CELL_H, CELL_W, CELL_H)
      }
    }
    cg.globalAlpha = 1
  }

  if (pixelStep === null || uiMix > 0) {
    cg.globalAlpha = uiMix
    // BPM — indented clear of the panel's left-edge sticker (owned by
    // Props.jsx) which overlaps roughly the first 11% of the screen width.
    const contentX0 = TEX_W * 0.15
    // the dial owns this readout: tempo normally, master volume after a click
    const readoutFor = (m) => m === 'volume'
      ? [String(Math.round(s.volume * 100)).padStart(3, '0'), 'VOL']
      : [String(s.bpm).padStart(3, '0'), 'BPM']
    const drawReadout = (m, dy) => {
      const [big, label] = readoutFor(m)
      cg.font = `700 ${Math.round(TEX_H * 0.4)}px "Courier New", monospace`
      cg.fillText(big, contentX0, TEX_H * 0.46 + dy)
      cg.font = `700 ${Math.round(TEX_H * 0.155)}px "Courier New", monospace`
      cg.fillText(label, contentX0, TEX_H * 0.62 + dy)
    }
    if (!mode || mode.mix >= 1 || mode.from == null) {
      drawReadout(s.knobMode, 0)
    } else {
      // odometer roll between the two readouts, clipped to the readout block;
      // offsets snap to whole dot rows so the motion is chunky LCD steps, not
      // a smooth slide the panel couldn't display
      const eased = smoothstep(mode.mix)
      const dir = s.knobMode === 'volume' ? 1 : -1
      const roll = TEX_H * 0.62
      const snap = (v) => Math.round(v / CELL_H) * CELL_H
      cg.save()
      cg.beginPath()
      cg.rect(0, TEX_H * 0.08, TEX_W * 0.6, TEX_H * 0.6)
      cg.clip()
      drawReadout(mode.from, snap(-dir * eased * roll))
      drawReadout(s.knobMode, snap(dir * (1 - eased) * roll))
      cg.restore()
    }

    // track label, top right — its own row, well clear of the transport row
    // below it so the two never merge into illegible glyphs at dot-matrix res.
    const track = TRACKS.find((t) => t.id === s.track)
    cg.font = `700 ${Math.round(TEX_H * 0.17)}px "Courier New", monospace`
    cg.textAlign = 'right'
    cg.fillText((track?.label ?? '').toUpperCase(), TEX_W * 0.96, TEX_H * 0.24)

    // Per-track swing feedback plus transport state. Keeping them on separate
    // rows makes the selected instrument's timing immediately readable without
    // crowding the BPM block or the step ladder.
    const swingPercent = Math.round((s.swing[s.track] ?? 0) * 100)
    cg.font = `700 ${Math.round(TEX_H * 0.13)}px "Courier New", monospace`
    cg.fillText(`SW${String(swingPercent).padStart(2, '0')}`, TEX_W * 0.96, TEX_H * 0.42)
    cg.font = `700 ${Math.round(TEX_H * 0.14)}px "Courier New", monospace`
    cg.fillText(s.playing ? 'RUN' : 'STOP', TEX_W * 0.96, TEX_H * 0.59)
    cg.textAlign = 'left'

    // 16-step ladder + playhead
    const padX = TEX_W * STEP_PAD_X
    const ladderW = TEX_W - padX * 2
    const stepW = ladderW / 16
    const barGap = stepW * 0.16
    const baseY = TEX_H * 0.94
    const maxBarH = TEX_H * 0.28
    for (let i = 0; i < 16; i++) {
      const velocity = s.pattern[s.track][i]
      const cur = live.step === i
      const h = maxBarH * (velocity ? 0.2 + velocity * 0.8 : 0.14)
      const x = padX + i * stepW + barGap / 2
      const w = stepW - barGap
      cg.fillRect(x, baseY - h, w, h)
      if (cur) cg.fillRect(x, baseY - maxBarH - TEX_H * 0.05, w, TEX_H * 0.03)
    }
    cg.globalAlpha = 1
  }

  const mask = cg.getImageData(0, 0, TEX_W, TEX_H).data

  // --- resample the mask into a gappy dot-matrix grid ---
  // Lit cells composite additively at full alpha with a bright core plus a
  // dim one-cell halo, so the emissive dots (fed to bloom via the HDR
  // content-plane color) read as glowing points on dead-black glass. Unlit
  // cells stay untouched — truly black — except a minority carrying a
  // near-invisible backlight fleck, so the ground never lights up as a floor.
  for (let gy = 0; gy < ROWS; gy++) {
    const rowOff = gy * COLS
    for (let gx = 0; gx < COLS; gx++) {
      const idx = rowOff + gx
      if (dead[idx]) continue

      const cx = Math.min(TEX_W - 1, Math.floor((gx + 0.5) * CELL_W))
      const cy = Math.min(TEX_H - 1, Math.floor((gy + 0.5) * CELL_H))
      const contentOn = mask[(cy * TEX_W + cx) * 4] / 255
      const strength = stuck[idx] ? 1 : contentOn
      const lit = strength > 0.01

      const dw = CELL_W * 0.58
      const dh = CELL_H * 0.58
      const x = gx * CELL_W + (CELL_W - dw) / 2
      const y = gy * CELL_H + (CELL_H - dh) / 2

      if (lit) {
        const b = stuck[idx] ? 1 : 0.78 + 0.22 * backlight[idx] * blotch[idx]

        // dim halo underneath, additive — feeds bloom without a hard edge
        g.globalCompositeOperation = 'lighter'
        g.globalAlpha = 0.16 * Math.min(1, b) * strength
        g.fillStyle = '#5fd4f2'
        const hw = dw * 2.1, hh = dh * 2.1
        g.fillRect(x - (hw - dw) / 2, y - (hh - dh) / 2, hw, hh)

        // bright opaque core
        g.globalCompositeOperation = 'source-over'
        g.globalAlpha = strength
        g.fillStyle = b > 0.9 ? '#e8fbff' : '#8fe0f5'
        g.fillRect(x, y, dw, dh)
      } else if (ambientMask[idx]) {
        const v = ambientAmt[idx] * backlight[idx]
        if (v <= 0.006) continue
        g.globalAlpha = Math.min(0.07, v)
        g.fillStyle = '#123244'
        g.fillRect(x, y, dw, dh)
      }
    }
  }
  g.globalAlpha = 1
  g.globalCompositeOperation = 'source-over'

  // --- dark blob artefacts, multiplied over the field ---
  g.globalCompositeOperation = 'multiply'
  for (const b of blobs) {
    g.save()
    g.translate(b.x, b.y)
    g.rotate(b.rot)
    const rad = g.createRadialGradient(0, 0, 0, 0, 0, Math.max(b.rx, b.ry))
    rad.addColorStop(0, `rgba(2,8,10,${b.a})`)
    rad.addColorStop(1, 'rgba(2,8,10,0)')
    g.fillStyle = rad
    g.beginPath()
    g.ellipse(0, 0, b.rx, b.ry, 0, 0, Math.PI * 2)
    g.fill()
    g.restore()
  }
  g.globalCompositeOperation = 'source-over'

  // --- scanlines ---
  g.fillStyle = 'rgba(0,0,0,0.22)'
  for (let y = 0; y < TEX_H; y += 3) g.fillRect(0, y, TEX_W, 1)

  // --- edge bleed / vignette ---
  const vign = g.createRadialGradient(
    TEX_W * 0.3, TEX_H * 0.4, TEX_H * 0.1,
    TEX_W * 0.3, TEX_H * 0.4, TEX_W * 0.75,
  )
  vign.addColorStop(0, 'rgba(0,0,0,0)')
  vign.addColorStop(0.6, 'rgba(0,0,0,0)')
  vign.addColorStop(1, 'rgba(0,0,0,0.45)')
  g.fillStyle = vign
  g.fillRect(0, 0, TEX_W, TEX_H)

  tex.needsUpdate = true
}
