#!/usr/bin/env node
// Packaged gaze smoke: move the real OS cursor to either side of the pet
// and require data-gaze-x to change sign. Injected IPC samples do not count.
// Linux is the platform whose Electron cursor query stays stale off-window.
// Other packaged hosts skip; their cursor query is already global.

import { spawn, execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatExceptionDetails } from './lib/cdp-exception-details.mjs'
import {
  APP_DOCUMENT_POLL_MS,
  APP_DOCUMENT_TIMEOUT_MS,
  FATAL_DOCUMENT_CODE,
  isStorageSecurityError,
  selectPetPageTargets,
  shouldRetryEvaluateError,
  waitForAppDocument,
} from './lib/packaged-gaze-page-readiness.mjs'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const RELEASE_DIR = path.resolve(ROOT, process.env.PACKAGED_SMOKE_RELEASE_DIR || 'release')
const PORT = Number.parseInt(process.env.PACKAGED_GAZE_PORT || '47829', 10)
const PET_TARGET_TIMEOUT_MS = 45000

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isExecutable(filePath) {
  try {
    const stat = statSync(filePath)
    return stat.isFile() && Boolean(stat.mode & 0o111)
  } catch {
    return false
  }
}

function findLinuxExecutable() {
  const linuxDir = path.join(RELEASE_DIR, 'linux-unpacked')
  const preferred = ['nexus', 'Nexus', 'electron']
  for (const name of preferred) {
    const candidate = path.join(linuxDir, name)
    if (!existsSync(candidate)) continue
    try { chmodSync(candidate, 0o755) } catch { /* already executable */ }
    if (isExecutable(candidate)) return candidate
  }
  if (!existsSync(linuxDir)) return null
  for (const name of readdirSync(linuxDir)) {
    if (/\.(so|pak|bin|dat)$/i.test(name)) continue
    const candidate = path.join(linuxDir, name)
    try { chmodSync(candidate, 0o755) } catch { /* ignore */ }
    if (isExecutable(candidate)) return candidate
  }
  return null
}

function commandExists(name) {
  try {
    execFileSync('sh', ['-c', `command -v ${name}`], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    let nextId = 0
    const pending = new Map()
    const timer = setTimeout(() => reject(new Error('cdp connect timeout')), 10000)
    ws.addEventListener('open', () => {
      clearTimeout(timer)
      resolve({
        send(method, params = {}) {
          const id = ++nextId
          return new Promise((res, rej) => {
            const timeout = setTimeout(() => {
              pending.delete(id)
              rej(new Error(`timeout ${method}`))
            }, 15000)
            pending.set(id, { res, rej, timeout })
            ws.send(JSON.stringify({ id, method, params }))
          })
        },
        close() { ws.close() },
      })
    })
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (!message.id || !pending.has(message.id)) return
      const waiter = pending.get(message.id)
      pending.delete(message.id)
      clearTimeout(waiter.timeout)
      if (message.error) waiter.rej(new Error(message.error.message || 'cdp error'))
      else waiter.res(message.result)
    })
    ws.addEventListener('error', () => {
      clearTimeout(timer)
      reject(new Error('cdp socket error'))
    })
  })
}

async function listPetTargets() {
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/json/list`)
    if (!response.ok) return []
    return selectPetPageTargets(await response.json())
  } catch {
    // The port is not open yet.
    return []
  }
}

async function waitForPetAppDocument(session, options = {}) {
  return waitForAppDocument({ evaluate: (expression) => evaluate(session, expression), sleep, ...options })
}

async function openPetPage() {
  const started = Date.now()
  let lastReason = 'no packaged pet page debugger target'
  while (Date.now() - started < PET_TARGET_TIMEOUT_MS) {
    for (const target of await listPetTargets()) {
      let session = null
      try {
        session = await connect(target.webSocketDebuggerUrl)
        // Page.enable is a prerequisite for addScriptToEvaluateOnNewDocument.
        await session.send('Page.enable')
        await waitForPetAppDocument(session)
        return { session, target }
      } catch (error) {
        lastReason = error instanceof Error ? error.message : String(error)
        try { session?.close() } catch { /* already closed */ }
        if (error?.code === FATAL_DOCUMENT_CODE) {
          throw new Error(`packaged pet page is not usable: ${lastReason}`, { cause: error })
        }
      }
    }
    await sleep(APP_DOCUMENT_POLL_MS)
  }
  throw new Error(`packaged pet page did not open a usable app document: ${lastReason}`)
}

async function seedPetStorage(session, seed) {
  const started = Date.now()
  let lastReason = 'no seed attempt'
  while (Date.now() - started < APP_DOCUMENT_TIMEOUT_MS) {
    try {
      await evaluate(session, seed)
      return
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!isStorageSecurityError(message) && !shouldRetryEvaluateError(message)) {
        throw new Error(`packaged pet storage seed failed: ${message}`, { cause: error })
      }
      lastReason = message
      await waitForPetAppDocument(session)
      await sleep(APP_DOCUMENT_POLL_MS)
    }
  }
  throw new Error(
    `packaged pet page could not persist the smoke seed within ${APP_DOCUMENT_TIMEOUT_MS}ms: ${lastReason}`,
  )
}

async function evaluate(session, expression) {
  const result = await session.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (result.exceptionDetails) {
    throw new Error(formatExceptionDetails(result.exceptionDetails))
  }
  return result.result?.value
}

function listVisibleNexusWindows() {
  let raw
  try {
    raw = execFileSync('xdotool', ['search', '--onlyvisible', '--name', 'Nexus'], { encoding: 'utf8' })
  } catch {
    return []
  }
  const windows = []
  for (const id of raw.split('\n').map((line) => line.trim()).filter(Boolean)) {
    let geo = ''
    try {
      geo = execFileSync('xdotool', ['getwindowgeometry', '--shell', id], { encoding: 'utf8' })
    } catch {
      continue
    }
    const read = (key) => Number((geo.match(new RegExp(`${key}=(-?\\d+)`)) || [])[1] || 0)
    windows.push({
      id,
      x: read('X'),
      y: read('Y'),
      width: read('WIDTH'),
      height: read('HEIGHT'),
    })
  }
  return windows.filter((item, index, all) => all.findIndex((other) => other.id === item.id) === index)
}

function readGazeExpression() {
  return `(() => {
    const surface = document.querySelector('.nexus-companion-v2')
    const gazeX = Number(surface?.getAttribute('data-gaze-x'))
    return {
      gazeX: Number.isFinite(gazeX) ? gazeX : null,
      phase: surface?.getAttribute('data-phase') ?? '',
    }
  })()`
}

function readPetWindow() {
  return listVisibleNexusWindows().find((item) => item.width >= 200 && item.width < 420 && item.height >= 300) ?? null
}

function pinPet(pet) {
  if (!pet) return null
  // Locomotion can walk a free-mode pet toward the pointer. Put it back
  // before each sample so the cursor stays on the side we just chose.
  try { execFileSync('xdotool', ['windowmove', pet.id, '420', '160']) } catch { /* read back whatever stuck */ }
  return listVisibleNexusWindows().find((item) => item.id === pet.id) ?? readPetWindow() ?? pet
}

function cursorBeside(pet, side, jitter) {
  const midY = Math.round(pet.y + Math.min(pet.height, 400) / 2)
  // Farther than the 260px cursor-tease radius around the pet center, and
  // still on a 1280-wide smoke display when the pet sits at x=420.
  const x = side === 'left'
    ? Math.max(8, pet.x - 360)
    : pet.x + pet.width + 360
  return { x: x + jitter, y: midY }
}

async function sampleGaze(session, side) {
  // The Linux cursor hook only learns positions from motion after it
  // subscribes. Electron's own query stays stale, so one move that races
  // startup is invisible and the pet keeps looking at the old point.
  // Moving again on every poll gives a late hook a fresh sample.
  let last = null
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const pet = pinPet(readPetWindow())
    if (!pet) break
    const point = cursorBeside(pet, side, attempt % 2 === 0 ? -8 : 8)
    execFileSync('xdotool', ['mousemove', String(point.x), String(point.y)])
    await sleep(200)
    const gaze = await evaluate(session, readGazeExpression())
    last = { ...gaze, pet, cursorX: point.x, cursorY: point.y }
    if (!gaze || typeof gaze.gazeX !== 'number') continue
    if (side === 'left' ? gaze.gazeX < 0 : gaze.gazeX > 0) return last
  }
  return last
}

async function revealPet() {
  const started = Date.now()
  while (Date.now() - started < 20000) {
    const windows = listVisibleNexusWindows()
    const panels = windows.filter((item) => item.width >= 420 && item.height >= 500)
    const pets = windows.filter((item) => item.width >= 200 && item.width < 420 && item.height >= 300)
    for (const panel of panels) {
      try { execFileSync('xdotool', ['windowmove', panel.id, '2400', '2400']) } catch { /* off-screen is best effort */ }
    }
    if (panels.length > 0) {
      execFileSync('xdotool', ['mousemove', '30', '80'])
      execFileSync('xdotool', ['click', '1'])
      await sleep(400)
    }
    if (pets.length > 0) {
      const pet = pets[0]
      // Leave room on both sides. A corner pet has no screen left of the right edge,
      // so a cursor "to the right" never actually gets there.
      try { execFileSync('xdotool', ['windowmove', pet.id, '420', '160']) } catch { /* read back whatever stuck */ }
      await sleep(250)
      const moved = listVisibleNexusWindows().find((item) => item.id === pet.id) ?? pet
      if (moved.x > 200 && moved.x + moved.width < 1100) return moved
    }
    await sleep(400)
  }
  throw new Error(`packaged pet window did not become visible: ${JSON.stringify(listVisibleNexusWindows())}`)
}

if (process.platform !== 'linux') {
  console.log('[packaged-gaze-smoke] skipped: OS cursor assertion runs on Linux, where the Electron cursor query is stale off-window')
  process.exit(0)
}

if (!commandExists('xdotool')) {
  console.error('[packaged-gaze-smoke] xdotool is required to move the OS cursor')
  process.exit(1)
}

const executable = findLinuxExecutable()
if (!executable) {
  console.error('[packaged-gaze-smoke] No packaged executable found. Run `npm run package:dir` first.')
  process.exit(1)
}

let xvfb = null
if (!process.env.DISPLAY) {
  if (!commandExists('Xvfb')) {
    console.error('[packaged-gaze-smoke] no DISPLAY and Xvfb is missing')
    process.exit(1)
  }
  process.env.DISPLAY = ':97'
  xvfb = spawn('Xvfb', [':97', '-screen', '0', '1280x800x24'], { stdio: 'ignore' })
  await sleep(400)
}

const userData = mkdtempSync(path.join(os.tmpdir(), 'nexus-packaged-gaze-'))
const child = spawn(executable, [
  '--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${userData}`,
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--enable-webgl',
  '--disable-gpu-sandbox',
], {
  cwd: path.dirname(executable),
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
  stdio: 'ignore',
})

let failed = false
try {
  const petPage = await openPetPage()
  const session = petPage.session
  const seed = `(() => {
    localStorage.setItem('nexus:onboarding', JSON.stringify({ completedAt: '2026-01-01T00:00:00.000Z' }))
    sessionStorage.setItem('nexus.modelSetup.dismissedUntilRestart', '1')
  })()`
  await session.send('Page.addScriptToEvaluateOnNewDocument', { source: seed })
  await seedPetStorage(session, seed)
  // Clearing the marker before the reload proves the post-reload wait sees the
  // new document (which re-runs the injected seed), not the old one.
  await evaluate(session, "sessionStorage.removeItem('nexus.modelSetup.dismissedUntilRestart')")
  await session.send('Page.reload', { ignoreCache: true })
  await waitForPetAppDocument(session, { requireSeeded: true })
  await sleep(1200)
  const pet = await revealPet()
  const left = await sampleGaze(session, 'left')
  const right = await sampleGaze(session, 'right')
  console.log('[packaged-gaze-smoke]', JSON.stringify({ pet, left, right }))
  if (!left || typeof left.gazeX !== 'number' || !right || typeof right.gazeX !== 'number') {
    throw new Error(`gaze samples missing: ${JSON.stringify({ left, right })}`)
  }
  if (!(left.gazeX < 0 && right.gazeX > 0)) {
    throw new Error(`data-gaze-x did not change sign (left=${left.gazeX}, right=${right.gazeX})`)
  }
  console.log('[packaged-gaze-smoke] OS cursor changed data-gaze-x sign.')
  session.close()
} catch (error) {
  failed = true
  console.error(`[packaged-gaze-smoke] ${error instanceof Error ? error.message : String(error)}`)
} finally {
  try { child.kill('SIGKILL') } catch { /* already exited */ }
  if (xvfb) {
    try { xvfb.kill('SIGKILL') } catch { /* already exited */ }
  }
  try { rmSync(userData, { recursive: true, force: true }) } catch { /* best effort */ }
}

process.exit(failed ? 1 : 0)
