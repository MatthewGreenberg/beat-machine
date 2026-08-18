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
  const morph = useRef(0)
  const keys = useRef()
  const knob = useRef()
  const screen = useRef()

  useFrame((_, dt) => {
    const frameTime = Math.min(dt, 0.05)
    const duration = fxOpen ? 0.64 : 0.46
    morph.current = THREE.MathUtils.clamp(
      morph.current + (fxOpen ? 1 : -1) * frameTime / duration,
      0,
      1,
    )
    live.fxMorph = morph.current

    // The LCD is the source. The dial seats first, then the pad bank drops in
    // rows beneath the advancing glass; the original LCD only releases after
    // the new surface has inherited its image.
    const knobPhase = phase(morph.current, 0.04, 0.34)
    const keyPhase = phase(morph.current, 0.18, 0.62)
    const screenPhase = phase(morph.current, 0.62, 0.86)

    if (knob.current) {
      knob.current.position.z = -knobPhase * 1.34
      knob.current.scale.setScalar(1 - knobPhase * 0.04)
      knob.current.rotation.z = knobPhase * -0.025
    }
    if (keys.current) {
      keys.current.position.z = -keyPhase * 1.3
      keys.current.scale.set(1 - keyPhase * 0.022, 1 - keyPhase * 0.018, 1)
      keys.current.rotation.x = keyPhase * 0.018
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
      <group ref={keys}>
        <Keys />
      </group>
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
