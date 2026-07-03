import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { buildPlatformProfile } from '../electron/platformProfile.js'
import {
  resolveDesktopContextDiagnostics,
  type DesktopContextDiagnosticItemId,
} from '../src/features/context/desktopContextDiagnostics.ts'

function findItem(
  items: ReturnType<typeof resolveDesktopContextDiagnostics>['items'],
  id: DesktopContextDiagnosticItemId,
) {
  const item = items.find((candidate) => candidate.id === id)
  assert.ok(item, `missing diagnostic item: ${id}`)
  return item
}

test('desktop context diagnostics maps existing enabled settings into UI status keys', () => {
  const platformProfile = buildPlatformProfile({
    platform: 'darwin',
    packaged: true,
  })

  const diagnostics = resolveDesktopContextDiagnostics({
    activeWindowContextEnabled: true,
    clipboardContextEnabled: false,
    companionAwarenessPaused: false,
    contextAwarenessEnabled: true,
    platformProfile,
    screenContextEnabled: false,
  })

  assert.equal(diagnostics.contextAwarenessAvailable, true)
  assert.equal(diagnostics.activeWindowAvailable, true)
  assert.equal(diagnostics.clipboardAvailable, true)
  assert.equal(diagnostics.screenContextAvailable, true)

  const companion = findItem(diagnostics.items, 'companion-continuity')
  assert.equal(companion.source, 'ui_label_only')
  assert.equal(companion.active, true)
  assert.equal(companion.status.key, 'settings.memory.context.status_enabled')
  assert.equal(companion.platformHint, null)

  const activeWindow = findItem(diagnostics.items, 'active-window')
  assert.equal(activeWindow.source, 'capability_flag')
  assert.equal(activeWindow.active, true)
  assert.equal(activeWindow.status.key, 'settings.memory.context.status_enabled')
  assert.equal(activeWindow.hint.key, 'settings.memory.context.active_window_hint')

  const clipboard = findItem(diagnostics.items, 'clipboard')
  assert.equal(clipboard.source, 'capability_flag')
  assert.equal(clipboard.active, false)
  assert.equal(clipboard.status.key, 'settings.memory.context.status_ready')

  const screenOcr = findItem(diagnostics.items, 'screen-ocr')
  assert.equal(screenOcr.source, 'capability_flag')
  assert.equal(screenOcr.active, false)
  assert.equal(screenOcr.status.key, 'settings.memory.context.status_ready')
})

test('desktop context diagnostics keeps companion pause distinct from capability availability', () => {
  const platformProfile = buildPlatformProfile({
    platform: 'darwin',
    packaged: true,
  })

  const diagnostics = resolveDesktopContextDiagnostics({
    activeWindowContextEnabled: true,
    clipboardContextEnabled: true,
    companionAwarenessPaused: true,
    contextAwarenessEnabled: true,
    platformProfile,
    screenContextEnabled: true,
  })

  const companion = findItem(diagnostics.items, 'companion-continuity')
  assert.equal(companion.active, false)
  assert.equal(companion.available, true)
  assert.equal(companion.status.key, 'settings.memory.context.status_paused')

  assert.equal(findItem(diagnostics.items, 'active-window').status.key, 'settings.memory.context.status_enabled')
  assert.equal(findItem(diagnostics.items, 'clipboard').status.key, 'settings.memory.context.status_enabled')
  assert.equal(findItem(diagnostics.items, 'screen-ocr').status.key, 'settings.memory.context.status_enabled')
})

test('desktop context diagnostics coarsens platform dependency gaps without raw content', () => {
  const platformProfile = buildPlatformProfile({
    platform: 'linux',
    packaged: true,
    env: { PATH: '', DISPLAY: '' },
    hasExecutable: () => false,
  })

  const diagnostics = resolveDesktopContextDiagnostics({
    activeWindowContextEnabled: true,
    clipboardContextEnabled: true,
    companionAwarenessPaused: false,
    contextAwarenessEnabled: true,
    platformProfile,
    screenContextEnabled: true,
  })

  assert.equal(diagnostics.contextAwarenessAvailable, false)

  const activeWindow = findItem(diagnostics.items, 'active-window')
  assert.equal(activeWindow.available, false)
  assert.equal(activeWindow.active, false)
  assert.equal(activeWindow.status.key, 'settings.memory.context.status_unavailable')
  assert.equal(activeWindow.platformHint?.key, 'settings.platform.unavailable')
  assert.equal(activeWindow.platformHint?.params, undefined)

  const clipboard = findItem(diagnostics.items, 'clipboard')
  assert.equal(clipboard.platformHint?.key, 'settings.platform.unavailable')

  for (const item of diagnostics.items) {
    assert.equal(item.platformHint?.params, undefined)
  }

  const serialized = JSON.stringify(diagnostics)
  assert.doesNotMatch(serialized, /PRIVATE_WINDOW_TITLE|PRIVATE_CLIPBOARD|data:image/)
  assert.doesNotMatch(serialized, /xdotool|xprop|X11|XWayland|DISPLAY/)
})

test('desktop context diagnostics stays a source-only presentation mapper', () => {
  const source = readFileSync(join(process.cwd(), 'src/features/context/desktopContextDiagnostics.ts'), 'utf8')

  assert.doesNotMatch(source, /from ['"]electron['"]/)
  assert.doesNotMatch(source, /desktopCapturer/)
  assert.doesNotMatch(source, /desktop-context:get/)
  assert.doesNotMatch(source, /clipboard\./)
  assert.doesNotMatch(source, /readText/)
  assert.doesNotMatch(source, /activeWindowTitle/)
  assert.doesNotMatch(source, /screenshotDataUrl/)
  assert.doesNotMatch(source, /screenText/)
})

test('desktop context diagnostics is stable for identical capability inputs', () => {
  const platformProfile = buildPlatformProfile({
    platform: 'darwin',
    packaged: true,
  })
  const input = {
    activeWindowContextEnabled: true,
    clipboardContextEnabled: true,
    companionAwarenessPaused: false,
    contextAwarenessEnabled: true,
    platformProfile,
    screenContextEnabled: false,
  }

  assert.deepEqual(
    resolveDesktopContextDiagnostics(input),
    resolveDesktopContextDiagnostics(input),
  )
})

test('MemorySection consumes the diagnostics view model instead of inline platform logic', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/settingsSections/MemorySection.tsx'), 'utf8')

  assert.match(source, /resolveDesktopContextDiagnostics\(/)
  assert.doesNotMatch(source, /getPlatformDependencyHint/)
  assert.doesNotMatch(source, /isDesktopContextActiveWindowAvailable/)
  assert.doesNotMatch(source, /isDesktopContextClipboardAvailable/)
  assert.doesNotMatch(source, /isDesktopContextScreenshotAvailable/)
})
