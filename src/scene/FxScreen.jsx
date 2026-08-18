import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { RoundedBox } from '@react-three/drei'
import * as THREE from 'three'
import { actions, useStore } from '../state/store'
import { FINISHES, getFinish } from '../finishes'
import { BODY_H, BODY_W, PLATE_H, PLATE_Z, TOP_Y } from './layout'
import { toTexture } from './textures'

const EDITOR_W = BODY_W - 0.48
const EDITOR_H = BODY_H - 0.5
const SURFACE_Z = PLATE_Z + 1.74
const SOURCE_W = BODY_W - 4.7
const SOURCE_H = 2.5
const CLOSED_X = BODY_W / 2 - SOURCE_W / 2 - 0.55
const CLOSED_Y = TOP_Y - PLATE_H + 1.8
const SOURCE_Z = PLATE_Z + 0.17
const CLOSED_SCALE = [SOURCE_W / EDITOR_W, SOURCE_H / EDITOR_H]
const TRACK_X0 = -1.85
const TRACK_X1 = 3.55
const TRACK_W = TRACK_X1 - TRACK_X0

const ROWS = [
  { key: 'filter', label: 'FILTER', detail: 'LOW-PASS / 24 dB', y: 2.15 },
  { key: 'drive', label: 'DRIVE', detail: 'SOFT CLIP / PRE', y: 0.55 },
  { key: 'delay', label: 'ECHO', detail: '1/8 SYNC / SEND', y: -1.05 },
  { key: 'space', label: 'SPACE', detail: 'PLATE / SEND', y: -2.65 },
]

const VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const FRAGMENT = `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uReveal;
  uniform float uMorph;
  uniform float uEnergy;
  uniform vec3 uAccent;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 34.45);
    return fract(p.x * p.y);
  }

  float roundedMask(vec2 uv, float radius) {
    vec2 p = abs(uv - 0.5) - vec2(0.5 - radius);
    return 1.0 - smoothstep(radius - 0.004, radius + 0.004, length(max(p, 0.0)) + min(max(p.x, p.y), 0.0));
  }

  void main() {
    vec2 uv = vUv;
    float morphPulse = sin(clamp(uMorph, 0.0, 1.0) * 3.14159265);
    uv.x += sin(uv.y * 34.0 + uTime * 2.2) * morphPulse * 0.008;
    uv.y += sin(uv.x * 21.0 - uTime * 1.7) * morphPulse * 0.004;
    vec2 p = uv - 0.5;
    p.x *= 0.68;
    float mask = roundedMask(uv, 0.025);

    vec3 col = vec3(0.004, 0.007, 0.009);
    float halo = exp(-length(p - vec2(0.0, 0.08)) * 4.2);
    col += uAccent * halo * (0.045 + uEnergy * 0.055);

    vec2 gridUv = vec2(uv.x * 22.0, uv.y * 34.0 - uTime * 0.035);
    float gx = 1.0 - smoothstep(0.0, 0.035, abs(fract(gridUv.x) - 0.5));
    float gy = 1.0 - smoothstep(0.0, 0.035, abs(fract(gridUv.y) - 0.5));
    float grid = max(gx, gy);
    col += uAccent * grid * 0.035;

    // A live signal trace in the upper chamber. Its density and jitter respond
    // to the four inserts, so the editor never reads as a static decal.
    float chamber = smoothstep(0.64, 0.67, uv.y) * (1.0 - smoothstep(0.82, 0.85, uv.y));
    float waveY = 0.745
      + sin(uv.x * 31.0 + uTime * 2.4) * (0.010 + uEnergy * 0.014)
      + sin(uv.x * 83.0 - uTime * 4.1) * 0.006;
    float trace = exp(-abs(uv.y - waveY) * 720.0) * chamber;
    float ghost = exp(-abs(uv.y - waveY) * 115.0) * chamber;
    col += mix(vec3(0.74, 0.94, 1.0), uAccent, 0.38) * trace * 2.2;
    col += uAccent * ghost * 0.34;

    // A bright transfer line runs down the membrane while the old LCD is
    // becoming the larger surface. It is transition energy, not another panel.
    float transferY = mix(0.78, 0.12, uMorph);
    float transfer = exp(-abs(uv.y - transferY) * 85.0) * morphPulse;
    col += mix(vec3(0.7, 0.92, 1.0), uAccent, 0.55) * transfer * 0.72;

    float scan = 0.965 + 0.035 * sin(uv.y * 1800.0);
    col *= scan;
    col += (hash(gl_FragCoord.xy + uTime * 17.0) - 0.5) * 0.014;

    float edge = 1.0 - smoothstep(0.0, 0.018, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)));
    col += uAccent * edge * 0.18;
    float fade = smoothstep(0.08, 0.42, uReveal);
    gl_FragColor = vec4(max(col, 0.0), mask * fade);
  }
`

function makeReadoutCanvas() {
  const c = document.createElement('canvas')
  c.width = 1024
  c.height = 1536
  return c
}

function formatValue(key, value) {
  if (key === 'filter') {
    const frequency = 180 * Math.pow(100, value)
    return frequency >= 1000
      ? `${(frequency / 1000).toFixed(1)} kHz`
      : `${Math.round(frequency)} Hz`
  }
  return `${Math.round(value * 100).toString().padStart(2, '0')}%`
}

function drawReadout(canvas, texture, fx, finishIndex) {
  const g = canvas.getContext('2d')
  const sx = canvas.width / EDITOR_W
  const sy = canvas.height / EDITOR_H
  const x = (worldX) => canvas.width / 2 + worldX * sx
  const y = (worldY) => canvas.height / 2 - worldY * sy
  const accent = getFinish(finishIndex).accent

  g.clearRect(0, 0, canvas.width, canvas.height)
  g.textBaseline = 'middle'
  g.font = '700 38px "SFMono-Regular", "Courier New", monospace'
  g.letterSpacing = '8px'
  g.fillStyle = 'rgba(238,247,250,0.92)'
  g.fillText('FX / SIGNAL LAB', x(-4.25), y(6.25))

  g.font = '500 18px "SFMono-Regular", "Courier New", monospace'
  g.letterSpacing = '4px'
  g.fillStyle = accent
  g.fillText('MASTER INSERT', x(-4.22), y(5.73))
  g.textAlign = 'right'
  g.fillStyle = 'rgba(203,220,226,0.45)'
  g.fillText('LIVE // 04 CH', x(4.2), y(5.73))
  g.textAlign = 'left'

  g.strokeStyle = 'rgba(214,233,238,0.11)'
  g.lineWidth = 2
  g.strokeRect(x(-4.22), y(5.25), x(4.22) - x(-4.22), y(3.45) - y(5.25))
  g.font = '500 16px "SFMono-Regular", "Courier New", monospace'
  g.letterSpacing = '3px'
  g.fillStyle = 'rgba(203,220,226,0.42)'
  g.fillText('POST BUS / REALTIME RETURN', x(-4.0), y(4.95))

  for (const row of ROWS) {
    g.strokeStyle = 'rgba(214,233,238,0.09)'
    g.beginPath()
    g.moveTo(x(-4.2), y(row.y - 0.7))
    g.lineTo(x(4.2), y(row.y - 0.7))
    g.stroke()

    g.font = '700 25px "SFMono-Regular", "Courier New", monospace'
    g.letterSpacing = '5px'
    g.fillStyle = 'rgba(229,240,243,0.78)'
    g.fillText(row.label, x(-4.15), y(row.y + 0.18))
    g.font = '500 14px "SFMono-Regular", "Courier New", monospace'
    g.letterSpacing = '2px'
    g.fillStyle = 'rgba(189,208,214,0.34)'
    g.fillText(row.detail, x(-4.15), y(row.y - 0.24))

    g.textAlign = 'right'
    g.font = '700 25px "SFMono-Regular", "Courier New", monospace'
    g.letterSpacing = '1px'
    g.fillStyle = accent
    g.fillText(formatValue(row.key, fx[row.key]), x(4.15), y(row.y + 0.05))
    g.textAlign = 'left'

    for (let i = 0; i <= 10; i++) {
      const tickX = THREE.MathUtils.lerp(TRACK_X0, TRACK_X1, i / 10)
      g.fillStyle = i % 5 === 0
        ? 'rgba(224,239,243,0.32)'
        : 'rgba(224,239,243,0.13)'
      g.fillRect(x(tickX) - 1, y(row.y - 0.34), 2, i % 5 === 0 ? 12 : 7)
    }
  }

  g.font = '700 18px "SFMono-Regular", "Courier New", monospace'
  g.letterSpacing = '4px'
  g.fillStyle = 'rgba(229,240,243,0.62)'
  g.fillText('MACHINE SKIN', x(-4.15), y(-4.1))
  g.textAlign = 'right'
  g.fillStyle = accent
  g.fillText(FINISHES[finishIndex].label.toUpperCase(), x(4.15), y(-4.1))
  g.textAlign = 'center'

  const chipX = [-2.95, -0.98, 0.98, 2.95]
  FINISHES.forEach((option, index) => {
    g.font = '600 13px "SFMono-Regular", "Courier New", monospace'
    g.letterSpacing = '2px'
    g.fillStyle = index === finishIndex
      ? 'rgba(241,249,251,0.84)'
      : 'rgba(193,208,213,0.34)'
    g.fillText(option.label.toUpperCase(), x(chipX[index]), y(-5.25))
  })

  g.textAlign = 'left'
  g.font = '500 14px "SFMono-Regular", "Courier New", monospace'
  g.letterSpacing = '3px'
  g.fillStyle = 'rgba(193,208,213,0.3)'
  g.fillText('DRAG TO SHAPE', x(-4.15), y(-6.45))
  g.textAlign = 'right'
  g.fillStyle = 'rgba(193,208,213,0.3)'
  g.fillText('ESC / FX TO EXIT', x(4.15), y(-6.45))
  g.textAlign = 'left'

  texture.needsUpdate = true
}

function FxFader({ row, value, accent }) {
  const drag = useRef(false)
  const handle = useRef()
  const handleMaterial = useRef()
  const [hover, setHover] = useState(false)
  const knobX = THREE.MathUtils.lerp(TRACK_X0, TRACK_X1, value)
  const fillWidth = Math.max(0.015, knobX - TRACK_X0)

  useFrame((_, dt) => {
    const mesh = handle.current
    const material = handleMaterial.current
    if (!mesh || !material) return
    const target = hover || drag.current ? 1.18 : 1
    const k = 1 - Math.exp(-14 * Math.min(dt, 0.05))
    mesh.scale.y = THREE.MathUtils.lerp(mesh.scale.y, target, k)
    material.emissiveIntensity = THREE.MathUtils.lerp(
      material.emissiveIntensity,
      hover || drag.current ? 5.2 : 3.2,
      k,
    )
  })

  const update = (event) => {
    if (!event.uv) return
    actions.setFxValue(row.key, THREE.MathUtils.clamp(event.uv.x, 0, 1))
  }

  const finish = (event) => {
    if (!drag.current) return
    drag.current = false
    event.target.releasePointerCapture?.(event.pointerId)
    document.body.style.cursor = hover ? 'ew-resize' : ''
  }

  return (
    <group>
      <mesh position={[(TRACK_X0 + TRACK_X1) / 2, row.y, 0.23]}>
        <boxGeometry args={[TRACK_W, 0.055, 0.055]} />
        <meshBasicMaterial color="#2b3438" transparent opacity={0} userData={{ fxVisual: true }} />
      </mesh>
      <mesh position={[TRACK_X0 + fillWidth / 2, row.y, 0.255]} scale={[fillWidth, 1, 1]}>
        <boxGeometry args={[1, 0.065, 0.065]} />
        <meshBasicMaterial color={accent} transparent opacity={0} toneMapped={false} userData={{ fxVisual: true }} />
      </mesh>
      <RoundedBox
        ref={handle}
        args={[0.22, 0.48, 0.14]}
        radius={0.07}
        smoothness={4}
        position={[knobX, row.y, 0.34]}
      >
        <meshStandardMaterial
          ref={handleMaterial}
          color="#eaf8fb"
          emissive={accent}
          emissiveIntensity={3.2}
          roughness={0.2}
          metalness={0.18}
          transparent
          opacity={0}
          toneMapped={false}
          userData={{ fxVisual: true }}
        />
      </RoundedBox>

      {/* Transparent WebGL hit surface: the visual, hit test and audio value
          all live in the same Three.js coordinate system. */}
      <mesh
        position={[(TRACK_X0 + TRACK_X1) / 2, row.y, 0.48]}
        onPointerOver={(event) => {
          event.stopPropagation()
          setHover(true)
          document.body.style.cursor = 'ew-resize'
        }}
        onPointerOut={() => {
          setHover(false)
          document.body.style.cursor = drag.current ? 'grabbing' : ''
        }}
        onPointerDown={(event) => {
          event.stopPropagation()
          drag.current = true
          event.target.setPointerCapture(event.pointerId)
          document.body.style.cursor = 'grabbing'
          update(event)
        }}
        onPointerMove={(event) => {
          if (!drag.current) return
          event.stopPropagation()
          update(event)
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
      >
        <planeGeometry args={[TRACK_W + 0.35, 0.92]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} userData={{ fxInvisible: true }} />
      </mesh>
    </group>
  )
}

function FinishSelector({ selected }) {
  const positions = [-2.95, -0.98, 0.98, 2.95]
  return FINISHES.map((finish, index) => {
    const active = index === selected
    return (
      <RoundedBox
        key={finish.id}
        args={[1.62, 0.68, active ? 0.16 : 0.1]}
        radius={0.13}
        smoothness={4}
        position={[positions[index], -4.72, active ? 0.3 : 0.25]}
        onPointerOver={(event) => {
          event.stopPropagation()
          document.body.style.cursor = 'pointer'
        }}
        onPointerOut={() => { document.body.style.cursor = '' }}
        onPointerDown={(event) => {
          event.stopPropagation()
          actions.setFinish(index)
        }}
      >
        <meshStandardMaterial
          color={finish.accent}
          emissive={finish.accent}
          emissiveIntensity={active ? 3.6 : 0.42}
          metalness={0.18}
          roughness={active ? 0.2 : 0.42}
          transparent
          opacity={0}
          toneMapped={false}
          userData={{ fxVisual: true }}
        />
      </RoundedBox>
    )
  })
}

const phase = (progress, start, end) => {
  const value = THREE.MathUtils.clamp((progress - start) / (end - start), 0, 1)
  return value * value * (3 - 2 * value)
}

export default function FxScreen({ morph }) {
  const { fx, finish } = useStore()
  const activeFinish = getFinish(finish)
  const root = useRef()
  const visuals = useRef()
  const hitLayer = useRef()
  const backingMaterial = useRef()
  const shaderMaterial = useRef()
  const lamp = useRef()

  const [readoutCanvas, readoutTexture] = useMemo(() => {
    const c = makeReadoutCanvas()
    return [c, toTexture(c, { srgb: true, aniso: 16 })]
  }, [])

  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uReveal: { value: 0 },
    uMorph: { value: 0 },
    uEnergy: { value: 0 },
    uAccent: { value: new THREE.Color(activeFinish.accent) },
  // The material is intentionally stable; finish changes are eased in-frame.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [])

  useEffect(() => {
    drawReadout(readoutCanvas, readoutTexture, fx, finish)
  }, [finish, fx, readoutCanvas, readoutTexture])

  useEffect(() => () => {
    readoutTexture.dispose()
    document.body.style.cursor = ''
  }, [readoutTexture])

  useFrame(({ clock }, dt) => {
    const frameTime = Math.min(dt, 0.05)
    const mix = morph.current
    const widthPhase = phase(mix, 0.05, 0.42)
    const heightPhase = phase(mix, 0.16, 0.72)
    const depthPhase = phase(mix, 0.08, 0.68)
    const shellAlpha = phase(mix, 0.015, 0.2)
    const uiAlpha = phase(mix, 0.68, 0.94)
    const group = root.current
    if (!group) return

    group.visible = mix > 0.002
    group.position.x = THREE.MathUtils.lerp(CLOSED_X, 0, widthPhase)
    group.position.y = THREE.MathUtils.lerp(CLOSED_Y, 0, heightPhase)
    group.position.z = THREE.MathUtils.lerp(SOURCE_Z, SURFACE_Z, depthPhase)
    group.scale.set(
      THREE.MathUtils.lerp(CLOSED_SCALE[0], 1, widthPhase),
      THREE.MathUtils.lerp(CLOSED_SCALE[1], 1, heightPhase),
      1,
    )
    group.rotation.z = Math.sin(mix * Math.PI) * -0.011

    if (backingMaterial.current) backingMaterial.current.opacity = shellAlpha * 0.98
    if (lamp.current) lamp.current.intensity = shellAlpha * 2.2
    if (shaderMaterial.current) {
      shaderMaterial.current.uniforms.uTime.value = clock.elapsedTime
      shaderMaterial.current.uniforms.uReveal.value = shellAlpha
      shaderMaterial.current.uniforms.uMorph.value = mix
      shaderMaterial.current.uniforms.uEnergy.value = (
        fx.filter + fx.drive + fx.delay + fx.space
      ) / 4
      shaderMaterial.current.uniforms.uAccent.value.lerp(
        new THREE.Color(activeFinish.accent),
        1 - Math.exp(-5 * frameTime),
      )
    }
    if (visuals.current) {
      visuals.current.visible = uiAlpha > 0.001
      visuals.current.traverse((item) => {
        const material = item.material
        if (!material || material.isShaderMaterial || material.userData.fxInvisible) return
        material.opacity = uiAlpha
      })
    }
    if (hitLayer.current) hitLayer.current.visible = mix > 0.9
  })

  return (
    <group ref={root} visible={false}>
      <group>
        {/* A machined dark frame remains visible at the perimeter, so this is
            unmistakably the same piece of hardware in a second state. */}
        <RoundedBox args={[EDITOR_W, EDITOR_H, 0.34]} radius={0.3} smoothness={5}>
          <meshPhysicalMaterial
            ref={backingMaterial}
            color="#080b0d"
            metalness={0.78}
            roughness={0.24}
            clearcoat={0.64}
            clearcoatRoughness={0.16}
            transparent
            opacity={0}
            depthWrite={false}
            userData={{ fxVisual: true }}
          />
        </RoundedBox>

        <mesh position={[0, 0, 0.19]}>
          <planeGeometry args={[EDITOR_W - 0.18, EDITOR_H - 0.18]} />
          <shaderMaterial
            ref={shaderMaterial}
            vertexShader={VERTEX}
            fragmentShader={FRAGMENT}
            uniforms={uniforms}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </mesh>

        <group ref={visuals}>
          <mesh position={[0, 0, 0.215]} renderOrder={4}>
            <planeGeometry args={[EDITOR_W - 0.2, EDITOR_H - 0.2]} />
            <meshBasicMaterial
              map={readoutTexture}
              transparent
              opacity={0}
              depthWrite={false}
              toneMapped={false}
              userData={{ fxVisual: true }}
            />
          </mesh>

          {ROWS.map((row) => (
            <FxFader
              key={row.key}
              row={row}
              value={fx[row.key]}
              accent={activeFinish.accent}
            />
          ))}
          <FinishSelector selected={finish} />

          {/* Small scan nodes make the glass feel clamped into the old chassis,
              not composited on top of it. */}
          {[
            [-4.34, 6.55], [4.34, 6.55], [-4.34, -6.55], [4.34, -6.55],
          ].map(([x, y]) => (
            <mesh key={`${x}:${y}`} position={[x, y, 0.32]}>
              <circleGeometry args={[0.075, 20]} />
              <meshBasicMaterial
                color={activeFinish.accent}
                transparent
                opacity={0}
                toneMapped={false}
                userData={{ fxVisual: true }}
              />
            </mesh>
          ))}
        </group>

        <pointLight
          ref={lamp}
          position={[0, 0.5, 1.2]}
          color={activeFinish.accent}
          intensity={2.2}
          distance={7}
          decay={2}
        />
      </group>

      <group ref={hitLayer} visible={false}>
        {/* The blocker prevents the retracted physical keys from receiving
            events through the glass between the editor controls. */}
        <mesh
          position={[0, 0, 0.18]}
          onPointerDown={(event) => event.stopPropagation()}
          onPointerMove={(event) => event.stopPropagation()}
        >
          <planeGeometry args={[EDITOR_W, EDITOR_H]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      </group>
    </group>
  )
}
