import { useMemo } from 'react'
import * as THREE from 'three'
import { BODY_W, KEYS_W, TOP_Y, PLATE_Z, KEYS_TOP_Y } from './layout'
import { canvas, toTexture, memo } from './textures'

// Antenna, coiled cable, decals, debris — the wear and ownership layer.
// Everything below derives its position from layout.js constants (plus small
// hand-placed offsets, same pattern Knob.jsx/Screen.jsx use) so it stays
// attached to the plate edges if the body is resized.

// ---------------------------------------------------------------------------
// Antenna: telescoping segments (wide at base, narrow at tip), a joint collar
// between each, a tip bead, and a rubber grommet where it meets the plate.
const ANTENNA_BASE = new THREE.Vector3(BODY_W / 2 - 0.15, TOP_Y + 0.05, PLATE_Z + 0.35)
// Radii scaled ~2.5x from the original pass — at 12-17px on a 2000px frame
// the rod read as a scratch on the lens rather than metal.
const ANTENNA_SCALE = 2.5
const ANTENNA_SEGMENTS = [
  { len: 1.75, rB: 0.135 * ANTENNA_SCALE, rT: 0.115 * ANTENNA_SCALE },
  { len: 1.5, rB: 0.1 * ANTENNA_SCALE, rT: 0.085 * ANTENNA_SCALE },
  { len: 1.3, rB: 0.075 * ANTENNA_SCALE, rT: 0.062 * ANTENNA_SCALE },
  { len: 1.05, rB: 0.052 * ANTENNA_SCALE, rT: 0.042 * ANTENNA_SCALE },
]
const JOINT_LEN = 0.1

function Antenna() {
  const rodMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#75767c', roughness: 0.32, metalness: 0.92 }), [])
  const jointMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2b2c30', roughness: 0.5, metalness: 0.8 }), [])
  const rubberMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#141416', roughness: 0.85, metalness: 0.05 }), [])

  let y = 0
  const parts = []
  ANTENNA_SEGMENTS.forEach((s, i) => {
    const cy = y + s.len / 2
    parts.push(
      <mesh key={`seg${i}`} position={[0, cy, 0]} material={rodMat} castShadow>
        <cylinderGeometry args={[s.rT, s.rB, s.len, 10]} />
      </mesh>,
    )
    y += s.len
    if (i < ANTENNA_SEGMENTS.length - 1) {
      const nextR = ANTENNA_SEGMENTS[i + 1].rB
      parts.push(
        <mesh key={`joint${i}`} position={[0, y + JOINT_LEN / 2, 0]} material={jointMat} castShadow>
          <cylinderGeometry args={[nextR * 1.35, nextR * 1.35, JOINT_LEN, 10]} />
        </mesh>,
      )
      y += JOINT_LEN
    }
  })

  return (
    <group position={ANTENNA_BASE} rotation={[-0.04, 0, -0.07]}>
      {/* base grommet, sits flush on the plate */}
      <mesh position={[0, -0.01, 0]} rotation={[Math.PI / 2, 0, 0]} material={rubberMat} castShadow>
        <torusGeometry args={[0.19 * ANTENNA_SCALE * 0.7, 0.075 * ANTENNA_SCALE * 0.7, 8, 20]} />
      </mesh>
      {parts}
      {/* tip bead */}
      <mesh position={[0, y + 0.07 * ANTENNA_SCALE, 0]} material={rodMat} castShadow>
        <sphereGeometry args={[0.075 * ANTENNA_SCALE, 12, 10]} />
      </mesh>
    </group>
  )
}

// ---------------------------------------------------------------------------
// Cable: a socket boss plugged into the top edge, a short strain-relief boot,
// then a coil that runs along the plate's top edge so it silhouettes against
// the faceplate and its lit top bevel instead of the void behind it.
const SOCKET = new THREE.Vector3(BODY_W / 2 - 3.4, TOP_Y - 0.15, PLATE_Z - 0.1)
const COIL_END = new THREE.Vector3(BODY_W / 2 + 0.4, TOP_Y + 1.4, PLATE_Z - 0.9)
const COIL_TURNS = 19
const COIL_SAMPLES_PER_TURN = 24
const COIL_SAMPLES = Math.round(COIL_TURNS * COIL_SAMPLES_PER_TURN)
const WIRE_R = 0.11

function buildCoilPoints() {
  const bootTop = SOCKET.clone().add(new THREE.Vector3(0, 0.55, 0))
  const axis = COIL_END.clone().sub(bootTop)
  const axisLen = axis.length()
  const dir = axis.clone().normalize()
  // Stable orthonormal basis perpendicular to the axis, so the helix radius
  // is measured in the plane truly perpendicular to travel (the axis here
  // runs diagonally, not just up +y, so we can't cheat with world x/z).
  const ref = Math.abs(dir.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
  const u = new THREE.Vector3().crossVectors(ref, dir).normalize()
  const v = new THREE.Vector3().crossVectors(dir, u).normalize()

  const pts = []
  for (let i = 0; i <= COIL_SAMPLES; i++) {
    const t = i / COIL_SAMPLES
    const p = bootTop.clone().addScaledVector(dir, axisLen * t)
    const ang = t * Math.PI * 2 * COIL_TURNS
    const rad = THREE.MathUtils.lerp(0.65, 0.55, t)
    p.addScaledVector(u, Math.cos(ang) * rad)
    p.addScaledVector(v, Math.sin(ang) * rad)
    pts.push(p)
  }
  return pts
}

function Cable() {
  const cableMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2a2a30', roughness: 0.08, metalness: 0.85 }), [])
  const socketMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#0c0c0e', roughness: 0.6, metalness: 0.3 }), [])

  const coilGeo = useMemo(() => {
    const pts = buildCoilPoints()
    const curve = new THREE.CatmullRomCurve3(pts)
    return new THREE.TubeGeometry(curve, pts.length, WIRE_R, 12, false)
  }, [])

  return (
    <group>
      {/* socket boss on the chassis edge */}
      <mesh position={[SOCKET.x, SOCKET.y + 0.11, SOCKET.z]} material={socketMat} castShadow>
        <cylinderGeometry args={[0.15, 0.17, 0.22, 16]} />
      </mesh>
      <mesh position={[SOCKET.x, SOCKET.y + 0.02, SOCKET.z]} rotation={[Math.PI / 2, 0, 0]} material={socketMat}>
        <cylinderGeometry args={[0.22, 0.22, 0.05, 20]} />
      </mesh>
      {/* strain-relief boot */}
      <mesh position={[SOCKET.x, SOCKET.y + 0.4, SOCKET.z]} material={cableMat} castShadow>
        <cylinderGeometry args={[0.09, 0.15, 0.55, 12]} />
      </mesh>
      <mesh geometry={coilGeo} material={cableMat} castShadow />
    </group>
  )
}

// ---------------------------------------------------------------------------
// Decals: peeling sticker planes with procedural canvas art and a soft
// contact shadow under the lifted corner.
function softCircleCanvas(size = 128) {
  const [c, g] = canvas(size)
  const r = size / 2
  const grad = g.createRadialGradient(r, r, 0, r, r, r)
  grad.addColorStop(0, 'rgba(0,0,0,0.55)')
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, size, size)
  return c
}

function foilFill(g, N, x = 0, y = 0, w = N, h = N) {
  const foil = g.createLinearGradient(x, y + h, x + w, y)
  foil.addColorStop(0, '#55f6ff')
  foil.addColorStop(0.18, '#7a7dff')
  foil.addColorStop(0.36, '#ff6be1')
  foil.addColorStop(0.53, '#ffcf66')
  foil.addColorStop(0.7, '#77ffb1')
  foil.addColorStop(0.86, '#79a7ff')
  foil.addColorStop(1, '#f5a7ff')
  g.fillStyle = foil
  g.fillRect(x, y, w, h)

  // Fine diffraction bands keep the foil lively even in the fixed front view.
  g.save()
  g.globalCompositeOperation = 'screen'
  g.lineWidth = N * 0.012
  for (let i = -8; i < 18; i++) {
    g.strokeStyle = i % 3 === 0 ? 'rgba(255,255,255,0.34)' : 'rgba(125,255,235,0.15)'
    g.beginPath()
    g.moveTo(x + i * N * 0.09, y + h)
    g.lineTo(x + i * N * 0.09 + N * 0.7, y)
    g.stroke()
  }
  const flash = g.createRadialGradient(x + w * 0.28, y + h * 0.18, 0, x + w * 0.28, y + h * 0.18, w * 0.45)
  flash.addColorStop(0, 'rgba(255,255,255,0.78)')
  flash.addColorStop(0.18, 'rgba(255,255,255,0.18)')
  flash.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = flash
  g.fillRect(x, y, w, h)
  g.restore()
}

function drawBoltBadge(g, N) {
  g.clearRect(0, 0, N, N)
  const x = N * 0.055, y = N * 0.1, w = N * 0.89, h = N * 0.8
  g.save()
  g.beginPath()
  g.roundRect(x, y, w, h, N * 0.15)
  g.clip()
  foilFill(g, N, x, y, w, h)

  g.fillStyle = 'rgba(8,7,16,0.88)'
  g.beginPath()
  g.roundRect(N * 0.12, N * 0.17, N * 0.76, N * 0.66, N * 0.1)
  g.fill()

  // An oversized bolt with a hot foil keyline.
  g.beginPath()
  g.moveTo(N * 0.53, N * 0.2)
  g.lineTo(N * 0.31, N * 0.51)
  g.lineTo(N * 0.48, N * 0.51)
  g.lineTo(N * 0.39, N * 0.79)
  g.lineTo(N * 0.71, N * 0.42)
  g.lineTo(N * 0.54, N * 0.42)
  g.lineTo(N * 0.66, N * 0.2)
  g.closePath()
  const bolt = g.createLinearGradient(N * 0.35, N * 0.7, N * 0.7, N * 0.25)
  bolt.addColorStop(0, '#61fff2')
  bolt.addColorStop(0.5, '#ffffff')
  bolt.addColorStop(1, '#ff77dd')
  g.fillStyle = bolt
  g.fill()
  g.strokeStyle = 'rgba(255,255,255,0.9)'
  g.lineWidth = N * 0.014
  g.stroke()
  g.restore()

  g.strokeStyle = 'rgba(255,255,255,0.88)'
  g.lineWidth = N * 0.014
  g.beginPath()
  g.roundRect(x, y, w, h, N * 0.15)
  g.stroke()
}

function drawBeatPass(g, N) {
  g.clearRect(0, 0, N, N)
  const x = N * 0.025, y = N * 0.13, w = N * 0.95, h = N * 0.74
  g.save()
  g.beginPath()
  g.roundRect(x, y, w, h, N * 0.065)
  g.clip()
  foilFill(g, N, x, y, w, h)

  g.fillStyle = 'rgba(8,7,14,0.82)'
  g.beginPath()
  g.roundRect(N * 0.065, N * 0.2, N * 0.87, N * 0.6, N * 0.04)
  g.fill()

  g.textBaseline = 'top'
  g.fillStyle = '#f8fbff'
  g.font = `900 ${N * 0.14}px Arial Black, sans-serif`
  g.fillText('BEAT UNIT', N * 0.1, N * 0.235, N * 0.69)
  g.fillStyle = '#84fff1'
  g.font = `700 ${N * 0.06}px Menlo, monospace`
  g.fillText('LIVE LOOP // 096', N * 0.105, N * 0.455)

  g.fillStyle = '#ff74dc'
  g.beginPath()
  g.arc(N * 0.82, N * 0.57, N * 0.075, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#08070e'
  g.font = `900 ${N * 0.065}px Arial, sans-serif`
  g.textAlign = 'center'
  g.fillText('96', N * 0.82, N * 0.535)
  g.textAlign = 'left'

  g.fillStyle = 'rgba(255,255,255,0.7)'
  for (let i = 0; i < 17; i++) {
    const bw = N * (i % 4 === 0 ? 0.012 : 0.006)
    g.fillRect(N * 0.105 + i * N * 0.02, N * 0.63, bw, N * 0.095)
  }
  g.restore()

  g.strokeStyle = 'rgba(255,255,255,0.9)'
  g.lineWidth = N * 0.012
  g.beginPath()
  g.roundRect(x, y, w, h, N * 0.065)
  g.stroke()
}

function drawFoilSmiley(g, N) {
  g.clearRect(0, 0, N, N)
  const cx = N / 2, cy = N / 2, r = N * 0.43
  g.save()
  g.beginPath()
  g.arc(cx, cy, r, 0, Math.PI * 2)
  g.clip()
  foilFill(g, N)

  g.fillStyle = 'rgba(255,255,255,0.18)'
  g.beginPath()
  g.arc(cx - r * 0.25, cy - r * 0.3, r * 0.68, 0, Math.PI * 2)
  g.fill()
  g.restore()

  g.fillStyle = '#0b0912'
  g.beginPath()
  g.ellipse(cx - r * 0.31, cy - r * 0.13, r * 0.11, r * 0.16, -0.15, 0, Math.PI * 2)
  g.fill()

  // A star eye makes this feel like a collected sticker rather than emoji art.
  g.save()
  g.translate(cx + r * 0.31, cy - r * 0.13)
  g.rotate(Math.PI / 4)
  g.fillRect(-r * 0.05, -r * 0.17, r * 0.1, r * 0.34)
  g.fillRect(-r * 0.17, -r * 0.05, r * 0.34, r * 0.1)
  g.restore()

  g.strokeStyle = '#0b0912'
  g.lineWidth = r * 0.11
  g.lineCap = 'round'
  g.beginPath()
  g.arc(cx, cy + r * 0.06, r * 0.47, 0.14 * Math.PI, 0.86 * Math.PI)
  g.stroke()

  g.strokeStyle = 'rgba(255,255,255,0.95)'
  g.lineWidth = N * 0.018
  g.beginPath()
  g.arc(cx, cy, r, 0, Math.PI * 2)
  g.stroke()
}

// Peeled-corner plane: lifts + curls the geometry toward one corner so the
// sticker reads as half-unstuck rather than painted on.
function peelPlane(w, h, cornerX, cornerY, amount, segs = 8) {
  const geo = new THREE.PlaneGeometry(w, h, segs, segs)
  const pos = geo.attributes.position
  const cx = cornerX * w * 0.5
  const cy = cornerY * h * 0.5
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i)
    const dx = (x - cx) / w
    const dy = (y - cy) / h
    const d = Math.max(0, 1 - Math.min(1, Math.hypot(dx, dy) * 1.4))
    const lift = Math.pow(d, 2.4) * amount
    pos.setZ(i, lift)
    pos.setX(i, x + (cx - x) * lift * 0.4)
    pos.setY(i, y + (cy - y) * lift * 0.4)
  }
  geo.computeVertexNormals()
  return geo
}

function Sticker({
  w,
  h,
  position,
  rotation = 0,
  cornerX = 1,
  cornerY = 1,
  peel = 0.11,
  texture,
  foil = false,
  castShadow = true,
  renderOrder = 0,
}) {
  const geo = useMemo(() => peelPlane(w, h, cornerX, cornerY, peel), [w, h, cornerX, cornerY, peel])
  const shadowTex = useMemo(() => memo('props:softShadow', () => toTexture(softCircleCanvas(128))), [])
  const shadowSize = Math.max(w, h) * 0.85

  return (
    <group position={position} rotation={[0, 0, rotation]}>
      <mesh
        position={[cornerX * w * 0.24, cornerY * h * 0.24, -0.01]}
        renderOrder={-1}
      >
        <planeGeometry args={[shadowSize, shadowSize]} />
        <meshBasicMaterial map={shadowTex} transparent depthWrite={false} opacity={0.5} />
      </mesh>
      <mesh geometry={geo} castShadow={castShadow} renderOrder={renderOrder}>
        {foil ? (
          <meshPhysicalMaterial
            map={texture}
            transparent
            alphaTest={0.025}
            roughness={0.2}
            metalness={0.68}
            clearcoat={1}
            clearcoatRoughness={0.08}
            iridescence={1}
            iridescenceIOR={1.7}
            iridescenceThicknessRange={[180, 920]}
            envMapIntensity={1.8}
            emissiveMap={texture}
            emissive="#241b32"
            emissiveIntensity={0.16}
            side={THREE.DoubleSide}
            polygonOffset
            polygonOffsetFactor={-1}
          />
        ) : (
          <meshStandardMaterial
            map={texture}
            transparent
            roughness={0.5}
            metalness={0.04}
            side={THREE.DoubleSide}
            polygonOffset
            polygonOffsetFactor={-1}
          />
        )}
      </mesh>
    </group>
  )
}

function Decals() {
  const boltTex = useMemo(
    () => memo('props:foil-bolt-v2', () => toTexture(((c) => { drawBoltBadge(c.getContext('2d'), 512); return c })(canvas(512)[0]), { srgb: true })),
    [],
  )
  const passTex = useMemo(
    () => memo('props:foil-pass-v2', () => toTexture(((c) => { drawBeatPass(c.getContext('2d'), 512); return c })(canvas(512)[0]), { srgb: true })),
    [],
  )
  const smileyTex = useMemo(
    () => memo('props:foil-smiley-v2', () => toTexture(((c) => { drawFoilSmiley(c.getContext('2d'), 512); return c })(canvas(512)[0]), { srgb: true })),
    [],
  )

  return (
    <group>
      <Sticker
        w={0.82} h={0.82}
        position={[-0.78, 6.14, PLATE_Z + 0.14]}
        rotation={-0.16}
        cornerX={-1} cornerY={1}
        peel={0.09}
        texture={smileyTex}
        foil
      />
      <Sticker
        w={1.25} h={0.94}
        position={[0.38, 6.22, PLATE_Z + 0.15]}
        rotation={0.07}
        cornerX={1} cornerY={-1}
        peel={0.14}
        texture={boltTex}
        foil
      />
      <Sticker
        w={2.25} h={0.92}
        position={[2.55, 6.1, PLATE_Z + 0.14]}
        rotation={-0.045}
        cornerX={-1} cornerY={1}
        peel={0.12}
        texture={passTex}
        foil
      />
    </group>
  )
}

// ---------------------------------------------------------------------------
// Dust and specks: instanced so it's one draw call regardless of count.
// Scattered along the plate's lower strip and outer edges — away from the
// knob/screen without needing to know their internal layout.
function buildDustMesh() {
  const geo = new THREE.CircleGeometry(1, 6)
  const mat = new THREE.MeshStandardMaterial({
    color: '#050505', roughness: 1, metalness: 0, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
  })
  const N = 44
  const inst = new THREE.InstancedMesh(geo, mat, N)
  const dummy = new THREE.Object3D()
  const color = new THREE.Color()

  for (let i = 0; i < N; i++) {
    let x, y
    if (Math.random() < 0.4) {
      // open strip low-left of the knob, clear of the screen
      x = THREE.MathUtils.lerp(-KEYS_W / 2 + 0.2, -1.3, Math.random())
      y = THREE.MathUtils.lerp(KEYS_TOP_Y + 0.15, KEYS_TOP_Y + 0.5, Math.random())
    } else {
      // outer left/right edge margins, full plate height
      const side = Math.random() < 0.5 ? -1 : 1
      x = side * THREE.MathUtils.lerp(BODY_W / 2 - 0.5, BODY_W / 2 - 0.15, Math.random())
      y = THREE.MathUtils.lerp(KEYS_TOP_Y + 0.15, TOP_Y - 0.15, Math.random())
    }
    const s = 0.02 + Math.random() * 0.05
    dummy.position.set(x, y, PLATE_Z + 0.015)
    dummy.rotation.set(0, 0, Math.random() * Math.PI)
    dummy.scale.setScalar(s)
    dummy.updateMatrix()
    inst.setMatrixAt(i, dummy.matrix)
    color.set(Math.random() > 0.5 ? '#050505' : '#403c36')
    inst.setColorAt(i, color)
  }
  inst.instanceMatrix.needsUpdate = true
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true
  return inst
}

function Dust() {
  const inst = useMemo(() => buildDustMesh(), [])
  return <primitive object={inst} />
}

export default function Props() {
  return (
    <group>
      <Antenna />
      <Cable />
      <Decals />
      <Dust />
    </group>
  )
}
