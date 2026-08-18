import { useSyncExternalStore } from 'react'
import {
  TRACKS,
  createTransport,
  trigger,
  resume,
  setMasterVolume,
  setKit,
  syncDelay,
  setFx as setAudioFx,
  uiWhoosh,
} from '../audio/engine'
import { FINISHES } from '../finishes'

export const BPM_MIN = 60
export const BPM_MAX = 180
export const SWING_OPTIONS = [0, 0.18, 0.32, 0.46]

// Blue plays hip-hop, red plays trap, purple plays cool; ivory stays on the synths.
const FINISH_KIT = { cobalt: 'hip', ember: 'trap', violet: 'cool' }

// ponytail: 30-line subscribe store instead of zustand — no new dep.
const listeners = new Set()

const emptyPattern = () =>
  Object.fromEntries(TRACKS.map((t) => [t.id, new Array(16).fill(0)]))

const seed = emptyPattern()
seed.kick[0] = seed.kick[4] = seed.kick[8] = seed.kick[11] = 1
seed.snare[4] = seed.snare[12] = 1
for (let i = 0; i < 16; i += 2) seed.hat[i] = i % 4 === 0 ? 0.75 : 0.45
seed.clap[12] = 0.8

let state = {
  pattern: seed,
  track: 'kick',
  bpm: 120,
  swing: Object.fromEntries(TRACKS.map((track) => [track.id, 0.18])),
  playing: false,
  step: -1,
  finish: 0,
  // main dial: click toggles between tempo and master volume
  knobMode: 'bpm',
  volume: 0.5,
  fxOpen: false,
  fx: {
    filter: 1,
    drive: 0,
    delay: 0,
    space: 0,
  },
}

// Mutable mirror the render loop reads every frame without triggering React.
export const live = { step: -1, hits: new Map(), knob: 0, fxMorph: 0, dollyVel: 0 }

function set(patch) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

export function getState() { return state }

// Selectors must return a stable value (primitive or an object identity that
// only changes with `state`) — the whole state object is the safe default.
export function useStore(selector = (s) => s) {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l) },
    () => selector(state),
  )
}

const transport = createTransport({
  getPattern: () => state.pattern,
  getBpm: () => state.bpm,
  getSwing: (trackId = state.track) => state.swing[trackId] ?? 0,
  onStep: (s) => {
    live.step = s
    if (s >= 0) {
      for (const t of TRACKS) {
        if (state.pattern[t.id]?.[s]) live.hits.set(t.id, performance.now())
      }
    }
  },
})

export const actions = {
  toggleStep(i) {
    const row = state.pattern[state.track].slice()
    row[i] = row[i] ? 0 : 1
    set({ pattern: { ...state.pattern, [state.track]: row } })
    if (row[i] && !state.playing) trigger(state.track)
  },
  setStepVelocity(i, velocity) {
    const row = state.pattern[state.track].slice()
    row[i] = Math.max(0.1, Math.min(1, velocity))
    set({ pattern: { ...state.pattern, [state.track]: row } })
  },
  selectTrack(id) {
    set({ track: id })
    trigger(id)
  },
  togglePlay() {
    resume()
    if (transport.running) transport.stop()
    else transport.start()
    set({ playing: transport.running })
  },
  setBpm(v) {
    const bpm = Math.max(BPM_MIN, Math.min(BPM_MAX, Math.round(v)))
    set({ bpm })
    syncDelay(bpm)
  },
  setVolume(v) {
    const volume = Math.max(0, Math.min(1, v))
    setMasterVolume(volume)
    set({ volume })
  },
  toggleKnobMode() {
    set({ knobMode: state.knobMode === 'bpm' ? 'volume' : 'bpm' })
  },
  toggleFx() {
    const next = !state.fxOpen
    resume()
    uiWhoosh(next)
    set({ fxOpen: next })
  },
  closeFx() {
    if (state.fxOpen) actions.toggleFx()
  },
  setFxValue(name, value) {
    if (!(name in state.fx)) return
    const next = Math.max(0, Math.min(1, value))
    setAudioFx(name, next)
    set({ fx: { ...state.fx, [name]: next } })
  },
  cycleSwing() {
    const current = state.swing[state.track] ?? 0
    const currentIndex = SWING_OPTIONS.findIndex(
      (option) => Math.abs(option - current) < 0.001,
    )
    const next = SWING_OPTIONS[(currentIndex + 1) % SWING_OPTIONS.length]
    set({ swing: { ...state.swing, [state.track]: next } })
  },
  setFinish(index) {
    const finish = ((index % FINISHES.length) + FINISHES.length) % FINISHES.length
    set({ finish })
    setKit(FINISH_KIT[FINISHES[finish].id] ?? null)
  },
  cycleFinish() {
    actions.setFinish(state.finish + 1)
  },
  clear() {
    set({ pattern: { ...state.pattern, [state.track]: new Array(16).fill(0) } })
  },
}

export { TRACKS }
