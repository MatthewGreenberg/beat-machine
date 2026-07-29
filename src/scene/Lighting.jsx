import { Environment, Lightformer } from '@react-three/drei'
import { useControls } from 'leva'

// Reference look: an object lit in a black room. One hard key rakes the face
// from upper-left-front, a cool sliver skims the right edge, and there is no
// broad fill at all — the environment is reflection-only so glossy plastic gets
// small hard speculars without a grey wash flattening every value.
//
// Spot/point intensities are candela with physical inverse-square decay, so
// irradiance is intensity / distance². The key sits close (~26 units) on
// purpose: the falloff across that distance is what darkens the bottom rows.
export default function Lighting() {
  const {
    envIntensity,
    softbox,
    softboxColor,
    strip,
    stripColor,
    pinpoint,
    keyIntensity,
    keyColor,
    rimIntensity,
    rimColor,
    bounceIntensity,
    bounceColor,
  } = useControls('Lighting', {
    envIntensity: { value: 0.55, min: 0, max: 2, step: 0.05 },
    softbox: { value: 1, min: 0, max: 4, step: 0.05 },
    softboxColor: '#fff2e0',
    strip: { value: 0.55, min: 0, max: 4, step: 0.05 },
    stripColor: '#95a8c6',
    pinpoint: { value: 2.5, min: 0, max: 30, step: 0.5 },
    keyIntensity: { value: 2200, min: 0, max: 6000, step: 50 },
    keyColor: '#fff4e6',
    rimIntensity: { value: 900, min: 0, max: 3000, step: 50 },
    rimColor: '#a8bcd8',
    bounceIntensity: { value: 0, min: 0, max: 1500, step: 10 },
    bounceColor: '#2c7258',
  })

  return (
    <>
      {/* Reflection-only room. Almost entirely black; the panels exist to be
          seen *in* the plastic, not to light it. frames={1} bakes once. */}
      {/* key remounts + frames=1 so leva retunes without a per-frame bake */}
      <Environment key={`${softbox}|${softboxColor}|${strip}|${stripColor}|${pinpoint}`} resolution={128} frames={1} environmentIntensity={envIntensity}>
        {/* big warm softbox, upper-left-front — broad sheen across the plate.
            Deliberately large: a small one mirrors as a hard-edged parallelogram
            in the glossy faceplate, a large one reads as an even sheen. */}
        <Lightformer
          form="rect"
          intensity={softbox}
          color={softboxColor}
          position={[-14, 22, 26]}
          rotation={[-0.6, -0.45, 0]}
          scale={[26, 16, 1]}
        />
        {/* cool vertical strip, camera-right — blue edge on the cap shoulders */}
        <Lightformer
          form="rect"
          intensity={strip}
          color={stripColor}
          position={[16, 1, 6]}
          rotation={[0, -1.25, 0]}
          scale={[2.5, 22, 1]}
        />
        {/* one hot pinpoint: this is what makes the small hard speculars */}
        <Lightformer form="circle" intensity={pinpoint} color="#ffffff" position={[-5, 8, 14]} scale={0.9} />
      </Environment>

      {/* KEY — upper-left-front, close in. Cone is wide enough that its edge
          never lands on the unit (a visible cone boundary reads as a fake
          wedge); the top-bright / bottom-dark gradient comes from the 1/d²
          falloff between the top row and the bottom row instead. */}
      <spotLight
        position={[-11, 14, 18]}
        angle={0.62}
        penumbra={0.85}
        decay={2}
        intensity={keyIntensity}
        color={keyColor}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.00015}
        shadow-normalBias={0.06}
        shadow-camera-near={6}
        shadow-camera-far={60}
      />

      {/* RIM — cool, camera-right and slightly behind. Only ever catches the
          right shoulders of the caps and the chassis edge; contributes ~nothing
          face-on, which is why the front view keeps its contrast. */}
      <spotLight
        position={[21, 5, -4]}
        angle={0.95}
        penumbra={1}
        decay={2}
        intensity={rimIntensity}
        color={rimColor}
      />

      {/* BOUNCE — a whisper of cool fill from below so the bottom rows sit at
          near-black rather than dead black. Deliberately tiny. */}
      <pointLight position={[1, -15, 14]} intensity={bounceIntensity} decay={2} color={bounceColor} />
    </>
  )
}
