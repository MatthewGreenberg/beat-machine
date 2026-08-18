// WebAudio drum synths + lookahead scheduler.
// ponytail: no Tone.js — 4 synth voices and a lookahead loop are ~150 lines of native WebAudio.

let ctx = null
let master = null
let comp = null
let fx = null

// ---- Master FX bus ---------------------------------------------------------
// comp -> drive -> filter -> [dry | tempo-synced delay | plate] -> master

function driveCurve() {
  const n = 1024
  const curve = new Float32Array(n)
  for (let i = 0; i < n; i++) curve[i] = Math.tanh(((i / (n - 1)) * 2 - 1) * 2.2)
  return curve
}

// ponytail: generated noise impulse instead of shipping an IR file.
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
  reverb.buffer = impulse(c)
  const revSend = c.createGain()
  revSend.gain.value = 0

  from.connect(pre)
  pre.connect(shaper)
  shaper.connect(post)
  post.connect(filter)
  filter.connect(to)                                   // dry
  filter.connect(delaySend).connect(delay).connect(to)
  delay.connect(damp).connect(feedback).connect(delay) // damped feedback loop
  filter.connect(revSend).connect(reverb).connect(to)

  return { pre, post, filter, delaySend, revSend, delay }
}

export function getContext() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)()
    comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -12
    comp.ratio.value = 4
    comp.attack.value = 0.003
    comp.release.value = 0.15
    master = ctx.createGain()
    master.gain.value = 0.5
    fx = buildFx(ctx, comp, master)
    master.connect(ctx.destination)
  }
  return ctx
}

// Panel controls, all normalised 0..1.
export function setFx(name, v) {
  const c = getContext()
  const t = c.currentTime
  const ramp = 0.03
  if (name === 'filter') fx.filter.frequency.setTargetAtTime(180 * Math.pow(100, v), t, ramp)
  else if (name === 'drive') {
    fx.pre.gain.setTargetAtTime(1 + v * 7, t, ramp)
    fx.post.gain.setTargetAtTime(1 / (1 + v * 2.6), t, ramp)
  } else if (name === 'delay') fx.delaySend.gain.setTargetAtTime(v * 0.55, t, ramp)
  else if (name === 'space') fx.revSend.gain.setTargetAtTime(v * 0.75, t, ramp)
}

// Keep the delay on an eighth note so it never smears against the pattern.
export function syncDelay(bpm) {
  const c = getContext()
  fx.delay.delayTime.setTargetAtTime(Math.min(1.4, 60 / bpm / 2), c.currentTime, 0.05)
}

export function setMasterVolume(v) {
  const c = getContext()
  // short ramp instead of a snap so dragging the dial doesn't zipper
  master.gain.setTargetAtTime(v, c.currentTime, 0.02)
}

export function resume() {
  const c = getContext()
  if (c.state === 'suspended') c.resume()
  return c
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
