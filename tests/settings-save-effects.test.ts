import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { commitSettingsDraft, shouldPurgeRecentCompanionData } from '../src/components/settingsSaveEffects.ts'
import type { AppSettings } from '../src/types/index.ts'

const readSource = (url: URL) => readFile(url, 'utf8').then((source) => source.replace(/\r\n?/g, '\n'))

function makeSettings(contextAwarenessEnabled: boolean): AppSettings {
  return { contextAwarenessEnabled } as AppSettings
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (error?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

test('draft changes alone never purge recent companion data', () => {
  const committed = makeSettings(true)
  const draft = makeSettings(false)

  assert.equal(shouldPurgeRecentCompanionData(committed, draft), true)
  // Discard restores the committed draft without crossing commitSettingsDraft.
  assert.equal(shouldPurgeRecentCompanionData(committed, committed), false)
})

test('saving the true-to-false transition purges only after settings commit', async () => {
  const calls: string[] = []

  await commitSettingsDraft({
    committed: makeSettings(true),
    draft: makeSettings(false),
    onSave: async () => { calls.push('save') },
    onContextAwarenessDisabled: () => calls.push('purge'),
  })

  assert.deepEqual(calls, ['save', 'purge'])
})

test('saving without a true-to-false transition does not purge', async () => {
  for (const [before, after] of [[true, true], [false, false], [false, true]] as const) {
    let purges = 0
    await commitSettingsDraft({
      committed: makeSettings(before),
      draft: makeSettings(after),
      onSave: async () => undefined,
      onContextAwarenessDisabled: () => { purges += 1 },
    })
    assert.equal(purges, 0, `${before} -> ${after}`)
  }
})

test('pending save keeps awareness data until save resolves', async () => {
  const save = deferred<void>()
  let purges = 0
  const commit = commitSettingsDraft({
    committed: makeSettings(true),
    draft: makeSettings(false),
    onSave: async () => save.promise,
    onContextAwarenessDisabled: () => { purges += 1 },
  })

  await Promise.resolve()
  assert.equal(purges, 0)
  save.resolve()
  await commit
  assert.equal(purges, 1)
})

test('failed save rejects and never purges awareness data', async () => {
  const saveError = new Error('save failed')
  let purges = 0
  const commit = commitSettingsDraft({
    committed: makeSettings(true),
    draft: makeSettings(false),
    onSave: async () => { throw saveError },
    onContextAwarenessDisabled: () => { purges += 1 },
  })

  await assert.rejects(commit, saveError)
  assert.equal(purges, 0)
})

test('settings commits use the serial functional mutation authority', async () => {
  const commitSource = await readSource(new URL('../src/app/store/commitSettingsUpdate.ts', import.meta.url))
  const themeSource = await readSource(new URL('../src/app/providers/ThemeProvider.tsx', import.meta.url))
  const drawerSource = await readSource(new URL('../src/components/SettingsDrawer.tsx', import.meta.url))
  const overlaysSource = await readSource(new URL('../src/app/controllers/useAppOverlays.ts', import.meta.url))
  const setThemeSource = themeSource.match(/setTheme:\s*\([\s\S]*?\n\s*\},\n\s*theme,/)?.[0] ?? ''
  const settingsOnSaveSource = overlaysSource.match(/onSave: async \(nextSettings, baselineSettings\) => \{[\s\S]*?\n\s*\},\n\s*onImportPetModel/)?.[0] ?? ''
  const commitDraftSource = drawerSource.match(/function commitDraft\(\): Promise<void> \{[\s\S]*?\n\s*\}\n\n\s*async function handleSaveDraft/)?.[0] ?? ''
  const handleSaveDraftSource = drawerSource.match(/async function handleSaveDraft\(\) \{[\s\S]*?\n\s*\}\n\n\s*async function handleStartVoiceConversation/)?.[0] ?? ''
  const handleStartVoiceSource = drawerSource.match(/async function handleStartVoiceConversation\(\) \{[\s\S]*?\n\s*\}\n\n\s*function handleOpenSettingsSection/)?.[0] ?? ''

  assert.match(commitSource, /updateSettingsSnapshot\(update, apply\)/)
  assert.doesNotMatch(commitSource, /getSettingsSnapshot|setSettingsSnapshot/)
  assert.match(setThemeSource, /updateSettingsSnapshot\([\s\S]*?\)\.catch\(/)
  assert.doesNotMatch(setThemeSource, /getSettingsSnapshot|setSettingsSnapshot/)
  assert.match(drawerSource, /onSave: \(settings: AppSettings, baseline: AppSettings\) => Promise<void>/)
  assert.match(commitDraftSource, /const savePromise = commitSettingsDraft\(\{/)
  assert.match(commitDraftSource, /if \(saveInFlightRef\.current\) return saveInFlightRef\.current/)
  assert.match(commitDraftSource, /saveInFlightRef\.current = savePromise/)
  assert.match(commitDraftSource, /return savePromise/)
  assert.match(handleSaveDraftSource, /await commitDraft\(\)/)
  assert.match(handleStartVoiceSource, /if \(isDirty\) \{\s*await commitDraft\(\)/)
  assert.match(drawerSource, /getRedactedLogErrorMessage\(error\)/)
  assert.match(settingsOnSaveSource, /chat\.appendSystemMessage\(/)
  assert.match(settingsOnSaveSource, /throw error/)
  assert.match(settingsOnSaveSource, /onSave: async \(nextSettings, baselineSettings\)/)
  assert.match(settingsOnSaveSource, /baselineSettings,/)
  assert.match(
    overlaysSource,
    /const launchOnStartupChanged = !Object\.is\([\s\S]*?else if \(launchOnStartupChanged\)[\s\S]*?setLaunchOnStartup/,
  )
  assert.match(overlaysSource, /reuseUnchangedProviderProfileMaps\(/)
  assert.match(overlaysSource, /pickTranslatedUiText\(\s*committedSettings\.uiLanguage/)
  assert.doesNotMatch(overlaysSource, /pickTranslatedUiText\(\s*finalSettings\.uiLanguage/)
})
