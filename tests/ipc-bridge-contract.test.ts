import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import { validateWeatherToolPayload } from '../electron/ipc/payloadSchemas.js'

const ROOT = path.resolve(import.meta.dirname, '..')
const PRELOAD_PATH = path.join(ROOT, 'electron', 'preload.js')
const VITE_ENV_PATH = path.join(ROOT, 'src', 'vite-env.d.ts')
const AUTONOMY_TYPES_PATH = path.join(ROOT, 'src', 'types', 'autonomy.ts')
const WINDOW_IPC_PATH = path.join(ROOT, 'electron', 'ipc', 'windowIpc.js')

function walkFiles(dir: string, predicate: (file: string) => boolean): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath, predicate))
    } else if (predicate(fullPath)) {
      files.push(fullPath)
    }
  }
  return files
}

function extractRegexMatches(source: string, regex: RegExp): string[] {
  return [...source.matchAll(regex)].map((match) => match[1])
}

function loadPreloadDesktopPetApi() {
  const preloadSource = fs.readFileSync(PRELOAD_PATH, 'utf8')
  const exposed: Record<string, unknown> = {}
  const invokedChannels: string[] = []
  const subscribedChannels = new Map<string, Set<(...args: unknown[]) => void>>()
  const removedChannels: Array<{ channel: string; handler: (...args: unknown[]) => void }> = []
  const ipcRenderer = {
    invoke(channel: string, payload?: unknown) {
      invokedChannels.push(channel)
      return Promise.resolve(payload)
    },
    on(channel: string, handler: (...args: unknown[]) => void) {
      const handlers = subscribedChannels.get(channel) ?? new Set()
      handlers.add(handler)
      subscribedChannels.set(channel, handlers)
    },
    removeListener(channel: string, handler: (...args: unknown[]) => void) {
      subscribedChannels.get(channel)?.delete(handler)
      removedChannels.push({ channel, handler })
    },
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
    process: { env: { NEXUS_ENABLE_REALTIME_VOICE: '1' } },
    console,
    Date,
    Math,
    crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000000' },
  }, { filename: PRELOAD_PATH })

  const desktopPet = exposed.desktopPet as Record<string, unknown> | undefined
  assert.ok(desktopPet, 'preload did not expose desktopPet')
  return {
    desktopPet,
    invokedChannels,
    subscribedChannels,
    removedChannels,
  }
}

function getPreloadDesktopPetKeys() {
  return Object.keys(loadPreloadDesktopPetApi().desktopPet).sort()
}

function getDeclaredDesktopPetKeys() {
  const source = fs.readFileSync(VITE_ENV_PATH, 'utf8')
  const file = ts.createSourceFile(VITE_ENV_PATH, source, ts.ScriptTarget.Latest, true)
  const keys = new Set<string>()

  function visit(node: ts.Node) {
    if (ts.isInterfaceDeclaration(node) && node.name.text === 'Window') {
      const desktopPet = node.members.find((member): member is ts.PropertySignature => (
        ts.isPropertySignature(member)
        && ts.isIdentifier(member.name)
        && member.name.text === 'desktopPet'
        && Boolean(member.type)
        && ts.isTypeLiteralNode(member.type)
      ))
      assert.ok(desktopPet?.type && ts.isTypeLiteralNode(desktopPet.type), 'Window.desktopPet type literal not found')
      for (const member of desktopPet.type.members) {
        if (
          (ts.isPropertySignature(member) || ts.isMethodSignature(member))
          && ts.isIdentifier(member.name)
        ) {
          keys.add(member.name.text)
        }
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(file)
  assert.ok(keys.size > 0, 'no Window.desktopPet keys found in vite-env.d.ts')
  return [...keys].sort()
}

test('preload desktopPet API keys match the Window.desktopPet type contract', () => {
  const preloadKeys = getPreloadDesktopPetKeys()
  const declaredKeys = getDeclaredDesktopPetKeys()

  assert.deepEqual(
    declaredKeys.filter((key) => !preloadKeys.includes(key)),
    [],
    'vite-env.d.ts declares desktopPet APIs that preload does not expose',
  )
  assert.deepEqual(
    preloadKeys.filter((key) => !declaredKeys.includes(key)),
    [],
    'preload exposes desktopPet APIs missing from vite-env.d.ts',
  )
})

test('every preload invoke channel has an ipcMain handler', () => {
  const preload = fs.readFileSync(PRELOAD_PATH, 'utf8')
  const invokeChannels = new Set(extractRegexMatches(preload, /ipcRenderer\.invoke\(['"]([^'"]+)['"]/g))
  const handlerChannels = new Set<string>()

  for (const file of walkFiles(path.join(ROOT, 'electron', 'ipc'), (file) => file.endsWith('.js'))) {
    for (const channel of extractRegexMatches(fs.readFileSync(file, 'utf8'), /ipcMain\.handle\(['"]([^'"]+)['"]/g)) {
      handlerChannels.add(channel)
    }
  }

  assert.deepEqual([...invokeChannels].filter((channel) => !handlerChannels.has(channel)).sort(), [])
})

test('every preload subscription channel has a main-process event source', () => {
  const preload = fs.readFileSync(PRELOAD_PATH, 'utf8')
  const subscribedChannels = new Set(extractRegexMatches(preload, /ipcRenderer\.on\(['"]([^'"]+)['"]/g))
  const electronSources = walkFiles(path.join(ROOT, 'electron'), (file) => file.endsWith('.js') && file !== PRELOAD_PATH)
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\\n')

  const missing = [...subscribedChannels].filter((channel) => !electronSources.includes(channel)).sort()
  assert.deepEqual(missing, [])
})

test('preload power event subscription forwards payloads and unregisters handlers', () => {
  const { desktopPet, subscribedChannels, removedChannels } = loadPreloadDesktopPetApi()
  const events: unknown[] = []
  const subscribePowerEvents = desktopPet.subscribePowerEvents as ((listener: (event: unknown) => void) => () => void) | undefined

  assert.equal(typeof subscribePowerEvents, 'function')
  const unsubscribe = subscribePowerEvents((event) => events.push(event))
  const handlers = subscribedChannels.get('app:power-event')

  assert.equal(handlers?.size, 1)
  const [handler] = [...handlers ?? []]
  handler({}, { kind: 'lock-screen' })
  assert.deepEqual(events, [{ kind: 'lock-screen' }])

  unsubscribe()
  assert.equal(subscribedChannels.get('app:power-event')?.size ?? 0, 0)
  assert.equal(removedChannels[0]?.channel, 'app:power-event')
  assert.equal(removedChannels[0]?.handler, handler)
})

test('power event kinds stay aligned between main bridge and renderer types', () => {
  const windowIpc = fs.readFileSync(WINDOW_IPC_PATH, 'utf8')
  const autonomyTypes = fs.readFileSync(AUTONOMY_TYPES_PATH, 'utf8')
  const powerKinds = [...(windowIpc.match(/POWER_EVENT_KINDS = \[([^\]]+)\]/)?.[1] ?? '').matchAll(/'([^']+)'/g)]
    .map((match) => match[1])
    .sort()
  const typedKinds = [...(autonomyTypes.match(/export type PowerEventKind = ([^\n]+)/)?.[1] ?? '').matchAll(/'([^']+)'/g)]
    .map((match) => match[1])
    .sort()

  assert.ok(powerKinds.length > 0, 'POWER_EVENT_KINDS not found in main bridge')
  assert.deepEqual(powerKinds, typedKinds)
})

test('idle time IPC clamps negative powerMonitor values before reaching renderer', () => {
  const windowIpc = fs.readFileSync(WINDOW_IPC_PATH, 'utf8')
  assert.match(
    windowIpc,
    /ipcMain\.handle\('app:get-system-idle-time'[\s\S]*?Math\.max\(0,\s*powerMonitor\.getSystemIdleTime\(\)\)/,
  )
})

test('weather IPC accepts quiet ambient lookup payloads', () => {
  const payload = validateWeatherToolPayload({
    location: 'Tokyo',
    fallbackLocation: 'Kyoto',
    locale: 'ja',
    quiet: true,
    policy: { enabled: true, requiresConfirmation: false },
  }) as {
    location: string
    fallbackLocation?: string
    locale?: string
    quiet?: boolean
    policy?: { enabled?: boolean; requiresConfirmation?: boolean }
  }

  assert.equal(payload.location, 'Tokyo')
  assert.equal(payload.fallbackLocation, 'Kyoto')
  assert.equal(payload.locale, 'ja')
  assert.equal(payload.quiet, true)
  assert.equal(payload.policy?.enabled, true)
  assert.equal(payload.policy?.requiresConfirmation, false)
  assert.throws(() => validateWeatherToolPayload({ location: 'Paris', locale: 'fr-FR' }))
})

test('ambient weather is quiet without muting explicit weather tool failures', () => {
  const hook = fs.readFileSync(path.join(ROOT, 'src', 'hooks', 'useAmbientWeather.ts'), 'utf8')
  assert.match(
    hook,
    /loadAmbientWeatherSnapshot\(trimmedLocation, \{ locale \}\)/,
    'ambient weather hook should use the shared weather loader',
  )
  assert.match(
    hook,
    /getWeather\?\.\(\{\s*location:\s*normalizedLocation,\s*locale,\s*quiet:\s*true,?\s*policy:\s*\{\s*enabled:\s*true,\s*requiresConfirmation:\s*false\s*\},?\s*\}\)/s,
    'ambient weather should pass locale and quiet: true to the IPC bridge',
  )

  const windowIpc = fs.readFileSync(path.join(ROOT, 'electron', 'ipc', 'windowIpc.js'), 'utf8')
  assert.match(
    windowIpc,
    /if \(payload\.quiet\) \{\s*try \{\s*return await invokeRegisteredTool\(event, 'weather_lookup', payload\)[\s\S]*?catch \{\s*return null\s*\}/,
    'quiet weather IPC should degrade to null instead of rejecting',
  )

  const registry = fs.readFileSync(path.join(ROOT, 'src', 'features', 'tools', 'registry.ts'), 'utf8')
  const weatherToolCall = registry.match(/window\.desktopPet\.getWeather\(\{[\s\S]*?\n\s*\}\)/)?.[0] ?? ''
  assert.ok(weatherToolCall, 'weather tool registry call not found')
  assert.doesNotMatch(
    weatherToolCall,
    /\bquiet\b/,
    'explicit weather tool calls should continue surfacing weather lookup failures',
  )
})
