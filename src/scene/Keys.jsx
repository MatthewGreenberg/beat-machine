import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useControls } from 'leva'
import Keycap from './Keycap'
import { capColorMap } from './capMaterials'
import { useStore, actions, live, TRACKS } from '../state/store'
import {
  PITCH, keyX, keyY, PLATE_Z, TRACK_KEYS, SWING_KEY,
  STEP_COLS, stepPos, PLAY_KEY, CLEAR_KEY,
} from './layout'
import { FINISHES, getFinish } from '../finishes'

const CAP_Z = PLATE_Z + 0.02

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

const trackGlyphs = {
  kick: (g, S, ink) => glyph(g, S, '●', 190, ink),
  snare: (g, S, ink) => glyph(g, S, '≡', 200, ink),
  hat: (g, S, ink) => glyph(g, S, '✕', 170, ink),
  clap: (g, S, ink) => glyph(g, S, '◈', 180, ink),
}

function glyph(g, S, ch, size, ink = 'rgba(226,222,214,0.72)') {
  g.fillStyle = ink
  g.font = `300 ${size}px "Helvetica Neue", Arial`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(ch, S / 2, S * 0.52)
}

function GlowGlyph({ type, color, active = false }) {
  const material = (
    <meshBasicMaterial
      color={color}
      transparent
      opacity={active ? 0.78 : 0.56}
      depthWrite={false}
      toneMapped={false}
    />
  )

  const bar = (key, position, scale, rotation = 0) => (
    <mesh key={key} position={position} rotation={[0, 0, rotation]}>
      <boxGeometry args={scale} />
      {material}
    </mesh>
  )

  let mark
  if (type === 'kick') {
    mark = (
      <mesh>
        <circleGeometry args={[0.145, 32]} />
        {material}
      </mesh>
    )
  } else if (type === 'snare') {
    mark = [-0.13, 0, 0.13].map((y) => bar(y, [0, y, 0], [0.34, 0.045, 0.014]))
  } else if (type === 'hat') {
    mark = [
      bar('a', [0, 0, 0], [0.38, 0.055, 0.014], Math.PI / 4),
      bar('b', [0, 0, 0], [0.38, 0.055, 0.014], -Math.PI / 4),
    ]
  } else if (type === 'clap') {
    mark = [
      bar('tl', [-0.1, 0.1, 0], [0.24, 0.045, 0.014], -Math.PI / 4),
      bar('tr', [0.1, 0.1, 0], [0.24, 0.045, 0.014], Math.PI / 4),
      bar('bl', [-0.1, -0.1, 0], [0.24, 0.045, 0.014], Math.PI / 4),
      bar('br', [0.1, -0.1, 0], [0.24, 0.045, 0.014], -Math.PI / 4),
    ]
  } else {
    mark = [
      bar('top', [0, 0.09, 0], [0.35, 0.045, 0.014], 0.09),
      bar('bottom', [0, -0.09, 0], [0.35, 0.045, 0.014], -0.09),
    ]
  }

  return <group position={[0, 0, 0.842]} renderOrder={4}>{mark}</group>
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
          key: `trk-v3-${activeFinish.id}-${t.id}`,
          clean: keys.clean,
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
      (g, S) => glyph(g, S, '≈', 180, keys.glyphInk),
      {
        key: `swing-v3-${activeFinish.id}`,
        clean: keys.clean,
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

      {/* 16 step pads */}
      {row.map((v, i) => {
        const { col, row: r } = stepPos(i)
        return (
          <Keycap
            key={i}
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
        )
      })}

      {/* right column: finish selector above, orange transport below */}
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
    </group>
  )
}

export { PITCH, STEP_COLS }
