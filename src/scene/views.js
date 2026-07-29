// Fixed camera/rig presets so screenshots are reproducible frame-for-frame.
// ?view=front|hero|macro locks the rig; without it the unit follows the pointer.
// `focus` is unused — Post.jsx derives its focal plane in world units from
// `camera`. Kept out of the objects entirely rather than left to rot.
export const VIEWS = {
  front: { rotY: 0, rotX: 0, camera: [0, 0, 38], fov: 26 },
  hero: { rotY: 0.46, rotX: -0.2, camera: [0, 0, 30], fov: 30 },
  macro: { rotY: 0.62, rotX: -0.26, camera: [-1.5, 2.5, 20], fov: 28 },
}

const params = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search)
export const VIEW = VIEWS[params.get('view')] ?? null
export const NO_POST = params.get('post') === '0'
export const AUTOPLAY = params.get('play') === '1'
export const DEBUG = params.has('debug')
