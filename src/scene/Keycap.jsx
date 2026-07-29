import { useFrame } from '@react-three/fiber'
import { useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { makeKeycapGeometry } from './keycapGeometry'
import { capMaterial } from './capMaterials'
import { PITCH, GAP } from './layout'

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
  depth = 0,
  pulse,
  onPress,
  onDragStart,
  onDragY,
  cursor = 'pointer',
  children,
  ...rest
}) {
  const mesh = useRef()
  const [hover, setHover] = useState(false)
  const held = useRef(0)
  const drag = useRef(null)

  const material = useMemo(
    () => capMaterial({ color, map, roughness, metalness }),
    [color, map, roughness, metalness],
  )
  const geo = useMemo(() => geometry(span, height), [span, height])

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
    const m = mesh.current
    if (!m) return
    const target =
      depth * 0.42 + held.current + (pulse ? pulse() : 0) * 0.85 + (hover ? 0.1 : 0)
    const k = 1 - Math.exp(-26 * Math.min(dt, 0.05))
    m.position.z += (-target * TRAVEL - m.position.z) * k
    held.current *= 1 - Math.min(1, dt * 14)
  })

  return (
    <group position={position}>
      <mesh
        ref={mesh}
        geometry={geo}
        material={material}
        castShadow
        receiveShadow
        onPointerOver={(e) => {
          e.stopPropagation()
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
          if (Math.abs(dy) >= 3) d.moved = true
          if (d.moved) onDragY(dy, d.value, e)
        }}
        onPointerUp={(e) => finishDrag(e)}
        onPointerCancel={(e) => finishDrag(e, true)}
        {...rest}
      >
        {children}
      </mesh>
    </group>
  )
}

export { TRAVEL }
export const capGeometry = geometry
export const _three = THREE
