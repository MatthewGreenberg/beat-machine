import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import Chassis from './Chassis'
import Keys from './Keys'
import Knob from './Knob'
import Screen from './Screen'
import Props from './Props'
import AssemblyPart from './AssemblyPart'
import FxScreen from './FxScreen'
import { live, useStore } from '../state/store'

const CHASSIS_FROM = [0, -2.8, -20]
const CHASSIS_ROTATION = [0.28, -0.48, 0.14]
const CHASSIS_ARC = [0, 3.8, 2.4]
const KNOB_FROM = [-14, 10, 19]
const KNOB_ROTATION = [1.36, -1.12, -2.7]
const KNOB_ARC = [7.5, -3.5, 4.8]

const phase = (progress, start, end) => {
  const value = THREE.MathUtils.clamp((progress - start) / (end - start), 0, 1)
  return value * value * (3 - 2 * value)
}

export default function Machine() {
  const fxOpen = useStore((state) => state.fxOpen)
  const raw = useRef(0)
  const morph = useRef(0)
  const knob = useRef()
  const screen = useRef()

  useFrame((_, dt) => {
    const frameTime = Math.min(dt, 0.05)
    const duration = fxOpen ? 1.25 : 0.7
    raw.current = THREE.MathUtils.clamp(
      raw.current + (fxOpen ? 1 : -1) * frameTime / duration,
      0,
      1,
    )
    // Constant velocity reads mechanical; the master timeline gets a
    // smoothstep so every sub-phase inherits a slow start and a soft landing.
    morph.current = raw.current * raw.current * (3 - 2 * raw.current)
    live.fxMorph = morph.current

    // go-go-gadget sequence: dial sinks, key rows ratchet down top-to-bottom
    // (per-row stagger lives in Keys.jsx FxSink, 0.10-0.58), then the glass
    // extends horizontally and finally vertically (FxScreen). Strictly
    // sequential so each mechanical beat reads on its own.
    const knobPhase = phase(morph.current, 0.0, 0.16)
    const screenPhase = phase(morph.current, 0.5, 0.68)

    if (knob.current) {
      // 1.6 fully clears the 1.36-tall dial below the seated glass (z ~0.84).
      // The dial follows its phase through a damp: tight while sinking, loose
      // on close so the big knob glides back up and settles after the glass.
      knob.current.position.z = THREE.MathUtils.damp(
        knob.current.position.z, -knobPhase * 1.6, fxOpen ? 18 : 5, frameTime,
      )
      const travel = -knob.current.position.z / 1.6
      knob.current.scale.setScalar(1 - travel * 0.04)
      knob.current.rotation.z = travel * -0.025
    }
    if (screen.current) screen.current.position.z = -screenPhase * 1.3
  })

  return (
    <group>
      <AssemblyPart
        fromPosition={CHASSIS_FROM}
        fromRotation={CHASSIS_ROTATION}
        fromScale={0.76}
        arc={CHASSIS_ARC}
        duration={1.38}
      >
        <Chassis />
      </AssemblyPart>
      <Keys />
      <group ref={knob}>
        <AssemblyPart
          fromPosition={KNOB_FROM}
          fromRotation={KNOB_ROTATION}
          fromScale={0.38}
          arc={KNOB_ARC}
          delay={0.12}
          duration={1.48}
        >
          <Knob />
        </AssemblyPart>
      </group>
      <group ref={screen}>
        <Screen />
      </group>
      <Props />
      <FxScreen morph={morph} />
    </group>
  )
}
