import { Canvas } from '@react-three/fiber'
import { PerformanceMonitor } from '@react-three/drei'
import { Suspense, useCallback, useMemo, useState } from 'react'
import { Leva, button, levaStore, useControls } from 'leva'
import * as THREE from 'three'
import Rig from './scene/Rig'
import Look from './scene/Look'
import Lighting from './scene/Lighting'
import Machine from './scene/Machine'
import Post from './scene/Post'
import TempoMatrix from './scene/TempoMatrix'
import Hud from './ui/Hud'
import { DEBUG, NO_POST } from './scene/views'
import {
  COARSE,
  QualityProvider,
  qualityConfig,
  qualityNameForFactor,
  requestedQuality,
} from './scene/quality'

const FORCED_QUALITY = requestedQuality()
// Touch devices boot in the performance preset and let PerformanceMonitor
// earn its way up; desktop starts balanced as before.
const INITIAL_FACTOR = COARSE ? 0.2 : 0.58

function CopyValues() {
  useControls('Debug', {
    'Copy all values': button(() => {
      const out = {}
      for (const [path, item] of Object.entries(levaStore.getData())) {
        if (!('value' in item) || path.startsWith('Debug.')) continue
        const parts = path.split('.')
        let cur = out
        for (let i = 0; i < parts.length - 1; i++) cur = (cur[parts[i]] ??= {})
        cur[parts.at(-1)] = item.value
      }
      navigator.clipboard.writeText(JSON.stringify(out, null, 2))
    }),
  })
  return null
}

export default function App() {
  const [qualityFactor, setQualityFactor] = useState(INITIAL_FACTOR)
  const [adaptiveFallback, setAdaptiveFallback] = useState(false)

  const qualityName = FORCED_QUALITY
    ?? (adaptiveFallback ? 'performance' : qualityNameForFactor(qualityFactor))
  const quality = useMemo(
    () => qualityConfig(qualityName, FORCED_QUALITY ? null : qualityFactor),
    [qualityFactor, qualityName],
  )

  const updateQuality = useCallback((api) => {
    setQualityFactor((current) => (
      Math.abs(current - api.factor) >= 0.01 ? api.factor : current
    ))
  }, [])

  return (
    <QualityProvider value={quality}>
      <div className="stage" data-quality={quality.name}>
        <Leva hidden={!DEBUG} />
        {DEBUG && <CopyValues />}
        <Canvas
          dpr={quality.dpr}
          gl={{
            // the post chain owns AA (composer MSAA or FXAA); canvas MSAA on
            // top of it is pure fill-rate waste. ?post=0 renders straight to
            // canvas, so it keeps native AA and its depth buffer.
            antialias: NO_POST,
            stencil: false,
            depth: NO_POST,
            toneMapping: THREE.ACESFilmicToneMapping,
            toneMappingExposure: 0.92,
            powerPreference: 'high-performance',
          }}
          camera={{ position: [0, 0, 46], fov: 26, near: 0.1, far: 200 }}
        >
          {!FORCED_QUALITY && !adaptiveFallback && (
            <PerformanceMonitor
              factor={INITIAL_FACTOR}
              iterations={6}
              ms={350}
              threshold={0.8}
              step={0.12}
              flipflops={4}
              bounds={(refreshRate) => (
                refreshRate > 100
                  ? [refreshRate * 0.72, refreshRate * 0.92]
                  : [48, 58]
              )}
              onChange={updateQuality}
              onFallback={() => setAdaptiveFallback(true)}
            />
          )}
          <Suspense fallback={null}>
            <Look />
            <Rig>
              <TempoMatrix />
              <Lighting />
              <Machine />
            </Rig>
            <Post />
          </Suspense>
        </Canvas>
        <Hud />
      </div>
    </QualityProvider>
  )
}
