import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { BPM_MAX, BPM_MIN, live, useStore } from '../state/store'
import { BODY_W } from './layout'

// A scene-space tempo scale, inspired by old calibration matrices rather than
// a flat HUD. Everything here is rendered by WebGL: instanced phosphor dots,
// canvas-textured labels, and HDR arrow geometry that participates in bloom.

const TICKS = [BPM_MAX, 150, 120, 90, BPM_MIN]
const GRID_ROWS = TICKS.length
const GRID_COLS = 8
const GRID_TOP = 5.8
const GRID_BOTTOM = -5.8
// Kept inside the square front-view frustum: the reference composition leaves
// less horizontal room than the normal widescreen browser does.
const GRID_INNER_X = BODY_W / 2 + 0.9
const GRID_STEP_X = 0.38
const LABEL_X = GRID_INNER_X + GRID_STEP_X * (GRID_COLS - 1) + 0.85
const ARROW_X = LABEL_X + 0.85
const DOT_Z = -0.7
const RETRACTED_X = 0.38
const RETRACTED_SCALE = [RETRACTED_X, 1, 1]

const yForBpm = (bpm) =>
  THREE.MathUtils.mapLinear(bpm, BPM_MIN, BPM_MAX, GRID_BOTTOM, GRID_TOP)

function buildDotMatrices() {
  const geometry = new THREE.CircleGeometry(0.045, 12)
  const material = new THREE.MeshBasicMaterial({
    color: '#b7b9b5',
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    toneMapped: false,
  })
  const left = new THREE.InstancedMesh(geometry, material, GRID_ROWS * GRID_COLS)
  const right = new THREE.InstancedMesh(geometry, material, GRID_ROWS * GRID_COLS)
  const transform = new THREE.Object3D()
  const shade = new THREE.Color()

  for (let row = 0; row < GRID_ROWS; row += 1) {
    const y = THREE.MathUtils.lerp(GRID_TOP, GRID_BOTTOM, row / (GRID_ROWS - 1))
    for (let col = 0; col < GRID_COLS; col += 1) {
      const index = row * GRID_COLS + col
      // The deterministic variation keeps the field from reading as a clean
      // UI grid without introducing unstable random dressing.
      const scale = 0.72 + ((row * 11 + col * 7) % 5) * 0.07
      transform.position.set(-(GRID_INNER_X + col * GRID_STEP_X), y, DOT_Z)
      transform.scale.setScalar(scale)
      transform.updateMatrix()
      left.setMatrixAt(index, transform.matrix)

      transform.position.x *= -1
      transform.updateMatrix()
      right.setMatrixAt(index, transform.matrix)

      shade.setScalar(0.55 + ((row * 5 + col * 3) % 4) * 0.09)
      left.setColorAt(index, shade)
      right.setColorAt(index, shade)
    }
  }

  left.instanceMatrix.needsUpdate = true
  right.instanceMatrix.needsUpdate = true
  left.instanceColor.needsUpdate = true
  right.instanceColor.needsUpdate = true
  left.frustumCulled = false
  right.frustumCulled = false

  return { geometry, material, left, right }
}

function StepTick({ step, velocity }) {
  const meshRef = useRef()
  const leftWing = step < 8
  const wingStep = leftWing ? step : step - 8
  const column = leftWing ? 7 - wingStep : wingStep
  const x = GRID_INNER_X + column * GRID_STEP_X

  useFrame((_, delta) => {
    const mesh = meshRef.current
    if (!mesh) return
    const playhead = live.step === step
    const targetX = playhead ? 1.45 : velocity ? 1 : 0.25
    const targetY = playhead ? 3.6 : velocity ? 1.2 + velocity * 2.3 : 0.25
    mesh.scale.x = THREE.MathUtils.damp(mesh.scale.x, targetX, 18, delta)
    mesh.scale.y = THREE.MathUtils.damp(mesh.scale.y, targetY, 18, delta)
    mesh.material.opacity = THREE.MathUtils.damp(
      mesh.material.opacity,
      playhead || velocity ? 1 : 0,
      18,
      delta,
    )

    if (playhead) mesh.material.color.setRGB(4.8, 0.34, 0.035)
    else mesh.material.color.setRGB(0.15, 1.15, 1.65)
  })

  return (
    <mesh ref={meshRef} position={[leftWing ? -x : x, 0, DOT_Z + 0.08]} renderOrder={1}>
      <planeGeometry args={[0.085, 0.11]} />
      <meshBasicMaterial
        transparent
        opacity={0}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  )
}

// Mirrors the selected instrument's 16-step LCD ladder across the background:
// steps 1–8 live on the left wing and 9–16 continue on the right. The machine
// occludes the missing centre, so the sequence feels like it passes behind it.
function StepRail({ groupRef, pattern }) {
  return (
    <group ref={groupRef}>
      {pattern.map((velocity, step) => (
        <StepTick key={step} step={step} velocity={velocity || 0} />
      ))}
    </group>
  )
}

function makeLabelTexture(value) {
  const canvas = document.createElement('canvas')
  canvas.width = 192
  canvas.height = 96
  const context = canvas.getContext('2d')
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#ffffff'
  context.font = '700 74px "SFMono-Regular", "SF Mono", Menlo, monospace'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(String(value), canvas.width / 2, canvas.height / 2)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  return texture
}

function TickLabel({ value, y }) {
  const texture = useMemo(() => makeLabelTexture(value), [value])

  useEffect(() => () => texture.dispose(), [texture])

  return (
    <>
      <mesh position={[-LABEL_X, y, DOT_Z]} renderOrder={1}>
        <planeGeometry args={[0.84, 0.42]} />
        <meshBasicMaterial
          map={texture}
          transparent
          opacity={0.94}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh position={[LABEL_X, y, DOT_Z]} renderOrder={1}>
        <planeGeometry args={[0.84, 0.42]} />
        <meshBasicMaterial
          map={texture}
          transparent
          opacity={0.94}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </>
  )
}

function Arrow({ side, groupRef }) {
  const geometry = useMemo(() => {
    const direction = side === 'left' ? 1 : -1
    const points = new Float32Array([
      direction * 0.25, 0, 0,
      -direction * 0.19, 0.24, 0,
      -direction * 0.19, -0.24, 0,
    ])
    const result = new THREE.BufferGeometry()
    result.setAttribute('position', new THREE.BufferAttribute(points, 3))
    return result
  }, [side])

  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <group ref={groupRef} position={[side === 'left' ? -ARROW_X : ARROW_X, 0, DOT_Z + 0.04]}>
      <mesh geometry={geometry} renderOrder={2}>
        <meshBasicMaterial
          color={new THREE.Color(4.8, 0.34, 0.035)}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
    </group>
  )
}

export default function TempoMatrix() {
  const { bpm, pattern, track, playing } = useStore()
  const reveal = useRef()
  const leftArrow = useRef()
  const rightArrow = useRef()
  const stepRail = useRef()
  const currentY = useRef(yForBpm(bpm))
  const targetY = yForBpm(bpm)
  const matrices = useMemo(() => buildDotMatrices(), [])

  useEffect(() => () => {
    matrices.geometry.dispose()
    matrices.material.dispose()
  }, [matrices])

  useFrame((_, delta) => {
    if (reveal.current) {
      reveal.current.scale.x = THREE.MathUtils.damp(
        reveal.current.scale.x,
        playing ? 1 : RETRACTED_X,
        playing ? 6.5 : 8,
        delta,
      )
    }
    currentY.current = THREE.MathUtils.damp(currentY.current, targetY, 10, delta)
    if (leftArrow.current) leftArrow.current.position.y = currentY.current
    if (rightArrow.current) rightArrow.current.position.y = currentY.current
    if (stepRail.current) stepRail.current.position.y = currentY.current
  })

  return (
    <group ref={reveal} scale={RETRACTED_SCALE}>
      <primitive object={matrices.left} />
      <primitive object={matrices.right} />
      {TICKS.map((value, row) => (
        <TickLabel
          key={value}
          value={value}
          y={THREE.MathUtils.lerp(GRID_TOP, GRID_BOTTOM, row / (GRID_ROWS - 1))}
        />
      ))}
      <StepRail groupRef={stepRail} pattern={pattern[track]} />
      <Arrow side="left" groupRef={leftArrow} />
      <Arrow side="right" groupRef={rightArrow} />
    </group>
  )
}
