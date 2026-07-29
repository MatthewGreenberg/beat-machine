import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { useControls } from 'leva'

// Exposure + void colour — the two global look knobs that sit outside Lighting/Post.
export default function Look() {
  const { exposure, background } = useControls('Look', {
    exposure: { value: 0.92, min: 0.2, max: 2.5, step: 0.01 },
    background: '#050505',
  })
  const gl = useThree((s) => s.gl)
  useEffect(() => { gl.toneMappingExposure = exposure }, [gl, exposure])
  return <color attach="background" args={[background]} />
}
