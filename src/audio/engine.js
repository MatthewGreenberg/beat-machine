// WebAudio drum synths + lookahead scheduler.
// ponytail: no Tone.js — 4 synth voices and a lookahead loop are ~150 lines of native WebAudio.

import { COARSE } from '../scene/quality'

let ctx = null
let master = null
let sfxBus = null
let comp = null
let fx = null
let tape = null

// ---- Master FX bus ---------------------------------------------------------
// comp -> drive -> filter -> [dry | tempo-synced delay | reverb] -> master

// Selectable character per effect; the panel cycles these via setFxMode.
export const FX_MODE_OPTIONS = {
  filter: ['LP', 'HP', 'BP'],
  drive: ['SOFT', 'HARD', 'FOLD'],
  delay: ['1/16', '1/8', '1/4'],
  space: ['PLATE', 'HALL', 'SPRING'],
  repeat: ['1/4', '1/8', '1/16', '1/32'],
}
const DELAY_DIV = { '1/16': 0.25, '1/8': 0.5, '1/4': 1 }
// Beat-repeat loop lengths in sequencer steps (SP-404 looper style).
// 1/32 is half a step: the current step retriggers at double rate.
export const REPEAT_STEPS = { '1/4': 4, '1/8': 2, '1/16': 1, '1/32': 0.5 }
const FILTER_TYPE = { LP: 'lowpass', HP: 'highpass', BP: 'bandpass' }
const modes = { filter: 'LP', drive: 'SOFT', delay: '1/8', space: 'PLATE', repeat: '1/4' }
// Last-applied panel values, so a mode change can re-apply its mapping.
const last = { filter: 1, drive: 0, delay: 0, space: 0, bpm: 120 }

const curveCache = {}
function driveCurve(mode = 'SOFT') {
  if (curveCache[mode]) return curveCache[mode]
  const n = 1024
  const curve = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    curve[i] = mode === 'HARD' ? Math.max(-0.8, Math.min(0.8, x * 2.4))
      : mode === 'FOLD' ? Math.sin(x * Math.PI * 1.4)
      : Math.tanh(x * 2.2)
  }
  curveCache[mode] = curve
  return curve
}

// ponytail: generated noise impulses instead of shipping IR files.
const IR_PARAMS = { PLATE: [1.9, 3.4], HALL: [3.2, 2.2], SPRING: [0.9, 5.5] }
const irCache = {}
function impulseFor(c, mode) {
  if (!irCache[mode]) irCache[mode] = impulse(c, ...IR_PARAMS[mode])
  return irCache[mode]
}

function impulse(c, seconds = 1.9, decay = 3.4) {
  const len = Math.floor(c.sampleRate * seconds)
  const buf = c.createBuffer(2, len, c.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay)
    }
  }
  return buf
}

function buildFx(c, from, to) {
  const pre = c.createGain()
  const shaper = c.createWaveShaper()
  shaper.curve = driveCurve()
  shaper.oversample = '2x'
  const post = c.createGain()

  const filter = c.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 18000
  filter.Q.value = 0.9

  const delay = c.createDelay(1.5)
  delay.delayTime.value = 0.25
  const feedback = c.createGain()
  feedback.gain.value = 0.34
  const damp = c.createBiquadFilter()
  damp.type = 'lowpass'
  damp.frequency.value = 2600
  const delaySend = c.createGain()
  delaySend.gain.value = 0

  const reverb = c.createConvolver()
  reverb.buffer = impulseFor(c, modes.space)
  const revSend = c.createGain()
  revSend.gain.value = 0
  const dry = c.createGain() // ducked as the space send rises (wet/dry)

  from.connect(pre)
  pre.connect(shaper)
  shaper.connect(post)
  post.connect(filter)
  filter.connect(dry).connect(to)                      // dry
  filter.connect(delaySend).connect(delay).connect(to)
  delay.connect(damp).connect(feedback).connect(delay) // damped feedback loop
  filter.connect(revSend).connect(reverb).connect(to)

  return { pre, post, shaper, filter, delaySend, revSend, dry, delay, reverb }
}

// ---- Tape stop --------------------------------------------------------------
// A varispeed delay line on the whole beat bus. Output time = input time +
// delayTime, so ramping delayTime with a quadratic curve IS a tape grinding to
// a halt (pitch ratio = 1 - slope, 1 -> 0). Every voice, sample or synth, slows
// identically. A resonant low-pass closes with it — the wahhh. Release snaps
// straight back to real time, in phase with the bar (the sequencer never
// slowed).
const TAPE_T = 0.85         // seconds to a dead stop
const TAPE_HOLD = 1.6       // stopped tape keeps "rolling" this long before the buffer runs dry
const TAPE_Q = 7            // filter resonance: the wah
const TAPE_VERB = 1.3       // brake-only reverb send — the stop always gets its wash
const TAPE_BOOST = 1.35     // level through the brake; the closing filter eats energy
const TAPE_K = 6            // speed decay rate; pitch hits 1/e at TAPE_T / TAPE_K
function buildTape(c, from, to) {
  const filter = c.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 20000
  filter.Q.value = TAPE_Q
  const delay = c.createDelay(TAPE_T + TAPE_HOLD + 0.1)
  const gain = c.createGain()
  from.connect(filter).connect(delay).connect(gain).connect(to)
  // own reverb, fed BEFORE the varispeed: drum hits are too short to carry
  // a pitch glide, the hall tail isn't — it's the sustained thing that sweeps.
  const verb = c.createConvolver()
  verb.buffer = impulseFor(c, 'HALL')
  const send = c.createGain()
  send.gain.value = 0
  filter.connect(send).connect(verb).connect(delay)
  // exponential speed decay: pitch = e^(-k t), so it falls octaves in the
  // first tenth and tails into the floor — the wheeooo. delay = ∫(1 - pitch).
  const n = 128
  const k = TAPE_K / TAPE_T
  const brake = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * TAPE_T
    brake[i] = t - (1 - Math.exp(-k * t)) / k
  }
  return { filter, delay, gain, send, brake, on: false }
}

export function setTape(on) {
  const c = resume()
  if (on === tape.on) return
  tape.on = on
  const t = c.currentTime
  const d = tape.delay.delayTime
  const g = tape.gain.gain
  const f = tape.filter.frequency
  const r = tape.send.gain
  const cur = d.value
  d.cancelScheduledValues(t)
  g.cancelScheduledValues(t)
  f.cancelScheduledValues(t)
  r.cancelScheduledValues(t)
  // The panel FILTER sits upstream; a closed LP or a high HP would starve
  // the sweep, so it steps aside (allpass) for the brake and comes back after.
  fx.filter.type = on ? 'allpass' : FILTER_TYPE[modes.filter]
  if (on) {
    d.setValueAtTime(cur, t)
    d.setValueCurveAtTime(tape.brake.map((v) => v + cur), t, TAPE_T)
    // keep the slope at 1 (pitch 0) while stopped, then the buffer runs out
    d.linearRampToValueAtTime(cur + tape.brake[tape.brake.length - 1] + TAPE_HOLD, t + TAPE_T + TAPE_HOLD)
    f.setValueAtTime(Math.max(f.value, 200), t)
    f.exponentialRampToValueAtTime(70, t + TAPE_T)
    // stay loud through the whole brake — the drama is the grind, not a fade
    g.setValueAtTime(g.value, t)
    g.linearRampToValueAtTime(TAPE_BOOST, t + 0.08)
    g.setTargetAtTime(0, t + TAPE_T, 0.12)
    r.setValueAtTime(r.value, t)
    r.linearRampToValueAtTime(TAPE_VERB, t + 0.05) // open fast so there's a tail to drag down
  } else {
    // close the send; the hall tail rings out on its own
    r.setValueAtTime(r.value, t)
    r.linearRampToValueAtTime(0, t + 0.03)
    // short dip covers the jump back to real time
    g.setValueAtTime(g.value, t)
    g.linearRampToValueAtTime(0, t + 0.015)
    d.setValueAtTime(0, t + 0.015)
    f.setValueAtTime(20000, t + 0.015)
    g.linearRampToValueAtTime(1, t + 0.04)
  }
}

// iOS suspends the context after a call/Siri/backgrounding and never resumes
// it on its own. Only ever resumes an existing context — never creates one
// before a user gesture.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && ctx && ctx.state !== 'running') ctx.resume()
  })
  // Keys act on pointerdown, but WebKit only counts touchend/click as the
  // gesture that unlocks audio — without this the first tap arms the transport
  // against a still-suspended clock and nothing is heard until the next tap.
  // Capture phase so no handler in between can ever get in the way.
  const unlock = () => { if (ctx && ctx.state !== 'running') ctx.resume() }
  const opts = { capture: true, passive: true }
  document.addEventListener('touchend', unlock, opts)
  document.addEventListener('pointerup', unlock, opts)
}

export function getContext() {
  if (!ctx) {
    // iOS: WebAudio defaults to the "ambient" session, which the ringer/silent
    // switch mutes. "playback" opts into media-app behaviour (audible on
    // silent, like YouTube). Touch devices only: desktop Safari also exposes
    // audioSession, has no silent switch to work around, and re-typing the
    // session there risks muting the context instead.
    if (COARSE) {
      try { navigator.audioSession.type = 'playback' } catch { /* unsupported */ }
    }
    ctx = new (window.AudioContext || window.webkitAudioContext)()
    comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -12
    comp.ratio.value = 4
    comp.attack.value = 0.003
    comp.release.value = 0.15
    master = ctx.createGain()
    master.gain.value = 0.5
    // Beat sits 30% under the mech sfx, which ride their own bus into master.
    const beatBus = ctx.createGain()
    beatBus.gain.value = 0.7
    tape = buildTape(ctx, beatBus, master)
    sfxBus = ctx.createGain()
    sfxBus.gain.value = 1.35
    sfxBus.connect(master)
    fx = buildFx(ctx, comp, beatBus)
    master.connect(ctx.destination)
  }
  return ctx
}

// Frequency mapping per filter mode. HP/BP sweep upward with the fader so
// "more fader" always means "more effect".
export function filterFrequency(v, mode = modes.filter) {
  return mode === 'HP' ? 20 * Math.pow(400, v)
    : mode === 'BP' ? 200 * Math.pow(40, v)
    : 180 * Math.pow(100, v)
}

// Panel controls, all normalised 0..1.
export function setFx(name, v) {
  const c = getContext()
  const t = c.currentTime
  const ramp = 0.03
  last[name] = v
  if (name === 'filter') fx.filter.frequency.setTargetAtTime(filterFrequency(v), t, ramp)
  else if (name === 'drive') {
    fx.pre.gain.setTargetAtTime(1 + v * 7, t, ramp)
    fx.post.gain.setTargetAtTime(1 / (1 + v * 2.6), t, ramp)
  } else if (name === 'delay') fx.delaySend.gain.setTargetAtTime(v * 0.55, t, ramp)
  else if (name === 'space') {
    // Curved send + dry duck: low fader is a subtle sheen, high fader
    // washes the kit out into the room instead of plateauing.
    fx.revSend.gain.setTargetAtTime(Math.pow(v, 1.6) * 1.5, t, ramp)
    fx.dry.gain.setTargetAtTime(1 - v * 0.55, t, ramp)
  }
}

export function setFxMode(name, mode) {
  modes[name] = mode
  if (name === 'repeat') return // sequencer-side, see createTransport
  const c = getContext()
  if (name === 'filter') {
    fx.filter.type = FILTER_TYPE[mode]
    fx.filter.Q.value = mode === 'BP' ? 1.6 : 0.9
    setFx('filter', last.filter)
  } else if (name === 'drive') fx.shaper.curve = driveCurve(mode)
  else if (name === 'delay') syncDelay(last.bpm)
  else if (name === 'space') fx.reverb.buffer = impulseFor(c, mode)
}

// A small relay click for the mode selector pills on the FX panel.
export function modeTick() {
  const c = resume()
  mechClick(c, c.currentTime, 0.05, 2000)
}

// Keep the delay on the selected sync division so it never smears against
// the pattern.
export function syncDelay(bpm) {
  const c = getContext()
  last.bpm = bpm
  fx.delay.delayTime.setTargetAtTime(
    Math.min(1.4, (60 / bpm) * DELAY_DIV[modes.delay]),
    c.currentTime,
    0.05,
  )
}

export function setMasterVolume(v) {
  const c = getContext()
  // short ramp instead of a snap so dragging the dial doesn't zipper
  master.gain.setTargetAtTime(v, c.currentTime, 0.02)
}

export function resume() {
  const c = getContext()
  if (c.state !== 'running') {
    c.resume()
    // iOS: resume() is async and a note scheduled in the future does not count
    // as a user-gesture unlock. A source has to start in this call stack — that
    // is why the skin whoosh is audible on the first tap and play is not.
    const src = c.createBufferSource()
    src.buffer = c._silent ?? (c._silent = c.createBuffer(1, 1, c.sampleRate))
    src.connect(c.destination)
    src.start()
  }
  return c
}

// iOS: the context can stay 'suspended' for a beat after the unlocking tap, so
// currentTime is frozen and anything scheduled against it never fires. Callers
// that need a live clock wait here instead of reading a stale currentTime.
export function whenRunning(cb) {
  const c = resume()
  if (c.state === 'running') return cb(c)
  let fired = false
  const run = () => {
    if (fired || c.state !== 'running') return
    fired = true
    c.removeEventListener('statechange', run)
    cb(c)
  }
  c.addEventListener('statechange', run)
  c.resume().then(run, () => {})
}

// Mechanical foley for the FX-panel transformation. Everything rides the
// sfx bus straight into master — the panel's own sound must never be
// coloured by whatever FILTER/DRIVE settings the panel is about to edit.

// Short filtered-noise tick: a relay/latch.
function mechClick(c, t, gain = 0.045, freq = 2600) {
  const n = c.createBufferSource()
  n.buffer = noiseBuffer(c)
  const f = c.createBiquadFilter()
  f.type = 'bandpass'
  f.frequency.value = freq
  f.Q.value = 2.2
  const g = c.createGain()
  g.gain.setValueAtTime(gain, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045)
  n.connect(f).connect(g).connect(sfxBus)
  n.start(t)
  n.stop(t + 0.06)
}

// Narrow-band noise with a fast gain flutter — mechanism friction/whirr,
// no tonal oscillator anywhere. f0→f1 sweeps the band like motor pitch.
function mechWhirr(c, t, dur, f0, f1, gain = 0.04) {
  gain *= 2 // narrow-band noise carries far less energy than the old saw
  const n = c.createBufferSource()
  n.buffer = noiseBuffer(c)
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.Q.value = 3.5
  bp.frequency.setValueAtTime(f0 * 6, t)
  bp.frequency.linearRampToValueAtTime(f1 * 6, t + dur)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(gain, t + 0.04)
  g.gain.setValueAtTime(gain, t + Math.max(0.05, dur - 0.05))
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  const trem = c.createOscillator()
  trem.frequency.value = 27
  const tremGain = c.createGain()
  tremGain.gain.value = gain * 0.45
  trem.connect(tremGain).connect(g.gain)
  n.connect(bp).connect(g).connect(sfxBus)
  n.start(t)
  n.stop(t + dur + 0.02)
  trem.start(t)
  trem.stop(t + dur + 0.02)
}

// Timings mirror the eased 1.25s open / 0.7s close morph in Machine.jsx:
// dial servo, five row ratchets, horizontal stroke, vertical stroke, latch.
export function uiWhoosh(open) {
  const c = getContext()
  const t = c.currentTime
  if (open) {
    mechWhirr(c, t + 0.02, 0.22, 130, 68, 0.03)
    ;[0.44, 0.5, 0.56, 0.63, 0.69].forEach((d, i) =>
      mechClick(c, t + d, 0.04, 2200 + i * 180))
    mechWhirr(c, t + 0.62, 0.17, 92, 126, 0.042)
    mechClick(c, t + 0.8, 0.05, 1700)
    mechWhirr(c, t + 0.8, 0.19, 78, 112, 0.045)
    mechClick(c, t + 1.0, 0.06, 1400)
  } else {
    mechWhirr(c, t + 0.02, 0.14, 112, 78, 0.04)
    mechWhirr(c, t + 0.16, 0.12, 126, 92, 0.038)
    ;[0.38, 0.43, 0.48, 0.52, 0.57].forEach((d, i) =>
      mechClick(c, t + d, 0.038, 2600 - i * 150))
    mechWhirr(c, t + 0.55, 0.28, 68, 118, 0.024)
    mechClick(c, t + 0.66, 0.045, 1600)
  }
}

// Airy band-swept noise for the skin swap — rises then falls away, one breath.
export function skinWhoosh() {
  const c = resume()
  const t = c.currentTime
  const dur = 0.45
  const n = c.createBufferSource()
  n.buffer = noiseBuffer(c)
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.Q.value = 1.1
  bp.frequency.setValueAtTime(90, t)
  bp.frequency.exponentialRampToValueAtTime(650, t + dur * 0.55)
  bp.frequency.exponentialRampToValueAtTime(140, t + dur)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, t)
  // low band carries less energy, so push the envelope harder
  g.gain.exponentialRampToValueAtTime(0.3, t + dur * 0.4)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  n.connect(bp).connect(g).connect(sfxBus)
  n.start(t)
  n.stop(t + dur + 0.02)
}

function noiseBuffer(c) {
  if (!c._noise) {
    const len = c.sampleRate * 2
    const buf = c.createBuffer(1, len, c.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    c._noise = buf
  }
  return c._noise
}

function env(param, t, peak, attack, decay) {
  param.cancelScheduledValues(t)
  param.setValueAtTime(0.0001, t)
  param.exponentialRampToValueAtTime(peak, t + attack)
  param.exponentialRampToValueAtTime(0.0001, t + attack + decay)
}

const voices = {
  kick(c, t, gain = 1) {
    const o = c.createOscillator()
    const g = c.createGain()
    o.type = 'sine'
    o.frequency.setValueAtTime(150, t)
    o.frequency.exponentialRampToValueAtTime(42, t + 0.11)
    env(g.gain, t, 1.0 * gain, 0.002, 0.42)
    // click transient
    const cl = c.createOscillator()
    const cg = c.createGain()
    cl.type = 'triangle'
    cl.frequency.setValueAtTime(1100, t)
    env(cg.gain, t, 0.28 * gain, 0.001, 0.014)
    o.connect(g).connect(comp)
    cl.connect(cg).connect(comp)
    o.start(t); o.stop(t + 0.6)
    cl.start(t); cl.stop(t + 0.05)
  },
  snare(c, t, gain = 1) {
    const n = c.createBufferSource()
    n.buffer = noiseBuffer(c)
    const hp = c.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 1400
    const ng = c.createGain()
    env(ng.gain, t, 0.6 * gain, 0.001, 0.17)
    n.connect(hp).connect(ng).connect(comp)
    n.start(t); n.stop(t + 0.3)

    const o = c.createOscillator()
    const g = c.createGain()
    o.type = 'triangle'
    o.frequency.setValueAtTime(210, t)
    o.frequency.exponentialRampToValueAtTime(150, t + 0.1)
    env(g.gain, t, 0.45 * gain, 0.002, 0.11)
    o.connect(g).connect(comp)
    o.start(t); o.stop(t + 0.25)
  },
  hat(c, t, gain = 1) {
    const n = c.createBufferSource()
    n.buffer = noiseBuffer(c)
    const hp = c.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 7200
    const bp = c.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 10500
    bp.Q.value = 0.9
    const g = c.createGain()
    env(g.gain, t, 0.3 * gain, 0.001, 0.045)
    n.connect(hp).connect(bp).connect(g).connect(comp)
    n.start(t); n.stop(t + 0.12)
  },
  clap(c, t, gain = 1) {
    for (let i = 0; i < 3; i++) {
      const off = i * 0.012
      const n = c.createBufferSource()
      n.buffer = noiseBuffer(c)
      const bp = c.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = 1600
      bp.Q.value = 1.1
      const g = c.createGain()
      env(g.gain, t + off, 0.34 * gain, 0.001, i === 2 ? 0.16 : 0.03)
      n.connect(bp).connect(g).connect(comp)
      n.start(t + off); n.stop(t + off + 0.25)
    }
  },
}

const VOICE_GAIN = {
  snare: 0.78,
  clap: 1.25,
}

export const TRACKS = [
  { id: 'kick', label: 'KICK' },
  { id: 'snare', label: 'SNARE' },
  { id: 'hat', label: 'HAT' },
  { id: 'clap', label: 'CLAP' },
]

// ---- Sample kits -----------------------------------------------------------
// public/sounds/<kit>-<track>.wav. Synth voices stay as the fallback: they play
// while a kit is still decoding, and when no kit is selected.

const buffers = new Map()
// samples come in hotter than the synth voices — trim to match
const KIT_GAIN = 0.8
let kit = null

export function setKit(next) {
  kit = next
  if (!next) return
  const c = getContext()
  for (const t of TRACKS) {
    const key = `${next}-${t.id}`
    if (buffers.has(key)) continue
    buffers.set(key, null) // claim the slot so we fetch once
    fetch(`/sounds/${key}.wav`)
      .then((r) => r.arrayBuffer())
      .then((b) => c.decodeAudioData(b))
      .then((buf) => buffers.set(key, buf))
      .catch(() => buffers.delete(key)) // let a later setKit retry
  }
}

// ponytail: rate (pitch) only reaches sample kits; the synth voices ignore it.
export function trigger(trackId, when, gain = 1, rate = 1) {
  const c = resume()
  const t = when ?? c.currentTime
  const buf = kit && buffers.get(`${kit}-${trackId}`)
  if (buf) {
    const src = c.createBufferSource()
    src.buffer = buf
    src.playbackRate.value = rate
    const g = c.createGain()
    g.gain.value = gain * KIT_GAIN
    src.connect(g).connect(comp)
    src.start(t)
    return
  }
  voices[trackId]?.(c, t, gain * (VOICE_GAIN[trackId] ?? 1))
}

// ---- Transport -------------------------------------------------------------
// Lookahead scheduler: a 25ms timer queues note events ~100ms ahead on the
// audio clock, so timing never depends on rAF or React render cadence.

const LOOKAHEAD_MS = 25
const SCHEDULE_AHEAD = 0.12
// Preset values describe the swing control amount; this multiplier turns that
// into an audible offbeat delay. Kept below 1 so the heaviest setting remains
// behind the beat without collapsing into the following sixteenth note.
const SWING_DELAY_SCALE = 0.85

// getRepeat() returns a loop length in steps (or 0/undefined when off). While
// on, the playhead is held inside the grid-aligned section it was in when
// engaged and replays it — the SP-404 looper, on the sequencer instead of audio.
// A ghost clock keeps counting underneath, so releasing drops you back exactly
// where the pattern would have been: the loop never knocks the groove out of
// phase with the bar. Fast divisions (1/16, 1/32) fade a little per repeat —
// a roll, not a buzz.
// getGlitch() true = scatter: random slice lengths, random steps pulled from
// the pattern's own hits, random gain/pitch. Same ghost clock, same in-phase release.
const REPEAT_DECAY = 0.9   // gain per repeat at 1/16 and 1/32
const REPEAT_FLOOR = 0.45  // rolls never fade below this
const GLITCH_TICKS = [0.25, 0.25, 0.5, 0.5, 0.5, 1]  // slice lengths in steps, weighted
const GLITCH_RATES = [0.5, 0.75, 1, 1, 1.5, 2]        // sample pitch per slice
export function createTransport({ getPattern, getBpm, getSwing, getRepeat, getGlitch, onStep }) {
  let timer = null
  let step = 0
  let ghost = 0       // where the pattern would be without the loop
  let loopStart = -1
  let lastHit = 0     // most recent step that fired anything
  let reps = 0
  let nextTime = 0
  let running = false
  // Recently scheduled hits, drained by the render loop for visual sync.
  const queue = []

  function stepDur() {
    return 60 / getBpm() / 4
  }

  function schedule() {
    const c = getContext()
    while (nextTime < c.currentTime + SCHEDULE_AHEAD) {
      const pattern = getPattern()
      if (getGlitch?.()) {
        loopStart = -1
        const tick = GLITCH_TICKS[Math.floor(Math.random() * GLITCH_TICKS.length)]
        const duration = stepDur() * tick
        const hits = []
        for (let i = 0; i < 16; i++) if (TRACKS.some((t) => pattern[t.id]?.[i])) hits.push(i)
        const play = hits.length ? hits[Math.floor(Math.random() * hits.length)] : -1
        if (play >= 0) {
          const rate = GLITCH_RATES[Math.floor(Math.random() * GLITCH_RATES.length)]
          const gain = 0.5 + Math.random() * 0.6
          for (const t of TRACKS) {
            const v = pattern[t.id]?.[play]
            if (v) trigger(t.id, nextTime, v * gain, rate)
          }
        }
        queue.push({ step: play, time: nextTime })
        ghost = (ghost + tick) % 16
        step = Math.floor(ghost) % 16
        nextTime += duration
        continue
      }
      const len = getRepeat?.() || 0
      if (!len) {
        if (loopStart >= 0) step = Math.floor(ghost) % 16 // release: snap back in phase
        loopStart = -1
      } else if (loopStart < 0) {
        // Section loops align to the grid. Rolls (1/16, 1/32) retrigger the
        // last thing that sounded — rolling an empty step is just silence.
        loopStart = len > 1 ? step - (step % len) : lastHit
        step = len > 1 ? step : lastHit
        reps = 0
      }
      const tick = len > 0 && len < 1 ? len : 1       // 1/32 = half a step
      const duration = stepDur() * tick
      const roll = len > 0 && len <= 1 ? Math.max(REPEAT_FLOOR, Math.pow(REPEAT_DECAY, reps)) : 1
      const selectedSwing = getSwing?.() ?? 0
      const visualTime = step % 2 === 1
        ? nextTime + duration * selectedSwing * SWING_DELAY_SCALE
        : nextTime
      for (const t of TRACKS) {
        const v = pattern[t.id]?.[step]
        if (v) {
          const trackSwing = getSwing?.(t.id) ?? selectedSwing
          const hitTime = step % 2 === 1
            ? nextTime + duration * trackSwing * SWING_DELAY_SCALE
            : nextTime
          trigger(t.id, hitTime, v * roll, 1)
          lastHit = step
        }
      }
      queue.push({ step, time: visualTime })
      ghost = (ghost + tick) % 16
      if (len) {
        step = loopStart + ((step + 1 - loopStart) % Math.max(1, len))
        if (step === loopStart) reps++
      } else {
        step = (step + 1) % 16
        ghost = step
      }
      nextTime += duration
    }
    // Hand the renderer any hits whose audio time has arrived.
    while (queue.length && queue[0].time <= c.currentTime) {
      onStep?.(queue.shift().step)
    }
  }

  return {
    start() {
      if (running) return
      running = true
      step = 0
      ghost = 0
      loopStart = -1
      whenRunning((c) => {
        if (!running || timer) return
        nextTime = c.currentTime + 0.06
        schedule()
        timer = setInterval(schedule, LOOKAHEAD_MS)
      })
    },
    stop() {
      running = false
      clearInterval(timer)
      timer = null
      queue.length = 0
      onStep?.(-1)
    },
    get running() { return running },
  }
}
