import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { RoundedBox, Instances, Instance } from '@react-three/drei'
import { folder, useControls } from 'leva'
import {
  BODY_W, BODY_H, BODY_D, PLATE_H, TOP_Y, KEYS_TOP_Y, PLATE_Z, KEYS_W, KEYS_H,
  PITCH, COLS, ROWS, keyX, keyY,
} from './layout'
import {
  blotchCanvas, scratchCanvas, plateScratchOverlayCanvas, rustCanvas, toTexture, memo,
} from './textures'
import { useStore } from '../state/store'
import { getFinish } from '../finishes'

// Chassis: body, faceplate, recessed switch well + housings, hardware.
// Owned by the chassis builder pass.
//
// The recessed well is built from primitives, not a CSG cutout: the body's
// own front face doubles as the well floor, and two side rails + top/bottom
// lips sit proud of it (RIM_T) right at the key-grid boundary. That proud
// step is what reads as a sunken pocket — no hole-punching required. Vertical
// margin isn't available (KEYS_H runs flush from the plate seam to the body's
// bottom edge per layout.js), so only the left/right rails are true "walls";
// top/bottom lips are thin cosmetic strips that catch light at the seams.

const WELL_Y = KEYS_TOP_Y - KEYS_H / 2   // vertical centre of the key section
const RIM_W = 0.22                        // side-rail width outside the key grid
const RIM_T = 0.13                        // how proud the rim stands above the floor
const FLOOR_BACK = 0.05                   // how far the switch floor sits behind PLATE_Z

// Neutral stand-in for the wear maps on a clean finish. Swapping a map to null
// recompiles the material's shader — which hitches the finish switch — so the
// clean skins bind this instead: white is the identity value for every channel
// it stands in for (colour, bump, metalness).
const BLANK_MAP = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
BLANK_MAP.needsUpdate = true

function TweenedStandardMaterial({ color, roughness, metalness, ...props }) {
  const material = useRef()
  const [initial] = useState(() => ({ color, roughness, metalness }))
  const targetColor = useMemo(() => new THREE.Color(color), [color])

  useFrame((_, dt) => {
    const mat = material.current
    if (!mat) return
    const colorDelta =
      Math.abs(mat.color.r - targetColor.r)
      + Math.abs(mat.color.g - targetColor.g)
      + Math.abs(mat.color.b - targetColor.b)
    const settled =
      colorDelta < 1e-4
      && Math.abs(mat.roughness - roughness) < 1e-4
      && Math.abs(mat.metalness - metalness) < 1e-4
    if (settled) return

    const k = 1 - Math.exp(-4.8 * Math.min(dt, 0.05))
    mat.color.lerp(targetColor, k)
    mat.roughness = THREE.MathUtils.lerp(mat.roughness, roughness, k)
    mat.metalness = THREE.MathUtils.lerp(mat.metalness, metalness, k)
  })

  return (
    <meshStandardMaterial
      ref={material}
      color={initial.color}
      roughness={initial.roughness}
      metalness={initial.metalness}
      {...props}
    />
  )
}

// A rounded six-lobe drive silhouette. Layering two copies of this shape gives
// the socket a bright cut edge and a genuinely dark floor without needing CSG.
const TORX_SHAPE = (() => {
  const shape = new THREE.Shape()
  const points = 96
  for (let i = 0; i <= points; i++) {
    const a = (i / points) * Math.PI * 2
    const lobe = ((1 + Math.cos(a * 6)) / 2) ** 0.62
    const r = 0.034 + lobe * 0.017
    const x = Math.cos(a) * r
    const y = Math.sin(a) * r
    if (i === 0) shape.moveTo(x, y)
    else shape.lineTo(x, y)
  }
  shape.closePath()
  return shape
})()

const SCREW_FINISHES = [
  { rotation: 0.14, grime: 2.5, color: '#aaa9a2', roughness: 0.3, pit: [-0.064, 0.036] },
  { rotation: 0.52, grime: 4.2, color: '#8f9292', roughness: 0.38, pit: [0.058, 0.045] },
  { rotation: -0.28, grime: 0.6, color: '#9d9b94', roughness: 0.34, pit: [-0.054, -0.05] },
  { rotation: 0.86, grime: 3.35, color: '#b1aea5', roughness: 0.27, pit: [0.068, -0.025] },
]

function PanelScrew({ position, index, scratchMap }) {
  const finish = SCREW_FINISHES[index]

  return (
    <group position={position} rotation={[0, 0, finish.rotation]}>
      {/* The countersink is almost flush with the plate. Its black funnel and
          dirty partial rim make the fastener feel seated, rather than pasted on. */}
      <mesh position={[0, 0, -0.021]} rotation={[Math.PI / 2, 0, 0]} receiveShadow>
        <cylinderGeometry args={[0.17, 0.1, 0.04, 32]} />
        <meshStandardMaterial color="#242326" roughness={0.76} metalness={0.42} />
      </mesh>
      <mesh position={[0, 0, 0.0005]}>
        <torusGeometry args={[0.151, 0.008, 8, 48]} />
        <meshStandardMaterial color="#242222" roughness={0.72} metalness={0.35} />
      </mesh>
      <mesh position={[0, 0, 0.002]}>
        <torusGeometry args={[0.129, 0.004, 6, 40]} />
        <meshStandardMaterial color="#77766f" roughness={0.36} metalness={0.78} />
      </mesh>
      <mesh position={[0, 0, 0.001]} rotation={[0, 0, finish.grime]}>
        <torusGeometry args={[0.158, 0.006, 6, 24, 1.72]} />
        <meshStandardMaterial color="#6d3b1d" roughness={0.96} metalness={0.05} />
      </mesh>

      {/* Chamfered stainless head with a shallow crown. The fine concentric
          rings catch the environment like machining marks at macro distance. */}
      <mesh position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.101, 0.124, 0.042, 32]} />
        <meshPhysicalMaterial
          color={finish.color}
          roughness={finish.roughness}
          roughnessMap={scratchMap}
          metalness={0.8}
          envMapIntensity={1.3}
          clearcoat={0.18}
          clearcoatRoughness={0.2}
          anisotropy={0.3}
        />
      </mesh>
      <mesh position={[0, 0, 0.0235]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.101, 0.101, 0.008, 32]} />
        <meshPhysicalMaterial
          color={finish.color}
          roughness={finish.roughness + 0.04}
          roughnessMap={scratchMap}
          metalness={0.84}
          envMapIntensity={1.4}
          clearcoat={0.12}
          clearcoatRoughness={0.24}
          anisotropy={0.42}
          anisotropyRotation={finish.rotation}
        />
      </mesh>
      <mesh position={[0, 0, 0.028]}>
        <torusGeometry args={[0.096, 0.0035, 6, 48]} />
        <meshStandardMaterial color="#d8d4c8" roughness={0.22} metalness={1} />
      </mesh>
      {[0.069, 0.082].map((radius) => (
        <mesh key={radius} position={[0, 0, 0.0285]}>
          <torusGeometry args={[radius, 0.0009, 4, 40]} />
          <meshStandardMaterial color="#55575a" roughness={0.45} metalness={1} />
        </mesh>
      ))}

      {/* Recessed tamper-resistant Torx drive: bright freshly-cut bevel, dark
          socket floor, and a steel centre pin. */}
      <mesh position={[0, 0, 0.029]}>
        <shapeGeometry args={[TORX_SHAPE, 24]} />
        <meshStandardMaterial color="#4c4d4e" roughness={0.32} metalness={0.92} />
      </mesh>
      <mesh position={[0, 0, 0.0298]} scale={[0.76, 0.76, 1]}>
        <shapeGeometry args={[TORX_SHAPE, 24]} />
        <meshStandardMaterial color="#090a0b" roughness={0.68} metalness={0.5} />
      </mesh>
      <mesh position={[0, 0, 0.033]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.009, 0.009, 0.007, 16]} />
        <meshStandardMaterial color="#9b9b96" roughness={0.3} metalness={1} />
      </mesh>

      {/* One tiny oxidised pit breaks the otherwise perfect procedural finish. */}
      <mesh position={[finish.pit[0], finish.pit[1], 0.0295]}>
        <circleGeometry args={[0.006, 9]} />
        <meshStandardMaterial color="#312018" roughness={1} metalness={0.18} />
      </mesh>
    </group>
  )
}

export default function Chassis() {
  const finishIndex = useStore((state) => state.finish)
  const finish = getFinish(finishIndex)
  const surface = finish.surface
  const {
    rustPatches, rustDings, rustStrength, plateBump, rustSeed,
  } = useControls('Chassis', {
    rust: folder({
      rustPatches: { value: 30, min: 0, max: 100, step: 1 },
      rustDings: { value: 90, min: 0, max: 250, step: 1 },
      rustStrength: { value: 1, min: 0, max: 2, step: 0.05 },
      plateBump: { value: 0.08, min: 0, max: 0.25, step: 0.005 },
      rustSeed: { value: 0, min: 0, max: 50, step: 1 },
    }),
  })

  const rough = useMemo(
    () => memo('chassis:rough', () => toTexture(blotchCanvas(512, 40, 24, 0.8), { repeat: 2 })),
    [],
  )
  const scratch = useMemo(
    () => memo('chassis:scratch', () => toTexture(scratchCanvas(512, 120, 0.7), { repeat: 2 })),
    [],
  )
  // Colored rust/chip pass for the faceplate's diffuse map (sRGB — it carries
  // actual orange-brown hue, unlike the grayscale wear maps). Doubles as the
  // bump map so chips read as depressions and rust crust as raised grain.
  // Regenerates when leva knobs change — no memo cache, or seed would stick.
  const plateRust = useMemo(() => {
    // The seed control intentionally triggers a fresh procedural draw.
    void rustSeed
    return toTexture(
      rustCanvas(512, rustPatches, rustDings, rustStrength * surface.wear),
      { srgb: true, repeat: 1 },
    )
  }, [rustPatches, rustDings, rustStrength, rustSeed, surface.wear])
  useEffect(() => () => plateRust.dispose(), [plateRust])
  // Denser scratch pass than the shared body scratch — the faceplate takes
  // the most handling abuse, so it gets its own heavier layer.
  const plateScratch = useMemo(
    () => memo('chassis:plateScratch', () => toTexture(scratchCanvas(512, 260, 1), { repeat: 1.4 })),
    [],
  )
  const plateScratchOverlay = useMemo(
    () => memo(
      'chassis:plateScratchOverlay-v1',
      () => toTexture(plateScratchOverlayCanvas(), { srgb: true, repeat: 1, aniso: 16 }),
    ),
    [],
  )
  // Higher-frequency, higher-contrast pass just for the plate's roughness
  // channel — this is what turns the key light's rake into hot polished
  // streaks against a dull field, distinct from plateWear's broader grime.
  const plateRoughMap = useMemo(
    () => memo('chassis:plateRough', () => toTexture(blotchCanvas(512, 130, 10, 1.6), { repeat: 1.6 })),
    [],
  )

  // Housing nub sits proud of the well floor in the shadow gap around/under
  // each cap. Slightly larger than the cap footprint (PITCH-GAP) so a rim of
  // it peeks past the cap edge into the gap, but small enough it still reads
  // as a hint rather than a second layer of caps.
  const nubSize = PITCH - 0.1
  const NUB_H = 0.14
  const NUB_PROUD = 0.1
  const nubs = useMemo(() => {
    const out = []
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) out.push([keyX(c), keyY(r), r * COLS + c])
    return out
  }, [])

  return (
    <group>
      {/* body — also serves as the floor plane the rim/rails sit on */}
      <RoundedBox
        args={[BODY_W, BODY_H, BODY_D]}
        radius={0.16}
        smoothness={6}
        castShadow
        receiveShadow
      >
        <TweenedStandardMaterial
          color={surface.body}
          roughness={surface.bodyRough}
          metalness={surface.bodyMetal}
          roughnessMap={rough}
          metalnessMap={scratch}
          normalScale={new THREE.Vector2(0.12, 0.12)}
        />
      </RoundedBox>

      {/* faceplate over the top section (knob / screen / decals) */}
      <group position={[0, TOP_Y - PLATE_H / 2, 0]}>
        {/* parting-line backer: a hair larger, peeks out as a dark seam.
            Still the darkest thing on the plate on purpose (it's a gap, meant
            to read as recessed) but not a zero-albedo void like the rest. */}
        <mesh position={[0, 0, PLATE_Z - 0.02]} receiveShadow>
          <boxGeometry args={[BODY_W - 0.02, PLATE_H + 0.02, 0.1]} />
          <meshStandardMaterial color="#0a0a0c" roughness={0.9} metalness={0.05} />
        </mesh>
        {/* Faceplate proper: rough dielectric, not raw metal (see bodyMat).
            plateRust rides the diffuse `map` (orange-brown blooms + chips) and
            the bump channel (chips depress, crust raises); plateScratch keys
            the metalness so scratches flash under the rake; plateRough drives
            roughness so hot polished streaks (~0.25) fight a dull field (~0.7).
            At wear 0 the rust canvas is a flat mid-grey that would just halve
            the plate colour, so a clean finish drops it and shows its true hue. */}
        <mesh position={[0, 0, PLATE_Z + 0.01]} castShadow receiveShadow>
          <boxGeometry args={[BODY_W - 0.12, PLATE_H - 0.1, 0.14]} />
          <TweenedStandardMaterial
            color={surface.plate}
            roughness={surface.plateRough}
            metalness={surface.plateMetal}
            map={surface.wear ? plateRust : BLANK_MAP}
            bumpMap={surface.wear ? plateRust : BLANK_MAP}
            bumpScale={plateBump}
            roughnessMap={plateRoughMap}
            metalnessMap={surface.wear ? plateScratch : BLANK_MAP}
            normalScale={new THREE.Vector2(0.22, 0.22)}
          />
        </mesh>
        {/* Front-only scratch decal. Transparent grooves keep the original rust
            and paint variation intact; their pale offset lips pick up the key
            light like exposed metal at the edge of a real cut. */}
        <mesh position={[0, 0, PLATE_Z + 0.082]} receiveShadow renderOrder={2} visible={surface.wear > 0}>
          <planeGeometry args={[BODY_W - 0.16, PLATE_H - 0.14]} />
          <meshStandardMaterial
            map={plateScratchOverlay}
            transparent
            alphaTest={0.025}
            depthWrite={false}
            roughness={0.42}
            metalness={0.58}
            envMapIntensity={1.15}
            polygonOffset
            polygonOffsetFactor={-2}
          />
        </mesh>
      </group>

      {/* recessed key well: floor + raised side rails + top/bottom lips */}
      <group>
        {/* white floor plate — off-white so it still shades, not blown out */}
        {/* front face sits 0.01 proud of the body face — coplanar z-fights */}
        <mesh position={[0, WELL_Y, PLATE_Z - FLOOR_BACK + 0.01]} receiveShadow>
          <boxGeometry args={[KEYS_W, KEYS_H, 0.1]} />
          <TweenedStandardMaterial
            color={surface.floor}
            roughness={surface.floorRough}
            metalness={0.05}
            roughnessMap={rough}
          />
        </mesh>

        {[-1, 1].map((s) => (
          <mesh
            key={`rail-${s}`}
            position={[s * (KEYS_W / 2 + RIM_W / 2), WELL_Y, PLATE_Z + RIM_T / 2]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[RIM_W, KEYS_H - 0.08, RIM_T]} />
            <TweenedStandardMaterial
              color={surface.body}
              roughness={Math.max(0.24, surface.bodyRough - 0.08)}
              metalness={surface.bodyMetal + 0.03}
              roughnessMap={rough}
              metalnessMap={scratch}
              normalScale={new THREE.Vector2(0.15, 0.15)}
            />
          </mesh>
        ))}
        {[1, -1].map((s) => (
          <mesh
            key={`lip-${s}`}
            position={[0, WELL_Y + s * (KEYS_H / 2 - 0.06), PLATE_Z + RIM_T / 2]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[KEYS_W - 0.06, 0.12, RIM_T]} />
            <TweenedStandardMaterial
              color={surface.body}
              roughness={Math.max(0.24, surface.bodyRough - 0.08)}
              metalness={surface.bodyMetal + 0.03}
              roughnessMap={rough}
              metalnessMap={scratch}
              normalScale={new THREE.Vector2(0.15, 0.15)}
            />
          </mesh>
        ))}
      </group>

      {/* per-key switch-housing hint, one draw call */}
      <Instances limit={ROWS * COLS} castShadow receiveShadow>
        <boxGeometry args={[nubSize, nubSize, NUB_H]} />
        <meshStandardMaterial color="#232328" roughness={0.4} metalness={0.1} />
        {nubs.map(([x, y, i]) => (
          <Instance key={i} position={[x, y, PLATE_Z + NUB_PROUD - NUB_H / 2]} />
        ))}
      </Instances>

      {/* side vents on the body's left edge, below the key well */}
      <Instances limit={6} castShadow>
        <boxGeometry args={[0.05, 0.5, 0.1]} />
        <meshStandardMaterial color="#040405" roughness={0.7} metalness={0.3} />
        {Array.from({ length: 6 }, (_, i) => (
          <Instance
            key={i}
            position={[-BODY_W / 2 + 0.03, -TOP_Y + 1.4 + i * 0.62, 0]}
            rotation={[0, Math.PI / 2, 0]}
          />
        ))}
      </Instances>

      {/* countersunk, security-Torx corner screws on the faceplate */}
      {[[-1, 1], [1, 1], [-1, -1], [1, -1]].map(([sx, sy], i) => {
        const sPos = [
          sx * (BODY_W / 2 - 0.4),
          TOP_Y - (sy > 0 ? 0.4 : PLATE_H - 0.32),
          PLATE_Z + 0.082,
        ]
        return <PanelScrew key={i} position={sPos} index={i} scratchMap={scratch} />
      })}
    </group>
  )
}
