// Shared between Tutorial.jsx (DOM overlay) and scene/TutorialAnchor.jsx
// (in-canvas projector): the anchor projects `target` to screen px every
// frame and moves the `hole` element imperatively — same live-object idiom
// as store.js's `live`.
export const tutorialLive = { hole: null, target: null }
