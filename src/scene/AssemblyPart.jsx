import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useRef } from 'react'
import {
  INTRO_DISABLED,
  assemblyProgress,
  setAssemblyPose,
} from './assemblyMotion'

export default function AssemblyPart({
  children,
  fromPosition = [0, 0, 4],
  fromRotation = [0, 0, 0],
  fromScale = 0.9,
  arc = [0, 0, 0],
  delay = 0,
  duration = 0.9,
}) {
  const group = useRef()
  const startedAt = useRef(null)
  const settled = useRef(INTRO_DISABLED)

  useLayoutEffect(() => {
    setAssemblyPose(
      group.current,
      INTRO_DISABLED ? 1 : 0,
      fromPosition,
      fromRotation,
      fromScale,
      arc,
    )
  }, [arc, fromPosition, fromRotation, fromScale])

  useFrame(({ clock }) => {
    if (settled.current || !group.current) return
    if (startedAt.current === null) startedAt.current = clock.elapsedTime

    const elapsed = clock.elapsedTime - startedAt.current
    const progress = assemblyProgress(elapsed, delay, duration)
    setAssemblyPose(
      group.current,
      progress,
      fromPosition,
      fromRotation,
      fromScale,
      arc,
    )

    if (progress === 1) settled.current = true
  })

  return <group ref={group}>{children}</group>
}
