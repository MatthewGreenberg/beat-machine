#!/usr/bin/env node
// Repeatable GPU/draw-call smoke benchmark.
//   npm run perf
//   npm run perf -- --quality=high,balanced --seconds=6 --size=1440x900
//   npm run perf -- --quality=balanced --finish=cobalt --play=1

import { chromium } from 'playwright'
import { spawn } from 'node:child_process'

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter((arg) => arg.startsWith('--'))
    .map((arg) => arg.replace(/^--/, '').split('=')),
)

const PORT = Number(args.port || process.env.PORT || 5198)
const BASE = `http://127.0.0.1:${PORT}`
const qualities = (args.quality || 'high,balanced,performance').split(',')
const seconds = Number(args.seconds || 4)
const [width, height] = (args.size || '1200x800').split('x').map(Number)
const view = args.view || 'front'
const finish = args.finish || 'ivory'
const finishIndex = ['ivory', 'cobalt', 'ember'].indexOf(finish)
const play = args.play === '1'

async function isUp() {
  try {
    const response = await fetch(BASE, { signal: AbortSignal.timeout(1000) })
    return response.ok
  } catch {
    return false
  }
}

let server
if (!(await isUp())) {
  server = spawn(
    'npm',
    ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
    { stdio: 'ignore', detached: true },
  )

  const deadline = Date.now() + 40000
  while (!(await isUp())) {
    if (Date.now() > deadline) throw new Error('benchmark server did not start')
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
}

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--ignore-gpu-blocklist'],
})

const rows = []

try {
  for (const quality of qualities) {
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: 2,
    })

    await page.addInitScript(() => {
      const probe = window.__beatPerf = {
        raf: 0,
        draws: 0,
        gpuMs: [],
        pending: [],
        gl: null,
        timer: null,
      }

      const originalGetContext = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (type, attributes) {
        const gl = originalGetContext.call(this, type, attributes)
        if (!gl || !/webgl/.test(type) || probe.gl) return gl

        probe.gl = gl
        probe.timer = gl.getExtension('EXT_disjoint_timer_query_webgl2')
          || gl.getExtension('EXT_disjoint_timer_query')

        for (const name of [
          'drawElements',
          'drawArrays',
          'drawElementsInstanced',
          'drawArraysInstanced',
        ]) {
          const original = gl[name]?.bind(gl)
          if (!original) continue
          gl[name] = (...drawArgs) => {
            probe.draws += 1
            return original(...drawArgs)
          }
        }
        return gl
      }

      const nativeRaf = window.requestAnimationFrame.bind(window)
      window.requestAnimationFrame = (callback) => nativeRaf((time) => {
        probe.raf += 1
        const gl = probe.gl
        const timer = probe.timer

        if (gl && timer) {
          const remaining = []
          for (const query of probe.pending) {
            const available = gl.createQuery
              ? gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)
              : timer.getQueryObjectEXT(query, timer.QUERY_RESULT_AVAILABLE_EXT)
            const disjoint = gl.getParameter(timer.GPU_DISJOINT_EXT)
            if (available && !disjoint) {
              const elapsed = gl.createQuery
                ? gl.getQueryParameter(query, gl.QUERY_RESULT)
                : timer.getQueryObjectEXT(query, timer.QUERY_RESULT_EXT)
              probe.gpuMs.push(elapsed / 1e6)
              if (gl.deleteQuery) gl.deleteQuery(query)
              else timer.deleteQueryEXT(query)
            } else {
              remaining.push(query)
            }
          }
          probe.pending = remaining
        }

        let query = null
        if (gl && timer) {
          query = gl.createQuery ? gl.createQuery() : timer.createQueryEXT()
          if (gl.beginQuery) gl.beginQuery(timer.TIME_ELAPSED_EXT, query)
          else timer.beginQueryEXT(timer.TIME_ELAPSED_EXT, query)
        }

        try {
          return callback(time)
        } finally {
          if (query) {
            if (gl.endQuery) gl.endQuery(timer.TIME_ELAPSED_EXT)
            else timer.endQueryEXT(timer.TIME_ELAPSED_EXT)
            probe.pending.push(query)
          }
        }
      })
    })

    const errors = []
    page.on('pageerror', (error) => errors.push(String(error)))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })

    await page.goto(`${BASE}/?view=${view}&quality=${quality}`, {
      waitUntil: 'domcontentloaded',
    })
    await page.waitForSelector('canvas')
    if (finishIndex > 0) {
      await page.locator('.finish-picker button').nth(finishIndex).click()
    }
    if (play) await page.keyboard.press('Space')
    await page.waitForTimeout(2500)
    await page.evaluate(() => {
      window.__beatPerf.raf = 0
      window.__beatPerf.draws = 0
      window.__beatPerf.gpuMs = []
    })
    await page.waitForTimeout(seconds * 1000)

    const result = await page.evaluate(() => {
      const samples = window.__beatPerf.gpuMs.slice().sort((a, b) => a - b)
      const percentile = (amount) => (
        samples[Math.min(samples.length - 1, Math.floor(samples.length * amount))]
      )
      const canvas = document.querySelector('canvas')
      return {
        tier: document.querySelector('.stage')?.dataset.quality,
        buffer: `${canvas.width}x${canvas.height}`,
        frames: window.__beatPerf.raf,
        draws: window.__beatPerf.draws,
        samples: samples.length,
        gpuP50: percentile(0.5),
        gpuP95: percentile(0.95),
      }
    })

    rows.push({
      quality: result.tier || quality,
      buffer: result.buffer,
      fps: (result.frames / seconds).toFixed(1),
      'draws/frame': (result.draws / Math.max(1, result.frames)).toFixed(0),
      'GPU p50 ms': result.gpuP50?.toFixed(2) ?? 'n/a',
      'GPU p95 ms': result.gpuP95?.toFixed(2) ?? 'n/a',
      errors: errors.length,
    })

    await page.close()
  }
} finally {
  await browser.close()
  if (server) process.kill(-server.pid)
}

console.table(rows)

if (rows.some((row) => row.errors)) process.exitCode = 2
