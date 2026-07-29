/* eslint-disable react-hooks/immutability */
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useLayoutEffect, useRef } from 'react'
import * as THREE from 'three'
import { VIEW, DEBUG } from './views'

// Pointer-parallax rig: the unit hangs in a void and leans toward the cursor.
// Damped, frame-rate independent, and it never fully faces away.
// ?debug freezes parallax and enables drag-orbit so you can dial the look.
export default function Rig({ children }) {
  const group = useRef()
  const { pointer, camera } = useThree()
  const target = useRef(new THREE.Vector2())

  useLayoutEffect(() => {
    if (!VIEW) return
    camera.position.set(...VIEW.camera)
    camera.fov = VIEW.fov
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
    group.current.rotation.set(VIEW.rotX, VIEW.rotY, 0)
  }, [camera])

  useFrame((_, dt) => {
    if (VIEW || DEBUG) return
    const k = 1 - Math.exp(-3.5 * Math.min(dt, 0.1))
    target.current.lerp(pointer, k)
    const g = group.current
    if (!g) return
    g.rotation.y = target.current.x * 0.42
    g.rotation.x = -target.current.y * 0.26
    g.position.x = target.current.x * 0.9
  })

  return (
    <>
      <group ref={group}>{children}</group>
      {DEBUG && <OrbitControls makeDefault enablePan={false} enableZoom target={[0, 0, 0]} />}
    </>
  )
}
