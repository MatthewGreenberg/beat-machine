/* eslint-disable react-hooks/immutability */
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useLayoutEffect, useRef } from 'react'
import * as THREE from 'three'
import { VIEW, DEBUG } from './views'
import { live } from '../state/store'

const phase = (progress, start, end) => {
  const value = THREE.MathUtils.clamp((progress - start) / (end - start), 0, 1)
  return value * value * (3 - 2 * value)
}

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
    if (!VIEW && !DEBUG) {
      const k = 1 - Math.exp(-3.5 * Math.min(dt, 0.1))
      target.current.lerp(pointer, k)
    }
    const g = group.current
    if (!g) return
    const frameTime = Math.min(dt, 0.05)
    const fxPose = phase(live.fxMorph, 0.02, 0.54)
    const mix = fxPose * fxPose * (3 - 2 * fxPose)
    const baseRotY = VIEW ? VIEW.rotY : target.current.x * 0.42
    const baseRotX = VIEW ? VIEW.rotX : -target.current.y * 0.26
    const baseX = VIEW ? 0 : target.current.x * 0.9

    // Editor mode docks the product into a deliberate face-on inspection pose.
    // The physical machine moves; the camera and background remain continuous.
    g.rotation.y = THREE.MathUtils.damp(g.rotation.y, baseRotY * (1 - mix), 12, frameTime)
    g.rotation.x = THREE.MathUtils.damp(g.rotation.x, baseRotX * (1 - mix), 12, frameTime)
    g.rotation.z = THREE.MathUtils.damp(g.rotation.z, -0.012 * mix, 12, frameTime)
    g.position.x = THREE.MathUtils.damp(g.position.x, baseX * (1 - mix), 12, frameTime)
    g.position.y = THREE.MathUtils.damp(g.position.y, mix * 0.08, 12, frameTime)
    g.position.z = THREE.MathUtils.damp(g.position.z, mix * 0.85, 12, frameTime)
  })

  return (
    <>
      <group ref={group}>{children}</group>
      {DEBUG && <OrbitControls makeDefault enablePan={false} enableZoom target={[0, 0, 0]} />}
    </>
  )
}
