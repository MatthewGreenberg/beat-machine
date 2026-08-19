/* eslint-disable react-refresh/only-export-components */
import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { makeKeycapGeometry } from './keycapGeometry'
import { capMaterial } from './capMaterials'
import { PITCH, GAP } from './layout'
import { useQuality, TAP_PX } from './quality'
import {
  INTRO_DISABLED,
  assemblyProgress,
  setAssemblyPose,
} from './assemblyMotion'

const geoCache = new Map()
function geometry(span, height) {
  const key = `${span}:${height}`
  if (!geoCache.has(key)) {
    geoCache.set(
      key,
      makeKeycapGeometry({
        width: PITCH - GAP,
        depth: PITCH * span - GAP,
        height,
        taper: 0.14,
        dish: span > 1 ? 0.05 : 0.1,
      }),
    )
  }
  return geoCache.get(key)
}

const TRAVEL = 0.17

/**
 * One physical key. All motion is imperative so the sequencer can drive 16 caps
 * at audio rate without a single React render.
 *
 * @param depth  0..1 static latch (a programmed step sits lower than an empty one)
 * @param pulse  () => 0..1 read every frame — playhead punch
 * @param onDragY Optional vertical drag handler. Receives upward distance in
 *                screen pixels and the value returned by onDragStart.
 */
export default function Keycap({
  position,
  span = 1,
  height = 1.05,
  color,
  map,
  roughness,
  metalness,
  materialProps,
  depth = 0,
  pulse,
  introIndex,
  onPress,
  onDragStart,
  onDragY,
  cursor = 'pointer',
  children,
  ...rest
}) {
  const quality = useQuality()
  const assembly = useRef()
  const mesh = useRef()
  const materialRef = useRef()
  const [hover, setHover] = useState(false)
  const held = useRef(0)
  const drag = useRef(null)
  const introStartedAt = useRef(null)
  const introSettled = useRef(INTRO_DISABLED || introIndex === undefined)
  const introX = position?.[0] ?? 0
  const introY = position?.[1] ?? 0

  const intro = useMemo(() => {
    if (introIndex === undefined) return null

    const side = introX < 0 ? -1 : 1
    const variation = ((introIndex * 17) % 7) / 7
    const angle = introIndex * 2.399963 + 0.72
    const radius = 12 + variation * 8
    const tangent = 4.5 + variation * 3
    return {
      delay: 0.2 + (introIndex % 6) * 0.055 + Math.floor(introIndex / 6) * 0.018,
      duration: 1.08 + variation * 0.22,
      fromPosition: [
        Math.cos(angle) * radius,
        Math.sin(angle) * radius + Math.sign(introY || 1) * 2.5,
        16 + (introIndex % 5) * 2.1,
      ],
      fromRotation: [
        Math.sin(angle) * (1.4 + variation),
        Math.cos(angle) * (1.5 + variation * 1.2),
        side * (1.6 + variation * 2.2),
      ],
      fromScale: 0.34 + variation * 0.12,
      arc: [
        -Math.sin(angle) * tangent,
        Math.cos(angle) * tangent,
        3 + variation * 3,
      ],
    }
  }, [introIndex, introX, introY])

  const qualityMaterialProps = useMemo(() => {
    if (!materialProps?.transmission || quality.name === 'high') return materialProps
    return { ...materialProps, transmission: 0, thickness: 0 }
  }, [materialProps, quality.name])

  const targetMaterial = useMemo(
    () => capMaterial({ color, map, roughness, metalness, ...qualityMaterialProps }),
    [color, map, roughness, metalness, qualityMaterialProps],
  )
  const [initialMaterial] = useState(() => targetMaterial.clone())
  const geo = useMemo(() => geometry(span, height), [span, height])

  useEffect(() => {
    if (materialRef.current) materialRef.current.needsUpdate = true
  }, [targetMaterial])

  useEffect(() => () => {
    if (qualityMaterialProps) targetMaterial.dispose()
  }, [qualityMaterialProps, targetMaterial])

  useEffect(() => () => initialMaterial.dispose(), [initialMaterial])

  useLayoutEffect(() => {
    if (!intro) return
    setAssemblyPose(
      assembly.current,
      INTRO_DISABLED ? 1 : 0,
      intro.fromPosition,
      intro.fromRotation,
      intro.fromScale,
      intro.arc,
    )
  }, [intro])

  const setCursor = (active = false) => {
    document.body.style.cursor = active ? 'grabbing' : hover ? cursor : 'auto'
  }

  const finishDrag = (e, cancelled = false) => {
    const d = drag.current
    if (!d) return
    drag.current = null
    e.target.releasePointerCapture?.(e.pointerId)
    setCursor()
    if (!cancelled && !d.moved) onPress?.()
  }

  useFrame((_, dt) => {
    if (!introSettled.current && intro && assembly.current) {
      if (introStartedAt.current === null) introStartedAt.current = _.clock.elapsedTime
      const elapsed = _.clock.elapsedTime - introStartedAt.current
      const progress = assemblyProgress(elapsed, intro.delay, intro.duration)
      setAssemblyPose(
        assembly.current,
        progress,
        intro.fromPosition,
        intro.fromRotation,
        intro.fromScale,
        intro.arc,
      )
      if (progress === 1) introSettled.current = true
    }

    const m = mesh.current
    if (!m) return
    const target =
      depth * 0.42 + held.current + (pulse ? pulse() : 0) * 0.85 + (hover ? 0.1 : 0)
    const targetZ = -target * TRAVEL
    if (Math.abs(m.position.z - targetZ) > 1e-5) {
      const k = 1 - Math.exp(-26 * Math.min(dt, 0.05))
      m.position.z += (targetZ - m.position.z) * k
    } else {
      m.position.z = targetZ
    }
    held.current *= 1 - Math.min(1, dt * 14)

    const mat = materialRef.current
    if (!mat) return
    const colorDelta =
      Math.abs(mat.color.r - targetMaterial.color.r)
      + Math.abs(mat.color.g - targetMaterial.color.g)
      + Math.abs(mat.color.b - targetMaterial.color.b)
    const materialSettled =
      colorDelta < 1e-4
      && Math.abs(mat.roughness - targetMaterial.roughness) < 1e-4
      && Math.abs(mat.metalness - targetMaterial.metalness) < 1e-4
      && Math.abs(mat.transmission - targetMaterial.transmission) < 1e-4
      && Math.abs(mat.clearcoat - targetMaterial.clearcoat) < 1e-4
      && mat.map === targetMaterial.map
    if (materialSettled) return

    const materialK = 1 - Math.exp(-5.4 * Math.min(dt, 0.05))
    mat.color.lerp(targetMaterial.color, materialK)
    mat.roughness = THREE.MathUtils.lerp(mat.roughness, targetMaterial.roughness, materialK)
    mat.metalness = THREE.MathUtils.lerp(mat.metalness, targetMaterial.metalness, materialK)
    mat.transmission = THREE.MathUtils.lerp(
      mat.transmission,
      targetMaterial.transmission,
      materialK,
    )
    mat.thickness = THREE.MathUtils.lerp(mat.thickness, targetMaterial.thickness, materialK)
    mat.ior = THREE.MathUtils.lerp(mat.ior, targetMaterial.ior, materialK)
    mat.clearcoat = THREE.MathUtils.lerp(mat.clearcoat, targetMaterial.clearcoat, materialK)
    mat.clearcoatRoughness = THREE.MathUtils.lerp(
      mat.clearcoatRoughness,
      targetMaterial.clearcoatRoughness,
      materialK,
    )
    mat.envMapIntensity = THREE.MathUtils.lerp(
      mat.envMapIntensity,
      targetMaterial.envMapIntensity,
      materialK,
    )

    if (mat.map !== targetMaterial.map) {
      mat.map = targetMaterial.map
      mat.roughnessMap = targetMaterial.roughnessMap
      mat.normalMap = targetMaterial.normalMap
      mat.needsUpdate = true
    }
  })

  return (
    <group position={position}>
      <group ref={assembly}>
        <mesh
          ref={mesh}
          geometry={geo}
          castShadow
          receiveShadow
          onPointerOver={(e) => {
            e.stopPropagation()
            // touch: pointerover fires on tap but pointerout never reliably
            // follows, so caps stayed visually lifted
            if (e.pointerType === 'touch') return
            setHover(true)
            document.body.style.cursor = drag.current ? 'grabbing' : cursor
          }}
          onPointerOut={() => {
            setHover(false)
            document.body.style.cursor = drag.current ? 'grabbing' : 'auto'
          }}
          onPointerDown={(e) => {
            e.stopPropagation()
            held.current = 1
            if (!onDragY) {
              onPress?.()
              return
            }
            e.target.setPointerCapture(e.pointerId)
            drag.current = {
              y: e.clientY,
              moved: false,
              value: onDragStart?.(),
            }
            setCursor(true)
          }}
          onPointerMove={(e) => {
            const d = drag.current
            if (!d) return
            e.stopPropagation()
            const dy = d.y - e.clientY
            if (Math.abs(dy) >= TAP_PX) d.moved = true
            if (d.moved) onDragY(dy, d.value, e)
          }}
          onPointerUp={(e) => finishDrag(e)}
          onPointerCancel={(e) => finishDrag(e, true)}
          {...rest}
        >
          <primitive ref={materialRef} object={initialMaterial} attach="material" />
          {children}
        </mesh>
      </group>
    </group>
  )
}

export { TRAVEL }
export const capGeometry = geometry
export const _three = THREE
