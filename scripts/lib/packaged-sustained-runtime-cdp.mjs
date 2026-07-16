/**
 * CDP, Live2D DOM probes, and visibility-toggle helpers for the
 * packaged sustained runtime harness.
 */

import { createServer } from 'node:net'

export const NATIVE_VISIBILITY_METHOD = 'native_pet_panel_hide_show'
export const NATIVE_VISIBILITY_TRANSITION_TIMEOUT_MS = 3_000
export const NATIVE_VISIBILITY_POLL_INTERVAL_MS = 100

export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function allocatePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : null
      server.close((error) => {
        if (error) reject(error)
        else if (!port) reject(new Error('failed to allocate port'))
        else resolve(port)
      })
    })
    server.on('error', reject)
  })
}

/** Documented product onboarding state (see src/lib/storage/onboarding.ts). */
const SEED_STORAGE_SCRIPT = `(() => {
  try {
    window.localStorage.setItem('nexus:onboarding', JSON.stringify({
      completedAt: '2026-07-12T00:00:00.000Z',
      firstConversationAt: '2026-07-12T00:02:00.000Z',
      firstConversationElapsedMs: 120000
    }))
    window.sessionStorage.setItem('nexus:startup-greeting-shown', '1')
    window.sessionStorage.setItem('nexus.modelSetup.dismissedUntilRestart', '1')
    return true
  } catch (error) {
    return String(error)
  }
})()`

export const LIVE2D_READY_PHASE = 'first-frame'

export function isLive2DFirstFrameReady(phase) {
  return phase === LIVE2D_READY_PHASE
}

export const LIVE2D_SNAPSHOT_SCRIPT = `(() => {
  const shells = Array.from(document.querySelectorAll('.live2d-shell'))
  const canvases = Array.from(document.querySelectorAll('canvas'))
  const live2dCanvases = Array.from(document.querySelectorAll('.live2d-canvas canvas'))
  const container = document.querySelector('.live2d-canvas') || null
  const debug = window.__desktopPetLive2DDebug || null
  const probe = window.__packagedSustainedRuntimeProbe || null
  const phase = container?.dataset?.live2dPhase
    || debug?.phase
    || null
  const ready = phase === ${JSON.stringify(LIVE2D_READY_PHASE)}
  return {
    url: location.href,
    visibilityState: document.visibilityState,
    hidden: document.visibilityState === 'hidden',
    shellCount: shells.length,
    canvasCount: live2dCanvases.length,
    allCanvasCount: canvases.length,
    phase,
    modelId: container?.dataset?.live2dModelId || null,
    error: container?.dataset?.live2dError || null,
    readyMs: container?.dataset?.live2dReadyMs || null,
    firstFrameMs: container?.dataset?.live2dFirstFrameMs || null,
    ready,
    hasErrorFallback: Boolean(document.querySelector('.app-error-fallback')),
    hasOnboarding: Boolean(document.querySelector('.onboarding-backdrop, .onboarding-card')),
    hasModelSetup: Boolean(document.querySelector('.model-setup-backdrop, .model-setup-card')),
    debugPhase: debug?.phase ?? null,
    probeInstalled: probe?.installed === true,
    modelUpdateCount: Number.isFinite(probe?.modelUpdateCount) ? probe.modelUpdateCount : null,
    tickerTickCount: Number.isFinite(probe?.tickerTickCount) ? probe.tickerTickCount : null,
  }
})()`

/**
 * Attach a page-local probe to the actual model.update and owning app ticker.
 * This is evidence-only instrumentation; it does not alter product logic.
 */
export async function installLive2DPauseProbe(page) {
  try {
    return await page.evaluate(() => {
      const existing = window.__packagedSustainedRuntimeProbe
      if (existing?.installed === true) {
        return {
          ok: true,
          installed: true,
          modelUpdateCount: existing.modelUpdateCount,
          tickerTickCount: existing.tickerTickCount,
          reused: true,
        }
      }

      const debug = window.__desktopPetLive2DDebug || null
      const model = debug?.model || null
      const app = debug?.app || null
      const ticker = app?.ticker || null
      if (!model || typeof model.update !== 'function') {
        return { ok: false, installed: false, reason: 'Live2D model.update is unavailable' }
      }
      if (!ticker || typeof ticker.add !== 'function' || typeof ticker.remove !== 'function') {
        return { ok: false, installed: false, reason: 'Live2D app ticker is unavailable' }
      }

      const originalUpdate = model.update
      const probe = {
        installed: false,
        modelUpdateCount: 0,
        tickerTickCount: 0,
      }
      const wrappedUpdate = function wrappedUpdate(...args) {
        probe.modelUpdateCount += 1
        return originalUpdate.apply(this, args)
      }
      const tickerListener = () => {
        probe.tickerTickCount += 1
      }

      try {
        model.update = wrappedUpdate
        ticker.add(tickerListener)
      } catch (error) {
        try { model.update = originalUpdate } catch { /* best effort */ }
        return {
          ok: false,
          installed: false,
          reason: error instanceof Error ? error.message : String(error),
        }
      }

      probe.installed = true
      window.__packagedSustainedRuntimeProbe = probe
      return {
        ok: true,
        installed: true,
        modelUpdateCount: 0,
        tickerTickCount: 0,
        reused: false,
      }
    })
  } catch (error) {
    return {
      ok: false,
      installed: false,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function seedPages(pages) {
  const results = []
  for (const page of pages) {
    try {
      const seeded = await page.evaluate(SEED_STORAGE_SCRIPT)
      results.push({ url: page.url(), seeded })
    } catch (error) {
      results.push({
        url: page.url(),
        seeded: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return results
}

export async function snapshotLive2D(pages) {
  const snapshots = []
  for (const page of pages) {
    try {
      const snapshot = await page.evaluate(LIVE2D_SNAPSHOT_SCRIPT)
      snapshots.push(snapshot)
    } catch (error) {
      snapshots.push({
        url: page.url(),
        error: error instanceof Error ? error.message : String(error),
        ready: false,
        canvasCount: null,
      })
    }
  }
  return snapshots
}

export function pickLive2DPage(pages, snapshots) {
  for (let index = 0; index < snapshots.length; index += 1) {
    const snap = snapshots[index]
    if (snap?.ready || (snap?.canvasCount ?? 0) > 0 || snap?.phase) {
      return pages[index]
    }
  }
  for (const page of pages) {
    const url = page.url()
    if (/view=panel|view=pet/i.test(url)) return page
  }
  return pages[0] ?? null
}

export async function waitForLive2DReady(getPages, timeoutMs) {
  const started = Date.now()
  let last = []
  let reloadedForOnboarding = false
  while (Date.now() - started < timeoutMs) {
    const pages = getPages()
    if (pages.length) {
      await seedPages(pages)
      last = await snapshotLive2D(pages)
      if (last.some((snap) => snap.ready && !snap.hasOnboarding && !snap.hasModelSetup && !snap.hasErrorFallback)) {
        return { ok: true, snapshots: last, elapsedMs: Date.now() - started }
      }
      if (!reloadedForOnboarding && last.some((snap) => snap.hasOnboarding || snap.hasModelSetup)) {
        reloadedForOnboarding = true
        for (const page of pages) {
          try { await page.reload({ waitUntil: 'domcontentloaded' }) } catch { /* ignore */ }
        }
      }
    }
    await wait(400)
  }
  return { ok: false, snapshots: last, elapsedMs: Date.now() - started }
}

async function readVisibilityState(page) {
  try {
    return await page.evaluate(() => document.visibilityState)
  } catch {
    return null
  }
}

function isViewPage(page, view) {
  try {
    return new URL(page.url()).searchParams.get('view') === view
  } catch {
    return false
  }
}

function getBrowserPages(browser) {
  return browser.contexts().flatMap((context) => context.pages())
}

async function readPetVisibility(page) {
  try {
    return await page.evaluate(() => {
      const probe = window.__packagedSustainedRuntimeProbe || null
      return {
        visibilityState: document.visibilityState,
        hidden: document.visibilityState === 'hidden',
        probeInstalled: probe?.installed === true,
      }
    })
  } catch {
    return null
  }
}

async function invokePetPanelAction(page, hidden) {
  try {
    return await page.evaluate(async (shouldHide) => {
      if (shouldHide) {
        if (typeof window.desktopPet?.openPanel !== 'function') {
          return { ok: false, reason: 'openPanel_unavailable' }
        }
        await window.desktopPet.openPanel('chat')
      } else {
        if (typeof window.desktopPet?.closePanel !== 'function') {
          return { ok: false, reason: 'closePanel_unavailable' }
        }
        await window.desktopPet.closePanel()
      }
      return { ok: true }
    }, hidden)
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

async function waitForNativePetPanelTransition(browser, petPage, hidden) {
  const startedAt = Date.now()
  let lastPetState = null
  let panelPage = null
  let observedHidden = false

  while (Date.now() - startedAt <= NATIVE_VISIBILITY_TRANSITION_TIMEOUT_MS) {
    lastPetState = await readPetVisibility(petPage)
    panelPage = getBrowserPages(browser).find((candidate) => (
      !candidate.isClosed() && isViewPage(candidate, 'panel')
    )) ?? null

    if (!lastPetState?.probeInstalled) {
      return {
        ok: false,
        reason: 'native_pet_live2d_probe_lost',
        petState: lastPetState,
        panelPageObserved: Boolean(panelPage),
      }
    }

    if (hidden) {
      if (lastPetState.hidden) observedHidden = true
      if (observedHidden && !lastPetState.hidden) {
        return {
          ok: false,
          reason: 'native_pet_visibility_recovered_early',
          petState: lastPetState,
          panelPageObserved: Boolean(panelPage),
        }
      }
      if (lastPetState.hidden && panelPage) {
        return {
          ok: true,
          petState: lastPetState,
          panelPageObserved: true,
          elapsedMs: Date.now() - startedAt,
        }
      }
    } else if (!lastPetState.hidden && lastPetState.visibilityState === 'visible') {
      return {
        ok: true,
        petState: lastPetState,
        panelPageObserved: Boolean(panelPage),
        elapsedMs: Date.now() - startedAt,
      }
    }

    await wait(NATIVE_VISIBILITY_POLL_INTERVAL_MS)
  }

  return {
    ok: false,
    reason: hidden ? 'native_pet_hide_transition_timeout' : 'native_pet_show_transition_timeout',
    petState: lastPetState,
    panelPageObserved: Boolean(panelPage),
    elapsedMs: Date.now() - startedAt,
  }
}

/**
 * Change visibility using one explicitly selected, verifiable pause entry.
 *
 * Native mode exercises the product path: the Live2D-bearing pet page opens
 * the chat panel, which hides the pet BrowserWindow, then the hidden pet page
 * closes that panel to restore itself. Emulated mode is available only when
 * explicitly requested for a controlled fixture; it is never a native-mode
 * fallback. Any unavailable or unverifiable mode fails closed.
 */
export async function setWindowHidden(
  browser,
  page,
  hidden,
  { mode = process.env.PACKAGED_RUNTIME_VISIBILITY_MODE || 'native' } = {},
) {
  const attempts = []
  let pageSession = null

  try {
    if (!browser || !page) {
      return { ok: false, hidden, reason: 'browser_or_page_unavailable', attempts }
    }

    const expectedVisibilityState = hidden ? 'hidden' : 'visible'
    if (!['native', 'emulated'].includes(mode)) {
      return {
        ok: false,
        hidden,
        reason: `unsupported_visibility_mode=${mode}`,
        attempts,
      }
    }

    if (mode === 'native') {
      if (!isViewPage(page, 'pet')) {
        return {
          ok: false,
          hidden,
          method: NATIVE_VISIBILITY_METHOD,
          reason: 'native_pet_panel_transition_requires_pet_page',
          attempts,
        }
      }

      const before = await readPetVisibility(page)
      if (!before?.probeInstalled) {
        return {
          ok: false,
          hidden,
          method: NATIVE_VISIBILITY_METHOD,
          visibilityState: before?.visibilityState ?? null,
          reason: 'native_pet_live2d_probe_unavailable',
          attempts,
        }
      }
      if (hidden ? before.hidden : !before.hidden) {
        return {
          ok: false,
          hidden,
          method: NATIVE_VISIBILITY_METHOD,
          visibilityState: before.visibilityState,
          reason: hidden ? 'native_hide_requires_visible_pet' : 'native_show_requires_hidden_pet',
          attempts,
        }
      }

      const invoked = await invokePetPanelAction(page, hidden)
      attempts.push({ method: NATIVE_VISIBILITY_METHOD, actionInvoked: invoked.ok === true, ...invoked })
      if (!invoked.ok) {
        return {
          ok: false,
          hidden,
          method: NATIVE_VISIBILITY_METHOD,
          visibilityState: before.visibilityState,
          reason: 'native_pet_panel_action_failed',
          attempts,
        }
      }

      const transition = await waitForNativePetPanelTransition(browser, page, hidden)
      attempts.push({ method: NATIVE_VISIBILITY_METHOD, ...transition })
      if (!transition.ok) {
        return {
          ok: false,
          hidden,
          method: NATIVE_VISIBILITY_METHOD,
          visibilityState: transition.petState?.visibilityState ?? null,
          reason: transition.reason,
          panelPageObserved: transition.panelPageObserved,
          attempts,
        }
      }

      return {
        ok: true,
        hidden,
        method: NATIVE_VISIBILITY_METHOD,
        visibilityState: transition.petState.visibilityState,
        panelPageObserved: transition.panelPageObserved,
        transitionElapsedMs: transition.elapsedMs,
        attempts,
      }
    }

    // Explicit fixture mode only. This is not reached after native failure.
    pageSession = await page.context().newCDPSession(page)
    try {
      await pageSession.send('Emulation.setEmulatedVisibilityState', {
        visibility: expectedVisibilityState,
      })
      await wait(100)
      const visibilityState = await readVisibilityState(page)
      if (visibilityState === expectedVisibilityState) {
        return {
          ok: true,
          hidden,
          visibilityState,
          method: 'Emulation.setEmulatedVisibilityState',
          explicitMode: true,
          attempts,
        }
      }
      attempts.push({
        method: 'Emulation.setEmulatedVisibilityState',
        ok: false,
        reason: `visibilityState=${visibilityState} expected=${expectedVisibilityState}`,
      })
    } catch (error) {
      attempts.push({
        method: 'Emulation.setEmulatedVisibilityState',
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
      })
    }

    return {
      ok: false,
      hidden,
      reason: 'visibility_pause_entry_unverified',
      attempts,
    }
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
      hidden,
      attempts,
    }
  } finally {
    if (pageSession) {
      await pageSession.detach().catch(() => {})
    }
  }
}

export async function waitForCdpHttp(port, timeoutMs) {
  const started = Date.now()
  let lastError = null
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(2000),
      })
      if (response.ok) {
        const body = await response.json()
        return { ok: true, body, elapsedMs: Date.now() - started }
      }
      lastError = new Error(`HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await wait(300)
  }
  return {
    ok: false,
    error: lastError instanceof Error ? lastError.message : String(lastError),
    elapsedMs: Date.now() - started,
  }
}
