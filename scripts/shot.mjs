#!/usr/bin/env node
// Deterministic screenshots of the running app.
//   node scripts/shot.mjs [view] [outfile] [--size=WxH] [--post=0] [--wait=ms]
// Boots the dev server itself if nothing is listening on PORT.
//
// ponytail: one script, no test framework. It also fails loudly on any page
// console error, which is how every agent finds a broken build.

import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

// Dedicated port + strictPort: other projects squat on 5173 and we must never
// screenshot someone else's app.
const PORT = process.env.PORT || 5199
const BASE = `http://localhost:${PORT}`

const args = process.argv.slice(2)
const flags = Object.fromEntries(
  args.filter((a) => a.startsWith('--')).map((a) => a.replace(/^--/, '').split('=')),
)
const positional = args.filter((a) => !a.startsWith('--'))
const view = positional[0] || 'front'
const out = resolve(positional[1] || `shots/${view}.png`)
const [w, h] = (flags.size || '1200x1400').split('x').map(Number)
const wait = Number(flags.wait ?? 2600)
const quality = flags.quality || 'high'

async function up() {
  try {
    const r = await fetch(BASE, { signal: AbortSignal.timeout(1200) })
    return r.ok
  } catch { return false }
}

let server
if (!(await up())) {
  server = spawn('npm', ['run', 'dev', '--', '--port', String(PORT), '--strictPort'], {
    stdio: 'ignore', detached: true,
  })
  const deadline = Date.now() + 40000
  while (!(await up())) {
    if (Date.now() > deadline) { console.error('dev server did not start'); process.exit(1) }
    await new Promise((r) => setTimeout(r, 400))
  }
}

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 })

const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(String(e)))

const url = `${BASE}/?view=${view}&quality=${quality}${flags.post === '0' ? '&post=0' : ''}${flags.play ? '&play=1' : ''}`
// vite's HMR socket means networkidle never fires
await page.goto(url, { waitUntil: 'domcontentloaded' })
try {
  await page.waitForSelector('canvas', { timeout: 15000 })
} catch {
  console.error('NO CANVAS — page errors:\n' + (errors.join('\n') || '(none captured)'))
  await browser.close()
  if (server) process.kill(-server.pid)
  process.exit(2)
}
await page.waitForTimeout(wait)

mkdirSync(dirname(out), { recursive: true })
await page.screenshot({ path: out })
await browser.close()
if (server) process.kill(-server.pid)

if (errors.length) {
  console.error('PAGE ERRORS:\n' + errors.slice(0, 12).join('\n'))
  console.log(out)
  process.exit(2)
}
console.log(out)
