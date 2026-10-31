import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import {
  extractDesktopPetBridgeSurface,
  renderDesktopPetBridgeTypes,
} from '../scripts/generate-ipc-types.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const PRELOAD_PATH = path.join(ROOT, 'electron', 'preload.js')
const GENERATED_PATH = path.join(ROOT, 'src', 'types', 'generated', 'desktopPetBridge.generated.ts')

function readPreloadSource() {
  return fs.readFileSync(PRELOAD_PATH, 'utf8')
}

function loadPanelDesktopPetKeys() {
  const preloadSource = readPreloadSource()
  const exposed: Record<string, unknown> = {}
  const ipcRenderer = {
    invoke: () => Promise.resolve(),
    on: () => {},
    removeListener: () => {},
  }

  vm.runInNewContext(preloadSource, {
    require(name: string) {
      if (name !== 'electron') throw new Error(`Unexpected preload require: ${name}`)
      return {
        contextBridge: {
          exposeInMainWorld(name: string, api: unknown) {
            exposed[name] = api
          },
        },
        ipcRenderer,
      }
    },
    window: { location: { search: '?view=panel' } },
    URLSearchParams,
    console,
    Date,
    Math,
    crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000000' },
  }, { filename: PRELOAD_PATH })

  const desktopPet = exposed.desktopPet as Record<string, unknown> | undefined
  assert.ok(desktopPet, 'preload did not expose desktopPet')
  return Object.keys(desktopPet).sort()
}

test('generated bridge types are not stale with respect to electron/preload.js', () => {
  const expected = renderDesktopPetBridgeTypes(extractDesktopPetBridgeSurface(readPreloadSource()))
  const actual = fs.readFileSync(GENERATED_PATH, 'utf8')
  assert.equal(actual, expected)
})

test('extracted bridge keys match the panel preload surface', () => {
  const surface = extractDesktopPetBridgeSurface(readPreloadSource())
  assert.deepEqual(Object.keys(surface).sort(), loadPanelDesktopPetKeys())
})

test('extractor records conditional members and their IPC channels', () => {
  const surface = extractDesktopPetBridgeSurface(readPreloadSource())

  for (const key of ['consumeModelSetupRequest', 'declineModelSetup', 'subscribeModelSetupRequest']) {
    assert.equal(surface[key]?.conditional, true, `${key} should be conditional`)
  }
  assert.equal(surface.updatePetWindowState?.conditional, false)

  assert.deepEqual(surface.updatePetWindowState?.invoke, ['pet-window:update-state'])
  assert.deepEqual(surface.subscribePetWindowState?.events, ['pet-window:state-changed'])
})

test('extractor rejects computed property names', () => {
  const fixture = `
    const { contextBridge, ipcRenderer } = require('electron')
    const dynamicKey = 'dynamic'
    contextBridge.exposeInMainWorld('desktopPet', {
      [dynamicKey]: () => ipcRenderer.invoke('dynamic:channel'),
    })
  `
  assert.throws(() => extractDesktopPetBridgeSurface(fixture), /property names must be static/)
})

test('extractor rejects preloads without an exposeInMainWorld call', () => {
  const fixture = `
    const { ipcRenderer } = require('electron')
    function unused() {
      return ipcRenderer.invoke('some:channel')
    }
  `
  assert.throws(() => extractDesktopPetBridgeSurface(fixture), /no contextBridge\.exposeInMainWorld/)
})

test('render output is deterministic and sorts keys', () => {
  const surface = extractDesktopPetBridgeSurface(readPreloadSource())
  const reversed = Object.fromEntries(Object.entries(surface).reverse())

  assert.equal(renderDesktopPetBridgeTypes(surface), renderDesktopPetBridgeTypes(surface))
  assert.equal(renderDesktopPetBridgeTypes(reversed), renderDesktopPetBridgeTypes(surface))

  const rendered = renderDesktopPetBridgeTypes(surface)
  const keys = Object.keys(surface).sort()
  const positions = keys.map((key) => rendered.indexOf(`  ${key}: {`))
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b))
})
