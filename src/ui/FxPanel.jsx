import { useEffect, useRef, useState } from 'react'
import { actions, useStore } from '../state/store'
import { FINISHES } from '../finishes'

// One geometry table drives both the shader and the DOM overlay, in CSS px
// with the canvas centre as the origin (y up for the shader, y down for DOM).
const PANEL_W = 460
const PANEL_H = 236
const PANEL_R = 26
const ORB = 78          // hit area while shut
const BLOB_R = 30       // the sdf blob itself
const PULL_MAX = 20
const PAD = 46
export const CW = PANEL_W + PAD * 2
export const CH = PANEL_H + PAD * 2
const ROW_Y0 = 86          // top row, y up
const ROW_DY = 43
const TX0 = -104           // slider track, left
const TX1 = 152            // slider track, right
const N = FINISHES.length
const pct = (v) => `${Math.round(v * 100)}%`
const hz = (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}K` : `${Math.round(v)}`)

const ROWS = [
  { key: 'filter', label: 'FILTER', init: 1, fmt: (v) => hz(180 * Math.pow(100, v)) },
  { key: 'drive', label: 'DRIVE', init: 0, fmt: pct },
  { key: 'delay', label: 'ECHO', init: 0, fmt: pct },
  { key: 'space', label: 'SPACE', init: 0, fmt: pct },
  { key: 'finish', label: 'FINISH', init: 0, step: 1 / (N - 1), fmt: (v) => FINISHES[Math.round(v * (N - 1))].label.toUpperCase() },
]

const VERT = `
attribute vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }
`

const FRAG = `
precision highp float;

uniform vec2  uRes;
uniform float uDpr;
uniform vec2  uOff;
uniform vec2  uMouse;
uniform vec3  uAccent;
uniform float uOpen;
uniform float uHover;
uniform float uPress;
uniform float uTime;
uniform float uCloseHot;
uniform float uX;
uniform float uVal[5];
uniform float uHot[5];

const float PW = __PW__, PH = __PH__, PR = __PR__, BR = __BR__;
const float TX0 = __TX0__, TX1 = __TX1__;
const float ROW_Y0 = __ROWY__, ROW_DY = __ROWDY__;

float hash21(vec2 v) { return fract(sin(dot(v, vec2(127.1, 311.7))) * 43758.5453); }
float sdBox(vec2 p, vec2 b, float r) {
  vec2 e = abs(p) - b + r;
  return min(max(e.x, e.y), 0.0) + length(max(e, 0.0)) - r;
}
float mx(vec3 c) { return max(c.r, max(c.g, c.b)); }

void main() {
  vec2 P = (gl_FragCoord.xy - 0.5 * uRes) / uDpr;      // css px, centred, y up
  float o  = clamp(uOpen, 0.0, 1.0);
  float pw = smoothstep(0.04, 0.55, o);                // when the panel look takes over

  // shut: the metaball — a circle that stretches toward the cursor instead of
  // sliding, so the pull reads as magnetic rather than as a moving sprite.
  float pull = clamp(length(uOff) / 30.0, 0.0, 1.0);
  float head = length(P - uOff) - (BR - 3.5 * pull + 3.5 * uPress);
  float tail = length(P - uOff * 0.35) - (BR - 7.0 * pull);
  float k = 20.0;
  float h = clamp(0.5 + 0.5 * (tail - head) / k, 0.0, 1.0);
  float dBlob = mix(tail, head, h) - k * h * (1.0 - h);

  // Editor mode: the blob folds into a close X — same object, new duty.
  // uX is spring-driven so it snaps past and settles like the open morph.
  float xm = clamp(uX, 0.0, 1.0);
  // X mode drops 11px; the bezel ring shifts with it (see .fx-toggle in index.css)
  vec2 xp = mat2(0.7071, -0.7071, 0.7071, 0.7071) * (P - uOff * 0.3 + vec2(0.0, 11.0));
  float arm = BR * 0.42;
  float dX = min(sdBox(xp, vec2(arm, 2.3), 2.3), sdBox(xp, vec2(2.3, arm), 2.3))
           - uPress * 2.0;
  dBlob = mix(dBlob, dX, xm);

  // open: the panel. Blending the two distance fields morphs one into the other.
  vec2 he = vec2(PW * 0.5, PH * 0.5);
  float d = mix(dBlob, sdBox(P, he, PR), o);
  float body = smoothstep(1.0, -1.0, d);

  // ---- shut look: ring, faint fill, soft glow. Nothing else. ---------------
  float mRing = smoothstep(6.0, 0.0, abs(d + 2.2));
  float mGlow = exp(-max(d, 0.0) * 0.115) * (0.30 + 0.45 * uPress + 0.28 * uHover);
  // As an X it cools toward white so it reads as a UI glyph, warmer on hover.
  vec3  mAccent = mix(uAccent, vec3(1.0), xm * (0.25 + 0.45 * uCloseHot));
  vec3  mCol  = mAccent * (0.22 * body + mRing + mGlow);
  float mA    = clamp(0.30 * body + mRing + mGlow * 0.7, 0.0, 1.0);

  // ---- open look: glass panel --------------------------------------------
  float gy = clamp((P.y + he.y) / (2.0 * he.y), 0.0, 1.0);
  vec3 base = mix(vec3(0.026, 0.025, 0.024), vec3(0.080, 0.076, 0.071), gy * gy);
  base += uAccent * 0.035 * pow(gy, 3.0);
  base += mix(vec3(1.0), uAccent, 0.5) * exp(-length(P - uMouse) / 200.0) * 0.055;
  base += (hash21(gl_FragCoord.xy + fract(uTime)) - 0.5) * 0.013;      // dither

  float shadow = smoothstep(42.0, 0.0, max(sdBox(P + vec2(0.0, 14.0), he * 0.97, PR), 0.0)) * 0.55;
  float ring = smoothstep(1.1, 0.0, abs(d + 0.9));
  float up = clamp(P.y / he.y, -1.0, 1.0);

  vec3 pCol = max(base, 0.0) * body;
  pCol += mix(vec3(1.0), uAccent, 0.45) * ring
        * (0.10 + 0.34 * smoothstep(0.1, 1.0, up) + 0.22 * uHover);

  vec3 inner = vec3(0.0);
  if (o > 0.02) {
    for (int i = 0; i < 5; i++) {
      float appear = smoothstep(0.34 + float(i) * 0.07, 0.90 + float(i) * 0.07, o);
      if (appear <= 0.001) continue;
      vec2 rp = P - vec2(0.0, ROW_Y0 - float(i) * ROW_DY);
      float v = uVal[i];
      float hot = uHot[i];
      float fillX = mix(TX0, TX1, v);

      float groove = sdBox(rp - vec2((TX0 + TX1) * 0.5, 0.0), vec2((TX1 - TX0) * 0.5, 1.9), 1.9);
      float gm = smoothstep(0.9, -0.9, groove);
      inner -= vec3(0.030, 0.029, 0.028) * gm * appear;                    // recessed
      inner += vec3(0.10) * smoothstep(0.9, -0.9, abs(groove + 1.1)) * appear;

      float fill = gm * smoothstep(1.0, -1.0, rp.x - fillX);
      inner += mix(vec3(1.0), uAccent, 0.55) * fill * (0.80 + 0.55 * hot) * appear;

      float td = length(rp - vec2(fillX, 0.0));
      inner += mix(vec3(1.0), uAccent, 0.20) * smoothstep(6.5 + 1.5 * hot, 4.2 + 1.5 * hot, td) * appear;
      inner += uAccent * exp(-max(td - 6.0, 0.0) * 0.11) * (0.10 + 0.40 * hot) * appear;
    }

    vec2 xr = mat2(0.7071, -0.7071, 0.7071, 0.7071) * (P - vec2(he.x - 24.0, he.y - 24.0));
    float cd = min(sdBox(xr, vec2(6.0, 0.9), 0.9), sdBox(xr, vec2(0.9, 6.0), 0.9));
    inner += mix(vec3(0.75), uAccent, uCloseHot) * smoothstep(0.9, -0.9, cd)
           * o * (0.45 + 0.55 * uCloseHot);
  }
  pCol += inner * body;
  pCol += uAccent * exp(-max(d, 0.0) * 0.055) * (0.05 + 0.10 * uHover);

  float pA = clamp(max(body * 0.93 + shadow * pw, mx(pCol)), 0.0, 1.0);

  vec3 col = max(mix(mCol, pCol, pw), vec3(0.0));
  float a  = clamp(max(mix(mA, pA, pw), mx(col)), 0.0, 1.0);
  gl_FragColor = vec4(col, a);   // premultiplied
}
`
  .replace(/__PW__/g, PANEL_W.toFixed(1))
  .replace(/__PH__/g, PANEL_H.toFixed(1))
  .replace(/__PR__/g, PANEL_R.toFixed(1))
  .replace(/__BR__/g, BLOB_R.toFixed(1))
  .replace(/__TX0__/g, TX0.toFixed(1))
  .replace(/__TX1__/g, TX1.toFixed(1))
  .replace(/__ROWY__/g, ROW_Y0.toFixed(1))
  .replace(/__ROWDY__/g, ROW_DY.toFixed(1))

function compile(gl, type, src) {
  const s = gl.createShader(type)
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s))
  return s
}

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
const ACCENTS = FINISHES.map((f) => rgb(f.accent))

// The orb scales with viewport height (see --fx-s / the svh offset in
// index.css) so it doesn't ride up into the machine on short windows. On
// narrow screens Rig.jsx's fit-to-width shrinks the machine, so the orb has
// more clearance there, not less. Floor at 0.62 so the 78px hit target never
// drops below ~48px on landscape phones.
const REF_H = 1080

export default function FxPanel() {
  const canvasRef = useRef(null)
  const { finish, fxOpen } = useStore()
  const [scale, setScale] = useState(1)

  useEffect(() => {
    const fit = () => setScale(Math.max(0.62, Math.min(1, window.innerHeight / REF_H)))
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  // The original magnetic WebGL orb stays byte-for-byte the same visual. Its
  // old expanded panel is deliberately never entered; the click now tells the
  // Three.js machine to become the editor instead.
  const liveRef = useRef({
    open: false,
    values: ROWS.map((r) => r.init),
    hot: ROWS.map(() => 0),
    closeHot: 0,
    accent: 0,
    press: 0,
    xTarget: 0,
  })

  useEffect(() => {
    const live = liveRef.current
    live.open = false
    live.accent = finish
  }, [finish])

  useEffect(() => {
    liveRef.current.xTarget = fxOpen ? 1 : 0
  }, [fxOpen])

  useEffect(() => {
    const live = liveRef.current
    const canvas = canvasRef.current
    const gl = canvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
    })
    if (!gl) return

    const prog = gl.createProgram()
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT))
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(prog)
    gl.useProgram(prog)

    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, 'p')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.clearColor(0, 0, 0, 0)

    const U = {}
    for (const n of ['uRes', 'uDpr', 'uOff', 'uMouse', 'uAccent', 'uOpen', 'uHover', 'uPress', 'uTime', 'uCloseHot', 'uX']) {
      U[n] = gl.getUniformLocation(prog, n)
    }
    U.uVal = gl.getUniformLocation(prog, 'uVal[0]')
    U.uHot = gl.getUniformLocation(prog, 'uHot[0]')

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = CW * dpr
    canvas.height = CH * dpr
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.uniform2f(U.uRes, canvas.width, canvas.height)
    gl.uniform1f(U.uDpr, dpr)

    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const mouse = { x: 0, y: -260 }
    const off = { x: 0, y: 0 }
    const val = new Float32Array(ROWS.length)
    const hot = new Float32Array(ROWS.length)
    let openA = 0
    let openV = 0
    let hover = 0
    let closeHot = 0
    let xA = 0
    let xV = 0
    const accent = [...ACCENTS[0]]
    let raf = 0
    let last = performance.now()

    const onMove = (e) => {
      const r = canvas.getBoundingClientRect()
      mouse.x = e.clientX - (r.left + r.width / 2)
      mouse.y = -(e.clientY - (r.top + r.height / 2))
    }
    window.addEventListener('pointermove', onMove)

    // ponytail: on context loss just hide it rather than rebuilding the GL state.
    const onLost = (e) => { e.preventDefault(); canvas.style.visibility = 'hidden' }
    canvas.addEventListener('webglcontextlost', onLost)

    const frame = (now) => {
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now

      // open/close spring, with a touch of overshoot so it snaps rather than slides
      const targetOpen = live.open ? 1 : 0
      openV += (targetOpen - openA) * 210 * dt
      openV *= Math.exp(-19 * dt)
      openA += openV * dt
      if (Math.abs(targetOpen - openA) < 0.0008 && Math.abs(openV) < 0.01) {
        openA = targetOpen
        openV = 0
      }

      // blob→X spring, same overshoot character as the open/close spring
      xV += (live.xTarget - xA) * 210 * dt
      xV *= Math.exp(-19 * dt)
      xA += xV * dt
      if (Math.abs(live.xTarget - xA) < 0.0008 && Math.abs(xV) < 0.01) {
        xA = live.xTarget
        xV = 0
      }

      const shut = 1 - Math.min(1, openA)
      const near = Math.hypot(mouse.x, mouse.y) < (live.open ? 320 : 150)
      hover += ((near ? 1 : 0) - hover) * (1 - Math.exp(-9 * dt))

      // magnetic drift while shut
      const plen = Math.hypot(mouse.x, mouse.y)
      const grab = !calm && shut > 0.01 && plen < 210 ? Math.min(1, PULL_MAX / Math.max(1, plen)) : 0
      const k = 1 - Math.exp(-12 * dt)
      off.x += (mouse.x * grab - off.x) * k
      off.y += (mouse.y * grab - off.y) * k

      const ease = 1 - Math.exp(-14 * dt)
      for (let i = 0; i < ROWS.length; i++) {
        val[i] += (live.values[i] - val[i]) * (1 - Math.exp(-22 * dt))
        hot[i] += (live.hot[i] - hot[i]) * ease
      }
      closeHot += (live.closeHot - closeHot) * ease
      live.press *= Math.exp(-7 * dt)

      const want = ACCENTS[live.accent]
      const ak = 1 - Math.exp(-5 * dt)
      for (let i = 0; i < 3; i++) accent[i] += (want[i] - accent[i]) * ak

      gl.uniform2f(U.uOff, off.x, off.y)
      gl.uniform2f(U.uMouse, mouse.x, mouse.y)
      gl.uniform3f(U.uAccent, accent[0], accent[1], accent[2])
      gl.uniform1f(U.uOpen, openA)
      gl.uniform1f(U.uHover, hover)
      gl.uniform1f(U.uPress, Math.min(live.press, 1))
      gl.uniform1f(U.uCloseHot, closeHot)
      gl.uniform1f(U.uX, xA)
      gl.uniform1f(U.uTime, calm ? 0 : now / 1000)
      gl.uniform1fv(U.uVal, val)
      gl.uniform1fv(U.uHot, hot)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('webglcontextlost', onLost)
      // ponytail: do NOT loseContext() here. StrictMode runs the effect twice and
      // getContext returns the same (now dead) context, leaving a blank canvas.
    }
  }, [])

  return (
    <div
      className="fx"
      style={{ width: CW, height: CH, '--accent': FINISHES[finish].accent, '--fx-s': scale }}
    >
      <canvas ref={canvasRef} className="fx-canvas" style={{ width: CW, height: CH }} />

      <button
        type="button"
        className="fx-toggle"
        aria-expanded={fxOpen}
        aria-label={fxOpen ? 'Close effects' : 'Effects'}
        // A mouse click leaves the button focused, so the next Space press
        // re-activates it instead of play/pause. Blur on pointer clicks only
        // (e.detail is 0 for keyboard activation, which keeps its focus).
        onClick={(e) => {
          if (e.detail) e.currentTarget.blur()
          liveRef.current.press = 1
          actions.toggleFx()
        }}
        onPointerEnter={() => { liveRef.current.closeHot = 1 }}
        onPointerLeave={() => { liveRef.current.closeHot = 0 }}
        style={{ width: ORB, height: ORB, transform: 'translate(-50%, -50%)' }}
      />
    </div>
  )
}
