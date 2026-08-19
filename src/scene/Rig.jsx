/* eslint-disable react-hooks/immutability */
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useLayoutEffect, useRef } from 'react'
import * as THREE from 'three'
import { VIEW, DEBUG } from './views'
import { live } from '../state/store'
import { COARSE } from './quality'
import { BODY_W } from './layout'

const phase = (progress, start, end) => {
  const value = THREE.MathUtils.clamp((progress - start) / (end - start), 0, 1)
  return value * value * (3 - 2 * value)
}

// Pointer-parallax rig: the unit hangs in a void and leans toward the cursor.
// Damped, frame-rate independent, and it never fully faces away.
// ?debug freezes parallax and enables drag-orbit so you can dial the look.
export default function Rig({ children }) {
  const group = useRef()
  const { pointer, camera, size } = useThree()
  const target = useRef(new THREE.Vector2())
  const baseFov = useRef(0)
  const prevMorph = useRef(0)
  const shake = useRef(0)

  useLayoutEffect(() => {
    baseFov.current = camera.fov
    if (!VIEW) return
    camera.position.set(...VIEW.camera)
    camera.fov = VIEW.fov
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
    baseFov.current = VIEW.fov
    group.current.rotation.set(VIEW.rotX, VIEW.rotY, 0)
  }, [camera])

  // Fit-to-width: the vertical fov frames the machine for landscape-ish
  // aspects; on a portrait phone the 10.28-unit body clips off both sides.
  // Dolly back just far enough that BODY_W + margin fits horizontally.
  // Margin 0.8 also covers the FX editor pose (+2.2 group dolly, -2° fov
  // punch) at iPhone aspect — don't shrink it below ~0.65. Locked ?view=
  // presets keep their exact camera for the screenshot harness.
  useLayoutEffect(() => {
    if (VIEW) return
    const aspect = size.width / size.height
    const need = (BODY_W / 2 + 0.8) /
      (Math.tan(THREE.MathUtils.degToRad(baseFov.current / 2)) * aspect)
    camera.position.z = Math.max(46, need)
    camera.updateProjectionMatrix()
  }, [size, camera])

  useFrame((state, dt) => {
    if (!VIEW && !DEBUG) {
      if (COARSE) {
        // Touch has no hover pointer to track. Hold a fixed pose: straight-on,
        // no yaw, leaned back a touch (rotX = -y * 0.26 ≈ -8°).
        target.current.x = 0
        target.current.y = 0.55
      } else {
        const t = Math.min(dt, 0.1)
        // x tracks faster than y so side-to-side yaw feels snappy without
        // making the vertical tilt twitchy
        target.current.x += (pointer.x - target.current.x) * (1 - Math.exp(-7 * t))
        target.current.y += (pointer.y - target.current.y) * (1 - Math.exp(-3.5 * t))
      }
    }
    const g = group.current
    if (!g) return
    const frameTime = Math.min(dt, 0.05)
    const fxPose = phase(live.fxMorph, 0.02, 0.54)
    const mix = fxPose * fxPose * (3 - 2 * fxPose)
    const baseRotY = VIEW ? VIEW.rotY : target.current.x * 0.42
    const baseRotX = VIEW ? VIEW.rotX : -target.current.y * 0.26
    const baseX = VIEW ? 0 : target.current.x * 0.9

    // Editor mode docks the product into a deliberate near-face-on inspection
    // pose. 25% of the pointer parallax survives at full morph so speculars
    // and env reflections keep sliding across the lit panel face — a fully
    // dead-on camera is what made the editor read as a flat 2D mockup.
    g.rotation.y = THREE.MathUtils.damp(g.rotation.y, baseRotY * (1 - 0.75 * mix), 12, frameTime)
    g.rotation.x = THREE.MathUtils.damp(g.rotation.x, baseRotX * (1 - 0.75 * mix), 12, frameTime)
    g.rotation.z = THREE.MathUtils.damp(g.rotation.z, -0.012 * mix, 12, frameTime)
    g.position.x = THREE.MathUtils.damp(g.position.x, baseX * (1 - 0.75 * mix), 12, frameTime)
    g.position.y = THREE.MathUtils.damp(g.position.y, mix * 0.08, 12, frameTime)
    // A real dolly-in for the editor pose; slower damping than the rotations
    // so the push reads as a camera glide, not part of the machine's snap.
    const prevZ = g.position.z
    // 2.2 (with the softer fov punch below) leaves a dark chassis/backdrop
    // border around the editor — full-frame white was killing the contrast.
    g.position.z = THREE.MathUtils.damp(g.position.z, mix * 2.2, 7, frameTime)
    // Post reads this: chromatic aberration rides the dolly speed, so the
    // smear exists only while the camera is actually moving.
    live.dollyVel = (g.position.z - prevZ) / frameTime

    // Dolly-zoom punch: fov tightens as the glass strokes fire, so the push
    // compresses the frame instead of just enlarging it.
    const fovTarget = baseFov.current - phase(live.fxMorph, 0.45, 0.95) * 2.0
    camera.fov = THREE.MathUtils.damp(camera.fov, fovTarget, 6, frameTime)
    camera.updateProjectionMatrix()

    // One decaying kick when the vertical stroke latches home.
    if (live.fxMorph > 0.92 && prevMorph.current <= 0.92) shake.current = 1
    prevMorph.current = live.fxMorph
    shake.current *= Math.exp(-9 * frameTime)
    if (shake.current > 0.004) {
      const s = Math.sin(state.clock.elapsedTime * 55) * shake.current
      g.position.y += s * 0.05
      g.rotation.z += s * 0.005
    }
  })

  return (
    <>
      <group ref={group}>{children}</group>
      {DEBUG && <OrbitControls makeDefault enablePan={false} enableZoom target={[0, 0, 0]} />}
    </>
  )
}
