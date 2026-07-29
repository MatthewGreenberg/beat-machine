import Chassis from './Chassis'
import Keys from './Keys'
import Knob from './Knob'
import Screen from './Screen'
import Props from './Props'

export default function Machine() {
  return (
    <group>
      <Chassis />
      <Keys />
      <Knob />
      <Screen />
      <Props />
    </group>
  )
}
