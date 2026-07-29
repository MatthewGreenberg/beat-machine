import { useMemo } from 'react'
import { useControls } from 'leva'
import Keycap from './Keycap'
import { capColorMap } from './capMaterials'
import { useStore, actions, live, TRACKS } from '../state/store'
import {
  PITCH, keyX, keyY, PLATE_Z, TRACK_KEYS, SWING_KEY,
  STEP_COLS, stepPos, PLAY_KEY, CLEAR_KEY,
} from './layout'

const CREAM = '#efe9dc'
const CHARCOAL = '#3a3a3d'
const TAN = '#d45b19'

const CAP_Z = PLATE_Z + 0.02

// Step caps read 1 when programmed, 0 when empty — the pattern is literally
// printed on the hardware.
const stepMap = (on, i) =>
  capColorMap(CREAM, on ? '1' : '0', {
    key: `step-v2-${on ? 1 : 0}-${i % 4}`,
    wearKey: `step-v2-wear-${i % 4}`,
    size: 240,
    y: 0.53,
    rot: (((i * 37) % 7) - 3) * 0.004,
    ink: 'rgba(30,26,22,0.86)',
    grime: 0.16 + (i % 3) * 0.05,
    edge: 0.5,
  })

const trackGlyphs = {
  kick: (g, S) => glyph(g, S, '●', 190),
  snare: (g, S) => glyph(g, S, '≡', 200),
  hat: (g, S) => glyph(g, S, '✕', 170),
  clap: (g, S) => glyph(g, S, '◈', 180),
}

function glyph(g, S, ch, size, ink = 'rgba(226,222,214,0.72)') {
  g.fillStyle = ink
  g.font = `300 ${size}px "Helvetica Neue", Arial`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(ch, S / 2, S * 0.52)
}

export default function Keys() {
  const { pattern, track, playing } = useStore()
  const row = pattern[track]

  const { cream, creamRough, charcoal, charcoalRough, tan, tanRough } = useControls('Caps', {
    cream: '#ffffff',
    creamRough: { value: 0.95, min: 0, max: 1, step: 0.01 },
    charcoal: '#646464',
    charcoalRough: { value: 0.61, min: 0, max: 1, step: 0.01 },
    tan: '#d45b19',
    tanRough: { value: 1, min: 0, max: 1, step: 0.01 },
  })

  const trackMaps = useMemo(
    () => Object.fromEntries(TRACKS.map((t) => [
      t.id,
      capColorMap(CHARCOAL, trackGlyphs[t.id], { key: `trk-${t.id}`, grime: 0.3, edge: 0.62 }),
    ])),
    [],
  )

  const swingMap = useMemo(
    () => capColorMap(CHARCOAL, (g, S) => glyph(g, S, '≈', 180), { key: 'swing', grime: 0.3, edge: 0.62 }),
    [],
  )

  // The tall caps are 2u, so their maps are drawn in a square that gets
  // stretched along y. The transport stays orange; the clear key uses the
  // same near-black plastic as the modifier row.
  const playMap = useMemo(
    () => capColorMap(TAN, null, { key: 'play-orange', grime: 0.26, edge: 0.55 }),
    [],
  )

  const clearMap = useMemo(
    () => capColorMap('#242427', null, { key: 'clear-black-v2', grime: 0.34, edge: 0.7 }),
    [],
  )

  return (
    <group>
      {/* modifier row — track select */}
      {TRACKS.map((t, i) => (
        <Keycap
          key={t.id}
          position={[keyX(TRACK_KEYS[i]), keyY(0), CAP_Z]}
          height={0.86}
          color={track === t.id ? '#54545a' : charcoal}
          map={trackMaps[t.id]}
          roughness={charcoalRough}
          metalness={0.22}
          depth={track === t.id ? 1 : 0}
          onPress={() => actions.selectTrack(t.id)}
        />
      ))}
      <Keycap
        position={[keyX(SWING_KEY), keyY(0), CAP_Z]}
        height={0.86}
        color={charcoal}
        map={swingMap}
        roughness={charcoalRough}
        metalness={0.22}
        onPress={() => actions.cycleSwing()}
      />

      {/* 16 step pads */}
      {row.map((v, i) => {
        const { col, row: r } = stepPos(i)
        return (
          <Keycap
            key={i}
            position={[keyX(col), keyY(r), CAP_Z]}
            color={cream}
            map={stepMap(!!v, i)}
            roughness={creamRough}
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

      {/* right column: clear above, orange transport below */}
      <Keycap
        position={[keyX(CLEAR_KEY.col), keyY(CLEAR_KEY.row, CLEAR_KEY.span), CAP_Z]}
        span={CLEAR_KEY.span}
        height={0.92}
        color="#26262a"
        map={clearMap}
        roughness={0.48}
        metalness={0.3}
        onPress={() => actions.clear()}
      >
        {/* Raised six-spoke clear mark: brighter and larger than the old
            texture print, so it remains legible on the near-black cap. */}
        <group position={[0, 0, 0.905]} renderOrder={2}>
          {[0, Math.PI / 3, (Math.PI * 2) / 3].map((rotation) => (
            <mesh key={rotation} rotation={[0, 0, rotation]}>
              <boxGeometry args={[0.58, 0.065, 0.016]} />
              <meshBasicMaterial
                color="#827c72"
                transparent
                opacity={0.78}
                depthWrite={false}
              />
            </mesh>
          ))}
        </group>
      </Keycap>
      <Keycap
        position={[keyX(PLAY_KEY.col), keyY(PLAY_KEY.row, PLAY_KEY.span), CAP_Z]}
        span={PLAY_KEY.span}
        height={0.92}
        color={tan}
        map={playMap}
        roughness={tanRough}
        depth={playing ? 1 : 0}
        onPress={() => actions.togglePlay()}
      >
        <mesh position={[0, 0, 0.902]} scale={[1, 1.08, 1]} renderOrder={2}>
          <circleGeometry args={[0.34, 3]} />
          <meshBasicMaterial
            color="#3b1607"
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
