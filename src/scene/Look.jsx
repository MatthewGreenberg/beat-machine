/* eslint-disable react-hooks/immutability */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useControls } from 'leva'
import * as THREE from 'three'
import { useStore } from '../state/store'
import { getFinish } from '../finishes'
import { INTRO_DISABLED } from './assemblyMotion'

const INITIAL_TRANSITION = INTRO_DISABLED ? 1 : 0

const vertexShader = `
  varying vec2 vUv;
  varying vec2 vScreenUv;
  varying float vBubbleLift;
  uniform float uTime;
  uniform float uTransition;
  uniform vec2 uBubbleCenter;
  uniform float uAspect;

  void main() {
    vUv = uv;
    vec4 baseClip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vScreenUv = baseClip.xy / baseClip.w * 0.5 + 0.5;

    float energy = sin(uTransition * 3.14159265);
    vec2 bubble = vScreenUv - uBubbleCenter;
    bubble.x *= uAspect;
    float distanceToCenter = length(bubble);
    float angle = atan(bubble.y, bubble.x);
    float radius = mix(-0.08, 1.05, uTransition);
    radius += sin(angle * 7.0 + uTime * 1.6) * 0.012 * energy;

    // A narrow crest physically bows the subdivided backdrop toward camera.
    // The shallow cap behind it makes the transition feel like a convex CRT
    // screen swelling outward instead of a flat circular mask.
    float crest = exp(-pow((distanceToCenter - radius) * 10.0, 2.0));
    float cap = radius > 0.0
      ? pow(max(0.0, 1.0 - distanceToCenter / radius), 2.0)
      : 0.0;
    vBubbleLift = (crest * 0.84 + cap * 0.78) * energy;

    vec3 displaced = position;
    displaced.z += vBubbleLift * 11.5;
    vec2 direction = bubble / max(distanceToCenter, 0.0001);
    displaced.xy += direction * (crest * 0.62 + cap * 0.28) * energy;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
  }
`

const fragmentShader = `
  precision highp float;

  varying vec2 vUv;
  varying vec2 vScreenUv;
  varying float vBubbleLift;
  uniform vec3 uFromTop;
  uniform vec3 uFromBottom;
  uniform vec3 uFromGlow;
  uniform vec3 uFromLine;
  uniform vec3 uToTop;
  uniform vec3 uToBottom;
  uniform vec3 uToGlow;
  uniform vec3 uToLine;
  uniform float uTime;
  uniform float uFromMode;
  uniform float uToMode;
  uniform float uTransition;
  uniform vec2 uBubbleCenter;
  uniform float uAspect;
  uniform vec2 uResolution;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  vec3 backdrop(
    vec2 uv,
    float mode,
    vec3 top,
    vec3 bottom,
    vec3 glow,
    vec3 line
  ) {
    vec2 p = uv - 0.5;
    p.x *= 1.65;

    vec3 color = mix(bottom, top, smoothstep(0.0, 1.0, uv.y));
    float halo = exp(-length(p - vec2(-0.08, 0.06)) * 3.1);
    color += glow * halo * 0.24;

    // Every finish shares the Cobalt screen-grid construction; its palette
    // still comes from the active skin's line/glow colors.
    vec2 gridUv = vec2(uv.x * 30.0, uv.y * 18.0 + uTime * 0.035);
    float grid = max(
      1.0 - smoothstep(0.0, 0.055, abs(fract(gridUv.x) - 0.5)),
      1.0 - smoothstep(0.0, 0.055, abs(fract(gridUv.y) - 0.5))
    );
    color += line * grid * 0.1 * smoothstep(0.0, 0.72, uv.y);

    float vignette = smoothstep(1.0, 0.18, length(p * vec2(0.78, 1.0)));
    color *= 0.46 + vignette * 0.54;
    return color;
  }

  void main() {
    vec2 uv = vUv;
    float energy = sin(uTransition * 3.14159265);

    vec2 screenUv = gl_FragCoord.xy / uResolution;
    vec2 bubble = screenUv - uBubbleCenter;
    bubble.x *= uAspect;
    float distanceToCenter = length(bubble);
    vec2 direction = bubble / max(distanceToCenter, 0.0001);
    vec2 uvDirection = vec2(direction.x / uAspect, direction.y);
    float angle = atan(bubble.y, bubble.x);
    float radius = mix(-0.08, 1.05, uTransition);
    radius += sin(angle * 7.0 + uTime * 1.6) * 0.012 * energy;

    float crest = exp(-pow((distanceToCenter - radius) * 34.0, 2.0));
    float cap = radius > 0.0
      ? pow(max(0.0, 1.0 - distanceToCenter / radius), 1.7)
      : 0.0;

    // Refract both sides of the moving boundary in opposite directions. The
    // new skin is slightly magnified inside the bubble, like curved glass.
    vec2 fromUv = clamp(
      uv + uvDirection * crest * energy * 0.022,
      vec2(0.001),
      vec2(0.999)
    );
    vec2 toUv = clamp(
      uv - uvDirection * (cap * 0.070 + crest * 0.020) * energy,
      vec2(0.001),
      vec2(0.999)
    );

    vec3 fromColor = backdrop(
      fromUv, uFromMode, uFromTop, uFromBottom, uFromGlow, uFromLine
    );
    vec3 toColor = backdrop(
      toUv, uToMode, uToTop, uToBottom, uToGlow, uToLine
    );

    float reveal = 1.0 - smoothstep(
      radius - 0.045,
      radius + 0.035,
      distanceToCenter
    );
    vec3 color = mix(fromColor, toColor, reveal);

    // A cool glass highlight on the upper-left arc and a skin-colored lower
    // rim make the boundary read as a glossy, dimensional bubble.
    float edge = crest * energy;
    vec3 edgeColor = mix(uFromGlow, uToGlow, uTransition);
    float glassArc = pow(max(0.0, dot(-direction, normalize(vec2(-0.62, 0.78)))), 5.0);
    color += edgeColor * edge * 0.62;
    color += vec3(0.72, 0.90, 1.0) * edge * glassArc * 0.60;
    color -= vec3(0.05, 0.065, 0.08) * edge * (1.0 - glassArc) * 0.7;

    // The raised mesh crest catches a final soft sheen, connecting the actual
    // vertex bow to the refracted fragment boundary.
    color += vec3(0.28, 0.42, 0.50) * vBubbleLift * 0.40;
    color += (hash(gl_FragCoord.xy + uTime) - 0.5) * (0.012 + energy * 0.016);

    gl_FragColor = vec4(color, 1.0);
  }
`

// Exposure + a procedural studio backdrop shared by all three finishes.
export default function Look() {
  const finishIndex = useStore((state) => state.finish)
  const finish = getFinish(finishIndex)
  const material = useRef()
  const activeFinish = useRef({ finish, index: finishIndex })
  const transition = useRef(INITIAL_TRANSITION)
  const transitionDuration = useRef(INTRO_DISABLED ? 0.85 : 1.75)

  const { exposure } = useControls('Look', {
    exposure: { value: 0.92, min: 0.2, max: 2.5, step: 0.01 },
  })
  const gl = useThree((s) => s.gl)
  const size = useThree((s) => s.size)
  useEffect(() => { gl.toneMappingExposure = exposure }, [gl, exposure])

  const uniforms = useMemo(() => ({
    uFromTop: { value: new THREE.Color(finish.background.top) },
    uFromBottom: { value: new THREE.Color(finish.background.bottom) },
    uFromGlow: { value: new THREE.Color(finish.background.glow) },
    uFromLine: { value: new THREE.Color(finish.background.line) },
    uToTop: { value: new THREE.Color(finish.background.top) },
    uToBottom: { value: new THREE.Color(finish.background.bottom) },
    uToGlow: { value: new THREE.Color(finish.background.glow) },
    uToLine: { value: new THREE.Color(finish.background.line) },
    uTime: { value: 0 },
    uFromMode: { value: finishIndex },
    uToMode: { value: finishIndex },
    uTransition: { value: INITIAL_TRANSITION },
    uBubbleCenter: { value: new THREE.Vector2(0.5, 0.54) },
    uAspect: { value: size.width / size.height },
    uResolution: {
      value: new THREE.Vector2(
        size.width * gl.getPixelRatio(),
        size.height * gl.getPixelRatio(),
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [])

  useEffect(() => {
    if (material.current) {
      material.current.uniforms.uAspect.value = size.width / size.height
    }
  }, [size.height, size.width])

  useEffect(() => {
    const mat = material.current
    const previous = activeFinish.current
    if (!mat || previous.index === finishIndex) return

    const from = previous.finish.background
    const to = finish.background
    mat.uniforms.uFromTop.value.set(from.top)
    mat.uniforms.uFromBottom.value.set(from.bottom)
    mat.uniforms.uFromGlow.value.set(from.glow)
    mat.uniforms.uFromLine.value.set(from.line)
    mat.uniforms.uToTop.value.set(to.top)
    mat.uniforms.uToBottom.value.set(to.bottom)
    mat.uniforms.uToGlow.value.set(to.glow)
    mat.uniforms.uToLine.value.set(to.line)
    mat.uniforms.uFromMode.value = previous.index
    mat.uniforms.uToMode.value = finishIndex
    mat.uniforms.uBubbleCenter.value.set(0.5, 0.5)
    transition.current = 0
    transitionDuration.current = 0.85
    activeFinish.current = { finish, index: finishIndex }
  }, [finish, finishIndex])

  useFrame((_, dt) => {
    const mat = material.current
    if (!mat) return

    const frameTime = Math.min(dt, 1 / 30)
    gl.getDrawingBufferSize(mat.uniforms.uResolution.value)
    mat.uniforms.uTime.value += frameTime
    transition.current = Math.min(
      1,
      transition.current + frameTime / transitionDuration.current,
    )
    const t = transition.current
    mat.uniforms.uTransition.value = t * t * (3 - 2 * t)
  })

  return (
    <>
      <color attach="background" args={[finish.background.bottom]} />
      <mesh position={[0, 0, -45]} frustumCulled={false} renderOrder={-100}>
        <planeGeometry args={[180, 120, 160, 100]} />
        <shaderMaterial
          ref={material}
          uniforms={uniforms}
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
    </>
  )
}
