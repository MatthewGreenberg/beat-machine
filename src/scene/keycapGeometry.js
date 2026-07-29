import * as THREE from 'three'
import { PITCH, GAP } from './layout.js'

// A keycap is a lofted superellipse: rounded-square rings stacked up a nearly
// vertical wall, a wide straight CHAMFER where the wall turns over, and a
// spherically dished top face. Three things make it read as a *sculpted* cap
// rather than a slab:
//
//  1. the chamfer is the whole show. It is a flat facet roughly 0.12 wide
//     over a ~0.08 drop, i.e. about 34 degrees off horizontal, which is where
//     the key light lives: at that angle the band beats the flat face on both
//     N.L and N.H, so it is the brightest feature on the cap, exactly as in the
//     reference. A true 45-degree chamfer measured *dimmer* — steeper than the
//     key buys silhouette drama at the cost of the highlight, and the highlight
//     is the point;
//  2. its two ends are HARD. The ring at the face rim and the ring at the
//     chamfer/wall junction are duplicated, so `computeVertexNormals` never
//     averages across them and you get two razor creases instead of one soft
//     roll. That crease line is what draws the rim in the reference;
//  3. the plan-view outline is a *square* (superellipse exponent ~8 at the base,
//     ~7 at the rim). All of the roundness lives in the chamfer radius, not in
//     the outline — round the outline as well and adjacent caps stop welding
//     into a mosaic and start floating as separate soap bars.
//
// The wall gets only a sliver of the taper (`taperK`), because in a top-down
// view the wall is the dark moat between caps: every unit of wall inset is a
// unit of black seam. Pushing that inset into the chamfer instead trades moat
// for highlight.
//
// Rows differ: the top modifier row is low and flat, the front rows are tall and
// deeply dished. `profile` picks the sculpt; when omitted it is inferred from
// `height`, which is how the consumers already distinguish their rows.

const SEG = 96            // points around one ring
const P_BASE = 8.0        // superellipse exponent at the base — a soft square

export const CAP_PROFILES = {
  // wallPow  >1 pushes the taper up the wall (straighter skirt, sharper shoulder)
  // taperK   share of `taper` the vertical wall is allowed to eat
  // dishK    multiplier on the requested scoop depth
  // bevelK   chamfer height (the z drop), as a multiple of `bevel`
  // chamferK chamfer WIDTH (the lateral inset), as a multiple of `bevel`.
  //          chamferK ~= bevelK is a 45° facet, which is what faces the key.
  // pTop     superellipse exponent at the top rim — lower = rounder corners
  deep: { wallPow: 1.9, taperK: 0.30, dishK: 1.25, bevelK: 0.70, chamferK: 1.05, pTop: 7.0 },
  flat: { wallPow: 1.6, taperK: 0.32, dishK: 1.05, bevelK: 0.66, chamferK: 1.00, pTop: 7.2 },
  slab: { wallPow: 1.4, taperK: 0.30, dishK: 0.60, bevelK: 0.62, chamferK: 0.96, pTop: 7.4 },
}

const profileFor = (height) => (height >= 0.98 ? 'deep' : height >= 0.9 ? 'slab' : 'flat')

// Where the two creases land in the planar (top-down) uv, as a fraction of the
// footprint measured in from the outer edge. `capMaterials` paints against these
// so the wall shading stops dead at the chamfer instead of fogging it.
export function capUVInsets({
  width = PITCH - GAP,
  taper = 0.14,
  bevel = 0.11,
  height = 1.05,
  profile,
} = {}) {
  const P = CAP_PROFILES[profile] ?? CAP_PROFILES[profileFor(height)]
  const wall = taper * P.taperK
  const chamfer = bevel * P.chamferK
  return { wall: wall / width, face: (wall + chamfer) / width, chamfer: chamfer / width }
}

// The standard 1u cap `Keycap.jsx` builds. One set of numbers, two files.
export const CAP_UV = capUVInsets()

// Deterministic noise so the same cap looks identical on every reload — worn,
// but not randomly worn per refresh.
function mulberry(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Silhouette irregularity: a slow wobble (mould shrink) plus a few discrete
// nicks (dropped on a desk once too often). Indexed per ring point.
function wobbleTable(rand) {
  const w = new Float32Array(SEG)
  const waves = [
    [2, 0.0016], [3, 0.0013], [5, 0.0009], [8, 0.0006],
  ]
  for (const [k, amp] of waves) {
    const ph = rand() * Math.PI * 2
    for (let i = 0; i < SEG; i++) w[i] += Math.sin((i / SEG) * Math.PI * 2 * k + ph) * amp
  }
  for (let n = 0; n < 3; n++) {
    const c = Math.floor(rand() * SEG)
    const width = 1.6 + rand() * 2.2
    const depth = 0.006 + rand() * 0.009
    for (let i = 0; i < SEG; i++) {
      let d = Math.abs(i - c)
      d = Math.min(d, SEG - d)
      w[i] -= depth * Math.exp(-(d * d) / (width * width))
    }
  }
  return w
}

// The plan-view outline at one height: a superellipse, wobbled.
//
// It is NOT sampled at even angles. A superellipse in the |cos a|^(2/p) form is
// wildly non-uniform in a: at p=8 the step out of a=0 already throws the point
// halfway up the straight side, so of 72 ring points barely a dozen land on the
// four corners and neighbours there end up 0.0014 apart — slivers whose face
// normals are numerical noise. computeVertexNormals averages that noise in and
// every cap fires four hard white specular dots at its corners. (The old p=5.4
// build had the same defect, just quieter.)
//
// So: sample densely by angle, then resample SEG points by a measure that mixes
// arc length with turning. Arc length alone starves the corners — they are ~20%
// of the perimeter but carry all the curvature — and pure turning starves the
// straight sides. The chord error of the dense polyline is nil where it takes
// long steps, because that is exactly where the curve is straight.
const TURN_BIAS = 0.45
const DENSE = SEG * 12

// Pull a dense outline inward by `d` along its own normal — a true offset curve,
// not a scale. Shrinking hw/hh instead moves the corner of a superellipse inward
// by only ~0.9*d per axis, so the diagonal offset comes out ~1.3x the offset at
// the edge midpoints: the chamfer would be a third wider, and a third shallower,
// at the four corners than along the sides. An offset curve holds one chamfer
// width the whole way round, so the highlight is one continuous ridge.
//
// Where d exceeds the corner radius the offset folds back on itself; those
// points are dropped rather than left to knot the ring.
function offsetIn(dx, dy, d) {
  const ox = []
  const oy = []
  for (let i = 0; i < DENSE; i++) {
    const a = (i + DENSE - 1) % DENSE
    const b = (i + 1) % DENSE
    const tx = dx[b] - dx[a]
    const ty = dy[b] - dy[a]
    const L = Math.hypot(tx, ty) || 1
    const px = dx[i] - (ty / L) * d
    const py = dy[i] + (tx / L) * d
    const n = ox.length
    if (n >= 2) {
      // reject a step that reverses direction against the source curve
      const ex = px - ox[n - 1]
      const ey = py - oy[n - 1]
      if (ex * tx + ey * ty < 0) continue
    }
    ox.push(px)
    oy.push(py)
  }
  return [ox, oy]
}

// Resample a closed polyline to SEG points, spaced by a measure that mixes arc
// length with turning. Arc length alone starves the corners — they are ~20% of
// the perimeter but carry all of the curvature — and pure angle (which is what
// the |cos a|^(2/p) form gives you for free) starves the straight sides so badly
// that at p=8 neighbouring ring points land 0.0014 apart. Those slivers have
// junk face normals, computeVertexNormals averages the junk in, and every cap
// fires four hard white specular dots at its corners. That was a real bug in the
// p=5.4 build too; raising the exponent only made it obvious.
function resample(px, py, wob, wk) {
  const N = px.length
  const cum = new Float64Array(N + 1)
  let ext = 0
  for (let i = 0; i < N; i++) ext = Math.max(ext, Math.abs(px[i]), Math.abs(py[i]))
  const scale = TURN_BIAS * ext
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N
    const k = (i + 2) % N
    const ax = px[j] - px[i]
    const ay = py[j] - py[i]
    const bx = px[k] - px[j]
    const by = py[k] - py[j]
    const turn = Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by))
    cum[i + 1] = cum[i] + Math.hypot(ax, ay) + turn * scale
  }
  const total = cum[N]
  const out = new Float64Array(SEG * 2)
  let k = 0
  for (let i = 0; i < SEG; i++) {
    const target = (i / SEG) * total
    while (k < N - 1 && cum[k + 1] < target) k++
    const span = cum[k + 1] - cum[k] || 1
    const f = Math.min(1, (target - cum[k]) / span)
    const j = (k + 1) % N
    const s = 1 + (wob ? wob[i] * wk : 0)
    out[i * 2] = (px[k] + (px[j] - px[k]) * f) * s
    out[i * 2 + 1] = (py[k] + (py[j] - py[k]) * f) * s
  }
  return out
}

// The plan-view outline at one height: a superellipse, offset inward by `d`,
// evenly resampled, wobbled. The dense intermediate is sampled by angle — its
// long steps land where the curve is dead straight, so the chord error is nil.
function outline(hw, hh, p, d, wob, wk) {
  const e = 2 / p
  const dx = new Float64Array(DENSE)
  const dy = new Float64Array(DENSE)
  for (let i = 0; i < DENSE; i++) {
    const a = (i / DENSE) * Math.PI * 2
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    dx[i] = hw * Math.sign(ca) * Math.abs(ca) ** e
    dy[i] = hh * Math.sign(sa) * Math.abs(sa) ** e
  }
  const [ox, oy] = d ? offsetIn(dx, dy, d) : [dx, dy]
  return resample(ox, oy, wob, wk)
}

function emit(pos, uvs, pts, k, z, v, sag, sw = 0) {
  for (let i = 0; i < SEG; i++) {
    const x = pts[i * 2] * k
    const y = pts[i * 2 + 1] * k
    pos.push(x, y, sag ? z - sag(x, y) * sw : z)
    uvs.push(i / SEG, v)
  }
}

const smooth = (t) => t * t * (3 - 2 * t)

export function makeKeycapGeometry({
  width = PITCH - GAP,
  depth = PITCH - GAP,
  height = 1.05,
  taper = 0.14,        // inset budget for the wall (the profile takes a share)
  dish = 0.09,         // concave scoop depth at the centre of the top
  bevel = 0.11,        // scale of the chamfer between the face and the wall
  profile,             // 'deep' | 'flat' | 'slab' — inferred from height if unset
  seed = 7,
} = {}) {
  const P = CAP_PROFILES[profile] ?? CAP_PROFILES[profileFor(height)]
  const pos = []
  const uvs = []
  const hw = width / 2
  const hh = depth / 2
  const rand = mulberry(seed + Math.round(width * 977) + Math.round(depth * 131))
  const wob = wobbleTable(rand)

  const wallIn = taper * P.taperK           // total inset the vertical wall eats
  const chamZ = bevel * P.bevelK            // chamfer height (z drop)
  const chamX = bevel * P.chamferK          // chamfer width (lateral inset)
  const dishD = dish * P.dishK
  const zShoulder = height - chamZ
  // exponent blends squarer base -> square-ish rim over the cap height
  const expAt = (z) => P_BASE + (P.pTop - P_BASE) * smooth(Math.min(1, z / height))

  // Rings are pushed through `addRing` so a ring can be emitted twice at the
  // same place with `bridge:false` between the copies. That duplication is the
  // whole trick: each copy is referenced by only one strip, so
  // computeVertexNormals gives it that strip's normal and the junction stays a
  // crease instead of rolling.
  const ringStart = []
  const bridged = []
  const addRing = (pts, k, z, v, sagFn, sw, bridge = true) => {
    if (ringStart.length) bridged[ringStart.length - 1] = bridge
    ringStart.push(pos.length / 3)
    emit(pos, uvs, pts, k, z, v, sagFn, sw)
  }

  // --- closed bottom (own vertices so the base edge stays crisp) -------------
  const bottomStart = pos.length / 3
  emit(pos, uvs, outline(hw, hh, P_BASE, 0, null, 0), 1, 0, 0)
  const bottomCentre = pos.length / 3
  pos.push(0, 0, 0)
  uvs.push(0.5, 0)

  // --- wall: nearly vertical, what little inset there is happens up top ------
  const WALL = [0, 0.14, 0.32, 0.52, 0.72, 0.87, 1]
  for (const u of WALL) {
    const z = u * zShoulder
    addRing(outline(hw, hh, expAt(z), wallIn * u ** P.wallPow, wob, smooth(u) * 0.55),
      1, z, u * 0.72)
  }

  // --- dish -----------------------------------------------------------------
  // Sag is quadratic in (x,y), not a function of the ring index. Scaling each
  // ring by a radial fraction instead makes the diagonals and the edge midpoints
  // curve at different rates and leaves a visible X-shaped crease across the
  // face. Quadratic sag also raises the four corners above the edge midpoints,
  // which is exactly what a spherically dished cap does.
  const rim = outline(hw, hh, P.pTop, wallIn + chamX, wob, 1)
  let rc2 = 0
  for (let i = 0; i < SEG; i++) {
    rc2 = Math.max(rc2, rim[i * 2] ** 2 + rim[i * 2 + 1] ** 2)  // corner: dish rim
  }
  const sag = (x, y) => Math.max(0, dishD * (1 - (x * x + y * y) / rc2))

  // --- chamfer: a FLAT facet, not an arc, creased at both ends ---------------
  // Straight interpolation (not sin/cos) is what keeps it a facet: an arc rolls
  // its normal through 90° and smears the highlight into a soft gradient, while
  // a facet holds one normal across the whole band and blows out as a single
  // hard stripe with a razor line at each end.
  const ARC = 2
  // duplicate of the last wall ring: crease at the wall/chamfer junction
  addRing(outline(hw, hh, expAt(zShoulder), wallIn, wob, 0.55),
    1, zShoulder, 0.72, null, 0, false)
  for (let j = 1; j <= ARC; j++) {
    const t = j / ARC
    const z = zShoulder + chamZ * t
    addRing(outline(hw, hh, expAt(z), wallIn + chamX * t, wob, 0.55 + t * 0.45),
      1, z, 0.72 + t * 0.16, sag, t)
  }

  // --- dished top: rings crowded toward the rim where curvature is highest ---
  // duplicate of the chamfer top ring: crease at the face rim
  addRing(rim, 1, height, 0.88, sag, 1, false)
  const DISH = 7
  for (let r = 1; r < DISH; r++) {
    const k = Math.cos((r / DISH) * (Math.PI / 2))   // radial fraction, 1 -> 0
    addRing(rim, k, height, 0.88 + (1 - k) * 0.12, sag, 1)
  }
  const centre = pos.length / 3
  pos.push(0, 0, height - dishD)
  uvs.push(0.5, 1)

  // --- indices ---------------------------------------------------------------
  const idx = []
  for (let i = 0; i < SEG; i++) {
    idx.push(bottomCentre, bottomStart + ((i + 1) % SEG), bottomStart + i)
  }
  for (let r = 0; r + 1 < ringStart.length; r++) {
    if (bridged[r] === false) continue
    const A = ringStart[r]
    const B = ringStart[r + 1]
    for (let i = 0; i < SEG; i++) {
      const n = (i + 1) % SEG
      // (A,B,C) -> (B-A)x(C-A): this order is the one that gives *outward*
      // normals. The previous winding was inverted, which is why the cap tops
      // shaded as if they faced away from the key light.
      idx.push(A + i, A + n, B + i, A + n, B + n, B + i)
    }
  }
  const last = ringStart[ringStart.length - 1]
  for (let i = 0; i < SEG; i++) idx.push(last + i, last + ((i + 1) % SEG), centre)

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  g.setIndex(idx)
  g.computeVertexNormals()

  // Primary uv is a planar top-down projection so legends and wear line up with
  // the cap face; the angular/height uv is kept as `uvWall` for side detail.
  g.setAttribute('uvWall', g.attributes.uv)
  const p = g.attributes.position
  const planar = new Float32Array(p.count * 2)
  for (let i = 0; i < p.count; i++) {
    planar[i * 2] = p.getX(i) / width + 0.5
    planar[i * 2 + 1] = p.getY(i) / depth + 0.5
  }
  g.setAttribute('uv', new THREE.BufferAttribute(planar, 2))
  g.computeBoundingBox()
  g.computeBoundingSphere()
  // Where the finish maps must put their steps: `wallInset` is the wall/chamfer
  // crease, `topInset` the face rim. Both are fractions of the footprint.
  g.userData.wallInset = wallIn / width
  g.userData.chamferInset = chamX / width
  g.userData.topInset = (wallIn + chamX) / width
  return g
}
