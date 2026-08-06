import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'

async function readSourcesInDirectory(directory: URL): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const sources = await Promise.all(entries.map(async (entry) => {
    if (entry.isDirectory()) return readSourcesInDirectory(new URL(`${entry.name}/`, directory))
    if (!entry.name.endsWith('.tsx')) return []
    // Shared primitives own the switch markup; section files must consume
    // them instead of re-implementing the label/input structure.
    if (entry.name === 'SettingsV3Primitives.tsx') return []
    return [await readFile(new URL(entry.name, directory), 'utf8')]
  }))

  return sources.flat()
}

test('settings V3 sections do not re-implement the shared switch markup', async () => {
  const sectionSources = await readSourcesInDirectory(new URL('../src/features/settingsV3/', import.meta.url))

  assert.equal(
    sectionSources.some((sectionSource) => sectionSource.includes('<label className="settings-v3-switch"')),
    false,
  )
})

test('model region filter stays off the onboarding tab chrome', async () => {
  const modelSource = await readFile(new URL('../src/features/settingsV3/ModelSectionV3.tsx', import.meta.url), 'utf8')

  assert.equal(modelSource.includes('onboarding-region-tabs'), false)
})

test('settings drawer delegates its save area to the shared action bar', async () => {
  const source = await readFile(new URL('../src/components/settingsFields.tsx', import.meta.url), 'utf8')
  const drawerSource = await readFile(new URL('../src/components/SettingsDrawer.tsx', import.meta.url), 'utf8')

  assert.match(source, /export function SettingsActionBar/)
  assert.match(source, /settings-drawer__actions[^"]*settings-action-bar/)
  assert.match(drawerSource, /<SettingsActionBar/)
  assert.equal(drawerSource.includes('<div className="settings-drawer__actions">'), false)
})
