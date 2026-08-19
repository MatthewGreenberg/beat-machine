// WebAudio drum synths + lookahead scheduler.
// ponytail: no Tone.js — 4 synth voices and a lookahead loop are ~150 lines of native WebAudio.

let ctx = null
let master = null
let sfxBus = null
let comp = null
let fx = null

// ---- Master FX bus ---------------------------------------------------------
// comp -> drive -> filter -> [dry | tempo-synced delay | reverb] -> master

// Selectable character per effect; the panel cycles these via setFxMode.
export const FX_MODE_OPTIONS = {
  filter: ['LP', 'HP', 'BP'],
  drive: ['SOFT', 'HARD', 'FOLD'],
  delay: ['1/16', '1/8', '1/4'],
  space: ['PLATE', 'HALL', 'SPRING'],
}
const DELAY_DIV = { '1/16': 0.25, '1/8': 0.5, '1/4': 1 }
const FILTER_TYPE = { LP: 'lowpass', HP: 'highpass', BP: 'bandpass' }
const modes = { filter: 'LP', drive: 'SOFT', delay: '1/8', space: 'PLATE' }
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

// iOS suspends the context after a call/Siri/backgrounding and never resumes
// it on its own. Only ever resumes an existing context — never creates one
// before a user gesture.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && ctx && ctx.state !== 'running') ctx.resume()
  })
}

export function getContext() {
  if (!ctx) {
    // iOS: WebAudio defaults to the "ambient" session, which the ringer/silent
    // switch mutes. "playback" opts into media-app behaviour (audible on
    // silent, like YouTube). Safari 16.4+; harmless no-op elsewhere.
    try { navigator.audioSession.type = 'playback' } catch { /* unsupported */ }
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
    beatBus.connect(master)
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
  const c = getContext()
  modes[name] = mode
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

export function trigger(trackId, when, gain = 1) {
  const c = resume()
  const t = when ?? c.currentTime
  const buf = kit && buffers.get(`${kit}-${trackId}`)
  if (buf) {
    const src = c.createBufferSource()
    src.buffer = buf
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

export function createTransport({ getPattern, getBpm, getSwing, onStep }) {
  let timer = null
  let step = 0
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
      const duration = stepDur()
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
          trigger(t.id, hitTime, v)
        }
      }
      queue.push({ step, time: visualTime })
      step = (step + 1) % 16
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
      const c = resume()
      running = true
      step = 0
      nextTime = c.currentTime + 0.06
      schedule()
      timer = setInterval(schedule, LOOKAHEAD_MS)
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
