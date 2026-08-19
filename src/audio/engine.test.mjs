// node src/audio/engine.test.mjs
// iOS regression: keys act on pointerdown, but WebKit only unlocks audio while
// a touchend/pointerup is being handled. If play is the first thing tapped the
// context must still end up running and stepping from step 0.
import assert from 'node:assert/strict'
import { register } from 'node:module'

// engine.js imports Vite-style extensionless paths; teach Node to resolve them.
const HOOK = 'export function resolve(s, c, n) { return n(s.startsWith(".") && !/\\.\\w+$/.test(s) ? s + ".js" : s, c) }'
register(`data:text/javascript,${encodeURIComponent(HOOK)}`)

let now = 12.5 // Safari keeps a non-zero clock on a page-load context
let activation = false // true only while a touchend/pointerup handler runs
const docListeners = {}
const param = () => ({ value: 0, setValueAtTime() {}, setTargetAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {}, setValueCurveAtTime() {} })
const node = () => new Proxy({ connect: (d) => d, start() {}, stop() {}, gain: param(), frequency: param(), Q: param(), delayTime: param() }, {
  get: (t, k) => (k in t ? t[k] : (t[k] = param())),
  set: (t, k, v) => ((t[k] = v), true),
})

class FakeAudioContext {
  state = 'suspended'
  sampleRate = 48000
  destination = node()
  #on = {}
  get currentTime() { return now }
  resume() {
    if (!activation) return Promise.resolve() // WebKit: ignored outside a gesture
    return new Promise((r) => setTimeout(() => { // and async even when honoured
      this.state = 'running'
      ;(this.#on.statechange ?? []).forEach((f) => f())
      r()
    }, 0))
  }
  addEventListener(t, f) { (this.#on[t] ??= []).push(f) }
  removeEventListener(t, f) { this.#on[t] = (this.#on[t] ?? []).filter((x) => x !== f) }
  createBuffer(ch, len) { return { length: len, getChannelData: () => new Float32Array(len) } }
  createBufferSource() { return node() }
  createGain() { return node() }
  createBiquadFilter() { return node() }
  createConvolver() { return node() }
  createDelay() { return node() }
  createDynamicsCompressor() { return node() }
  createOscillator() { return node() }
  createWaveShaper() { return node() }
}

globalThis.window = { AudioContext: FakeAudioContext, matchMedia: () => ({ matches: true }) } // touch device
globalThis.document = { hidden: false, addEventListener: (t, f) => ((docListeners[t] ??= []).push(f)) }
globalThis.navigator = {}

const { createTransport, getContext } = await import('./engine.js')

getContext() // the app builds the context at load, before any gesture
const steps = []
const t = createTransport({
  getPattern: () => ({ kick: Array.from({ length: 16 }, () => 1) }),
  getBpm: () => 120,
  getSwing: () => 0,
  onStep: (s) => steps.push(s),
})

// The tap: Keycap fires onPress on pointerdown (no activation yet)...
t.start()
assert.equal(t.running, true, 'transport reports running immediately for the UI')
// ...then the browser dispatches pointerup/touchend for the same tap.
activation = true
for (const type of ['pointerup', 'touchend']) (docListeners[type] ?? []).forEach((f) => f())
activation = false

const tick = async (n) => {
  for (let i = 0; i < n; i++) { now += 0.03; await new Promise((r) => setTimeout(r, 26)) }
}
await tick(2)
assert.equal(getContext().state, 'running', 'the play tap alone unlocked audio')
assert.ok(steps.length <= 1, `no burst of stale steps on unlock, got ${steps.length}`)
await tick(20)
t.stop()
const played = steps.filter((s) => s >= 0)
assert.ok(played.length >= 4, `steps keep firing, got ${played.length}`)
assert.deepEqual(played.slice(0, 4), [0, 1, 2, 3], 'starts at step 0 in order')
console.log('ok — play as the first tap starts playback:', played.slice(0, 6))
