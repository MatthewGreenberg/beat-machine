import { useEffect, useId, useRef, useState } from 'react'
import { replayTutorial } from './Tutorial'

export default function About() {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const panelRef = useRef(null)
  const toggleRef = useRef(null)

  const close = () => {
    setOpen(false)
    requestAnimationFrame(() => toggleRef.current?.focus())
  }

  useEffect(() => {
    if (!open) return

    const panel = panelRef.current
    panel?.querySelector('button')?.focus()

    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
        return
      }
      if (event.key !== 'Tab') return

      const focusable = [...panel.querySelectorAll('button, a[href]')]
      const first = focusable[0]
      const last = focusable.at(-1)
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div className="about">
      <button
        ref={toggleRef}
        type="button"
        className="about-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(true)}
      >
        About
      </button>

      {open && (
        <>
          <div className="about-backdrop" aria-hidden="true" onClick={close} />
          <section
            ref={panelRef}
            id={panelId}
            className="about-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${panelId}-title`}
          >
            <div className="about-heading">
              <span>About</span>
              <button type="button" className="about-close" onClick={close}>
                Close
              </button>
            </div>
            <p id={`${panelId}-title`} className="about-title">
              A WebGL Experiement By Matt Greenberg
            </p>
            <nav className="about-links" aria-label="Matt Greenberg on social media">
              <a href="https://x.com/McGreenBeats" target="_blank" rel="noreferrer">
                X
              </a>
              <a
                href="https://www.linkedin.com/in/mattcgreenberg/"
                target="_blank"
                rel="noreferrer"
              >
                LinkedIn
              </a>
            </nav>
            <button
              type="button"
              className="about-replay"
              onClick={() => { setOpen(false); replayTutorial() }}
            >
              Replay tutorial
            </button>
          </section>
        </>
      )}
    </div>
  )
}
