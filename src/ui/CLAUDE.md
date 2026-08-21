# src/ui

DOM overlays that sit on top of the R3F canvas (siblings of `<Canvas>` in
App.jsx). Hud.jsx owns global keyboard shortcuts and mounts FxPanel.
Hold Shift = momentary beat repeat (`actions.setRepeat`), active in both modes.

## Tutorial.jsx — first-visit walkthrough

- Gated on `localStorage.bm_tutorial_seen`; `?tutorial` forces a replay,
  `?view` / `?debug` / `?play` skip it (screenshot harness / demo params).
- Waits 2.1s for the assembly intro (INTRO_DURATION 1.75s in
  TempoMatrix.jsx) before showing.
- Steps advance by diffing store state against a baseline snapshot taken at
  step entry (`done(state, baseline)`) — store.js stays untouched.
- The spotlight is a DOM div (`.tut-hole`) whose giant box-shadow is the dim
  layer. Because every target is a 3D mesh moving under the pointer-parallax
  rig, `scene/TutorialAnchor.jsx` (mounted inside `<Rig>`) projects the
  target's machine-local rect (layout.js coords) through the rig's
  matrixWorld + camera every frame and positions the hole imperatively via
  the shared `tutorialLive` object (tutorial-live.js) — same live-mirror
  idiom as store.js.
  DOM targets (the FX orb) pass `{ dom: '.fx-toggle' }` and are measured
  with getBoundingClientRect instead.
- The overlay is `pointer-events: none` (only the card accepts clicks), so
  the spotlit control stays directly interactive on desktop and touch.
