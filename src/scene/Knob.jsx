import { useMemo, useRef, useEffect } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useControls } from 'leva'
import { BODY_W, TOP_Y, PLATE_H, PLATE_Z } from './layout'
import { canvas, blotchCanvas, scratchCanvas, toTexture, memo } from './textures'
import { useStore, actions, getState } from '../state/store'

// Tempo knob — a deep flared cup on a tall barrel, machined from brushed
// aluminium, with a dark gunmetal bore floor sunk ~1cm below the rolled rim and
// a chunky anodised pointer rib crossing the bore and out through a notch.
//
// The whole body is ONE swept profile (lathe), so the barrel, the flare, the
// rolled rim, the inner wall and the bore lip all share continuous smooth
// normals — that is what makes the rim read as rolled rather than as a bevelled
// washer. The C-notch falls out of the lathe's phiStart/phiLength; the two cut
// faces are capped by triangulating the same profile polygon.
//
// Drag vertically for BPM; the angle springs between detents instead of lerping.

// The reference notch subtends ~0.49 rad at the rim and the pointer fills the
// top ~half of it, leaving a dark wedge underneath. Measured off ref-front.
const NOTCH = 0.48                  // notch opening, radians (centred on +x)
const BAR_Y = 0.14                  // pointer rides high in the notch
const BASE_Z = -0.32                // barrel bottom, buried in the chassis
const R_RIM = 1.64                  // widest point, on the rolled outer edge
const RIM_Z = 1.80                  // crown of the rim
const FLOOR_Z = 1.02                // bore floor — 0.82 below the crown
const R_FLOOR = 0.72
const R_WELL = 1.88                 // recess in the faceplate

const SWEEP = Math.PI * 0.9         // total travel across the 60..180 range
const DETENT = 3                    // BPM per click
// 96 BPM sits with the pointer horizontal, as in the reference.
const angleFor = (bpm) => -((bpm - 96) / 120) * SWEEP

// ---------------------------------------------------------------------------
// Profile. Traversed counter-clockwise in the (radius, height) plane starting
// at the bottom bore, so THREE.LatheGeometry's (dy, -dx) normal rule points
// outwards the whole way round. `s` is a shade multiplier baked to vertex
// colour: it does the ambient-occlusion job the renderer will not do for us —
// near-black down the barrel, hot on the rolled rim, falling away again down
// the inner wall so the cup self-shadows.
// ---------------------------------------------------------------------------
function buildProfile() {
  const p = []
  const put = (r, z, s) => p.push({ r, z, s })
  const line = (r0, z0, r1, z1, n, s0, s1) => {
    for (let i = 1; i <= n; i++) {
      const t = i / n
      put(r0 + (r1 - r0) * t, z0 + (z1 - z0) * t, s0 + (s1 - s0) * t)
    }
  }
  const arc = (cr, cz, rad, a0, a1, n, s0, s1) => {
    for (let i = 1; i <= n; i++) {
      const t = i / n
      const a = a0 + (a1 - a0) * t
      put(cr + Math.cos(a) * rad, cz + Math.sin(a) * rad, s0 + (s1 - s0) * t)
    }
  }
  const bez = (r0, z0, cr, cz, r1, z1, n, s0, s1) => {
    for (let i = 1; i <= n; i++) {
      const t = i / n
      const u = 1 - t
      put(u * u * r0 + 2 * u * t * cr + t * t * r1,
        u * u * z0 + 2 * u * t * cz + t * t * z1,
        s0 + (s1 - s0) * t)
    }
  }
  const D = Math.PI / 180

  put(0.66, BASE_Z, 0.08)                                   // bottom bore edge
  line(0.66, BASE_Z, 1.10, BASE_Z, 1, 0.08, 0.08)           // underside annulus
  arc(1.10, -0.20, 0.12, -90 * D, 0, 3, 0.08, 0.10)         // bottom chamfer
  line(1.22, -0.20, 1.26, 0.68, 8, 0.10, 0.36)              // barrel wall
  bez(1.26, 0.68, 1.33, 1.08, 1.4986, 1.4854, 9, 0.36, 0.78) // flare
  arc(1.48, 1.64, 0.16, -75 * D, 0, 6, 0.78, 1.00)          // rolled edge, outer
  arc(1.48, 1.64, 0.16, 0, 85 * D, 6, 1.00, 0.99)           // rolled edge, over the top
  line(1.494, 1.7994, 1.03, 1.79, 5, 0.99, 0.94)            // flat top flange
  arc(1.03, 1.69, 0.10, 90 * D, 180 * D, 4, 0.94, 0.44)     // inner lip, turning down
  bez(0.93, 1.69, 0.86, 1.40, 0.75, 1.08, 8, 0.44, 0.16)    // steep inner wall
  arc(0.75, 1.02, 0.03, 90 * D, 180 * D, 2, 0.16, 0.15)     // bore lip fillet
  line(0.72, 1.02, 0.66, BASE_Z, 3, 0.15, 0.08)             // inner barrel wall

  return p
}

const PROFILE = buildProfile()

// Flat faces closing the two ends of the sweep. The profile polygon is simple
// and closed, so an ear-clip triangulation of it is exactly the cut face.
function capsGeometry(profile, notch) {
  const pts = profile.map((q) => new THREE.Vector2(q.r, q.z))
  // shoelace: triangulateShape wants a consistent winding and we want to know
  // which way the fan faces before we pick a normal.
  let area = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    area += a.x * b.y - b.x * a.y
  }
  const ccw = area > 0
  const tris = THREE.ShapeUtils.triangulateShape(pts, [])

  const pos = []
  const nor = []
  const col = []
  const scratch = new THREE.Color()
  for (const side of [1, -1]) {
    const theta = (side * notch) / 2
    const c = Math.cos(theta)
    const s = Math.sin(theta)
    // u x w with u = (c, s, 0), w = (0, 0, 1)  ->  (s, -c, 0)
    const flip = side === 1 ? !ccw : ccw
    const nx = flip ? -s : s
    const ny = flip ? c : -c
    for (const f of tris) {
      const order = flip ? [f[2], f[1], f[0]] : f
      for (const i of order) {
        const q = profile[i]
        pos.push(q.r * c, q.r * s, q.z)
        nor.push(nx, ny, 0)
        scratch.setScalar(q.s)
        col.push(scratch.r, scratch.g, scratch.b)
      }
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  // the cut faces are tiny and only ever seen edge-on; a cheap planar UV keeps
  // the roughness/bump maps from sampling garbage.
  const uv = []
  for (let i = 0; i < pos.length / 3; i += 1) uv.push(pos[i * 3 + 2] * 0.3, pos[i * 3 + 2] * 0.3)
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  return g
}

function bodyGeometry(profile, notch) {
  // LatheGeometry sweeps around +Y from phi measured off +Z; we want it around
  // +Z with the notch centred on +X, hence the quarter turn on both.
  const g = new THREE.LatheGeometry(
    profile.map((q) => new THREE.Vector2(q.r, q.z)),
    96,
    Math.PI / 2 + notch / 2,
    Math.PI * 2 - notch,
  )
  g.rotateX(Math.PI / 2)
  // vertices run phi-major, profile-minor, so shade is a straight per-j lookup
  const n = profile.length
  const count = g.attributes.position.count
  const col = new Float32Array(count * 3)
  const c = new THREE.Color()
  for (let i = 0; i < count; i++) {
    c.setScalar(profile[i % n].s)
    col[i * 3] = c.r
    col[i * 3 + 1] = c.g
    col[i * 3 + 2] = c.b
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  return g
}

// The bore floor. Flat discs shade dead-flat under a key light, so the contact
// occlusion of the wall that overhangs it is baked into vertex colour: darker
// as it approaches the wall, and darker again toward the top where the lip
// leans over it. It lives outside the spinning group so the bake stays put.
function floorGeometry(radius, rings = 10, segs = 72) {
  const pos = [0, 0, 0]
  const nor = [0, 0, 1]
  const col = [1, 1, 1]
  const idx = []
  const ring = (r) => 1 + (r - 1) * segs
  const c = new THREE.Color()
  const shadeAt = (x, y, t) => {
    const edge = Math.max(0, (t - 0.12) / 0.88)
    return (1 - 0.52 * Math.pow(edge, 1.5)) * (1 - 0.30 * (y / radius + 1) * 0.5)
  }
  c.setScalar(shadeAt(0, 0, 0))
  col[0] = c.r; col[1] = c.g; col[2] = c.b
  for (let r = 1; r <= rings; r++) {
    const t = r / rings
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2
      const x = Math.cos(a) * radius * t
      const y = Math.sin(a) * radius * t
      pos.push(x, y, 0)
      nor.push(0, 0, 1)
      c.setScalar(shadeAt(x, y, t))
      col.push(c.r, c.g, c.b)
    }
  }
  for (let s = 0; s < segs; s++) idx.push(0, ring(1) + s, ring(1) + ((s + 1) % segs))
  for (let r = 1; r < rings; r++) {
    for (let s = 0; s < segs; s++) {
      const a = ring(r) + s
      const b = ring(r) + ((s + 1) % segs)
      const d = ring(r + 1) + s
      const e = ring(r + 1) + ((s + 1) % segs)
      idx.push(a, d, e, a, e, b)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  const uv = []
  for (let i = 0; i < pos.length / 3; i++) uv.push(pos[i * 3] * 0.4 + 0.5, pos[i * 3 + 1] * 0.4 + 0.5)
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  return g
}

// The pointer rib: a moulded bar with draft on its top face, sitting on the
// bore floor and passing out through the notch.
function pointerGeometry() {
  const g = new THREE.BoxGeometry(1.57, 0.40, 0.46, 1, 1, 1)
  const p = g.attributes.position
  for (let i = 0; i < p.count; i++) {
    if (p.getZ(i) > 0) p.setY(i, p.getY(i) * 0.74)   // draft angle on the sides
    if (p.getX(i) > 0) p.setY(i, p.getY(i) * 1.06)   // fractionally wider at the tip
  }
  g.computeVertexNormals()
  return g
}

// Circular machining marks. The lathe's UVs run u around the circumference and
// v along the profile, so horizontal streaks in canvas space become concentric
// tool marks on the metal. Used as the roughness map (streaky sheen) and, at a
// lower weight, the bump map (you can feel the grooves under a raking light).
function brushCanvas(size = 512) {
  const [c, g] = canvas(size)
  g.fillStyle = '#787878'
  g.fillRect(0, 0, size, size)
  for (let y = 0; y < size; y++) {
    // per-row tone drift + occasional deeper groove
    const deep = Math.random() < 0.06
    const v = 120 + (Math.random() - 0.5) * 70 + (deep ? -55 : 0)
    g.fillStyle = `rgba(${v},${v},${v},${deep ? 0.9 : 0.35 + Math.random() * 0.3})`
    g.fillRect(0, y, size, 1)
  }
  // broken segments so rows don't read as perfect rings
  for (let i = 0; i < 700; i++) {
    const y = Math.random() * size
    const w = size * (0.02 + Math.random() * 0.12)
    const v = 90 + Math.random() * 110
    g.fillStyle = `rgba(${v},${v},${v},${0.15 + Math.random() * 0.25})`
    g.fillRect(Math.random() * size, y, w, 1)
  }
  return c
}

// Albedo mottle for handled metal — faint warm/cool smudges and fingerprint
// grease over a near-white base, so the aluminium isn't one flat value.
function grimeCanvas(size = 512) {
  const [c, g] = canvas(size)
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, size, size)
  g.filter = `blur(${size * 0.05}px)`
  for (let i = 0; i < 46; i++) {
    const r = size * (0.05 + Math.random() * 0.18)
    g.fillStyle = Math.random() > 0.35
      ? `rgba(140,150,165,${0.04 + Math.random() * 0.08})`
      : `rgba(255,250,240,${0.06 + Math.random() * 0.10})`
    g.beginPath()
    g.ellipse(Math.random() * size, Math.random() * size, r, r * (0.5 + Math.random()),
      Math.random() * Math.PI, 0, Math.PI * 2)
    g.fill()
  }
  g.filter = 'none'
  return c
}

// Soft contact grime under the knob — grounds it even where the shadow map is
// too soft to bite.
function haloCanvas(size = 256) {
  const [c, g] = canvas(size)
  const r = size / 2
  g.fillStyle = '#000'
  g.fillRect(0, 0, size, size)
  const grd = g.createRadialGradient(r, r, r * 0.42, r, r, r)
  grd.addColorStop(0, '#ffffff')
  grd.addColorStop(0.45, '#5a5a5a')
  grd.addColorStop(1, '#000000')
  g.fillStyle = grd
  g.fillRect(0, 0, size, size)
  return c
}

export default function Knob() {
  const spin = useRef()
  const rock = useRef()
  const drag = useRef(null)
  const spring = useRef({ a: angleFor(getState().bpm), v: 0 })
  const wob = useRef({ a: 0, v: 0, grab: 0 })
  const bpm = useStore((s) => s.bpm)

  const { bodyColor, bodyRough, bodyMetal, bodyEnv, floorColor, floorRough } = useControls('Knob', {
    bodyColor: '#535960',
    bodyRough: { value: 1, min: 0, max: 1, step: 0.01 },
    bodyMetal: { value: 1, min: 0, max: 1, step: 0.01 },
    bodyEnv: { value: 0.3, min: 0, max: 2, step: 0.05 },
    floorColor: '#ffffff',
    floorRough: { value: 0.41, min: 0, max: 1, step: 0.01 },
  })

  const geo = useMemo(() => ({
    body: bodyGeometry(PROFILE, NOTCH),
    caps: capsGeometry(PROFILE, NOTCH),
    floor: floorGeometry(R_FLOOR - 0.02),
    pointer: pointerGeometry(),
  }), [])

  const tex = useMemo(() => ({
    // Concentric machining marks — streaky sheen along the turn direction.
    brush: memo('knob:brush', () => toTexture(brushCanvas(512), { aniso: 16 })),
    // Handling smudges layered over the brush for the broad roughness drift.
    rough: memo('knob:rough', () => toTexture(blotchCanvas(512, 60, 22, 1.1), { repeat: 1.2 })),
    scratch: memo('knob:scratch', () => toTexture(scratchCanvas(512, 90, 0.6), { repeat: 1.2 })),
    grime: memo('knob:grime', () => toTexture(grimeCanvas(512), { srgb: true, repeat: 1.3 })),
    halo: memo('knob:halo', () => {
      const t = toTexture(haloCanvas())
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
      return t
    }),
  }), [])

  // One material for body + caps so the cut faces are literally the same
  // surface as the sweep.
  const mat = useMemo(() => ({
    // Brushed aluminium. Anisotropy stretches the env reflections across the
    // turn direction (tangent = u = around the circumference), which is what
    // sells a machined finish; the brush map modulates it into streaks and the
    // baked vertex AO still darkens the barrel and the inside of the cup.
    body: new THREE.MeshPhysicalMaterial({
      color: bodyColor,
      map: tex.grime,
      metalness: bodyMetal,
      roughness: bodyRough,
      roughnessMap: tex.brush,
      anisotropy: 0.55,
      vertexColors: true,
      bumpMap: tex.brush,
      bumpScale: 0.004,
      envMapIntensity: bodyEnv,
    }),
    // polished steel pointer rib — the brightest thing in the cup, so it reads
    // against the dark bore floor at a glance
    pointer: new THREE.MeshStandardMaterial({
      color: '#e8eaee',
      metalness: 1.0,
      roughness: 0.42,
      roughnessMap: tex.rough,
      bumpMap: tex.scratch,
      bumpScale: 0.006,
      envMapIntensity: 0.9,
    }),
    // dark gunmetal bore floor, spun-finished, so the bright rim and pointer
    // read against it
    floor: new THREE.MeshPhysicalMaterial({
      color: floorColor,
      metalness: 1.0,
      roughness: floorRough,
      roughnessMap: tex.brush,
      anisotropy: 0.5,
      vertexColors: true,
      bumpMap: tex.brush,
      bumpScale: 0.003,
      envMapIntensity: 0.8,
    }),
  }), [tex, bodyColor, bodyRough, bodyMetal, bodyEnv, floorColor, floorRough])

  useEffect(() => () => { document.body.style.cursor = '' }, [])
  useEffect(() => () => {
    Object.values(geo).forEach((g) => g.dispose())
    Object.values(mat).forEach((m) => m.dispose())
  }, [geo, mat])

  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 30)

    // Stiff, slightly underdamped spring toward the nearest detent — each click
    // overshoots a hair and settles, which is what a real detented pot does.
    const s = spring.current
    const target = angleFor(Math.round(bpm / DETENT) * DETENT)
    s.v += ((target - s.a) * 300 - s.v * 21) * dt
    s.a += s.v * dt
    if (spin.current) spin.current.rotation.z = s.a

    // Wobble in the bushing: drag velocity kicks it, it springs back.
    const w = wob.current
    w.v += (-w.a * 220 - w.v * 12) * dt
    w.a += w.v * dt
    w.grab += ((drag.current ? 1 : 0) - w.grab) * Math.min(1, dt * 14)
    if (rock.current) {
      rock.current.rotation.x = w.a
      rock.current.rotation.y = w.a * 0.35
      rock.current.position.z = -0.06 * w.grab
    }

  })

  const hover = useRef(false)
  const cursor = () => {
    document.body.style.cursor = drag.current ? 'grabbing' : hover.current ? 'ns-resize' : ''
  }

  return (
    /* sits very slightly cocked in its well — nothing on this unit is square */
    <group
      position={[-BODY_W / 2 + 1.99, TOP_Y - PLATE_H / 2, PLATE_Z + 0.08]}
      rotation={[0.018, -0.024, 0]}
    >
      {/* grime halo on the faceplate. z clears the plate face across the whole
          plane: the group's cocked rotation tips the plane's far edge back by
          ~0.07 (half-width 2.35 x ~0.03 rad), so anything less z-fights. */}
      <mesh position={[0, 0, 0.09]}>
        <planeGeometry args={[R_WELL * 2.5, R_WELL * 2.5]} />
        <meshBasicMaterial color="#000" transparent alphaMap={tex.halo} opacity={0.55} depthWrite={false} />
      </mesh>

      {/* recessed well: sunk wall + a machined lip that catches the key light */}
      <mesh position={[0, 0, -0.06]} rotation={[Math.PI / 2, 0, 0]} receiveShadow>
        <cylinderGeometry args={[R_WELL, R_WELL, 0.34, 48, 1, true]} />
        <meshStandardMaterial color="#0a0a0d" roughness={0.75} metalness={0.5} side={THREE.BackSide} />
      </mesh>
      <mesh position={[0, 0, 0.05]} receiveShadow>
        <torusGeometry args={[R_WELL + 0.05, 0.07, 8, 56]} />
        <meshStandardMaterial color="#17171b" roughness={0.4} metalness={0.9} />
      </mesh>

      <group
        ref={rock}
        onPointerOver={(e) => { e.stopPropagation(); hover.current = true; cursor() }}
        onPointerOut={() => { hover.current = false; cursor() }}
        onPointerDown={(e) => {
          e.stopPropagation()
          e.target.setPointerCapture(e.pointerId)
          drag.current = { y: e.clientY, bpm: getState().bpm }
          wob.current.v += 0.9      // it rocks when you take hold of it
          cursor()
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          e.stopPropagation()
          const dy = d.y - e.clientY
          actions.setBpm(d.bpm + dy * (e.shiftKey ? 0.07 : 0.3))
          wob.current.v += THREE.MathUtils.clamp((e.movementY || 0) * 0.012, -0.3, 0.3)
        }}
        onPointerUp={(e) => {
          if (!drag.current) return
          drag.current = null
          e.target.releasePointerCapture?.(e.pointerId)
          wob.current.v -= 0.6
          cursor()
        }}
      >
        {/* dark bushing where the barrel enters the well */}
        <mesh position={[0, 0, 0.0]} rotation={[Math.PI / 2, 0, 0]} receiveShadow>
          <cylinderGeometry args={[1.34, 1.30, 0.36, 40]} />
          <meshStandardMaterial color="#241413" roughness={0.62} metalness={0.3} />
        </mesh>

        {/* gunmetal bore floor, sunk 0.82 below the crown — outside the spin group
            so its baked contact occlusion does not rotate */}
        <mesh position={[0, 0, FLOOR_Z - 0.006]} geometry={geo.floor} material={mat.floor} />

        <group ref={spin}>
          {/* swept body: barrel -> flare -> rolled rim -> inner wall -> bore lip */}
          <mesh geometry={geo.body} castShadow receiveShadow material={mat.body} />
          <mesh geometry={geo.caps} castShadow receiveShadow material={mat.body} />

          {/* pointer rib, sitting on the bore floor and out through the notch.
              It does not cast: at this scale the shadow map only produces a
              stair-stepped black wedge on the floor. */}
          {/* <mesh
            position={[0.735, BAR_Y, FLOOR_Z + 0.23]}
            geometry={geo.pointer}
            material={mat.pointer}
            receiveShadow
          /> */}
        </group>
      </group>
    </group>
  )
}

export { R_RIM, RIM_Z }
