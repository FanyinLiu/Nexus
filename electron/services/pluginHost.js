import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import * as mcpHost from './mcpHost.js'

const PLUGINS_DIR_NAME = 'plugins'
const PLUGIN_MANIFEST_FILE = 'plugin.json'

/** @type {Map<string, PluginEntry>} */
const _plugins = new Map()

/**
 * @typedef {{
 *   id: string
 *   name: string
 *   description: string
 *   version: string
 *   command: string
 *   args: string[]
 *   autoStart: boolean
 *   enabled: boolean
 *   pluginDir: string
 *   manifestPath: string
 *   capabilities: string[]
 * }} PluginEntry
 */

function getPluginsDir() {
  return path.join(app.getPath('userData'), PLUGINS_DIR_NAME)
}

function resolvePluginCommand(pluginDir, command) {
  if (path.isAbsolute(command)) return command
  if (command.startsWith('.')) return path.resolve(pluginDir, command)
  return command
}

async function readPluginManifest(pluginDir) {
  const manifestPath = path.join(pluginDir, PLUGIN_MANIFEST_FILE)
  const raw = await readFile(manifestPath, 'utf8')
  const manifest = JSON.parse(raw)

  if (!manifest.id || !manifest.name || !manifest.command) {
    throw new Error(`Invalid plugin manifest: missing required fields (id, name, command)`)
  }

  return {
    id: String(manifest.id),
    name: String(manifest.name),
    description: String(manifest.description ?? ''),
    version: String(manifest.version ?? '0.0.0'),
    command: resolvePluginCommand(pluginDir, String(manifest.command)),
    args: Array.isArray(manifest.args) ? manifest.args.map(String) : [],
    autoStart: manifest.autoStart !== false,
    enabled: true,
    pluginDir,
    manifestPath,
    capabilities: Array.isArray(manifest.capabilities) ? manifest.capabilities : ['tools'],
  }
}

export async function scanPlugins() {
  const pluginsDir = getPluginsDir()

  let entries
  try {
    entries = await readdir(pluginsDir)
  } catch {
    return []
  }

  const discovered = []

  for (const entry of entries) {
    const pluginDir = path.join(pluginsDir, entry)
    try {
      const stats = await stat(pluginDir)
      if (!stats.isDirectory()) continue

      const manifest = await readPluginManifest(pluginDir)

      const existing = _plugins.get(manifest.id)
      if (existing) {
        manifest.enabled = existing.enabled
      }

      _plugins.set(manifest.id, manifest)
      discovered.push(manifest)
    } catch (err) {
      console.warn(`[pluginHost] skipping ${entry}:`, err.message)
    }
  }

  return discovered
}

export async function startPlugin(pluginId) {
  const plugin = _plugins.get(pluginId)
  if (!plugin) throw new Error(`Plugin not found: ${pluginId}`)
  if (!plugin.enabled) throw new Error(`Plugin is disabled: ${pluginId}`)

  const mcpServerId = `plugin:${pluginId}`
  await mcpHost.start(mcpServerId, plugin.command, plugin.args)

  return mcpHost.getStatus(mcpServerId)
}

export async function stopPlugin(pluginId) {
  const mcpServerId = `plugin:${pluginId}`
  await mcpHost.stop(mcpServerId)
}

export async function restartPlugin(pluginId) {
  const plugin = _plugins.get(pluginId)
  if (!plugin) throw new Error(`Plugin not found: ${pluginId}`)

  const mcpServerId = `plugin:${pluginId}`
  await mcpHost.restart(mcpServerId, plugin.command, plugin.args)

  return mcpHost.getStatus(mcpServerId)
}

export function enablePlugin(pluginId) {
  const plugin = _plugins.get(pluginId)
  if (!plugin) throw new Error(`Plugin not found: ${pluginId}`)

  plugin.enabled = true
  return getPluginStatus(pluginId)
}

export function disablePlugin(pluginId) {
  const plugin = _plugins.get(pluginId)
  if (!plugin) throw new Error(`Plugin not found: ${pluginId}`)

  plugin.enabled = false
  void stopPlugin(pluginId).catch(() => {})
  return getPluginStatus(pluginId)
}

export function getPluginStatus(pluginId) {
  const plugin = _plugins.get(pluginId)
  if (!plugin) return null

  const mcpServerId = `plugin:${pluginId}`
  const mcpStatus = mcpHost.getStatus(mcpServerId)

  return {
    id: plugin.id,
    name: plugin.name,
    description: plugin.description,
    version: plugin.version,
    enabled: plugin.enabled,
    running: mcpStatus.state === 'running',
    mcpState: mcpStatus.state,
    toolCount: mcpStatus.toolCount,
    tools: mcpStatus.tools,
    capabilities: plugin.capabilities,
  }
}

export function listPlugins() {
  return [..._plugins.values()].map((plugin) => getPluginStatus(plugin.id))
}

export async function autoStartPlugins() {
  const plugins = await scanPlugins()
  const autoStartable = plugins.filter((p) => p.enabled && p.autoStart)

  const results = []
  for (const plugin of autoStartable) {
    try {
      await startPlugin(plugin.id)
      results.push({ id: plugin.id, ok: true })
      console.info(`[pluginHost] auto-started: ${plugin.name}`)
    } catch (err) {
      results.push({ id: plugin.id, ok: false, error: err.message })
      console.warn(`[pluginHost] auto-start failed for ${plugin.name}:`, err.message)
    }
  }

  return results
}

export function getPluginsDir_() {
  return getPluginsDir()
}
