const installedTargets = new WeakSet()

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

export function classifyIpcAuditCategories(channel) {
  const normalized = String(channel ?? '')
  const categories = []
  const mutatingPattern = /:(abort|approve|assemble|connect|create|delete|disable|disconnect|download|enable|execute|feed|finish|import|index|install|mark-used|open|publish|remove|restart|revoke|save|send|set|start|stop|store|subscribe|sync|transcribe|unsubscribe|update)/

  if (normalized.startsWith('vault:')) categories.push('secret-vault')
  if (/^(chat|service|audio|tts|tencent-asr|telegram|discord|mcp|notification|doctor|integrations):/.test(normalized)
    || normalized === 'tool:web-search'
    || normalized === 'tool:get-weather') {
    categories.push('network-or-integration')
  }
  if (/^(file|pet-model|persona|plugin|plugin-bus|skill|memory):/.test(normalized)) {
    categories.push('local-data-or-files')
  }
  if (/^(tool:open-external|updater:install|app:set-launch-on-startup|media-session:control|window:|pet-window:|panel-window:|runtime-state:update|proactive:show-notification)/.test(normalized)) {
    categories.push('system-action')
  }
  if (mutatingPattern.test(normalized)) categories.push('mutating')

  return unique(categories)
}

export function isHighRiskIpcChannel(channel) {
  return classifyIpcAuditCategories(channel).some((category) => (
    category === 'secret-vault'
    || category === 'local-data-or-files'
    || category === 'system-action'
    || category === 'network-or-integration'
  ))
}

function senderSummary(event) {
  const url = String(event?.senderFrame?.url ?? event?.sender?.getURL?.() ?? '')
  let originKind = 'unknown'

  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'file:') {
      originKind = 'file'
    } else if (['127.0.0.1', 'localhost'].includes(parsed.hostname)) {
      originKind = 'local-dev'
    } else if (parsed.protocol === 'app:') {
      originKind = 'app'
    } else if (parsed.protocol) {
      originKind = parsed.protocol.replace(/:$/u, '') || 'other'
    }
  } catch {
    if (url) originKind = 'unparseable'
  }

  return {
    webContentsId: Number.isInteger(event?.sender?.id) ? event.sender.id : null,
    originKind,
  }
}

function safeErrorName(error) {
  if (error instanceof Error && error.name) return error.name
  return typeof error
}

function auditHighRiskResult(auditFn, channel, categories, event, startedAt, outcome, error) {
  const durationMs = Math.max(0, Date.now() - startedAt)
  const details = {
    channel,
    categories,
    outcome,
    durationMs,
    sender: senderSummary(event),
  }

  if (error) {
    details.errorName = safeErrorName(error)
  }

  auditFn('ipc', 'high-risk-invoke', details)
}

export function installHighRiskIpcAudit(ipcMainLike, options = {}) {
  const target = ipcMainLike
  if (!target || typeof target.handle !== 'function') {
    throw new Error('installHighRiskIpcAudit requires an ipcMain-like object with handle(channel, listener).')
  }
  if (installedTargets.has(target)) {
    return { installed: false }
  }

  const auditFn = options.auditFn
  if (typeof auditFn !== 'function') {
    throw new Error('installHighRiskIpcAudit requires an auditFn option.')
  }
  const originalHandle = target.handle.bind(target)

  target.handle = (channel, listener) => {
    if (!isHighRiskIpcChannel(channel)) {
      return originalHandle(channel, listener)
    }

    const categories = classifyIpcAuditCategories(channel)
    return originalHandle(channel, async (event, ...args) => {
      const startedAt = Date.now()
      try {
        const result = await listener(event, ...args)
        auditHighRiskResult(auditFn, channel, categories, event, startedAt, 'ok')
        return result
      } catch (error) {
        auditHighRiskResult(auditFn, channel, categories, event, startedAt, 'error', error)
        throw error
      }
    })
  }

  installedTargets.add(target)
  return { installed: true }
}
