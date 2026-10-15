const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { app, BrowserWindow, screen } = require('electron')

const ROOT = path.join(__dirname, '..')
const DIST_INDEX = path.join(ROOT, 'dist', 'index.html')
const PRELOAD_PATH = path.join(__dirname, 'pet-presence-smoke-preload.cjs')
const OUTPUT_DIR = path.join(ROOT, 'output', 'presence-smoke')
const TIMEOUT_MS = Number.parseInt(process.env.PET_PRESENCE_SMOKE_TIMEOUT_MS || '15000', 10)

if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
  console.log('[pet-presence-smoke] skipped: no Linux display server is available')
  process.exit(0)
}

const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-pet-presence-smoke-'))
app.setPath('userData', userDataRoot)
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
app.commandLine.appendSwitch('disable-features', 'UseSkiaRenderer')

const OUTSIDE_RIGHT = { paused: false, x: 2_000, y: 252, width: 400, height: 600, inside: false }
const OUTSIDE_LEFT = { paused: false, x: -800, y: 252, width: 400, height: 600, inside: false }

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function cleanupTempUserData() {
  fs.rmSync(userDataRoot, { recursive: true, force: true })
}

function readPresenceScript() {
  return `(() => {
    const surface = document.querySelector('.nexus-companion-v2')
    const shell = document.querySelector('.nexus-companion-v2 .live2d-shell')
    const rect = surface?.getBoundingClientRect()
    return {
      hasSurface: Boolean(surface),
      hasShell: Boolean(shell),
      phase: surface?.getAttribute('data-phase') ?? '',
      gazeX: Number(surface?.getAttribute('data-gaze-x')),
      gazeY: Number(surface?.getAttribute('data-gaze-y')),
      typingActive: shell?.getAttribute('data-typing-active') === 'true',
      typingIntensity: Number(shell?.getAttribute('data-typing-intensity')),
      width: Math.round(rect?.width ?? 0),
      height: Math.round(rect?.height ?? 0),
      hasOnboarding: Boolean(document.querySelector('.onboarding-backdrop, .onboarding-card')),
      hasErrorFallback: Boolean(document.querySelector('.app-error-fallback')),
      bodyText: document.body.innerText.slice(0, 240),
    }
  })()`
}

async function readPresence(window) {
  return window.webContents.executeJavaScript(readPresenceScript())
}

async function waitForCompanion(window) {
  const startedAt = Date.now()
  let lastSnapshot = null
  while (Date.now() - startedAt < TIMEOUT_MS) {
    lastSnapshot = await readPresence(window)
    if (lastSnapshot.hasOnboarding) {
      throw new Error(`onboarding overlay blocked the pet view: ${lastSnapshot.bodyText}`)
    }
    if (lastSnapshot.hasSurface && lastSnapshot.hasShell && lastSnapshot.phase === 'idle') {
      return lastSnapshot
    }
    await wait(150)
  }
  throw new Error(`v2 companion did not become ready within ${TIMEOUT_MS}ms: ${JSON.stringify(lastSnapshot)}`)
}

async function sendGaze(window, sample, times) {
  for (let index = 0; index < times; index += 1) {
    window.webContents.send('desktop-presence:gaze', sample)
    await wait(40)
  }
  await wait(120)
  return readPresence(window)
}

async function pointAtCharacter(window, xRatio) {
  const moved = await window.webContents.executeJavaScript(`(() => {
    const hit = document.querySelector('.nexus-companion-v2__character-hit')
    if (!hit) return false
    const rect = hit.getBoundingClientRect()
    const x = rect.left + rect.width * ${xRatio}
    const y = rect.top + rect.height * 0.42
    const common = { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', view: window }
    hit.dispatchEvent(new PointerEvent('pointerover', { ...common, relatedTarget: null }))
    hit.dispatchEvent(new PointerEvent('pointermove', common))
    return true
  })()`)
  if (!moved) throw new Error('v2 character hit target is missing')
  await wait(200)
  return readPresence(window)
}

async function pointOffCharacter(window) {
  await window.webContents.executeJavaScript(`(() => {
    const hit = document.querySelector('.nexus-companion-v2__character-hit')
    if (!hit) return false
    const common = { bubbles: true, cancelable: true, clientX: 1, clientY: 1, pointerId: 1, pointerType: 'mouse', view: window, relatedTarget: document.body }
    hit.dispatchEvent(new PointerEvent('pointerout', common))
    return true
  })()`)
  await wait(200)
}

function analyzeBitmap(image) {
  const size = image.getSize()
  const bitmap = image.toBitmap()
  let sampled = 0
  let nonTransparent = 0
  const buckets = new Set()
  const stride = 4 * Math.max(1, Math.floor((size.width * size.height) / 15000))

  for (let offset = 0; offset < bitmap.length; offset += stride) {
    sampled += 1
    const blue = bitmap[offset] ?? 0
    const green = bitmap[offset + 1] ?? 0
    const red = bitmap[offset + 2] ?? 0
    const alpha = bitmap[offset + 3] ?? 0
    if (alpha <= 16) continue
    nonTransparent += 1
    buckets.add(`${red >> 4}:${green >> 4}:${blue >> 4}:${alpha >> 5}`)
  }

  return {
    width: size.width,
    height: size.height,
    sampled,
    nonTransparent,
    colorBuckets: buckets.size,
  }
}

async function main() {
  if (!fs.existsSync(DIST_INDEX)) {
    throw new Error('dist/index.html is missing. Run `npm run build` before the visual smoke.')
  }

  await app.whenReady()
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })

  const window = new BrowserWindow({
    width: 520,
    height: 760,
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: PRELOAD_PATH,
    },
  })

  const rendererErrors = []
  window.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) rendererErrors.push(message)
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    rendererErrors.push(`renderer-process-gone:${details.reason}`)
  })

  try {
    await window.loadFile(DIST_INDEX, { query: { view: 'pet' } })
    // Keep the OS cursor off the pet. A real pointer over the character
    // would lock gaze to the in-window path and hide the global samples.
    const cursor = screen.getCursorScreenPoint()
    window.setBounds({ x: cursor.x + 900, y: cursor.y + 900, width: 520, height: 760 })
    window.showInactive()
    const snapshot = await waitForCompanion(window)
    await pointOffCharacter(window)

    if (snapshot.hasErrorFallback) {
      throw new Error(`app rendered the error fallback: ${snapshot.bodyText}`)
    }
    if (snapshot.width < 200 || snapshot.height < 300) {
      throw new Error(`v2 companion is unexpectedly small: ${snapshot.width}x${snapshot.height}`)
    }

    const outsideRight = await sendGaze(window, OUTSIDE_RIGHT, 4)
    if (!(outsideRight.gazeX > 0.75)) {
      throw new Error(`cursor outside the pet, to the right, did not pull gaze right: ${JSON.stringify(outsideRight)}`)
    }

    const outsideLeft = await sendGaze(window, OUTSIDE_LEFT, 6)
    if (!(outsideLeft.gazeX < -0.5)) {
      throw new Error(`cursor outside the pet, to the left, did not pull gaze left: ${JSON.stringify(outsideLeft)}`)
    }

    const inside = await pointAtCharacter(window, 0.12)
    if (!(inside.gazeX < -0.8)) {
      throw new Error(`pointer inside the pet did not take over gaze: ${JSON.stringify(inside)}`)
    }
    const insideHeld = await sendGaze(window, OUTSIDE_RIGHT, 3)
    if (!(insideHeld.gazeX < -0.5)) {
      throw new Error(`global gaze overrode the in-window pointer: ${JSON.stringify(insideHeld)}`)
    }

    await pointOffCharacter(window)
    const outsideAgain = await sendGaze(window, OUTSIDE_RIGHT, 5)
    if (!(outsideAgain.gazeX > 0.5)) {
      throw new Error(`gaze did not follow the cursor after the pointer left the pet: ${JSON.stringify(outsideAgain)}`)
    }

    window.webContents.send('desktop-presence:typing', { phase: 'start', keysPerSecond: 8 })
    await wait(200)
    const typing = await readPresence(window)
    if (!typing.typingActive || !(typing.typingIntensity >= 0.99)) {
      throw new Error(`typing signal did not reach the Live2D reaction: ${JSON.stringify(typing)}`)
    }

    window.webContents.send('desktop-presence:typing', { phase: 'stop', keysPerSecond: 0 })
    await wait(200)
    const idleTyping = await readPresence(window)
    if (idleTyping.typingActive || idleTyping.typingIntensity !== 0) {
      throw new Error(`typing stop did not return the reaction to idle: ${JSON.stringify(idleTyping)}`)
    }

    const image = await window.capturePage()
    const png = image.toPNG()
    const metrics = analyzeBitmap(image)
    if (metrics.width < 200 || metrics.height < 300) {
      throw new Error(`screenshot is unexpectedly small: ${metrics.width}x${metrics.height}`)
    }

    const screenshotPath = path.join(OUTPUT_DIR, 'pet-presence-smoke.png')
    const reportPath = path.join(OUTPUT_DIR, 'pet-presence-smoke.json')
    const report = {
      ok: true,
      snapshot,
      gaze: {
        outsideRight: { x: outsideRight.gazeX, y: outsideRight.gazeY },
        outsideLeft: { x: outsideLeft.gazeX, y: outsideLeft.gazeY },
        insideHeld: { x: insideHeld.gazeX, y: insideHeld.gazeY },
        outsideAgain: { x: outsideAgain.gazeX, y: outsideAgain.gazeY },
      },
      typing: {
        activeIntensity: typing.typingIntensity,
        idleIntensity: idleTyping.typingIntensity,
      },
      metrics,
      rendererWarnings: rendererErrors.slice(0, 8),
      screenshotPath,
    }
    fs.writeFileSync(screenshotPath, png)
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))

    console.log('[pet-presence-smoke] passed', JSON.stringify({
      phase: snapshot.phase,
      gaze: report.gaze,
      typing: report.typing,
      screenshotPath,
    }))
  } finally {
    window.destroy()
    cleanupTempUserData()
    app.quit()
  }
}

main().catch((error) => {
  console.error('[pet-presence-smoke] failed')
  console.error(error)
  try { cleanupTempUserData() } catch {}
  app.exit(1)
})
