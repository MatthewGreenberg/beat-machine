import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useControls } from 'leva'
import * as THREE from 'three'
import { BODY_W, TOP_Y, PLATE_H, PLATE_Z } from './layout'
import { canvas, memo, toTexture } from './textures'
import { useStore, actions, getState } from '../state/store'
import { getFinish } from '../finishes'

// A solid, machined-aluminium tempo dial: radially brushed face, polished
// shoulder, and a physically ridged cross-knurl around the grip. Drag vertically
// for BPM; the dial still springs between detents like the original control.

const BASE_Z = -0.06
const KNURL_TOP = 1.04
const BAND_TOP = 1.20
const RIM_Z = 1.36
const R_RIM = 1.50
const FACE_R = 1.445

const SWEEP = Math.PI * 0.9
const DETENT = 3
// The app boots at 120 BPM, placing the index at roughly one o'clock like the
// supplied hardware reference.
const HOME_ANGLE = Math.PI * 0.51
const angleFor = (bpm) => HOME_ANGLE - ((bpm - 96) / 120) * SWEEP
// volume rides the same physical travel as the 60–180 BPM sweep
const angleForVolume = (v) => HOME_ANGLE - (v - 0.3) * SWEEP
// ring hint colour while the dial is a volume control — deliberately not any
// finish accent, so the mode change reads at a glance
// dimmer than the accents it replaces: a near-white ring at the strip's
// emissive strength blooms out, and mode is legible without the extra punch
const VOLUME_RING = '#7d99b3'

function smoothstep(edge0, edge1, value) {
  const t = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

// The reference grip gets its character from silhouette, not just a printed
// texture. This shell displaces two families of diagonal ridges so the diamond
// knurl catches light and breaks the outer edge at oblique angles.
function knurlGeometry(
  radius = 1.43,
  height = KNURL_TOP - BASE_Z,
  radialSegments = 192,
  heightSegments = 48,
) {
  const positions = []
  const colors = []
  const uvs = []
  const indices = []
  const teeth = 48
  const rows = 9

  for (let y = 0; y <= heightSegments; y++) {
    const v = y / heightSegments
    const z = BASE_Z + v * height
    const endFade = smoothstep(0, 0.055, v) * smoothstep(0, 0.055, 1 - v)

    for (let x = 0; x <= radialSegments; x++) {
      const u = x / radialSegments
      const theta = u * Math.PI * 2
      const axialPhase = v * rows * Math.PI * 2
      const diagonalA = Math.max(0, Math.cos(theta * teeth + axialPhase)) ** 5
      const diagonalB = Math.max(0, Math.cos(theta * teeth - axialPhase)) ** 5
      const ridge = Math.max(diagonalA, diagonalB) * endFade
      const r = radius + ridge * 0.065

      positions.push(Math.cos(theta) * r, Math.sin(theta) * r, z)
      uvs.push(u, v)

      // Oxidised valleys and bright freshly-handled ridge tops make the small
      // geometry legible even when the dial is only a few dozen pixels wide.
      const shade = 0.34 + ridge * 0.66
      colors.push(shade, shade, shade)
    }
  }

  const stride = radialSegments + 1
  for (let y = 0; y < heightSegments; y++) {
    for (let x = 0; x < radialSegments; x++) {
      const a = y * stride + x
      const b = a + 1
      const c = a + stride
      const d = c + 1
      indices.push(a, c, b, b, c, d)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function radialFaceCanvas(size = 1024, roughness = false) {
  const [c, g] = canvas(size)
  const mid = size / 2

  if (roughness) {
    g.fillStyle = '#b9b9b9'
    g.fillRect(0, 0, size, size)
  } else {
    // Broad sectors are the characteristic "fan" in a circularly brushed
    // aluminium face. The values stay close enough to let real reflections lead.
    const gradient = g.createConicGradient(-Math.PI / 2, mid, mid)
    const stops = 32
    for (let i = 0; i <= stops; i++) {
      const wave = Math.sin((i / stops) * Math.PI * 8 + 0.7)
      const fineWave = Math.sin((i / stops) * Math.PI * 22 - 0.35)
      const value = Math.round(207 + wave * 17 + fineWave * 4)
      gradient.addColorStop(i / stops, `rgb(${value},${value + 2},${value + 4})`)
    }
    g.fillStyle = gradient
    g.fillRect(0, 0, size, size)

    const glow = g.createRadialGradient(mid * 0.94, mid * 0.88, 0, mid, mid, mid)
    glow.addColorStop(0, 'rgba(255,255,255,0.11)')
    glow.addColorStop(0.72, 'rgba(255,255,255,0.02)')
    glow.addColorStop(1, 'rgba(50,55,58,0.08)')
    g.fillStyle = glow
    g.fillRect(0, 0, size, size)
  }

  // Dense radial hairlines make the brush direction readable without turning
  // the surface into a noisy bump map.
  g.save()
  g.translate(mid, mid)
  for (let i = 0; i < 2200; i++) {
    const a = Math.random() * Math.PI * 2
    const inner = size * Math.random() * 0.18
    const outer = size * (0.34 + Math.random() * 0.16)
    const light = Math.random() > 0.48
    const alpha = roughness
      ? 0.035 + Math.random() * 0.055
      : 0.018 + Math.random() * 0.042
    g.strokeStyle = light
      ? `rgba(255,255,255,${alpha})`
      : `rgba(24,30,34,${alpha})`
    g.lineWidth = Math.random() < 0.9 ? 0.55 : 1.1
    g.beginPath()
    g.moveTo(Math.cos(a) * inner, Math.sin(a) * inner)
    g.lineTo(Math.cos(a) * outer, Math.sin(a) * outer)
    g.stroke()
  }

  // Fine concentric tool paths sit underneath the radial hand-brush.
  for (let r = size * 0.035; r < size * 0.49; r += 1.85 + Math.random() * 0.9) {
    const alpha = roughness ? 0.046 : 0.029
    g.strokeStyle = `rgba(24,28,31,${alpha})`
    g.lineWidth = 0.55
    g.beginPath()
    g.arc(0, 0, r, 0, Math.PI * 2)
    g.stroke()
  }

  // Broken partial passes keep the machining from reading as a perfect
  // procedural sunburst. These are shallow lathe chatter, not damage.
  for (let i = 0; i < 260; i++) {
    const r = size * (0.08 + Math.random() * 0.40)
    const start = Math.random() * Math.PI * 2
    const length = 0.025 + Math.random() * 0.16
    const alpha = roughness
      ? 0.035 + Math.random() * 0.05
      : 0.015 + Math.random() * 0.035
    g.strokeStyle = Math.random() > 0.42
      ? `rgba(255,255,255,${alpha})`
      : `rgba(28,32,35,${alpha})`
    g.lineWidth = Math.random() < 0.88 ? 0.6 : 1.1
    g.beginPath()
    g.arc(0, 0, r, start, start + length)
    g.stroke()
  }
  g.restore()
  return c
}

function sideBrushCanvas(size = 512) {
  const [c, g] = canvas(size)
  g.fillStyle = '#dddddd'
  g.fillRect(0, 0, size, size)
  for (let y = 0; y < size; y++) {
    const v = 184 + Math.sin(y * 0.31) * 16 + Math.random() * 22
    g.fillStyle = `rgba(${v},${v},${v},0.22)`
    g.fillRect(0, y, size, 1)
  }

  // Object-space highlight bands are painted into the side texture instead of
  // coming from the world environment. They stay attached to the dial as the
  // whole machine follows the pointer, eliminating the sliding dark patches.
  g.globalCompositeOperation = 'multiply'
  const lockedLight = g.createLinearGradient(0, 0, size, 0)
  lockedLight.addColorStop(0, '#656b6e')
  lockedLight.addColorStop(0.14, '#cbd0d1')
  lockedLight.addColorStop(0.28, '#777e81')
  lockedLight.addColorStop(0.48, '#a8adaf')
  lockedLight.addColorStop(0.69, '#e7e9e9')
  lockedLight.addColorStop(0.82, '#858b8e')
  lockedLight.addColorStop(1, '#656b6e')
  g.fillStyle = lockedLight
  g.fillRect(0, 0, size, size)
  g.globalCompositeOperation = 'source-over'
  return c
}

// Engraved legend for the dial's push action, printed on a static center cap
// so the text doesn't spin with the tempo detents.
function pushCapCanvas(size = 256) {
  const [c, g] = canvas(size)
  g.clearRect(0, 0, size, size)
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  // ragged ink pass: jittered low-alpha repeats rough up the letter edges so
  // the print reads as worn pad-printing, not a fresh vector stamp
  const stamp = (text, font, y, alpha) => {
    g.font = font
    for (let i = 0; i < 7; i++) {
      g.fillStyle = `rgba(24,28,31,${alpha * (0.3 + Math.random() * 0.35)})`
      g.fillText(
        text,
        size / 2 + (Math.random() - 0.5) * size * 0.008,
        y + (Math.random() - 0.5) * size * 0.008,
      )
    }
  }
  stamp('PUSH', `700 ${Math.round(size * 0.3)}px Arial, sans-serif`, size * 0.38, 0.88)
  stamp('BPM / VOL', `700 ${Math.round(size * 0.16)}px Arial, sans-serif`, size * 0.64, 0.66)

  // chip flecks of ink back out — decades of thumbs on the cap
  g.globalCompositeOperation = 'destination-out'
  for (let i = 0; i < 520; i++) {
    const a = Math.random() * Math.PI * 2
    const r = Math.random() * size * 0.42
    g.fillStyle = `rgba(0,0,0,${0.25 + Math.random() * 0.55})`
    const w = 1 + Math.random() * 2.6
    g.fillRect(size / 2 + Math.cos(a) * r, size / 2 + Math.sin(a) * r, w, w * (0.5 + Math.random()))
  }
  g.globalCompositeOperation = 'source-over'
  return c
}

function capsuleGeometry(start, end, width) {
  const r = width / 2
  const shape = new THREE.Shape()
  shape.moveTo(start, -r)
  shape.lineTo(end, -r)
  shape.absarc(end, 0, r, -Math.PI / 2, Math.PI / 2, false)
  shape.lineTo(start, r)
  shape.absarc(start, 0, r, Math.PI / 2, Math.PI * 1.5, false)
  shape.closePath()
  return new THREE.ShapeGeometry(shape, 12)
}

export default function Knob() {
  const spin = useRef()
  const rock = useRef()
  const drag = useRef(null)
  const hover = useRef(false)
  const spring = useRef({ a: angleFor(getState().bpm), v: 0 })
  const wobble = useRef({ a: 0, v: 0, grab: 0 })
  const bpm = useStore((state) => state.bpm)
  const volume = useStore((state) => state.volume)
  const knobMode = useStore((state) => state.knobMode)
  const finishIndex = useStore((state) => state.finish)
  const finish = getFinish(finishIndex)
  const ringAccent = finish.accent
  // Coloured skins get a dial tinted to a dark version of their accent; the
  // ivory machine keeps its bare-aluminium dial.
  const knobTint = useMemo(
    () => {
      if (finish.id === 'ivory') return null
      return new THREE.Color(finish.accent).lerp(new THREE.Color('#000000'), 0.7)
    },
    [finish.id, finish.accent],
  )
  const ringTarget = useMemo(() => {
    const emissive = new THREE.Color(knobMode === 'volume' ? VOLUME_RING : ringAccent)
    return {
      emissive,
      surface: emissive.clone().lerp(new THREE.Color('#ffffff'), 0.38),
    }
  }, [ringAccent, knobMode])

  const {
    metalColor,
    faceRoughness,
    metalEnv,
  } = useControls('Knob', {
    metalColor: '#bec4c6',
    faceRoughness: { value: 0.38, min: 0.08, max: 0.8, step: 0.01 },
    metalEnv: { value: 1.35, min: 0, max: 3, step: 0.05 },
  })

  const geometry = useMemo(() => ({
    knurl: knurlGeometry(),
    face: new THREE.CircleGeometry(FACE_R, 192),
    groove: capsuleGeometry(0.83, 1.36, 0.094),
    indicator: capsuleGeometry(0.855, 1.35, 0.044),
  }), [])

  const textures = useMemo(() => ({
    faceColor: memo(
      'knob:solid-face-color-v2',
      () => toTexture(radialFaceCanvas(1024), { srgb: true, aniso: 16 }),
    ),
    faceRough: memo(
      'knob:solid-face-rough-v2',
      () => toTexture(radialFaceCanvas(1024, true), { aniso: 16 }),
    ),
    sideBrush: memo(
      'knob:solid-side-brush-frozen-v1',
      () => toTexture(sideBrushCanvas(512), { srgb: true, aniso: 16 }),
    ),
    pushCap: memo(
      'knob:push-cap-v3',
      () => toTexture(pushCapCanvas(256), { srgb: true, aniso: 8 }),
    ),
  }), [])

  const materials = useMemo(() => ({
    face: new THREE.MeshPhysicalMaterial({
      color: metalColor,
      map: textures.faceColor,
      // A small diffuse component keeps the aluminium legible in this mostly
      // black reflection environment while the polished highlights stay metal.
      metalness: 0.78,
      roughness: faceRoughness,
      roughnessMap: textures.faceRough,
      bumpMap: textures.faceRough,
      bumpScale: 0.004,
      anisotropy: 0.62,
      envMapIntensity: metalEnv,
      clearcoat: 0.08,
      clearcoatRoughness: 0.3,
    }),
    // These three side materials intentionally ignore scene lights and the
    // environment map. Their texture contains a fixed, machined-metal lighting
    // pass, so parallax can no longer slide reflections across the barrel.
    knurl: new THREE.MeshBasicMaterial({
      color: '#bdc3c5',
      map: textures.sideBrush,
      vertexColors: true,
      toneMapped: true,
    }),
    band: new THREE.MeshBasicMaterial({
      color: '#e4e8e9',
      map: textures.sideBrush,
      toneMapped: true,
    }),
    bevel: new THREE.MeshBasicMaterial({
      color: '#cbd0d1',
      map: textures.sideBrush,
      toneMapped: true,
    }),
    groove: new THREE.MeshStandardMaterial({
      color: '#303438',
      metalness: 0.92,
      roughness: 0.48,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
    indicator: new THREE.MeshPhysicalMaterial({
      color: '#f2f4f4',
      emissive: '#4b5154',
      emissiveIntensity: 0.38,
      metalness: 0.72,
      roughness: 0.19,
      envMapIntensity: metalEnv * 1.5,
      clearcoat: 0.22,
      clearcoatRoughness: 0.1,
      polygonOffset: true,
      polygonOffsetFactor: -4,
    }),
    ringLight: new THREE.MeshStandardMaterial({
      color: '#e89c77',
      emissive: '#d96a2b',
      emissiveIntensity: 2.15,
      metalness: 0.08,
      roughness: 0.28,
      toneMapped: true,
    }),
  }), [faceRoughness, metalColor, metalEnv, textures])

  // Tint targets, not new materials: rebuilding the dial's materials on a skin
  // change forces a shader recompile and hitches the switch. The frame loop
  // eases the existing colours instead, matching the ring's crossfade.
  const tintTargets = useMemo(() => {
    const mix = (hex) => {
      const c = new THREE.Color(hex)
      return knobTint ? c.lerp(knobTint, 0.78) : c
    }
    return {
      face: mix(metalColor),
      knurl: mix('#bdc3c5'),
      band: mix('#e4e8e9'),
      bevel: mix('#cbd0d1'),
      groove: mix('#303438'),
      indicator: mix('#f2f4f4'),
    }
  }, [knobTint, metalColor])

  useEffect(() => () => {
    document.body.style.cursor = ''
  }, [])

  useEffect(() => () => {
    Object.values(geometry).forEach((item) => item.dispose())
    Object.values(materials).forEach((item) => item.dispose())
  }, [geometry, materials])

  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 30)

    const motion = spring.current
    // tempo springs between detents; volume is a smooth continuous sweep
    const target = knobMode === 'volume'
      ? angleForVolume(volume)
      : angleFor(Math.round(bpm / DETENT) * DETENT)
    motion.v += ((target - motion.a) * 300 - motion.v * 21) * dt
    motion.a += motion.v * dt
    if (spin.current) spin.current.rotation.z = motion.a

    const wob = wobble.current
    wob.v += (-wob.a * 220 - wob.v * 12) * dt
    wob.a += wob.v * dt
    wob.grab += ((drag.current ? 1 : 0) - wob.grab) * Math.min(1, dt * 14)
    if (rock.current) {
      rock.current.rotation.x = wob.a
      rock.current.rotation.y = wob.a * 0.35
      rock.current.position.z = -0.045 * wob.grab
    }

    // Match the finish transition instead of snapping the emissive strip from
    // one skin accent to the next.
    const ringBlend = 1 - Math.exp(-4.2 * dt)
    materials.ringLight.color.lerp(ringTarget.surface, ringBlend)
    materials.ringLight.emissive.lerp(ringTarget.emissive, ringBlend)
    for (const key in tintTargets) materials[key].color.lerp(tintTargets[key], ringBlend)
  })

  const updateCursor = () => {
    document.body.style.cursor = drag.current
      ? 'grabbing'
      : hover.current ? 'ns-resize' : ''
  }

  return (
    <group
      position={[-BODY_W / 2 + 1.99, TOP_Y - PLATE_H / 2, PLATE_Z + 0.09]}
      rotation={[0.018, -0.024, 0]}
    >
      <group
        ref={rock}
        scale={1.035}
        onPointerOver={(event) => {
          event.stopPropagation()
          hover.current = true
          updateCursor()
        }}
        onPointerOut={() => {
          hover.current = false
          updateCursor()
        }}
        onPointerDown={(event) => {
          event.stopPropagation()
          event.target.setPointerCapture(event.pointerId)
          drag.current = {
            y: event.clientY,
            bpm: getState().bpm,
            volume: getState().volume,
            moved: false,
          }
          wobble.current.v += 0.9
          updateCursor()
        }}
        onPointerMove={(event) => {
          const start = drag.current
          if (!start) return
          event.stopPropagation()
          const dy = start.y - event.clientY
          if (Math.abs(dy) >= 3) start.moved = true
          if (!start.moved) return
          if (getState().knobMode === 'volume') {
            actions.setVolume(start.volume + dy * (event.shiftKey ? 0.001 : 0.004))
          } else {
            actions.setBpm(start.bpm + dy * (event.shiftKey ? 0.07 : 0.3))
          }
          wobble.current.v += THREE.MathUtils.clamp(
            (event.movementY || 0) * 0.012,
            -0.3,
            0.3,
          )
        }}
        onPointerUp={(event) => {
          const start = drag.current
          if (!start) return
          drag.current = null
          event.target.releasePointerCapture?.(event.pointerId)
          // a clean click (no drag) flips the dial between tempo and volume
          if (!start.moved) actions.toggleKnobMode()
          wobble.current.v -= 0.6
          updateCursor()
        }}
      >
        {/* Dark mounting collar visible only in the small gap below the grip. */}
        <mesh position={[0, 0, -0.055]} rotation={[Math.PI / 2, 0, 0]} receiveShadow>
          <cylinderGeometry args={[1.34, 1.29, 0.20, 64]} />
          <meshStandardMaterial color="#161719" roughness={0.72} metalness={0.44} />
        </mesh>
        <mesh position={[0, 0, -0.045]}>
          <torusGeometry args={[1.365, 0.032, 8, 96]} />
          <meshStandardMaterial color="#343638" roughness={0.42} metalness={0.85} />
        </mesh>

        <group ref={spin}>
          <mesh
            geometry={geometry.knurl}
            material={materials.knurl}
            receiveShadow
          />

          {/* Mirror-finished separator above the knurl, matching the bright
              shoulder band in the hardware reference. */}
          <mesh
            position={[0, 0, (KNURL_TOP + BAND_TOP) / 2]}
            rotation={[Math.PI / 2, 0, 0]}
            material={materials.band}
          >
            <cylinderGeometry
              args={[R_RIM - 0.012, R_RIM - 0.012, BAND_TOP - KNURL_TOP, 192, 1, true]}
            />
          </mesh>
          <mesh
            position={[0, 0, KNURL_TOP + 0.008]}
            material={materials.band}
          >
            <torusGeometry args={[1.462, 0.026, 8, 192]} />
          </mesh>

          {/* Soft chamfer from the polished band into the flat face. */}
          <mesh
            position={[0, 0, (BAND_TOP + RIM_Z) / 2]}
            rotation={[Math.PI / 2, 0, 0]}
            material={materials.bevel}
          >
            <cylinderGeometry
              args={[FACE_R, R_RIM, RIM_Z - BAND_TOP, 192, 3, true]}
            />
          </mesh>

          <mesh
            position={[0, 0, RIM_Z]}
            geometry={geometry.face}
            material={materials.face}
            castShadow
            receiveShadow
          />

          {/* Slim finish-aware status ring seated just inside the machined rim.
              Its HDR emissive value gives it a restrained halo through bloom. */}
          <mesh
            position={[0, 0, RIM_Z + 0.011]}
            material={materials.ringLight}
          >
            <torusGeometry args={[FACE_R - 0.026, 0.018, 8, 192]} />
          </mesh>

          {/* A dark milled bed and narrower polished insert create the fine
              recessed index line, set at one o'clock at the default 120 BPM. */}
          <mesh
            position={[0, 0, RIM_Z + 0.0015]}
            geometry={geometry.groove}
            material={materials.groove}
          />
          <mesh
            position={[0, 0, RIM_Z + 0.003]}
            geometry={geometry.indicator}
            material={materials.indicator}
          />
        </group>

        {/* Static engraved legend over the face center — advertises that the
            dial is also a button that swaps between tempo and volume. Sits
            outside the spin group so the text stays upright through detents. */}
        <mesh position={[0, 0, RIM_Z + 0.006]}>
          <circleGeometry args={[0.62, 48]} />
          <meshBasicMaterial
            map={textures.pushCap}
            transparent
            depthWrite={false}
            polygonOffset
            polygonOffsetFactor={-6}
          />
        </mesh>
      </group>
    </group>
  )
}

export { R_RIM, RIM_Z }
