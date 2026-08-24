# src/scene

## Canvas blur — never set ctx.filter directly

Safari has never shipped `CanvasRenderingContext2D.filter` (WebKit bug
198416): `g.filter = 'blur(…)'` silently no-ops and every soft grime/wear
blotch bakes as a hard-edged ellipse — that exact bug shipped once. All
blurred drawing goes through `withBlur(g, radius, draw)` from textures.js:
native filter where it works, a temp layer + downscale/upscale pyramid
where it doesn't (drawImage-only — a JS pixel-loop blur here cost ~2s of
Safari startup). The callback must set its own styles; the layer composites
back through g's current globalAlpha/composite op. Repro Safari rendering
with `node scripts/shot.mjs front out.png --browser=webkit`.

## Mobile / touch

`quality.js` exports the two shared touch signals: `COARSE` (`(pointer:
coarse)` media query, the only mobile detection in the app) and `TAP_PX`
(tap-vs-drag threshold, 9px on touch vs 3px mouse — used by Keycap, Knob,
Screen). Rig.jsx has a fit-to-width effect: when no `?view=` lock is
active it dollies the camera back so `BODY_W/2 + 0.8` fits the horizontal
fov (clamped at the desktop z=46, so wide aspects are pixel-identical).
The 0.8 margin also covers the FX editor pose (+2.2 group dolly, −2° fov
punch) at iPhone aspect — don't shrink it below ~0.65. On COARSE the
pointer parallax is replaced by a fixed pose — straight-on, zero yaw,
leaned back ~8° (touch has no hover pointer; tracking it lurches to the
last tap and sticks) — and
`makeReadoutCanvas` in FxScreen halves to 640×960 (the per-drag-frame
texture re-upload stutters mobile GPUs; all px in the file scale by
`k = canvas.width / 1024` so this is safe). `onPointerOver` handlers with
visual state early-return on `pointerType === 'touch'` — pointerout never
reliably follows on touch, so hover states stick. `.stage canvas` gets
`touch-action: none` in index.css (r3f does not set it); without it every
keycap/fader drag scrolls the page.

Mobile look/perf: on COARSE every finish is forced to its clean-showroom
variant (finishes.js: `surface.wear = 0`, `keys.clean = true`, and cobalt's
transmission/thickness/ior deleted — that material forced a full extra
scene render per frame). `capMaterial` skips its wear roughness/normal maps
on COARSE (they read as splotches at phone size, and skipping them skips
the per-pixel normal bake at startup), and Post.jsx doesn't mount N8AO on
COARSE at all — it was the most expensive standing pass and near-invisible
on a phone. Wear/rust rendering is otherwise untouched on desktop. `qualityNameForFactor` never returns 'high' on COARSE (MSAA 4 +
dpr 1.5 melts tile GPUs even when PerformanceMonitor earns it), and
`toTexture` caps anisotropy at 4 on COARSE.

## FxScreen.jsx rendering contract

The FX panel is a hybrid of three layers, back to front:

1. **Lit face** — the backing RoundedBox (MeshPhysicalMaterial, uniform
   smooth roughness — a mottled roughness map read as fabric under the
   raking key light). This IS the panel surface: the key-light gradient
   and Lightformer reflections land here, the clearcoat is the cover
   glass, and the backlight emissive + printed scanlines are the screen
   cues. The shader plane above it is *morph-only* (wobble + transfer
   line) and fades out via `uHide` as the UI reveals.
2. **Real geometry** — card slabs, fader caps, fill bars, finish buttons.
   Cards are RoundedBox slabs (not printed) so their edges catch light and
   N8AO grounds them.
3. **Unlit print plane** — the 2D canvas carries only silk-screen content
   (labels, ticks, insets, LEDs) via `drawInset` / `engravedLine` /
   `drawLed`. It must stay meshBasicMaterial with a transparent canvas:
   near-black ink (~0.086 albedo) on a *lit* material under ~3 irradiance
   would render ~3× lighter — grey pencil. Light the surface, not the ink.

Rules that bite if you don't know them:

- three's raycaster ignores `visible`, so every handler mesh in the panel
  would catch clicks even with the editor closed. Two layers of defence:
  the root useFrame swaps `raycast` off on the whole subtree while
  `mix <= 0.9` (delete restores the prototype method — so no mesh in
  FxScreen may set its own `raycast` prop without updating that traverse),
  AND every state-mutating onPointerDown guards on
  `live.fxMorph <= 0.9` before stopPropagation, so a closed-panel click
  passes through to the machine instead of firing an invisible control.

- Every visible FX mesh material needs `transparent`, `opacity={0}`, and
  `userData={{ fxVisual: true }}` — the useFrame cascade drives opacity
  during the reveal. A material that must stay partially transparent at
  full reveal (e.g. the cap contact shadow) must bake its max alpha into
  its texture, because the cascade lerps opacity to 1.
- The readout plane renders at renderOrder 4 (+10 from the mount-time
  traverse). Meshes that must blend *over* the print (contact shadows)
  need a higher renderOrder and `depthWrite={false}`; solid meshes occlude
  the print through the depth buffer instead.
- Print ink must be full-alpha near-black — the post ToneMapping pass
  compresses contrast, so translucent grey ink reads as pencil on paper.
- Rig.jsx keeps 25% pointer parallax at full fxMorph and dollies only to
  ~2.2 (softer fov punch) so a dark border frames the panel and reflections
  keep moving — a dead-on full-frame pose reads as a flat 2D mockup.
- All canvas absolute px values scale by `k = canvas.width / 1024`; world
  coords go through `x()`/`y()`. Canvas is 1280×1920 (matches EDITOR
  aspect exactly). Don't grow it much — it re-uploads every drag frame.
- The readout texture runs mipmap-free (`generateMipmaps false`, Linear
  minFilter): the print is only visible near full size, mip sampling blurs
  the text, and skipping regeneration cheapens the per-drag re-upload.
  Don't re-enable mipmaps.
- Fader travel geometry (TRACK_Y0/Y1) is shared by the canvas slot, the 3D
  cap, the hit plane, and the audio value mapping. Change it in one place.
- Fader drag reads pointer clientY deltas, NOT `event.uv`. Pointer-down uses
  uv once (jump-to-click) and calibrates px-per-value by projecting the hit
  plane through the camera. Under pointer capture r3f replays the stale
  capture-time intersection once the cursor leaves the plane, so uv-driven
  drags snapped back to the start value past 0% and 100%.
- The skin row shares `FINISH_POS` = the fader column x's — footer and
  faders are one grid. Each key wears its finish's `keys.step` colour +
  finish (NOT `surface.body` — three of those render as flat black chips;
  and never spread `keys.material` transmission overrides onto them — one
  transmissive material forces the transmission pass every frame), with
  printed LED above and name below. No printed well around the keys: the
  rig's pointer parallax shifts the 3D keys against any printed opening,
  so registration-tight print under raised geometry always reads as
  misaligned — ground raised meshes with their contact shadow instead.
  Active state is
  the lit LED + full-ink name + pressed key (canvas redraws on `finish`
  change), not glowing caps.
- Each effect has selectable modes (engine `FX_MODE_OPTIONS`): the printed
  pill under a card's title is a button — an invisible `ModeButton` plane
  covering BOTH the pill and the scope window beneath it (the squiggle is
  the obvious target, so it cycles too; its bottom edge stops at y 2.86,
  clear of the fader hit plane's top at 2.70) —
  cycles `actions.cycleFxMode`, the canvas redraws pill + icon from
  `fxMode`, and the engine swaps filter type / drive curve / delay division
  / reverb IR. Keep UI labels (`SUBTITLES`, `filterFreq`) in lockstep with
  the engine's mappings.
- Selected-track legibility comes from `keys.modifierActive` making a real
  jump off `keys.modifier` — ember set the bar (dark red -> bright orange,
  ~+20 lightness at high saturation) and the other three now match it,
  pulling the active cap toward each skin's accent hue. Grey-on-grey or a
  jump inside the shadows (cobalt's old L12 -> L30) reads as nothing.
  `keys.glyphInkWear` optionally dials back `drawLegend`'s speckle for
  glyph caps only; ivory needs it (no `glyphGlow` layer, `wear: 1`).
  On cobalt and violet the tint alone can't do it — cobalt's caps are
  transmissive so `modifierActive` washes out through the glass, and both
  skins' modifiers sit too dark for a lightness jump to register. There the
  `GlowGlyph` opacity split carries the state (0.3 rest -> 1 active); the
  printed `glyphInk` keeps unselected caps readable on its own, so the glow
  is free to go near-dark.
- Track keycap glyphs (`trackGlyphs` in `Keys.jsx`) are drawn paths, not
  font characters: kick = drum head + beater spot, snare = the same head
  strung with wires, hat = two chevron cymbals on a stand, clap = an
  8-ray burst, swing = two waves. Font glyphs at 300 weight baked too
  faint to read on the cap — stroke them. `GLYPH_SCALE` (0.6) sizes the
  whole family, stroke weight included. `GlowGlyph` (the emissive layer the
  glass/plasma skins add via `keys.glyphGlow`) is the SAME draw call baked
  white onto a transparent canvas and hung on a `CAP`-sized plane, tinted
  by the material. It used to be hand-built geometry in its own units,
  which drifted off the print every time a glyph changed — cap UVs map the
  full canvas across `CAP` local units, so plane + shared draw = exact
  registration for free. Never reintroduce a second copy of the shapes.
- `drawIcon` draws a distinct trace per mode for ALL four effects, not
  just filter: drive SOFT is a pure tanh sigmoid vs HARD's angular ramp
  vs FOLD's sine; delay tap COUNT/SPACING encodes the sync division
  (1/16 = 8 tight taps … 1/4 = 3 wide); space is PLATE (instant attack,
  exp fall) / HALL (slow swell, long tail) / SPRING (decaying wobble).
  If a mode is added to `FX_MODE_OPTIONS`, give it a shape here too.
- Beat repeat sits in the panel header (`REPEAT_KEY` / `REPEAT_DIV`
  constants): 80s-badge FX wordmark (upright bold, speed-line stripes
  cut via destination-out, ghost offset, light speckle wear),
  printed REPEAT label, a physical square `HeaderKey` (3D, skin
  key recipe; the cap wears the accent even at rest, and sinks + lights up
  from within while engaged (steady — a slice-rate pulse was tried and cut),
  `actions.toggleRepeat`), a printed status LED left of the label (lit while
  engaged; `repeat` is a `drawReadout` param + redraw dep) and a
  printed slice-length pill (`fxMode.repeat`, 1/4…1/32) cycled by a
  `ModeButton` plane with an explicit rect.
  `drawKey` is the shared raised-key painter for all pills. It's an SP-404
  style looper on the SEQUENCER, not audio: `createTransport`'s `getRepeat`
  returns a length in steps (`REPEAT_STEPS`) and the playhead is held inside
  the grid-aligned section it was in when engaged (1/32 = half a step, the
  current step retriggered at double rate; 1/16 and 1/32 latch onto the
  last step that actually fired, so a roll never grabs silence). A ghost clock keeps counting
  under the loop so release snaps back in phase with the bar; 1/16 and 1/32
  fade per repeat (`REPEAT_DECAY`/`REPEAT_FLOOR`). Hold Shift anywhere for a
  momentary repeat (Hud.jsx).
- Tape stop (`TAPE_KEY`: a momentary `TapeKey` centred on its own row below
  the skin keys — a strip of blue painter's tape, not a machined key:
  `tapeStrip` bakes a mottled crepe-paper base, crosswise ridges, creases,
  ragged torn ends, a peeled-up top-right corner (corner bitten out via
  destination-out, flap mirrored across the fold and laid back over the
  face adhesive-side-up), sharpie 'TAPE STOP' lettering, translucency AND drop
  shadow into a colour map + matching bump canvas (reveal cascade lerps
  opacity to 1, so alpha lives in the pixels). The plane is a lit matte
  MeshPhysicalMaterial — the one exception to the unlit-print rule — so the
  key light rakes the bump crepe; held, it drags like the tape it's
  stopping — a subtle sag, skew and stretch with a faint sinusoidal
  reel-judder flutter — instead of sinking/lighting. `onRelease` + pointer capture, driving
  `actions.setTape`): engine `buildTape`/`setTape` is a
  resonant low-pass + varispeed delay line on the whole beat bus. Press: a
  `delayTime` curve over `TAPE_T` with exponential speed decay (`TAPE_K`) is
  the tape grinding to a halt (pitch = 1 − slope) at boosted level (`TAPE_BOOST`) while the filter closes
  (the wah, `TAPE_Q`), then gain fades after the halt; a
  brake-only HALL send (`TAPE_VERB`) feeds the delay line from in FRONT so
  its tail is what gets pitched down (drum hits are too short to glide).
  The panel FILTER flips to allpass for the brake so it can't starve the sweep.
  Release snaps straight back to real time, in phase — the transport never
  slowed.
  Step lights keep real time during the stop.

## Post-processing vs the FX panel

The screen Vignette (Post.jsx) paints a huge grey ellipse across the bright
near-full-frame FX panel — that exact bug shipped once. N8AO did the same
in scene space: full-strength AO inked dark halos around the fader caps,
reading as toon outlines. Post.jsx now fades vignette darkness and lerps AO
intensity *and radius* down with `live.fxMorph` (tight contact AO stays to
ground the slabs/caps); if you add a new full-frame bright surface, check
it against every post effect. Bloom risk: the lit face's albedo × key-light
irradiance sits near the 1.85 bloom threshold — keep the face color at or
below `#e3ded2` or the panel top blooms into a wash.
Accent glow is a drawn additive halo sprite (`fx-fill-glow` behind the
fill bar), NOT threshold bloom. Threshold bloom cannot work for the
saturated accents: their linear luminance is ~0.34, so reaching the 1.85
threshold takes emissiveIntensity ≈ 5.5 — and ACES has desaturated the
color to pastel long before that. That exact bug shipped once (washed
cream bars, no halo). Keep accent emissive moderate (~1.6–1.8 rest) so
the core stays saturated; tune the halo via the leva `glowStrength`. The
printed canvas accents (graph curves, LEDs) are LDR on meshBasicMaterial
and can never post-bloom — their glow is painted instead: `drawIcon` runs
twice (a wide dim `'glow'` pass under the crisp trace), clipped to the
scope-window rect so the halo stays behind the glass.
Debugging aid: `?view=front&debug` exposes `window.actions` so a scripted
browser can `actions.toggleFx()` and screenshot deterministically, and
`?post=0` bisects the composer wholesale.
