// Single source of truth for machine geometry. Every part module imports from
// here so nothing drifts. Units: 1 = 1cm.

export const PITCH = 1.92          // key-to-key spacing
export const GAP = 0.14            // air between adjacent caps
export const CAP = PITCH - GAP     // cap footprint at its base
export const COLS = 5
export const ROWS = 5              // row 0 = modifier row, rows 1-4 = step pads

export const KEYS_W = COLS * PITCH
export const KEYS_H = ROWS * PITCH

export const BEZEL_X = 0.34
export const PLATE_H = 5.6         // top faceplate (knob / screen / decals)

export const BODY_W = KEYS_W + BEZEL_X * 2
export const BODY_H = KEYS_H + PLATE_H
export const BODY_D = 1.5          // chassis thickness (caps sit on top)

// Centre of the whole unit is the origin; +y up, +x right, caps extrude in +z.
export const TOP_Y = BODY_H / 2
export const KEYS_TOP_Y = TOP_Y - PLATE_H

// Column/row centre for a key at grid (col, row), row 0 at the top.
export const keyX = (col, span = 1) =>
  -KEYS_W / 2 + (col + span / 2) * PITCH
export const keyY = (row, span = 1) =>
  KEYS_TOP_Y - (row + span / 2) * PITCH

export const PLATE_Z = BODY_D / 2  // front face of the chassis

// Which physical key is which control.
export const TRACK_KEYS = [0, 1, 2, 3]   // row 0, cols 0-3
export const SWING_KEY = 4               // row 0, col 4
export const STEP_COLS = 4               // cols 0-3 across rows 1-4 = 16 steps
export const stepIndex = (col, row) => (row - 1) * STEP_COLS + col
export const stepPos = (i) => ({ col: i % STEP_COLS, row: Math.floor(i / STEP_COLS) + 1 })

// Right column: two 2-unit-tall keys — clear above, orange transport below.
export const CLEAR_KEY = { col: 4, row: 1, span: 2 }
export const PLAY_KEY = { col: 4, row: 3, span: 2 }
