import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'

async function readSourcesInDirectory(directory: URL): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const sources = await Promise.all(entries.map(async (entry) => {
    if (entry.isDirectory()) return readSourcesInDirectory(new URL(`${entry.name}/`, directory))
    if (!entry.name.endsWith('.tsx')) return []
    return [await readFile(new URL(entry.name, directory), 'utf8')]
  }))

  return sources.flat()
}

test('settings status messages keep live-region semantics centralized', async () => {
  const source = await readFile(new URL('../src/components/settingsFields.tsx', import.meta.url), 'utf8')

  assert.match(source, /export function SettingsStatusMessage/)
  assert.match(source, /resolvedTone === 'error' \? 'alert' : 'status'/)
  assert.match(source, /resolvedTone === 'error' \? 'assertive' : 'polite'/)
  assert.match(source, /settings-test-result/)
})

test('model region filter uses the settings segmented-control contract', async () => {
  const source = await readFile(new URL('../src/components/settingsFields.tsx', import.meta.url), 'utf8')
  const modelSource = await readFile(new URL('../src/components/settingsSections/ModelSection.tsx', import.meta.url), 'utf8')

  assert.match(source, /export function SettingsSegmentedControl/)
  assert.match(source, /role="radiogroup"/)
  assert.match(source, /role="radio"/)
  assert.match(source, /aria-checked=\{selected\}/)
  assert.equal(modelSource.includes('onboarding-region-tabs'), false)
})

test('settings sections use the shared switch component', async () => {
  const source = await readFile(new URL('../src/components/settingsFields.tsx', import.meta.url), 'utf8')
  const sectionSources = await readSourcesInDirectory(new URL('../src/components/settingsSections/', import.meta.url))

  assert.match(source, /export function SettingsToggle/)
  assert.match(source, /settings-toggle__label--hidden/)
  assert.match(source, /onChange=\{\(event\) => onChange\(event\.target\.checked\)\}/)
  assert.match(source, /<SettingsToggle/)
  assert.equal(
    sectionSources.some((sectionSource) => sectionSource.includes('<label className="settings-toggle')),
    false,
  )
})

test('settings drawer delegates its save area to the shared action bar', async () => {
  const source = await readFile(new URL('../src/components/settingsFields.tsx', import.meta.url), 'utf8')
  const drawerSource = await readFile(new URL('../src/components/SettingsDrawer.tsx', import.meta.url), 'utf8')

  assert.match(source, /export function SettingsActionBar/)
  assert.match(source, /settings-drawer__actions[^"]*settings-action-bar/)
  assert.match(drawerSource, /<SettingsActionBar/)
  assert.equal(drawerSource.includes('<div className="settings-drawer__actions">'), false)
})
