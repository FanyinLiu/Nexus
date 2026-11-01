import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import {
  buildDesktopPetMethodTypes,
  deriveIpcChannelTypes,
  extractDesktopPetBridgeSurface,
  generateDesktopPetBridgeTypes,
  isGeneratedTypesCurrent,
  normalizeGeneratedTypesLineEndings,
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
  const expected = generateDesktopPetBridgeTypes({ preloadSource: readPreloadSource() })
  const actual = normalizeGeneratedTypesLineEndings(fs.readFileSync(GENERATED_PATH, 'utf8'))
  assert.equal(actual, expected)
})

test('check comparison accepts CRLF output but still detects content drift', () => {
  const expected = generateDesktopPetBridgeTypes({ preloadSource: readPreloadSource() })

  assert.equal(isGeneratedTypesCurrent(expected, expected.replaceAll('\n', '\r\n')), true)
  assert.equal(isGeneratedTypesCurrent(expected, `${expected}// drifted\n`), false)
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

test('rendered argument and result maps are deterministic for reversed method input', () => {
  const surface = extractDesktopPetBridgeSurface(readPreloadSource())
  const channelTypes = deriveIpcChannelTypes({
    handlerFiles: fs.readdirSync(path.join(ROOT, 'electron', 'ipc'))
      .filter((name) => name.endsWith('.js'))
      .sort()
      .map((name) => path.join(ROOT, 'electron', 'ipc', name)),
  })
  const methodTypes = buildDesktopPetMethodTypes(surface, channelTypes)
  const reversed = Object.fromEntries(Object.entries(methodTypes).reverse())

  assert.equal(
    renderDesktopPetBridgeTypes(surface, methodTypes),
    renderDesktopPetBridgeTypes(surface, reversed),
  )
})

function writeTypeFixture(files: Record<string, string>): string {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-ipc-types-')))
  for (const [name, source] of Object.entries(files)) {
    fs.writeFileSync(path.join(directory, name), source)
  }
  return directory
}

function renderFixtureSchemaType(directory: string): string {
  const { channelArguments } = deriveIpcChannelTypes({
    handlerFiles: [path.join(directory, 'handler.js'), path.join(directory, 'demoPayloadSchemas.js')],
  })
  return channelArguments['demo:save']?.type ?? ''
}

test('a payload schema change changes the generated argument type', () => {
  const baseSchema = `
    const demoSchema = {
      type: 'object',
      fields: {
        name: { type: 'string' },
      },
    }
    /**
     * @param {unknown} payload
     * @returns {{ name: string }}
     */
    export function validateDemoPayload(payload) {
      return validateIpcPayload('demo:save', payload, demoSchema)
    }
  `
  const handler = `
    import { validateDemoPayload } from './demoPayloadSchemas.js'
    ipcMain.handle('demo:save', (event, payload) => {
      payload = validateDemoPayload(payload)
      return { ok: true }
    })
  `
  const directory = writeTypeFixture({
    'demoPayloadSchemas.js': baseSchema,
    'handler.js': handler,
  })
  const before = renderFixtureSchemaType(directory)
  assert.equal(before, '{ name: string }')

  fs.writeFileSync(path.join(directory, 'demoPayloadSchemas.js'), baseSchema
    .replace("name: { type: 'string' },", "name: { type: 'string' },\n        count: { type: 'number' },")
    .replace('@returns {{ name: string }}', '@returns {{ name: string, count: number }}'))

  const after = renderFixtureSchemaType(directory)
  assert.equal(after, '{ name: string; count: number }')
  assert.notEqual(after, before)
})

test('methods with multiple preload parameters keep unknown argument types', () => {
  const surface = extractDesktopPetBridgeSurface(readPreloadSource())
  const channelTypes = deriveIpcChannelTypes({
    handlerFiles: fs.readdirSync(path.join(ROOT, 'electron', 'ipc'))
      .filter((name) => name.endsWith('.js'))
      .sort()
      .map((name) => path.join(ROOT, 'electron', 'ipc', name)),
  })
  const methodTypes = buildDesktopPetMethodTypes(surface, channelTypes)

  assert.equal(methodTypes.vaultStore?.argument, 'unknown')
  assert.equal(methodTypes.completeChatStream?.argument, 'unknown')
  assert.equal(methodTypes.closePanel?.argument, 'readonly []')
})

