# Beat Machine — build progress

Reference bar: `refs/ref-front.png` (straight-on) and `refs/ref-hero.png` (angled macro).
A worn industrial macropad floating in a black void — hard key light, cool rim,
shallow depth of field, aged cream keycaps with 0/1 legends, charcoal modifiers,
salmon rotary knob, glowing cyan LCD, antenna, coiled cable.

## How to look at the real thing

```bash
node scripts/shot.mjs front shots/front.png      # locked straight-on view
node scripts/shot.mjs hero  shots/hero.png       # locked angled hero view
node scripts/shot.mjs macro shots/macro.png      # close crop
node scripts/shot.mjs front shots/x.png --post=0 # no post, for diagnosing lighting
```
Dev server runs on **5199** (`npm run dev -- --port 5199 --strictPort`).
The script reuses it if it's already up, and exits non-zero on any page error.

## Architecture

| File | Owns |
|---|---|
| `src/audio/engine.js` | WebAudio drum voices + lookahead scheduler (no Tone.js) |
| `src/state/store.js` | 30-line subscribe store; `live` mirror for per-frame reads |
| `src/scene/layout.js` | All geometry constants — every part imports from here |
| `src/scene/Rig.jsx` | Pointer parallax + locked screenshot views |
| `src/scene/Lighting.jsx` `Post.jsx` | Mood, exposure, DOF/bloom |
| `src/scene/Chassis.jsx` | Body, faceplate, switch plate, hardware |
| `src/scene/keycapGeometry.js` `capMaterials.js` `Keycap.jsx` | Cap form, finish, press feel |
| `src/scene/Keys.jsx` | Key field wired to the sequencer |
| `src/scene/Knob.jsx` `Screen.jsx` `Props.jsx` | Knob, LCD, antenna/cable/decals |

`Screen.jsx` LCD notes: content plane is HDR (`meshBasicMaterial` color ~2.4x
white, `toneMapped={false}`) so lit dots overshoot 1.0 and bloom does the glow
— the base substrate gradient must stay near-black (`#02060a`-ish) and only
~25% of cells carry a faint `ambientMask` fleck, or the floor lights up as a
veil again. The glass plane must stay near-transparent (opacity ~0.07); at
its old 0.34 it was the single biggest black-lifter. The reflection-streak
plane must stay sized to exactly the glass opening with no extra rotation —
oversizing/rotating it is what previously painted a hard diagonal wedge past
the bezel onto the keycaps. BPM text starts at `TEX_W*0.15`, not `0.04`, to
stay clear of the smiley sticker Props.jsx anchors over the screen's left
edge.

## Interaction model

- 4×4 grid of cream caps = 16 steps of the selected track. Cap legend **is** the
  state: `1` programmed, `0` empty. Programmed caps sit latched lower. Drag a
  step vertically to set its velocity; the LCD ladder reflects the level and
  its bars can also be dragged directly.
- Top charcoal row = track select (kick / snare / hat / clap) + tempo nudge.
- Right column: tall dark cap = transport, tan cap = clear pattern.
- Salmon knob = drag for BPM. Keyboard: space, tab, `qwer/asdf/zxcv`.

## Status

### Done
- Audio engine, transport, sequencer state, keyboard control
- Reproducible screenshot harness + locked camera views
- v0 of every part; scene renders end to end

### Round 1 — complete (12 agents, 0 failures)
Six builder/critic pairs. Output: `shots/r1-front.png`, `shots/r1-hero.png`.
The render moved into the same family as the reference — worn cream caps printed
0/1, salmon C-knob, cyan LCD, serial label, green sticker, antenna, coiled cable.

Two real bugs found by measurement rather than by eye:
- `EffectComposer` sets `renderer.toneMapping = NoToneMapping` on mount, so with
  post enabled there was **no tone mapping at all** and `toneMappingExposure` was
  a dead prop. Fixed with an explicit `<ToneMapping>` in the chain.
- The keycap triangle winding was inverted — cap tops shaded as if facing away
  from the key light, which is why they rendered black under any rig.

### Round 1 critic scores (out of 10, judged against the reference)

| Part | Verdict | Biggest gap found |
|---|---|---|
| keycaps | close 6 | The chamfer rim — brightest feature on a real cap — reads as a soft dark nothing |
| screen | weak 5 | The LCD has no black: 15% of pixels below lum 60 vs the reference's 53% |
| lighting | weak 4.5 | Black plate gets no specular source; 44% of the object box is literal black vs 16% |
| knob | weak 4 | No interior depth — a flat washer where the reference is a deep flared cup |
| props | weak 4 | The coiled cable is photographically absent: zero pixels above L=60 |
| chassis | broken 2 | Black base colour at high metalness = no diffuse *and* sub-dielectric specular |

### Round 2 — STOPPED EARLY (token budget)
Stopped mid-run at the user's call. Current output: `shots/r2-stop.png`.
Build verified healthy after the stop — page renders, no console errors, eslint
clean except one unused import in `Props.jsx`.

Done by hand this round: front camera pulled in (the unit was filling 72% of frame
height vs the reference's ~85%), and real printing on the two tall right-column
caps, which were featureless black slabs.

| Agent | State at stop | Landed? |
|---|---|---|
| screen | **finished** | Yes — LCD now dark-substrate with HDR dots; BPM/track/transport/ladder all legible |
| chassis | **finished** | Yes — plate/body/rails now have real form and mottled wear; "black cutout" defect gone |
| chassis critic | **finished** | Yes — findings below |
| props | interrupted mid-iteration | Partial — cable is visible and re-routed, smiley moved off the LCD; was still chasing coil highlight brightness |
| knob | interrupted mid-iteration | Partial — lathe cup with real interior depth landed; was still tuning albedo (measured 59% of reference brightness) |
| keycaps | interrupted mid-write | **Yes** — verified landed and working; see below |
| screen critic | just started | No output |

### Findings banked from round 2

**Two real bugs the chassis critic caught by measurement** (neither fixed yet):
1. `Chassis.jsx` passes `map={plateWear}` where `plateWear` comes from `toTexture()`,
   which defaults to `NoColorSpace`. A diffuse `map` must be `SRGBColorSpace`. The
   0x80 canvas field therefore multiplies albedo by 0.502 linear instead of 0.216,
   so the rendered plate albedo is ~`#333` and the `color="#48484d"` in the source
   is a lie — and the map's contrast is compressed ~2x (1.67:1 instead of 3.0:1),
   which is exactly why the requested wear variation never showed up.
2. The faceplate shipped at **roughness 0.8** where the brief asked for 0.42.
   `Lighting.jsx` is built around a large warm Lightformer intended to lay a broad
   sheen across the plate; at 0.8 there is no specular lobe left to reflect it, so
   the plate is lit only by the key spot's lambert term. That is why brightness
   collapses with distance from the key and the right side stays black.

**Self-reported, unresolved:**
- Screen: on hero, above-180 is still well under the reference's 16.1% — the
  reference's LCD is a dense all-over starfield of midtone dots where ours is
  digits + bar chart over a much emptier field. A content-density choice, not a
  material bug.
- Chassis: plate variation is soft cloud-like blotches rather than the reference's
  finer scratch-grain streaks. Correct direction, wrong grain frequency.
- Props: coil highlights never reached the L>150 target.
- Knob: albedo too dark and saturated; reference is a pale dusty pink with a warm
  cream floor.

### Visible in `shots/r2-stop.png`, not yet assigned
- The white diagonal wedge is **reduced but not gone** — now contained inside the
  bezel, still slashing across the LCD face.
- The knob overshot: it reads as a pale ceramic cup/ashtray, lighter and larger
  than the reference's salmon C, and the C-notch no longer registers.
- LCD glyphs render white rather than cyan — the panel lost its colour identity
  while gaining its black point.
- Bottom keycap row falls off very dark compared to the reference.

### Cap chamfer — DONE (verified in `shots/k-macro.png`)
The round-2 keycap agent was stopped mid-write, but the change was complete; only
its final call-site pass was outstanding and that was already consistent. Verified
by macro screenshot: a hard bright ridge traces the top and left edge of every
cap with a razor crease at each end, and the caps weld into a mosaic instead of
floating in moats.

What makes it work, all in `keycapGeometry.js`:
- The chamfer is a **flat 2-ring facet, not an arc** — an arc rolls its normal
  through 90° and smears the highlight into a gradient; a facet holds one normal
  and blows out as a single hard stripe.
- It sits at ~34° off horizontal, not 45°. A true 45° chamfer measured *dimmer* —
  steeper than the key light buys silhouette drama at the cost of the highlight.
- Both ends are **duplicated rings emitted with `bridge:false`**, so
  `computeVertexNormals` never averages across them. That is the razor crease.
- The plan-view outline stays a near-square superellipse (p≈8 base, 7 rim) and the
  chamfer is an **offset curve, not a scale** — scaling makes the diagonal offset
  ~1.3x the offset at the edge midpoints, so the band would be a third wider and a
  third shallower at the corners than along the sides.
- The wall gets only ~30% of the taper budget (`taperK`): in top-down view the
  wall is the dark moat between caps, so every unit of wall inset is a unit of
  black seam. Pushing that inset into the chamfer trades moat for highlight.

`capMaterials.js` backs it up: the chamfer is burnished to bare plastic (lighter
albedo, never yellows, never holds grime) and stroked *dark* into the roughness
map — the rim is the smoothest part of a used cap, not the roughest.

### Next highest-priority gap
The two banked chassis bugs above (`NoColorSpace` diffuse map, faceplate roughness
0.8 vs 0.42) — together they are why the plate's right side still goes black.
