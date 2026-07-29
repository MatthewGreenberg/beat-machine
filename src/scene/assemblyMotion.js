import * as THREE from 'three'

const params = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search)

export const INTRO_DISABLED =
  params.get('intro') === '0'
  || (
    typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )

const easeOutCubic = (t) => 1 - (1 - t) ** 3

// A restrained back-ease makes each part feel seated rather than merely
// translated. The tiny overshoot is transform-only and costs no extra draw calls.
const easeOutBack = (t) => {
  const c1 = 1.18
  const c3 = c1 + 1
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2
}

export function setAssemblyPose(
  object,
  progress,
  fromPosition,
  fromRotation,
  fromScale = 1,
  arc = [0, 0, 0],
) {
  if (!object) return

  const travel = 1 - easeOutCubic(progress)
  const curve = Math.sin(progress * Math.PI) * travel
  object.position.set(
    fromPosition[0] * travel + arc[0] * curve,
    fromPosition[1] * travel + arc[1] * curve,
    fromPosition[2] * travel + arc[2] * curve,
  )
  object.rotation.set(
    fromRotation[0] * travel,
    fromRotation[1] * travel,
    fromRotation[2] * travel,
  )

  const scaleProgress = easeOutBack(progress)
  const startScale = Array.isArray(fromScale)
    ? fromScale
    : [fromScale, fromScale, fromScale]
  object.scale.set(
    THREE.MathUtils.lerp(startScale[0], 1, scaleProgress),
    THREE.MathUtils.lerp(startScale[1], 1, scaleProgress),
    THREE.MathUtils.lerp(startScale[2], 1, scaleProgress),
  )
}

export function assemblyProgress(elapsed, delay, duration) {
  return THREE.MathUtils.clamp((elapsed - delay) / duration, 0, 1)
}
