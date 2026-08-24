import { createContext, useContext } from 'react'

// The one mobile signal everything reuses. Coarse pointer ≈ touch device.
export const COARSE = typeof window !== 'undefined'
  && window.matchMedia?.('(pointer: coarse)').matches

// Tap-vs-drag discrimination distance: finger jitter blows through 3px, so
// touch taps were registering as drags and onPress never fired.
export const TAP_PX = COARSE ? 9 : 3

export const QUALITY_PRESETS = {
  high: {
    name: 'high',
    dpr: 1.5,
    multisampling: 4,
    antialias: 'msaa',
    aoSamples: 16,
    denoiseSamples: 4,
    dofHeight: 720,
    bloom: 'mipmap',
  },
  balanced: {
    name: 'balanced',
    dpr: 1.25,
    multisampling: 0,
    antialias: 'fxaa',
    aoSamples: 8,
    denoiseSamples: 2,
    dofHeight: 540,
    bloom: 'mipmap',
  },
  performance: {
    name: 'performance',
    dpr: 1,
    multisampling: 0,
    antialias: 'fxaa',
    aoSamples: 6,
    denoiseSamples: 2,
    dofHeight: 360,
    bloom: 'compact',
  },
}

export const QUALITY_NAMES = Object.keys(QUALITY_PRESETS)

export function qualityNameForFactor(factor) {
  // ponytail: phones never earn 'high' — MSAA 4 + dpr 1.5 melts tile GPUs
  if (factor >= 0.74) return COARSE ? 'balanced' : 'high'
  if (factor >= 0.34) return 'balanced'
  return 'performance'
}

export function requestedQuality() {
  if (typeof window === 'undefined') return null
  const value = new URLSearchParams(window.location.search).get('quality')
  return QUALITY_NAMES.includes(value) ? value : null
}

export function qualityConfig(name, factor = null) {
  const preset = QUALITY_PRESETS[name] ?? QUALITY_PRESETS.balanced
  if (factor == null) return preset

  return {
    ...preset,
    dpr: Math.min(preset.dpr, 0.9 + Math.max(0, Math.min(1, factor)) * 0.6),
  }
}

const QualityContext = createContext(QUALITY_PRESETS.high)

export const QualityProvider = QualityContext.Provider

export function useQuality() {
  return useContext(QualityContext)
}
