import { useEffect, useRef, useState } from 'react'
import { getState, useStore } from '../state/store'
import { VIEW, DEBUG } from '../scene/views'
import { BODY_W, BODY_H, PITCH, PLATE_H, TOP_Y, keyX, keyY } from '../scene/layout'
import { tutorialLive } from './tutorial-live'
import { FINISHES } from '../finishes'

const SEEN_KEY = 'bm_tutorial_seen'
const seen = () => {
  try { return localStorage.getItem(SEEN_KEY) } catch { return '1' }
}
const markSeen = () => {
  try { localStorage.setItem(SEEN_KEY, '1') } catch { /* private mode */ }
}

// ?tutorial forces a replay; harness/demo params (?view ?debug ?play) skip it.
const params = new URLSearchParams(window.location.search)
const SHOW = params.has('tutorial')
  || (!VIEW && !DEBUG && !params.has('play') && !seen())

// Machine-local rect (cm, centred) spanning a key-grid block, inclusive.
const gridRect = (c0, c1, r0, r1) => ({
  x: (keyX(c0) + keyX(c1)) / 2,
  y: (keyY(r0) + keyY(r1)) / 2,
  w: (c1 - c0 + 1) * PITCH,
  h: (r1 - r0 + 1) * PITCH,
})

const MACHINE = { x: 0, y: 0, w: BODY_W, h: BODY_H, pad: 20 }

// `done(state, baseline)` advances the step when the user performs the action;
// baseline is the state snapshot taken when the step was entered.
const STEPS = [
  {
    text: 'This is a drum machine. Let’s build a beat.',
    cta: 'Start',
    target: MACHINE,
  },
  {
    text: 'Pick an instrument — kick, snare, hat or clap.',
    target: gridRect(0, 3, 0, 0),
    done: (s, b) => s.track !== b.track,
  },
  {
    text: 'Tap the pads to place hits. Drag up or down on a pad to set how hard it hits.',
    target: gridRect(0, 3, 1, 4),
    done: (s, b) => s.pattern !== b.pattern,
  },
  {
    text: 'Hit the orange key to play your loop.',
    target: { x: keyX(4), y: keyY(3, 2), w: PITCH, h: 2 * PITCH },
    done: (s) => s.playing,
  },
  {
    text: 'Drag the dial to change the tempo. Click it to switch to volume.',
    target: { x: -BODY_W / 2 + 1.99, y: TOP_Y - PLATE_H / 2, w: 4.6, h: 4.6 },
    done: (s, b) => s.bpm !== b.bpm || s.knobMode !== b.knobMode,
  },
  {
    text: 'Tap the top-right key to switch the skin — each finish plays its own sample kit.',
    target: { x: keyX(4), y: keyY(1, 2), w: PITCH, h: 2 * PITCH },
    done: (s, b) => s.finish !== b.finish,
  },
  {
    text: 'Open the FX editor — filter, drive, echo and space live in there.',
    target: { dom: '.fx-toggle', pad: 10 },
    done: (s) => s.fxOpen,
  },
  {
    text: 'You’re set. Space plays, Backspace clears, and 1-4 / QWER / ASDF / ZXCV hit the pads.',
    cta: 'Done',
    target: MACHINE,
  },
]

let replay = null
export function replayTutorial() { replay?.() }

export default function Tutorial() {
  const state = useStore()
  const [step, setStep] = useState(0)
  const [ready, setReady] = useState(false)
  const [gone, setGone] = useState(!SHOW)
  const base = useRef(getState())
  // First visit waits for the assembly intro; a replay starts immediately.
  const wait = useRef(SHOW ? 2100 : 0)

  useEffect(() => {
    replay = () => {
      wait.current = 0
      base.current = getState()
      setStep(0)
      setReady(true)
      setGone(false)
    }
    return () => { replay = null }
  }, [])

  // Let the assembly intro land before pointing at anything (INTRO_DURATION
  // 1.75s in TempoMatrix.jsx, plus a beat).
  useEffect(() => {
    if (gone) return
    const t = setTimeout(() => setReady(true), wait.current)
    return () => clearTimeout(t)
  }, [gone])

  useEffect(() => {
    tutorialLive.target = ready && !gone ? STEPS[step].target : null
    return () => { tutorialLive.target = null }
  }, [step, ready, gone])

  const finish = () => { markSeen(); setGone(true) }
  const advance = () => {
    base.current = getState()
    if (step >= STEPS.length - 1) finish()
    else setStep(step + 1)
  }

  // Advance when the user performs the step's action, after a short beat so
  // they see the machine react before the card swaps.
  useEffect(() => {
    if (gone || !ready) return
    const done = STEPS[step].done
    if (!done || !done(state, base.current)) return
    const t = setTimeout(advance, 500)
    return () => clearTimeout(t)
  })

  if (gone) return null
  const s = STEPS[step]
  return (
    <div
      className={`tut${ready ? ' tut-on' : ''}`}
      style={{ '--accent': FINISHES[state.finish].accent }}
    >
      <div className="tut-hole" ref={(el) => { tutorialLive.hole = el }} />
      <div className="tut-card">
        <div className="tut-count">{step + 1} / {STEPS.length}</div>
        <p className="tut-text">{s.text}</p>
        <div className="tut-actions">
          {/* blur mouse clicks so a later Space press plays instead of re-clicking */}
          {step < STEPS.length - 1 && (
            <button
              type="button"
              className="tut-skip"
              onClick={(e) => { if (e.detail) e.currentTarget.blur(); finish() }}
            >
              Skip
            </button>
          )}
          <button
            type="button"
            className="tut-next"
            onClick={(e) => { if (e.detail) e.currentTarget.blur(); advance() }}
          >
            {s.cta ?? 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}
