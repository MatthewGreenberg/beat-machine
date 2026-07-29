import { useEffect } from 'react'
import { actions, useStore, TRACKS } from '../state/store'
import { FINISHES, getFinish } from '../finishes'

// Keyboard is the fast path: 1-4 pick a track, Q..] toggle the 16 steps,
// space plays. The 3D keys stay the primary surface; this is for muscle memory.
const STEP_KEYS = ['1', '2', '3', '4', 'q', 'w', 'e', 'r', 'a', 's', 'd', 'f', 'z', 'x', 'c', 'v']

export default function Hud() {
  const { playing, bpm, track, finish } = useStore()
  const activeFinish = getFinish(finish)

  useEffect(() => {
    const onKey = (e) => {
      if (e.repeat) return
      if (e.code === 'Space') { e.preventDefault(); actions.togglePlay(); return }
      if (e.code === 'Backspace') { e.preventDefault(); actions.clear(); return }
      const i = STEP_KEYS.indexOf(e.key.toLowerCase())
      if (i >= 0) { actions.toggleStep(i); return }
      const t = ['F1', 'F2', 'F3', 'F4'].indexOf(e.key)
      if (t >= 0) actions.selectTrack(TRACKS[t].id)
      if (e.key === 'Tab') {
        e.preventDefault()
        const cur = TRACKS.findIndex((x) => x.id === track)
        actions.selectTrack(TRACKS[(cur + 1) % TRACKS.length].id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [track])

  return (
    <div className="hud">
      <span className={playing ? 'dot on' : 'dot'} />
      <span>{playing ? 'RUN' : 'STOP'}</span>
      <span>{bpm} BPM</span>
      <span>{TRACKS.find((t) => t.id === track)?.label}</span>
      <span
        className="finish-name"
        style={{ '--finish-accent': activeFinish.accent }}
        aria-live="polite"
      >
        {activeFinish.label}
      </span>
      <span className="finish-picker" aria-label="Machine finish">
        {FINISHES.map((option, index) => (
          <button
            key={option.id}
            type="button"
            className={finish === index ? 'active' : ''}
            style={{ '--swatch': option.accent }}
            aria-label={`Use ${option.label} finish`}
            aria-pressed={finish === index}
            title={option.label}
            onClick={() => actions.setFinish(index)}
          >
            {String(index + 1).padStart(2, '0')}
          </button>
        ))}
      </span>
      <span className="hint">space plays · tab changes track · backspace clears</span>
    </div>
  )
}
