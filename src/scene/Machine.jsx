import Chassis from './Chassis'
import Keys from './Keys'
import Knob from './Knob'
import Screen from './Screen'
import Props from './Props'
import AssemblyPart from './AssemblyPart'

const CHASSIS_FROM = [0, -2.8, -20]
const CHASSIS_ROTATION = [0.28, -0.48, 0.14]
const CHASSIS_ARC = [0, 3.8, 2.4]
const KNOB_FROM = [-14, 10, 19]
const KNOB_ROTATION = [1.36, -1.12, -2.7]
const KNOB_ARC = [7.5, -3.5, 4.8]

export default function Machine() {
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
      <Screen />
      <Props />
    </group>
  )
}
