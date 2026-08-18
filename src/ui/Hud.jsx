import { useEffect } from 'react'
import { actions, useStore, TRACKS } from '../state/store'
import FxPanel from './FxPanel'

// Keyboard is the fast path: 1-4 pick a track, Q..] toggle the 16 steps,
// space plays. The 3D keys stay the primary surface; this is for muscle memory.
const STEP_KEYS = ['1', '2', '3', '4', 'q', 'w', 'e', 'r', 'a', 's', 'd', 'f', 'z', 'x', 'c', 'v']

export default function Hud() {
  const { track, fxOpen } = useStore()

  useEffect(() => {
    const onKey = (e) => {
      if (e.repeat) return
      if (e.key === 'Escape' && fxOpen) { actions.closeFx(); return }
      // In editor mode the hardware is behind glass, so its performance
      // shortcuts pause with it instead of firing invisible controls.
      if (fxOpen || e.target?.closest?.('.fx')) return
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
  }, [track, fxOpen])

  return <FxPanel />
}
