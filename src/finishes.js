import { COARSE } from './scene/quality'

export const FINISHES = [
  {
    id: 'ivory',
    label: 'Aged Ivory',
    accent: '#d96a2b',
    background: {
      top: '#1b1711',
      bottom: '#020202',
      glow: '#9a5528',
      line: '#9a6845',
    },
    surface: {
      body: '#ece7da',
      plate: '#f1eadb',
      floor: '#ded9cc',
      bodyRough: 0.48,
      bodyMetal: 0.12,
      plateRough: 0.92,
      plateMetal: 0.15,
      floorRough: 0.73,
      wear: 1,
    },
    keys: {
      step: '#efe9dc',
      stepInk: 'rgba(30,26,22,0.86)',
      modifier: '#3a3a3d',
      modifierActive: '#5b595c',
      glyphInk: 'rgba(226,222,214,0.72)',
      play: '#d45b19',
      playGlyph: '#3b1607',
      clear: '#242427',
      stepRough: 0.95,
      modifierRough: 0.61,
      playRough: 1,
      metalness: 0.22,
      // lacquer over worn plastic: base stays rough (dust, grime, scratches)
      // while a glossy coat throws the softbox back as a wet sheen
      material: {
        clearcoat: 0.9,
        clearcoatRoughness: 0.14,
        envMapIntensity: 1.25,
      },
    },
    stickers: {
      foil: ['#55f6ff', '#7a7dff', '#ff6be1', '#ffcf66', '#77ffb1', '#79a7ff', '#f5a7ff'],
      ink: '#090712',
      paper: '#f8fbff',
      primary: '#84fff1',
      secondary: '#ff74dc',
      title: 'BEAT UNIT',
      subtitle: 'LIVE LOOP // 096',
      number: '96',
      badge: 'bolt',
      round: 'face',
    },
  },
  {
    id: 'cobalt',
    label: 'Cobalt',
    accent: '#52c8ff',
    background: {
      top: '#092b49',
      bottom: '#01070d',
      glow: '#168bd2',
      line: '#225a79',
    },
    surface: {
      body: '#102d4b',
      plate: '#2376a6',
      floor: '#aec5cf',
      bodyRough: 0.34,
      bodyMetal: 0.5,
      plateRough: 0.4,
      plateMetal: 0.46,
      floorRough: 0.56,
      wear: 0.22,
    },
    keys: {
      step: '#b9dce4',
      stepInk: 'rgba(4,38,58,0.9)',
      modifier: '#071e35',
      modifierActive: '#165c82',
      glyphInk: 'rgba(154,232,255,0.84)',
      glyphGlow: '#72bfd4',
      play: '#29bcea',
      playGlyph: '#04243a',
      clear: '#061522',
      stepRough: 0.34,
      modifierRough: 0.3,
      playRough: 0.28,
      metalness: 0.06,
      clean: true,
      material: {
        transmission: 0.68,
        thickness: 0.78,
        ior: 1.46,
        clearcoat: 0.92,
        clearcoatRoughness: 0.08,
        roughnessMap: null,
        normalMap: null,
        envMapIntensity: 1.55,
      },
    },
    stickers: {
      foil: ['#79fbff', '#408cff', '#b9f4ff', '#1ec8ff', '#e8feff', '#517cff', '#72e5ff'],
      ink: '#031522',
      paper: '#e9fdff',
      primary: '#55eaff',
      secondary: '#6691ff',
      title: 'COLD WAVE',
      subtitle: 'DEEP LOOP // 124',
      number: '24',
      badge: 'wave',
      round: 'orbit',
    },
  },
  {
    id: 'ember',
    label: 'Ember',
    accent: '#ff7a3d',
    background: {
      top: '#43150e',
      bottom: '#080202',
      glow: '#f04d22',
      line: '#7b2e1c',
    },
    surface: {
      body: '#261718',
      plate: '#b54a29',
      floor: '#442b25',
      bodyRough: 0.41,
      bodyMetal: 0.34,
      plateRough: 0.5,
      plateMetal: 0.3,
      floorRough: 0.68,
      wear: 0.58,
    },
    keys: {
      step: '#412e2e',
      stepInk: 'rgba(255,220,185,0.97)',
      modifier: '#6d2521',
      modifierActive: '#c05535',
      glyphInk: 'rgba(255,218,188,0.90)',
      play: '#f29a43',
      playGlyph: '#4a1309',
      clear: '#1d1416',
      stepRough: 0.54,
      modifierRough: 0.47,
      playRough: 0.4,
      metalness: 0.28,
    },
    stickers: {
      foil: ['#ffb13b', '#ff5a2c', '#ffd279', '#e6321f', '#ff8d38', '#ffe0a0', '#ef4627'],
      ink: '#260806',
      paper: '#fff0d5',
      primary: '#ffbd62',
      secondary: '#ff4d27',
      title: 'HEAT UNIT',
      subtitle: 'REDLINE // 808',
      number: '08',
      badge: 'flare',
      round: 'sun',
    },
  },
  {
    id: 'violet',
    label: 'Violet',
    accent: '#9b6dff',
    background: {
      top: '#241636',
      bottom: '#050308',
      glow: '#7a44d6',
      line: '#4a2d72',
    },
    surface: {
      body: '#171320',
      plate: '#392b56',
      floor: '#2a2338',
      bodyRough: 0.38,
      bodyMetal: 0.42,
      plateRough: 0.34,
      plateMetal: 0.38,
      floorRough: 0.5,
      wear: 0,
    },
    keys: {
      step: '#6f57cf',
      stepInk: 'rgba(238,232,255,0.9)',
      modifier: '#231e2e',
      modifierActive: '#4a3a86',
      glyphInk: 'rgba(213,199,255,0.85)',
      glyphGlow: '#a98cff',
      play: '#9271ff',
      playGlyph: '#1a1030',
      clear: '#181320',
      stepRough: 0.36,
      modifierRough: 0.32,
      playRough: 0.3,
      metalness: 0.08,
      clean: true,
      material: {
        clearcoat: 0.85,
        clearcoatRoughness: 0.12,
        roughnessMap: null,
        normalMap: null,
        envMapIntensity: 1.35,
      },
    },
    stickers: {
      foil: ['#b79bff', '#7f5cff', '#d9c8ff', '#5b3fd0', '#a184ff', '#efe7ff', '#6f4dff'],
      ink: '#120a22',
      paper: '#f3ecff',
      primary: '#b394ff',
      secondary: '#7a5cff',
      title: 'NIGHT UNIT',
      subtitle: 'VIOLET LOOP // 140',
      number: '40',
      badge: 'wave',
      round: 'orbit',
    },
  },
]

// Mobile: at phone size the wear story reads as noise — plate rust as dirt,
// cap grime/aging as splotches — so every finish ships its clean-showroom
// variant (the look violet already has; capMaterial also drops its wear
// roughness/normal maps on COARSE). Dropping cobalt's transmission kills the
// full extra scene render that one material forces every frame.
if (COARSE) {
  for (const f of FINISHES) {
    f.surface.wear = 0
    f.keys.clean = true
    if (f.keys.material) {
      delete f.keys.material.transmission
      delete f.keys.material.thickness
      delete f.keys.material.ior
    }
  }
}

export function getFinish(index) {
  return FINISHES[index] ?? FINISHES[0]
}
