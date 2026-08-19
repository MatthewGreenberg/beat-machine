import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useControls } from 'leva'
import Keycap from './Keycap'
import { capColorMap } from './capMaterials'
import { canvas as makeCanvas, memo, toTexture } from './textures'
import { useStore, actions, live, TRACKS } from '../state/store'
import {
  CAP, PITCH, keyX, keyY, PLATE_Z, TRACK_KEYS, SWING_KEY,
  STEP_COLS, stepPos, PLAY_KEY, CLEAR_KEY,
} from './layout'
import { FINISHES, getFinish } from '../finishes'

const CAP_Z = PLATE_Z + 0.02

// go-go-gadget retraction: each key row drops into the chassis on its own
// beat before the FX glass sweeps the face — top row leads on the way out,
// so reassembly on close runs bottom-up. `row` may be fractional for the
// tall right-column keys that straddle two rows.
function FxSink({ row, children }) {
  const ref = useRef()
  useFrame(() => {
    const g = ref.current
    if (!g) return
    const v = THREE.MathUtils.clamp((live.fxMorph - (0.1 + row * 0.07)) / 0.2, 0, 1)
    g.position.z = -(v * v * (3 - 2 * v)) * 1.5
  })
  return <group ref={ref}>{children}</group>
}

const CHIP_DIM = new THREE.Color('#6b6760')
const CHIP_ACCENTS = FINISHES.map((f) => new THREE.Color(f.accent))

// The lit chip glides between positions instead of snapping: width, color and
// opacity all damp toward the active finish each frame.
function FinishChips({ finish }) {
  const refs = useRef([])
  useFrame((_, delta) => {
    refs.current.forEach((mesh, index) => {
      if (!mesh) return
      const on = index === finish
      mesh.scale.x = THREE.MathUtils.damp(mesh.scale.x, on ? 0.54 / 0.38 : 1, 7, delta)
      const mat = mesh.material
      mat.opacity = THREE.MathUtils.damp(mat.opacity, on ? 1 : 0.48, 7, delta)
      mat.color.lerp(on ? CHIP_ACCENTS[index] : CHIP_DIM, 1 - Math.exp(-7 * delta))
    })
  })
  return (
    <group position={[0, 0, 0.905]} renderOrder={2}>
      {FINISHES.map((option, index) => (
        <mesh key={option.id} ref={(m) => (refs.current[index] = m)} position={[0, (index - (FINISHES.length - 1) / 2) * 0.34, 0]}>
          <boxGeometry args={[0.38, 0.09, 0.018]} />
          <meshBasicMaterial
            color={index === finish ? option.accent : '#6b6760'}
            transparent
            opacity={index === finish ? 1 : 0.48}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  )
}

// Step caps read 1 when programmed, 0 when empty — the pattern is literally
// printed on the hardware.
const stepMap = (finish, on, i) =>
  capColorMap(finish.keys.step, on ? '1' : '0', {
    key: `step-v3-${finish.id}-${on ? 1 : 0}-${i % 4}`,
    wearKey: `step-v3-wear-${finish.id}-${i % 4}`,
    size: 240,
    y: 0.53,
    rot: (((i * 37) % 7) - 3) * 0.004,
    ink: finish.keys.stepInk,
    clean: finish.keys.clean,
    age: finish.keys.clean ? 0 : undefined,
    grime: finish.keys.clean ? 0 : 0.16 + (i % 3) * 0.05,
    edge: 0.5,
  })

const TAU = Math.PI * 2

// Drum iconography, not typography: a kick head with its beater spot, the
// same head strung with snare wires, two cymbals on a stand, a clap burst.
// '≡' and '◈' told you nothing about which drum you were about to program.
// GLYPH_SCALE shrinks the whole family — stroke weight included, so they
// stay marks rather than becoming chunky miniatures. GlowGlyph's group
// carries the same factor.
const GLYPH_SCALE = 0.48

function pen(g, S, ink) {
  g.strokeStyle = ink
  g.fillStyle = ink
  g.lineWidth = S * 0.05 * GLYPH_SCALE
  g.lineCap = 'round'
  g.lineJoin = 'round'
  return [S / 2, S * 0.52, S * 0.3 * GLYPH_SCALE] // cx, cy, r
}

// wire chords across a drum head, at fractions of the radius
const WIRES = [-0.42, 0, 0.42]
const wireHalf = (r, t) => Math.sqrt(Math.max(0, 1 - t * t)) * r * 0.92

const trackGlyphs = {
  kick: (g, S, ink) => {
    const [cx, cy, r] = pen(g, S, ink)
    g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.stroke()
    g.beginPath(); g.arc(cx, cy, r * 0.34, 0, TAU); g.fill()
  },
  snare: (g, S, ink) => {
    const [cx, cy, r] = pen(g, S, ink)
    g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.stroke()
    for (const t of WIRES) {
      const dx = wireHalf(r, t)
      g.beginPath(); g.moveTo(cx - dx, cy + r * t); g.lineTo(cx + dx, cy + r * t); g.stroke()
    }
  },
  hat: (g, S, ink) => {
    const [cx, cy, r] = pen(g, S, ink)
    // canvas y runs down: dir flips the open side so the top cymbal points up
    // and the bottom one points down, the way a closed hi-hat sits.
    for (const [apex, dir] of [[-0.62, 1], [0.42, -1]]) {
      g.beginPath()
      g.moveTo(cx - r * 1.1, cy + r * (apex + dir * 0.32))
      g.lineTo(cx, cy + r * apex)
      g.lineTo(cx + r * 1.1, cy + r * (apex + dir * 0.32))
      g.stroke()
    }
    g.beginPath(); g.moveTo(cx, cy + r * 0.42); g.lineTo(cx, cy + r * 1.05); g.stroke()
  },
  // swung eighths: the grid loosened into two waves
  swing: (g, S, ink) => {
    const [cx, cy, r] = pen(g, S, ink)
    for (const dy of [-0.52, 0.52]) {
      g.beginPath()
      for (let i = 0; i <= 24; i++) {
        const u = i / 24
        const px = cx + (u - 0.5) * r * 2.2
        const py = cy + r * dy + Math.sin(u * TAU) * r * 0.3
        i === 0 ? g.moveTo(px, py) : g.lineTo(px, py)
      }
      g.stroke()
    }
  },
  clap: (g, S, ink) => {
    const [cx, cy, r] = pen(g, S, ink)
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + TAU / 16
      const r1 = r * (i % 2 === 0 ? 1.15 : 0.78)
      g.beginPath()
      g.moveTo(cx + Math.cos(a) * r * 0.34, cy + Math.sin(a) * r * 0.34)
      g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1)
      g.stroke()
    }
  },
}

// The emissive twin is the SAME draw call on a transparent canvas, laid over
// the cap as a plane. It used to be hand-built geometry in its own coordinate
// system, which meant every glyph edit silently drifted the glow off the
// print — visible on the two skins that light it (glass, plasma). Cap UVs map
// the full canvas across CAP local units, so a CAP-sized plane registers
// exactly, by construction.
// Baked white and tinted by the material, so all skins share one texture
// per shape rather than one per shape-and-colour.
const glyphTexture = (type) => memo(`glyphglow:${type}`, () => {
  const [c, g] = makeCanvas(512)
  trackGlyphs[type](g, 512, '#fff')
  return toTexture(c, { srgb: true })
})

// Cobalt and violet are the two skins that light their glyphs, and they are
// also the two where the cap TINT can't carry the selection — cobalt's caps
// are transmissive, so modifierActive washes out through the glass, and both
// sit dark enough that a lightness jump disappears. So the glow does the
// signalling: a lit trace means live, and the printed glyphInk underneath
// keeps the unselected caps perfectly readable at 0.3.
function GlowGlyph({ type, color, active = false }) {
  const map = useMemo(() => glyphTexture(type), [type])
  return (
    <mesh position={[0, 0, 0.842]} renderOrder={4}>
      <planeGeometry args={[CAP, CAP]} />
      <meshBasicMaterial
        map={map}
        color={color}
        transparent
        opacity={active ? 1 : 0.3}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  )
}

export default function Keys() {
  const { pattern, track, playing, finish } = useStore()
  const row = pattern[track]
  const activeFinish = getFinish(finish)
  const keys = activeFinish.keys

  // live-tunable lacquer, layered over the finish's own material block
  const coat = useControls('Clearcoat', {
    clearcoat: { value: 0.9, min: 0, max: 1, step: 0.01 },
    clearcoatRoughness: { value: 0.14, min: 0, max: 1, step: 0.01 },
    envMapIntensity: { value: 1.25, min: 0, max: 3, step: 0.05 },
  })
  const capMaterialProps = useMemo(() => ({ ...keys.material, ...coat }), [keys, coat])

  const trackMaps = useMemo(
    () => Object.fromEntries(TRACKS.map((t) => [
      t.id,
      capColorMap(
        keys.modifier,
        (g, S) => trackGlyphs[t.id](g, S, keys.glyphInk),
        {
          key: `trk-v4-${activeFinish.id}-${t.id}`,
          clean: keys.clean,
          inkWear: keys.glyphInkWear,
          age: keys.clean ? 0 : undefined,
          grime: keys.clean ? 0 : 0.3,
          edge: 0.62,
        },
      ),
    ])),
    [activeFinish.id, keys],
  )

  const swingMap = useMemo(
    () => capColorMap(
      keys.modifier,
      (g, S) => trackGlyphs.swing(g, S, keys.glyphInk),
      {
        key: `swing-v5-${activeFinish.id}`,
        clean: keys.clean,
        inkWear: keys.glyphInkWear,
        age: keys.clean ? 0 : undefined,
        grime: keys.clean ? 0 : 0.3,
        edge: 0.62,
      },
    ),
    [activeFinish.id, keys],
  )

  const playMap = useMemo(
    () => capColorMap(keys.play, null, {
      key: `play-v3-${activeFinish.id}`,
      clean: keys.clean,
      age: keys.clean ? 0 : undefined,
      grime: keys.clean ? 0 : 0.26,
      edge: 0.55,
    }),
    [activeFinish.id, keys],
  )

  const clearMap = useMemo(
    () => capColorMap(keys.clear, null, {
      key: `clear-v3-${activeFinish.id}`,
      clean: keys.clean,
      age: keys.clean ? 0 : undefined,
      grime: keys.clean ? 0 : 0.34,
      edge: 0.7,
    }),
    [activeFinish.id, keys],
  )

  return (
    <group>
      {/* modifier row — track select */}
      <FxSink row={0}>
      {TRACKS.map((t, i) => (
        <Keycap
          key={t.id}
          introIndex={i}
          position={[keyX(TRACK_KEYS[i]), keyY(0), CAP_Z]}
          height={0.86}
          color={track === t.id ? keys.modifierActive : keys.modifier}
          map={trackMaps[t.id]}
          roughness={keys.modifierRough}
          metalness={keys.metalness}
          materialProps={capMaterialProps}
          depth={track === t.id ? 1 : 0}
          onPress={() => actions.selectTrack(t.id)}
        >
          {keys.glyphGlow && (
            <GlowGlyph type={t.id} color={keys.glyphGlow} active={track === t.id} />
          )}
        </Keycap>
      ))}
      <Keycap
        introIndex={4}
        position={[keyX(SWING_KEY), keyY(0), CAP_Z]}
        height={0.86}
        color={keys.modifier}
        map={swingMap}
        roughness={keys.modifierRough}
        metalness={keys.metalness}
        materialProps={capMaterialProps}
        onPress={() => actions.cycleSwing()}
      >
        {keys.glyphGlow && <GlowGlyph type="swing" color={keys.glyphGlow} />}
      </Keycap>
      </FxSink>

      {/* 16 step pads */}
      {row.map((v, i) => {
        const { col, row: r } = stepPos(i)
        return (
          <FxSink row={r} key={i}>
          <Keycap
            introIndex={5 + i}
            position={[keyX(col), keyY(r), CAP_Z]}
            color={keys.step}
            map={stepMap(activeFinish, !!v, i)}
            roughness={keys.stepRough}
            metalness={keys.metalness * 0.45}
            materialProps={capMaterialProps}
            depth={v ? 0.35 + v * 0.65 : 0}
            pulse={() => (live.step === i ? 1 : 0)}
            onPress={() => actions.toggleStep(i)}
            onDragStart={() => v || 0.65}
            onDragY={(dy, startVelocity) => {
              actions.setStepVelocity(i, startVelocity + dy / 90)
            }}
            cursor="ns-resize"
          />
          </FxSink>
        )
      })}

      {/* right column: finish selector above, orange transport below */}
      <FxSink row={1.5}>
      <Keycap
        introIndex={21}
        position={[keyX(CLEAR_KEY.col), keyY(CLEAR_KEY.row, CLEAR_KEY.span), CAP_Z]}
        span={CLEAR_KEY.span}
        height={0.92}
        color={keys.clear}
        map={clearMap}
        roughness={keys.modifierRough}
        metalness={Math.max(0.3, keys.metalness)}
        materialProps={capMaterialProps}
        onPress={() => actions.cycleFinish()}
      >
        {/* Three finish chips turn the old clear symbol into a tactile material
            selector. The lit chip previews which surface is currently active. */}
        <FinishChips finish={finish} />
      </Keycap>
      </FxSink>
      <FxSink row={3.5}>
      <Keycap
        introIndex={22}
        position={[keyX(PLAY_KEY.col), keyY(PLAY_KEY.row, PLAY_KEY.span), CAP_Z]}
        span={PLAY_KEY.span}
        height={0.92}
        color={keys.play}
        map={playMap}
        roughness={keys.playRough}
        metalness={keys.metalness}
        materialProps={capMaterialProps}
        depth={playing ? 1 : 0}
        onPress={() => actions.togglePlay()}
      >
        <mesh position={[0, 0, 0.902]} scale={[1, 1.08, 1]} renderOrder={2}>
          <circleGeometry args={[0.34, 3]} />
          <meshBasicMaterial
            color={keys.playGlyph}
            transparent
            opacity={0.94}
            depthWrite={false}
          />
        </mesh>
      </Keycap>
      </FxSink>
    </group>
  )
}

export { PITCH, STEP_COLS }
