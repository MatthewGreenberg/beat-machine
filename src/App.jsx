import { Canvas } from '@react-three/fiber'
import { Suspense } from 'react'
import { Leva, button, levaStore, useControls } from 'leva'
import * as THREE from 'three'
import Rig from './scene/Rig'
import Look from './scene/Look'
import Lighting from './scene/Lighting'
import Machine from './scene/Machine'
import Post from './scene/Post'
import TempoMatrix from './scene/TempoMatrix'
import Hud from './ui/Hud'
import { DEBUG } from './scene/views'

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
  return (
    <div className="stage">
      <Leva hidden={!DEBUG} />
      {DEBUG && <CopyValues />}
      <Canvas
        shadows
        dpr={[1, 1.5]}
        gl={{
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 0.92,
          powerPreference: 'high-performance',
        }}
        camera={{ position: [0, 0, 46], fov: 26, near: 0.1, far: 200 }}
      >
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
  )
}
