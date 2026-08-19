import {
  EffectComposer,
  Bloom,
  DepthOfField,
  Vignette,
  Noise,
  ChromaticAberration,
  ToneMapping,
  N8AO,
  FXAA,
} from '@react-three/postprocessing'
import { BlendFunction, KernelSize, ToneMappingMode } from 'postprocessing'
import { useControls } from 'leva'
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { VIEW, VIEWS, NO_POST } from './views'
import { useQuality } from './quality'
import { live } from '../state/store'

// EffectComposer forces renderer.toneMapping = NoToneMapping, so without an
// explicit ToneMapping effect nothing rolls off and every lit surface clips to
// white — that was the flat grey mass. ACES here also re-enables the canvas
// `toneMappingExposure` prop, which three feeds to the tone-map uniform.
//
// Order matters: AO and DOF and bloom are HDR/scene-space and must run before
// the tone map; aberration, vignette and grain are display-space and after.

const name = Object.keys(VIEWS).find((k) => VIEWS[k] === VIEW) ?? 'front'

// Distance from camera to the unit's centre, in world units — DOF focuses
// there. views.js's normalised `focus` values put the focal plane ~4 units from
// the camera, i.e. 40 units in front of the machine, which blurred everything.
const dist = VIEW ? Math.hypot(...VIEW.camera) : 46

// Front is a product shot: near-sharp. Hero/macro are the shallow ones.
const DOF = {
  front: { range: 13, bokeh: 2.2 },
  hero: { range: 3.4, bokeh: 7 },
  macro: { range: 2.2, bokeh: 8 },
}[name]

export default function Post() {
  const quality = useQuality()
  const {
    ao,
    aoRadius,
    dofRange,
    dofBokeh,
    bloom,
    bloomThresh,
    bloomRadius,
    vignetteOffset,
    vignetteDark,
    grain,
    aberration,
  } = useControls('Post', {
    ao: { value: 3.9, min: 0, max: 8, step: 0.1 },
    aoRadius: { value: 0.95, min: 0.1, max: 3, step: 0.05 },
    dofRange: { value: DOF.range, min: 0.5, max: 30, step: 0.1 },
    dofBokeh: { value: DOF.bokeh, min: 0, max: 12, step: 0.1 },
    bloom: { value: 0.4, min: 0, max: 3, step: 0.05 },
    bloomThresh: { value: 1.85, min: 0.5, max: 3, step: 0.05 },
    bloomRadius: { value: 0.55, min: 0.1, max: 2, step: 0.05 },
    vignetteOffset: { value: 0.28, min: 0, max: 1, step: 0.01 },
    vignetteDark: { value: 0.85, min: 0, max: 1.5, step: 0.01 },
    grain: { value: 0, min: 0, max: 0.2, step: 0.005 },
    aberration: { value: 0.0006, min: 0, max: 0.005, step: 0.0001 },
  })

  // Transition punch: chromatic aberration spikes mid-morph and relaxes at
  // both rests, so entering/leaving the FX editor smears the frame for a beat.
  // The effect holds this exact Vector2 as its uniform, so mutating it in
  // place animates the pass without rebuilding anything.
  const caOffset = useMemo(() => new THREE.Vector2(), [])
  const vignetteRef = useRef()
  const aoRef = useRef()
  useFrame(() => {
    // Driven by dolly speed, so the smear exists only while the camera is
    // pushing in/out. The multiplier is huge because radialModulation eats
    // most of the offset away from the screen edges.
    const pulse = Math.min(Math.abs(live.dollyVel) / 4, 1)
    // Base aberration fades with the morph: RGB fringing over the FX panel's
    // small print costs legibility. The dolly pulse still fires mid-morph.
    const amt = aberration * (1 - live.fxMorph * 0.85) * (1 + pulse * 90)
    caOffset.set(amt, amt * 1.25)
    // The FX editor is a bright near-full-frame panel; at full vignette its
    // falloff paints a huge grey ellipse across the white face. Fade it with
    // the morph — reads as the camera adapting exposure to the bright screen.
    const vignette = vignetteRef.current
    if (vignette) {
      vignette.uniforms.get('darkness').value = vignetteDark * (1 - live.fxMorph * 0.85)
    }
    // Full-strength wide-radius AO inks dark halos around the fader caps on
    // the bright FX panel — toon outlines. Tighten the radius and soften the
    // intensity with the morph: tight contact AO still grounds the card slabs
    // and caps without the halos.
    if (aoRef.current) {
      aoRef.current.configuration.intensity = ao * (1 - live.fxMorph * 0.55)
      aoRef.current.configuration.aoRadius = aoRadius * (1 - live.fxMorph * 0.58)
    }
  })

  if (NO_POST) return null
  const showDof = name !== 'front'
  const compactBloom = quality.bloom === 'compact'

  return (
    <EffectComposer multisampling={quality.multisampling}>
      {/* crevice darkening between caps — most of the material separation in
          the reference is contact shadow, not light */}
      <N8AO
        ref={aoRef}
        aoRadius={aoRadius}
        distanceFalloff={0.5}
        intensity={ao}
        aoSamples={quality.aoSamples}
        denoiseSamples={quality.denoiseSamples}
        halfRes
      />
      {showDof && (
        <DepthOfField
          worldFocusDistance={dist}
          worldFocusRange={dofRange}
          bokehScale={dofBokeh}
          height={quality.dofHeight}
        />
      )}
      {/* threshold sits above 1.0 so only the LCD and true speculars bloom */}
      <Bloom
        intensity={bloom}
        luminanceThreshold={bloomThresh}
        luminanceSmoothing={0.12}
        mipmapBlur={!compactBloom}
        radius={bloomRadius}
        resolutionScale={compactBloom ? 0.4 : undefined}
        kernelSize={compactBloom ? KernelSize.MEDIUM : undefined}
      />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <ChromaticAberration offset={caOffset} radialModulation modulationOffset={0.4} />
      <Vignette ref={vignetteRef} eskil={false} offset={vignetteOffset} darkness={vignetteDark} />
      <Noise opacity={grain} blendFunction={BlendFunction.OVERLAY} />
      {quality.antialias === 'fxaa' && <FXAA />}
    </EffectComposer>
  )
}
