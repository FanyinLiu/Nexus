const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { app, BrowserWindow } = require('electron')

const ROOT = path.join(__dirname, '..')
const DIST_INDEX = path.join(ROOT, 'dist', 'index.html')
const OUTPUT_DIR = path.join(ROOT, 'output', 'presence-smoke')
const TIMEOUT_MS = Number.parseInt(process.env.PET_PRESENCE_SMOKE_TIMEOUT_MS || '12000', 10)

if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
  console.log('[pet-presence-smoke] skipped: no Linux display server is available')
  process.exit(0)
}

const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-pet-presence-smoke-'))
const preloadPath = path.join(userDataRoot, 'pet-presence-smoke-preload.cjs')
app.setPath('userData', userDataRoot)
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
app.commandLine.appendSwitch('disable-features', 'UseSkiaRenderer')

fs.writeFileSync(preloadPath, `
try {
  window.localStorage.setItem('nexus:onboarding', JSON.stringify({
    completedAt: '2026-06-20T00:00:00.000Z'
  }))
  window.sessionStorage.setItem('nexus:startup-greeting-shown', '1')
} catch (error) {
  console.error('[pet-presence-smoke-preload] failed to seed local state', error)
}
`)

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function cleanupTempUserData() {
  fs.rmSync(userDataRoot, { recursive: true, force: true })
}

async function waitForPetStage(window) {
  const startedAt = Date.now()
  let lastSnapshot = null

  while (Date.now() - startedAt < TIMEOUT_MS) {
    lastSnapshot = await window.webContents.executeJavaScript(`
      (() => {
        const stage = document.querySelector('.pet-window__stage-shell')
        const mascot = document.querySelector('.pet-window__mascot')
        const renderShell = document.querySelector('.pet-window__mascot .live2d-shell, .pet-window__mascot .sprite-pet-shell')
        const onboarding = document.querySelector('.onboarding-backdrop, .onboarding-card')
        const stageRect = stage?.getBoundingClientRect()
        const renderStyle = renderShell ? getComputedStyle(renderShell) : null
        return {
          hasStage: Boolean(stage),
          hasMascot: Boolean(mascot),
          hasRenderShell: Boolean(renderShell),
          hasOnboarding: Boolean(onboarding),
          hasErrorFallback: Boolean(document.querySelector('.app-error-fallback')),
          activity: stage?.getAttribute('data-companion-activity') ?? null,
          motion: stage?.getAttribute('data-companion-motion') ?? null,
          animationName: renderStyle?.animationName ?? '',
          prefersReducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
          width: Math.round(stageRect?.width ?? 0),
          height: Math.round(stageRect?.height ?? 0),
          bodyText: document.body.innerText.slice(0, 240),
        }
      })()
    `)

    if (lastSnapshot.hasOnboarding) {
      throw new Error(`onboarding overlay blocked the pet view: ${lastSnapshot.bodyText}`)
    }

    if (
      lastSnapshot.hasStage
      && lastSnapshot.hasMascot
      && lastSnapshot.hasRenderShell
      && lastSnapshot.motion
    ) {
      return lastSnapshot
    }

    await wait(150)
  }

  throw new Error(`pet stage did not become ready within ${TIMEOUT_MS}ms: ${JSON.stringify(lastSnapshot)}`)
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
      preload: preloadPath,
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
    const snapshot = await waitForPetStage(window)
    await wait(500)

    if (snapshot.hasErrorFallback) {
      throw new Error(`app rendered the error fallback: ${snapshot.bodyText}`)
    }
    if (snapshot.hasOnboarding) {
      throw new Error(`onboarding overlay rendered instead of the companion: ${snapshot.bodyText}`)
    }
    if (snapshot.activity !== 'idle') {
      throw new Error(`expected idle companion activity, got ${snapshot.activity}`)
    }
    if (snapshot.motion !== 'breathe') {
      throw new Error(`expected breathe companion motion, got ${snapshot.motion}`)
    }
    if (!snapshot.prefersReducedMotion && !String(snapshot.animationName).includes('pet-presence-breathe')) {
      throw new Error(`expected breathe animation, got ${snapshot.animationName || '(none)'}`)
    }
    if (snapshot.width < 200 || snapshot.height < 300) {
      throw new Error(`pet stage is unexpectedly small: ${snapshot.width}x${snapshot.height}`)
    }

    const image = await window.capturePage()
    const png = image.toPNG()
    const metrics = analyzeBitmap(image)
    if (metrics.width < 200 || metrics.height < 300) {
      throw new Error(`screenshot is unexpectedly small: ${metrics.width}x${metrics.height}`)
    }
    if (metrics.nonTransparent < 250 || metrics.colorBuckets < 6) {
      throw new Error(`screenshot looks blank: ${JSON.stringify(metrics)}`)
    }

    const screenshotPath = path.join(OUTPUT_DIR, 'pet-presence-smoke.png')
    const reportPath = path.join(OUTPUT_DIR, 'pet-presence-smoke.json')
    fs.writeFileSync(screenshotPath, png)
    fs.writeFileSync(reportPath, JSON.stringify({
      ok: true,
      snapshot,
      metrics,
      rendererWarnings: rendererErrors.slice(0, 8),
      screenshotPath,
    }, null, 2))

    console.log('[pet-presence-smoke] passed', JSON.stringify({
      activity: snapshot.activity,
      motion: snapshot.motion,
      animationName: snapshot.animationName,
      screenshotPath,
      metrics,
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
