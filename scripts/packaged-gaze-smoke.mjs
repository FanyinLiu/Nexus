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

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const RELEASE_DIR = path.resolve(ROOT, process.env.PACKAGED_SMOKE_RELEASE_DIR || 'release')
const PORT = Number.parseInt(process.env.PACKAGED_GAZE_PORT || '47829', 10)

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

async function waitForPetTarget() {
  const started = Date.now()
  while (Date.now() - started < 45000) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      if (response.ok) {
        const pages = await response.json()
        const pet = pages.find((target) => target.type === 'page' && String(target.url).includes('view=pet') && target.webSocketDebuggerUrl)
        if (pet) return pet
      }
    } catch {
      // The port is not open yet.
    }
    await sleep(200)
  }
  throw new Error('packaged pet page did not open a debugger target')
}

async function evaluate(session, expression) {
  const result = await session.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'eval failed')
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

async function sampleGaze(session, x, y, expectNegative) {
  execFileSync('xdotool', ['mousemove', String(x), String(y)])
  let last = null
  for (let attempt = 0; attempt < 16; attempt += 1) {
    await sleep(250)
    last = await evaluate(session, readGazeExpression())
    if (!last || typeof last.gazeX !== 'number') continue
    if (expectNegative ? last.gazeX < 0 : last.gazeX > 0) return last
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
  const petTarget = await waitForPetTarget()
  const session = await connect(petTarget.webSocketDebuggerUrl)
  const seed = `(() => {
    localStorage.setItem('nexus:onboarding', JSON.stringify({ completedAt: '2026-01-01T00:00:00.000Z' }))
    sessionStorage.setItem('nexus.modelSetup.dismissedUntilRestart', '1')
  })()`
  await session.send('Page.enable')
  await session.send('Page.addScriptToEvaluateOnNewDocument', { source: seed })
  await evaluate(session, seed)
  await session.send('Page.reload', { ignoreCache: true })
  await sleep(500)
  const reloaded = await waitForPetTarget()
  const gazeSession = await connect(reloaded.webSocketDebuggerUrl)
  await sleep(1200)
  const pet = await revealPet()
  const midY = Math.round(pet.y + Math.min(pet.height, 400) / 2)
  const leftX = Math.max(8, pet.x - 140)
  const rightX = pet.x + pet.width + 140
  const left = await sampleGaze(gazeSession, leftX, midY, true)
  const right = await sampleGaze(gazeSession, rightX, midY, false)
  console.log('[packaged-gaze-smoke]', JSON.stringify({ pet, left, right, leftX, rightX, midY }))
  if (!left || typeof left.gazeX !== 'number' || !right || typeof right.gazeX !== 'number') {
    throw new Error(`gaze samples missing: ${JSON.stringify({ left, right })}`)
  }
  if (!(left.gazeX < 0 && right.gazeX > 0)) {
    throw new Error(`data-gaze-x did not change sign (left=${left.gazeX}, right=${right.gazeX})`)
  }
  console.log('[packaged-gaze-smoke] OS cursor changed data-gaze-x sign.')
  session.close()
  gazeSession.close()
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
