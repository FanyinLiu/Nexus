import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  attachLive2DModelTicker,
  clearLive2DAsyncHandles,
  createIdempotentResourceDestroyer,
  createLive2DAsyncOwnershipCoordinator,
  destroyLateLive2DResource,
  LIVE2D_TEARDOWN,
  resolveLive2DVisibilityPlayback,
  syncLive2DPlayback,
  shouldAbortLive2DBoot,
  shouldContinueLive2DModelAttempt,
  shouldDestroyLateLive2DModel,
  trackLive2DAsyncHandle,
} from '../src/features/pet/components/live2d/lifecycle.ts'

const canvasPath = new URL('../src/features/pet/components/Live2DCanvas.tsx', import.meta.url)
const vendorPath = new URL('../src/features/pet/components/live2d/vendor.ts', import.meta.url)
const lifecyclePath = new URL('../src/features/pet/components/live2d/lifecycle.ts', import.meta.url)

test('shouldAbortLive2DBoot stops when disposed or container is missing', () => {
  assert.equal(shouldAbortLive2DBoot(false, true), false)
  assert.equal(shouldAbortLive2DBoot(true, true), true)
  assert.equal(shouldAbortLive2DBoot(false, false), true)
  assert.equal(shouldAbortLive2DBoot(true, false), true)
})

test('shouldDestroyLateLive2DModel covers timeout and dispose', () => {
  assert.equal(shouldDestroyLateLive2DModel({ disposed: false, timedOut: false }), false)
  assert.equal(shouldDestroyLateLive2DModel({ disposed: true, timedOut: false }), true)
  assert.equal(shouldDestroyLateLive2DModel({ disposed: false, timedOut: true }), true)
  assert.equal(shouldDestroyLateLive2DModel({ disposed: true, timedOut: true }), true)
})

test('shouldContinueLive2DModelAttempt rejects dispose and out-of-range attempts', () => {
  assert.equal(shouldContinueLive2DModelAttempt({
    disposed: false,
    attempt: 1,
    maxAttempts: 3,
  }), true)
  assert.equal(shouldContinueLive2DModelAttempt({
    disposed: true,
    attempt: 1,
    maxAttempts: 3,
  }), false)
  assert.equal(shouldContinueLive2DModelAttempt({
    disposed: false,
    attempt: 4,
    maxAttempts: 3,
  }), false)
  assert.equal(shouldContinueLive2DModelAttempt({
    disposed: false,
    attempt: 0,
    maxAttempts: 3,
  }), false)
})

test('resolveLive2DVisibilityPlayback pauses while hidden, paused, or disposed', () => {
  assert.equal(resolveLive2DVisibilityPlayback({
    disposed: false,
    visibilityState: 'visible',
    paused: false,
  }), 'start')
  assert.equal(resolveLive2DVisibilityPlayback({
    disposed: false,
    visibilityState: 'hidden',
    paused: false,
  }), 'stop')
  assert.equal(resolveLive2DVisibilityPlayback({
    disposed: false,
    visibilityState: 'visible',
    paused: true,
  }), 'stop')
  assert.equal(resolveLive2DVisibilityPlayback({
    disposed: true,
    visibilityState: 'visible',
    paused: false,
  }), 'stop')
  assert.equal(resolveLive2DVisibilityPlayback({
    disposed: true,
    visibilityState: 'hidden',
    paused: true,
  }), 'stop')
})

test('syncLive2DPlayback only starts or stops an existing app and never destroys it', () => {
  let startCount = 0
  let stopCount = 0
  let destroyCount = 0
  const app = {
    start() { startCount += 1 },
    stop() { stopCount += 1 },
    destroy() { destroyCount += 1 },
  }

  syncLive2DPlayback(app, { disposed: false, visibilityState: 'visible', paused: false })
  syncLive2DPlayback(app, { disposed: false, visibilityState: 'visible', paused: true })
  syncLive2DPlayback(app, { disposed: false, visibilityState: 'visible', paused: false })
  syncLive2DPlayback(app, { disposed: true, visibilityState: 'visible', paused: false })

  assert.equal(startCount, 2)
  assert.equal(stopCount, 2)
  assert.equal(destroyCount, 0)
  app.destroy()
  assert.equal(destroyCount, 1)
})

test('attachLive2DModelTicker uses only the app ticker and detaches without hidden-time accumulation', () => {
  const appListeners = new Set<(delta: number) => void>()
  const sharedListeners = new Set<(delta: number) => void>()
  const updates: number[] = []
  let active = true
  const appTicker = {
    deltaMS: 16,
    add(listener: (delta: number) => void) {
      appListeners.add(listener)
    },
    remove(listener: (delta: number) => void) {
      appListeners.delete(listener)
    },
  }
  const cleanup = attachLive2DModelTicker({
    ticker: appTicker,
    model: { update: (deltaMS) => updates.push(deltaMS) },
    shouldUpdate: () => active,
  })

  assert.equal(sharedListeners.size, 0)
  assert.equal(appListeners.size, 1)
  for (const listener of appListeners) listener(999)
  active = false
  appTicker.deltaMS = 2_000
  for (const listener of appListeners) listener(999)
  active = true
  appTicker.deltaMS = 17
  for (const listener of appListeners) listener(1)
  assert.deepEqual(updates, [16, 17])

  const registeredListener = [...appListeners][0]
  cleanup()
  cleanup()
  registeredListener?.(123)
  assert.equal(appListeners.size, 0)
  assert.equal(sharedListeners.size, 0)
  assert.deepEqual(updates, [16, 17])
})

test('destroyLateLive2DResource only destroys after dispose and uses late flags', () => {
  let destroyCount = 0
  let lastOptions: unknown
  const resource = {
    destroy(options?: unknown) {
      destroyCount += 1
      lastOptions = options
    },
  }

  assert.equal(destroyLateLive2DResource(resource, false), false)
  assert.equal(destroyCount, 0)
  assert.equal(destroyLateLive2DResource(null, true), false)
  assert.equal(destroyLateLive2DResource(resource, true), true)
  assert.equal(destroyCount, 1)
  assert.deepEqual(lastOptions, LIVE2D_TEARDOWN.lateModel)
  assert.equal(LIVE2D_TEARDOWN.lateModel.texture, false)
  assert.equal(LIVE2D_TEARDOWN.lateModel.baseTexture, false)
})

test('async handle tracking supports bulk timeout cancellation', () => {
  const handles = new Set<number>()
  const cleared: number[] = []

  trackLive2DAsyncHandle(handles, 11)
  trackLive2DAsyncHandle(handles, 22)
  assert.deepEqual([...handles].sort((a, b) => a - b), [11, 22])

  clearLive2DAsyncHandles(handles, (id) => {
    cleared.push(id)
  })

  assert.deepEqual(cleared.sort((a, b) => a - b), [11, 22])
  assert.equal(handles.size, 0)
})

test('tracked wait settles exactly once when cancelled via settle and dispose', async () => {
  const ownership = createLive2DAsyncOwnershipCoordinator()
  const { promise, settle } = ownership.createTrackedWait()
  let settleCount = 0
  void promise.then(() => {
    settleCount += 1
  })

  settle()
  settle()
  ownership.dispose()
  await promise
  // Let any duplicate resolve paths flush.
  await Promise.resolve()

  assert.equal(settleCount, 1)
})

test('aborting multiple pending load races rejects each exactly once while Set mutates', async () => {
  const ownership = createLive2DAsyncOwnershipCoordinator()
  const outcomes: string[] = []
  const rejectCounts = [0, 0, 0]

  const races = [0, 1, 2].map((index) => ownership.raceModelLoad({
    loadPromise: new Promise(() => {
      // Never resolves — only abort path settles.
    }),
    shouldDiscard: () => ownership.isDisposed,
  }).then(
    () => {
      outcomes.push(`fulfilled:${index}`)
    },
    () => {
      rejectCounts[index] += 1
      outcomes.push(`rejected:${index}`)
    },
  ))

  // Allow abort rejecters to register on the coordinator Set.
  await Promise.resolve()
  ownership.dispose()
  await Promise.all(races)
  await Promise.resolve()

  assert.deepEqual(outcomes.sort(), [
    'rejected:0',
    'rejected:1',
    'rejected:2',
  ])
  assert.deepEqual(rejectCounts, [1, 1, 1])
})

test('late model after timeout/abort is destroyed once with no unhandled rejection', async () => {
  const ownership = createLive2DAsyncOwnershipCoordinator()
  const unhandled: unknown[] = []
  const onUnhandled = (reason: unknown) => {
    unhandled.push(reason)
  }
  process.on('unhandledRejection', onUnhandled)

  try {
    let resolveLoad: ((model: { destroy: (options?: unknown) => void }) => void) | null = null
    let destroyCount = 0
    let lastDestroyOptions: unknown
    const loadPromise = new Promise<{ destroy: (options?: unknown) => void }>((resolve) => {
      resolveLoad = resolve
    })

    let timedOut = false
    const race = ownership.raceModelLoad({
      loadPromise,
      shouldDiscard: () => shouldDestroyLateLive2DModel({
        disposed: ownership.isDisposed,
        timedOut,
      }),
      registerAbort: (abort) => {
        // Simulate timeout winning the race, then a late model resolution.
        timedOut = true
        abort(new Error('Live2D model load timed out.'))
      },
    })

    await assert.rejects(race, /timed out|aborted|Discarded/)

    resolveLoad?.({
      destroy(options?: unknown) {
        destroyCount += 1
        lastDestroyOptions = options
      },
    })

    // Flush microtasks from the late guardedLoad path.
    await Promise.resolve()
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))

    assert.equal(destroyCount, 1)
    assert.deepEqual(lastDestroyOptions, LIVE2D_TEARDOWN.lateModel)

    // Same model identity must not be destroyed twice after a late discard.
    const ownership2 = createLive2DAsyncOwnershipCoordinator()
    let resolveShared: ((model: { destroy: () => void }) => void) | null = null
    const sharedLoad = new Promise<{ destroy: () => void }>((resolve) => {
      resolveShared = resolve
    })
    let sharedDestroyCount = 0
    const sharedModel = {
      destroy() {
        sharedDestroyCount += 1
      },
    }
    const race2 = ownership2.raceModelLoad({
      loadPromise: sharedLoad,
      shouldDiscard: () => true,
      registerAbort: (abort) => abort(new Error('Live2D boot aborted.')),
    })
    await assert.rejects(race2)
    resolveShared?.(sharedModel)
    await Promise.resolve()
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(sharedDestroyCount, 1)
    ownership2.destroyLateModel(sharedModel)
    assert.equal(sharedDestroyCount, 1)

    assert.equal(unhandled.length, 0)
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
})

test('owned model/app destruction is idempotent and uses intentional texture flags', () => {
  const ownership = createLive2DAsyncOwnershipCoordinator()
  let modelDestroyCount = 0
  let appDestroyCount = 0
  let modelOptions: unknown
  let appRemoveView: unknown
  let appStageOptions: unknown

  const model = {
    destroy(options?: unknown) {
      modelDestroyCount += 1
      modelOptions = options
    },
  }
  const app = {
    destroy(removeView?: boolean, stageOptions?: unknown) {
      appDestroyCount += 1
      appRemoveView = removeView
      appStageOptions = stageOptions
    },
  }

  ownership.destroyOwnedRuntime({ model, app })
  ownership.destroyOwnedRuntime({ model, app })
  ownership.destroyApplication(app)
  ownership.destroyLateModel(model)

  assert.equal(modelDestroyCount, 1)
  assert.equal(appDestroyCount, 1)
  assert.deepEqual(modelOptions, LIVE2D_TEARDOWN.ownedModel)
  assert.equal(appRemoveView, true)
  assert.deepEqual(appStageOptions, LIVE2D_TEARDOWN.appStage)
  assert.equal(LIVE2D_TEARDOWN.ownedModel.texture, true)
  assert.equal(LIVE2D_TEARDOWN.ownedModel.baseTexture, true)
  assert.equal(LIVE2D_TEARDOWN.appStage.texture, false)
  assert.equal(LIVE2D_TEARDOWN.appStage.baseTexture, false)
})

test('idempotent resource destroyer never double-destroys the same object', () => {
  const destroyer = createIdempotentResourceDestroyer()
  let count = 0
  const resource = {
    destroy() {
      count += 1
    },
  }

  assert.equal(destroyer.destroyOnce(resource, (item) => item.destroy()), true)
  assert.equal(destroyer.destroyOnce(resource, (item) => item.destroy()), false)
  assert.equal(count, 1)
  assert.equal(destroyer.wasDestroyed(resource), true)
})

test('Live2DCanvas wires ownership coordinator and does not set React state in cleanup', async () => {
  const canvasSource = await readFile(canvasPath, 'utf8')

  assert.match(canvasSource, /createLive2DAsyncOwnershipCoordinator/)
  assert.match(canvasSource, /ownership\.dispose\(\)/)
  assert.match(canvasSource, /ownership\.createTrackedWait\(\)/)
  assert.match(canvasSource, /ownership\.raceModelLoad/)
  assert.match(canvasSource, /ownership\.destroyOwnedRuntime/)
  assert.match(canvasSource, /ownership\.destroyLateModel/)
  assert.match(canvasSource, /ownership\.destroyApplication/)

  // Cleanup must invalidate ownership / destroy resources only — no React setters.
  assert.match(
    canvasSource,
    /return \(\) => \{[\s\S]*?clearPendingBootWork\(\)[\s\S]*?destroyOwnedRuntime\(\)/,
  )
  assert.doesNotMatch(
    canvasSource,
    /return \(\) => \{[\s\S]*?setModelReady\(/,
  )
  assert.doesNotMatch(
    canvasSource,
    /return \(\) => \{[\s\S]*?setError\(/,
  )

  // Boot initializes visible state before the first await.
  assert.match(
    canvasSource,
    /setModelReady\(false\)[\s\S]*?await ensureLive2DVendorScripts\(\)/,
  )

  // Visibility respects the current document state; no forced visible reset.
  assert.match(
    canvasSource,
    /document\.addEventListener\('visibilitychange', handleVisibilityChange\)[\s\S]*?handleVisibilityChange\(\)/,
  )
  assert.match(canvasSource, /syncLive2DPlayback/)
  assert.match(canvasSource, /autoUpdate: false/)
  assert.match(canvasSource, /attachLive2DModelTicker/)
  assert.match(canvasSource, /app\.ticker/)
  assert.match(canvasSource, /modelTickerCleanupRef\.current\?\.\(\)/)
  assert.match(canvasSource, /speechLevelSourceRef\.current\?\.current/)
  assert.doesNotMatch(canvasSource, /speechLevel=\{voice\.speechLevel\}/)
  assert.match(canvasSource, /paused\?: boolean/)
  assert.match(canvasSource, /const pausedRef = useRef\(paused\)/)
  assert.match(canvasSource, /paused: pausedRef\.current/)
  assert.match(canvasSource, /syncPlayback\(app, isDisposed\(\)\)/)
  assert.match(canvasSource, /pausedRef\.current = paused[\s\S]*?syncPlayback\(appRef\.current, false\)/)
  const bootEffect = canvasSource.match(
    /useEffect\(\(\) => \{\s*const ownership =([\s\S]*?)\n\s{2}\}, \[([\s\S]*?)\n\s{2}\]\)/,
  )?.[2]
  assert.ok(bootEffect, 'the boot effect dependency list should remain inspectable')
  assert.doesNotMatch(bootEffect, /\bpaused\b/)

  // Await boundaries stay guarded.
  assert.match(
    canvasSource,
    /await ensureLive2DVendorScripts\(\)[\s\S]*?shouldAbortLive2DBoot\(isDisposed\(\)/,
  )
  assert.match(
    canvasSource,
    /await fetch\(resolvedModelPath\)[\s\S]*?shouldAbortLive2DBoot\(isDisposed\(\)/,
  )
  assert.match(
    canvasSource,
    /await loadModelWithRetry\(Live2DModel\)[\s\S]*?ownership\.destroyLateModel\(model\)/,
  )
})

test('failed Live2D vendor scripts are removed so retry can create a fresh tag', async () => {
  const vendorSource = await readFile(vendorPath, 'utf8')

  assert.match(vendorSource, /dataset\.failed === 'true'/)
  assert.match(vendorSource, /existingScript\.remove\(\)/)
  assert.match(vendorSource, /failedScript\.dataset\.failed = 'true'/)
  assert.match(vendorSource, /failedScript\.remove\(\)/)
  assert.match(vendorSource, /live2dVendorScriptsPromise = null/)
})

test('lifecycle helpers stay pure (no DOM / Pixi side effects in module body)', async () => {
  const lifecycleSource = await readFile(lifecyclePath, 'utf8')
  // Strip block/line comments so documentation may mention PIXI/TextureCache.
  const codeOnly = lifecycleSource
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

  assert.doesNotMatch(codeOnly, /document\./)
  assert.doesNotMatch(codeOnly, /window\./)
  assert.doesNotMatch(codeOnly, /\bPIXI\b/)
  assert.doesNotMatch(codeOnly, /requestAnimationFrame/)
  assert.doesNotMatch(codeOnly, /setTimeout/)
  assert.match(lifecycleSource, /LIVE2D_TEARDOWN/)
  assert.match(lifecycleSource, /createLive2DAsyncOwnershipCoordinator/)
  assert.match(
    lifecycleSource,
    /Remaining measurement gap: packaged GPU\/memory proof/,
  )
})
