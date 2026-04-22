import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { app, dialog } from 'electron'
import * as mcpHost from './mcpHost.js'
import { hashCommand, isPluginCommandTrusted as _isPluginCommandTrusted } from './pluginHostUtils.js'

const PLUGINS_DIR_NAME = 'plugins'
const PLUGIN_MANIFEST_FILE = 'plugin.json'
const PLUGIN_SKILL_FILE = 'SKILL.md'
const APPROVED_PLUGINS_FILE = 'approved-plugins.json'

/** @type {Map<string, PluginEntry>} */
const _plugins = new Map()

/** @type {Map<string, string>} id → command hash */
let _approvedPlugins = new Map()
let _approvedPluginsLoaded = false

// hashCommand is now imported from pluginHostUtils.js

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
 *   skillGuide: string
 * }} PluginEntry
 */

function getPluginsDir() {
  return path.join(app.getPath('userData'), PLUGINS_DIR_NAME)
}

function getApprovedPluginsPath() {
  return path.join(app.getPath('userData'), APPROVED_PLUGINS_FILE)
}

async function loadApprovedPlugins() {
  if (_approvedPluginsLoaded) return
  try {
    const raw = await readFile(getApprovedPluginsPath(), 'utf8')
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      // Migrate from old format (array of ids) → map with empty hash (will re-prompt)
      _approvedPlugins = new Map(parsed.filter((id) => typeof id === 'string').map((id) => [id, '']))
    } else if (typeof parsed === 'object' && parsed !== null) {
      _approvedPlugins = new Map(Object.entries(parsed).filter(([, v]) => typeof v === 'string'))
    }
  } catch (err) {
    if (err?.code !== 'ENOENT') {
      console.error('[pluginHost] Failed to load approved plugins:', err?.message)
    }
  }
  _approvedPluginsLoaded = true
}

async function persistApprovedPlugins() {
  await writeFile(
    getApprovedPluginsPath(),
    JSON.stringify(Object.fromEntries(_approvedPlugins), null, 2),
    'utf8',
  )
}

export function isPluginApproved(pluginId) {
  return _approvedPlugins.has(pluginId)
}

/** Check if a plugin's command still matches its approved hash. */
function isPluginCommandTrusted(plugin) {
  return _isPluginCommandTrusted(plugin, _approvedPlugins)
}

export async function approvePlugin(pluginId) {
  const plugin = _plugins.get(pluginId)
  const cmdHash = plugin ? hashCommand(plugin.command, plugin.args) : ''
  _approvedPlugins.set(pluginId, cmdHash)
  await persistApprovedPlugins()
}

export async function revokePluginApproval(pluginId) {
  _approvedPlugins.delete(pluginId)
  await persistApprovedPlugins()
  void stopPlugin(pluginId).catch(() => {})
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

  let skillGuide = ''
  try {
    skillGuide = await readFile(path.join(pluginDir, PLUGIN_SKILL_FILE), 'utf8')
  } catch {
    // No SKILL.md — that's fine
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
    skillGuide,
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

/** Well-known capabilities that gate specific MCP tool categories. */
const VALID_CAPABILITIES = new Set(['tools', 'resources', 'prompts', 'notifications', 'filesystem', 'network'])

export async function startPlugin(pluginId) {
  const plugin = _plugins.get(pluginId)
  if (!plugin) throw new Error(`Plugin not found: ${pluginId}`)
  if (!plugin.enabled) throw new Error(`Plugin is disabled: ${pluginId}`)
  if (!_approvedPlugins.has(pluginId)) throw new Error(`Plugin not approved: ${pluginId}. Approve it in settings first.`)
  if (!isPluginCommandTrusted(plugin)) throw new Error(`Plugin "${pluginId}" command has changed since approval. Re-approve it in settings.`)

  const mcpServerId = `plugin:${pluginId}`
  // Pass declared capabilities before starting so they're available immediately
  const sanitizedCaps = (plugin.capabilities || ['tools']).filter((c) => VALID_CAPABILITIES.has(c))
  mcpHost.setCapabilities(mcpServerId, sanitizedCaps)
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
    approved: _approvedPlugins.has(plugin.id),
    commandTrusted: isPluginCommandTrusted(plugin),
    running: mcpStatus.state === 'running',
    mcpState: mcpStatus.state,
    toolCount: mcpStatus.toolCount,
    tools: mcpStatus.tools,
    capabilities: plugin.capabilities,
    skillGuide: plugin.skillGuide || '',
    metrics: mcpStatus.metrics ?? null,
  }
}

export function listPlugins() {
  return [..._plugins.values()].map((plugin) => getPluginStatus(plugin.id))
}

async function promptBatchPluginApproval(plugins) {
  const listing = plugins.map((p) => `  • ${p.name} (${p.id} v${p.version})`).join('\n')
  const { response } = await dialog.showMessageBox({
    type: 'question',
    buttons: ['全部允许', '全部拒绝'],
    defaultId: 1,
    cancelId: 1,
    title: `${plugins.length} 个插件需要授权`,
    message: `发现 ${plugins.length} 个插件需要授权启动`,
    detail: `${listing}\n\n允许后它们将作为本地进程运行，并可提供 MCP 工具。`,
  })
  return response === 0 ? plugins : []
}

async function promptPluginApproval(plugin) {
  const isReapproval = _approvedPlugins.has(plugin.id)
  const { response } = await dialog.showMessageBox({
    type: 'question',
    buttons: ['允许启动', '拒绝'],
    defaultId: 1,
    cancelId: 1,
    title: isReapproval ? '插件更新授权' : '新插件授权',
    message: isReapproval
      ? `插件「${plugin.name}」的启动命令已变更，需要重新授权`
      : `发现新插件「${plugin.name}」`,
    detail: [
      `插件 ID：${plugin.id}`,
      `版本：${plugin.version}`,
      plugin.description ? `描述：${plugin.description}` : '',
      `命令：${plugin.command}`,
      '',
      isReapproval
        ? '该插件的命令或参数已变更。重新授权后它将作为本地进程运行。'
        : '该插件请求自动启动权限。允许后它将作为本地进程运行，并可提供 MCP 工具。',
    ].filter(Boolean).join('\n'),
  })
  return response === 0
}

export async function autoStartPlugins() {
  await loadApprovedPlugins()
  const plugins = await scanPlugins()

  // Plugins needing approval: new or command changed since last approval
  const needApproval = plugins.filter((p) => p.enabled && p.autoStart && (!_approvedPlugins.has(p.id) || !isPluginCommandTrusted(p)))
  if (needApproval.length === 1) {
    const plugin = needApproval[0]
    const allowed = await promptPluginApproval(plugin)
    if (allowed) {
      _approvedPlugins.set(plugin.id, hashCommand(plugin.command, plugin.args))
      console.info(`[pluginHost] user approved plugin: ${plugin.name}`)
    } else {
      console.info(`[pluginHost] user rejected plugin: ${plugin.name}`)
    }
    await persistApprovedPlugins()
  } else if (needApproval.length > 1) {
    const approved = await promptBatchPluginApproval(needApproval)
    for (const plugin of approved) {
      _approvedPlugins.set(plugin.id, hashCommand(plugin.command, plugin.args))
      console.info(`[pluginHost] user approved plugin: ${plugin.name}`)
    }
    if (approved.length) {
      await persistApprovedPlugins()
    }
  }

  const autoStartable = plugins.filter((p) => p.enabled && p.autoStart && isPluginCommandTrusted(p))

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

/**
 * Check whether a plugin has a specific capability.
 * Used by MCP IPC layer to enforce capability-based access control.
 */
export function hasCapability(pluginId, capability) {
  const plugin = _plugins.get(pluginId)
  if (!plugin) return false
  return (plugin.capabilities || ['tools']).includes(capability)
}

export function getPluginsDir_() {
  return getPluginsDir()
}
