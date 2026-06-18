#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const MESSAGE_ADAPTER_CONTRACT_GATE = 'nexus-message-adapter-contract'

export const MESSAGE_ADAPTER_CAPTURE_METHODS = [
  {
    id: 'system-notification',
    label: 'System notification',
    notes: 'Reads user-visible OS notification events instead of private app stores.',
  },
  {
    id: 'public-api',
    label: 'Public API',
    notes: 'Uses an official app or service API with user-granted credentials.',
  },
  {
    id: 'user-automation',
    label: 'User-owned automation',
    notes: 'Uses Shortcuts, Hammerspoon, shell hooks, or similar user-configured automation.',
  },
  {
    id: 'mail-rule',
    label: 'Mail rule or forwarder',
    notes: 'Uses a user-configured mail rule, forwarder, or mailbox automation.',
  },
  {
    id: 'imap-api',
    label: 'IMAP or mailbox API',
    notes: 'Uses mailbox credentials or OAuth with explicit user consent.',
  },
  {
    id: 'export-file',
    label: 'User export file',
    notes: 'Uses an explicit user-created export, not a private app database.',
  },
]

export const MESSAGE_ADAPTER_SURFACES = [
  {
    id: 'local-webhook',
    status: 'available',
    kind: 'webhook-ingress',
    label: 'Local webhook',
    notes: 'Localhost POST endpoint used by external automation and helper adapters.',
  },
  {
    id: 'macos-notification-center',
    status: 'available-live-gated',
    kind: 'system-notification',
    label: 'macOS Notification Center watcher',
    notes: 'Requires Full Disk Access and v0.3.4 live evidence before stable release claims.',
  },
  {
    id: 'telegram-native',
    status: 'available-live-gated',
    kind: 'native-bridge',
    label: 'Telegram bot bridge',
    notes: 'Prefer the native Telegram bridge for Telegram itself; webhook adapters may duplicate native events.',
  },
  {
    id: 'discord-native',
    status: 'available-live-gated',
    kind: 'native-bridge',
    label: 'Discord gateway bridge',
    notes: 'Prefer the native Discord bridge for Discord itself; webhook adapters may duplicate native events.',
  },
  {
    id: 'automation-helper-macos-shortcuts',
    status: 'available-helper',
    kind: 'external-adapter',
    label: 'macOS Shortcuts / shell helper',
    notes: 'Calls scripts/send-message-webhook.mjs with user-supplied message fields.',
  },
  {
    id: 'automation-helper-hammerspoon',
    status: 'available-helper',
    kind: 'external-adapter',
    label: 'Hammerspoon helper',
    notes: 'Calls the same local webhook contract from user-owned automation.',
  },
  {
    id: 'automation-helper-windows-powershell',
    status: 'available-helper',
    kind: 'external-adapter',
    label: 'Windows PowerShell helper',
    notes: 'Calls the same local webhook contract from Windows automation.',
  },
  {
    id: 'email-forwarder',
    status: 'planned-contract',
    kind: 'external-adapter',
    label: 'Email forwarder adapter',
    notes: 'Use mail rules, IMAP/API, or user automation to post summarized email events into the local webhook.',
    allowedCaptureMethods: ['mail-rule', 'imap-api', 'public-api', 'user-automation', 'system-notification', 'export-file'],
  },
  {
    id: 'im-notification-exporter',
    status: 'planned-contract',
    kind: 'external-adapter',
    label: 'More IM adapters',
    notes: 'Use public APIs, system notifications, or user-owned automation; do not claim private database access.',
    allowedCaptureMethods: ['system-notification', 'public-api', 'user-automation', 'export-file'],
  },
]

export const MESSAGE_ADAPTER_PAYLOAD_TEMPLATES = [
  {
    id: 'email-mail-rule',
    aliases: ['email', 'mail', 'mail-rule'],
    category: 'email',
    label: 'Email mail-rule forwarder payload',
    notes: 'Use when a user-owned mail rule or forwarder posts a safe email summary to the local webhook.',
    payload: {
      kind: 'message',
      source: 'Mail',
      sender: 'REPLACE_WITH_SENDER_OR_SERVICE',
      chatTitle: 'REPLACE_WITH_SAFE_SUBJECT_OR_THREAD_LABEL',
      conversationId: 'mail-thread-REPLACE_WITH_STABLE_THREAD_ID',
      messageId: 'mail-message-REPLACE_WITH_STABLE_MESSAGE_ID',
      text: 'REPLACE_WITH_SAFE_EMAIL_SUMMARY_OR_SHORT_EXCERPT',
      captureMethod: 'mail-rule',
    },
  },
  {
    id: 'email-imap',
    aliases: ['imap', 'imap-api', 'mailbox'],
    category: 'email',
    label: 'Email IMAP/API polling payload',
    notes: 'Use when a permissioned IMAP or mailbox API adapter posts a safe email summary to the local webhook.',
    payload: {
      kind: 'message',
      source: 'Gmail',
      sender: 'REPLACE_WITH_SENDER_OR_SERVICE',
      chatTitle: 'REPLACE_WITH_SAFE_SUBJECT_OR_THREAD_LABEL',
      conversationId: 'imap-thread-REPLACE_WITH_STABLE_THREAD_ID',
      messageId: 'imap-message-REPLACE_WITH_STABLE_MESSAGE_ID',
      text: 'REPLACE_WITH_SAFE_EMAIL_SUMMARY_OR_SHORT_EXCERPT',
      captureMethod: 'imap-api',
    },
  },
  {
    id: 'im-system-notification',
    aliases: ['im', 'wechat', 'notification', 'system-notification'],
    category: 'im',
    label: 'IM system-notification payload',
    notes: 'Use when a visible system notification from WeChat, QQ, Slack, Teams, or another IM app posts into the local webhook.',
    payload: {
      kind: 'message',
      source: 'WeChat',
      sender: 'REPLACE_WITH_VISIBLE_SENDER',
      chatTitle: 'REPLACE_WITH_VISIBLE_CHAT_OR_ROOM',
      conversationId: 'im-chat-REPLACE_WITH_STABLE_CHAT_ID',
      messageId: 'im-message-REPLACE_WITH_STABLE_EVENT_ID',
      text: 'REPLACE_WITH_NOTIFICATION_TEXT_OR_SAFE_SUMMARY',
      captureMethod: 'system-notification',
    },
  },
  {
    id: 'im-public-api',
    aliases: ['public-api', 'slack', 'teams', 'lark-api'],
    category: 'im',
    label: 'IM public API payload',
    notes: 'Use when an official API or OAuth app posts an allowed channel/DM message summary to the local webhook.',
    payload: {
      kind: 'message',
      source: 'Slack',
      sender: 'REPLACE_WITH_SENDER_OR_BOT_SAFE_LABEL',
      chatTitle: 'REPLACE_WITH_CHANNEL_OR_DM_LABEL',
      conversationId: 'api-channel-REPLACE_WITH_STABLE_CHANNEL_ID',
      messageId: 'api-message-REPLACE_WITH_STABLE_MESSAGE_ID',
      text: 'REPLACE_WITH_SAFE_MESSAGE_SUMMARY_OR_SHORT_EXCERPT',
      captureMethod: 'public-api',
    },
  },
  {
    id: 'im-user-automation',
    aliases: ['automation', 'user-automation', 'shortcuts', 'hammerspoon'],
    category: 'im',
    label: 'IM user-owned automation payload',
    notes: 'Use when Shortcuts, Hammerspoon, shell hooks, or similar user-owned automation posts an IM event to the local webhook.',
    payload: {
      kind: 'message',
      source: 'DingTalk',
      sender: 'REPLACE_WITH_VISIBLE_SENDER',
      chatTitle: 'REPLACE_WITH_VISIBLE_CHAT_OR_ROOM',
      conversationId: 'automation-chat-REPLACE_WITH_STABLE_CHAT_ID',
      messageId: 'automation-message-REPLACE_WITH_STABLE_EVENT_ID',
      text: 'REPLACE_WITH_SAFE_MESSAGE_SUMMARY_OR_SHORT_EXCERPT',
      captureMethod: 'user-automation',
    },
  },
  {
    id: 'export-file',
    aliases: ['export', 'file', 'json-file', 'csv'],
    category: 'generic-webhook',
    label: 'User export-file payload',
    notes: 'Use when the user explicitly exports a message event and an adapter posts a safe summary to the local webhook.',
    payload: {
      kind: 'message',
      source: 'ExportedMessages',
      sender: 'REPLACE_WITH_EXPORT_ROW_SENDER',
      chatTitle: 'REPLACE_WITH_EXPORT_THREAD_LABEL',
      conversationId: 'export-thread-REPLACE_WITH_STABLE_THREAD_ID',
      messageId: 'export-message-REPLACE_WITH_STABLE_ROW_ID',
      text: 'REPLACE_WITH_SAFE_EXPORTED_MESSAGE_SUMMARY_OR_SHORT_EXCERPT',
      captureMethod: 'export-file',
    },
  },
]

const SOURCE_ALIASES = ['sourceName', 'source', 'app', 'application']
const SENDER_ALIASES = ['sender', 'fromUser', 'from', 'author']
const TEXT_ALIASES = ['body', 'text', 'message']
const CONVERSATION_ALIASES = ['conversationId', 'chatId', 'roomId', 'channelId', 'threadId']
const MESSAGE_ID_ALIASES = ['messageId', 'id', 'eventId']
const TITLE_ALIASES = ['title', 'conversationTitle', 'chatTitle', 'roomName', 'channelName', 'subject']
const CAPTURE_METHOD_ALIASES = ['captureMethod', 'ingestMethod', 'accessMethod', 'sourceMethod', 'adapterSource']
const PERMISSIONED_CAPTURE_METHODS = new Set(MESSAGE_ADAPTER_CAPTURE_METHODS.map((entry) => entry.id))
const PLANNED_PERMISSIONED_CATEGORIES = new Set(['email', 'im'])

function printUsage(stream = process.stderr) {
  stream.write([
    'Usage: node scripts/message-adapter-contract.mjs [--json <json-or-path>] [message fields]',
    '',
    'Options:',
    '  --json, --payload <json-or-path>   Check a raw adapter payload. Use "-" for stdin.',
    '  --source, --app <name>             Communication app name, e.g. Mail, WeChat, QQ',
    '  --sender, --from <name>            Sender display name',
    '  --text, --message, --body <text>   Message body. Use "-" for stdin.',
    '  --chat-title, --title <name>       Conversation, room, or subject title',
    '  --conversation-id <id>             Stable conversation/thread id for dedupe',
    '  --message-id <id>                  Stable message id for dedupe',
    '  --capture-method <method>          system-notification, public-api, user-automation, mail-rule, imap-api, or export-file',
    '  --output <path>                    Write the private-safe report JSON to a file',
    '  --template <id>                    Print a starter payload template (email, im, im-public-api, ...)',
    '  --require-ready                    Keep the default non-zero exit when contract checks fail',
    '  --list                             Print the adapter support manifest',
    '  --help                            Show this help',
    '',
    'Examples:',
    '  npm run message:adapter:check -- --source Mail --capture-method mail-rule --sender alerts@example.com --chat-title "Build" --conversation-id mail-thread-1 --message-id mail-1 --text "Build failed"',
    '  npm run message:adapter:check -- --json ./adapter-payload.json',
    '',
  ].join('\n'))
}

function cleanString(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function firstString(raw, aliases) {
  if (!raw || typeof raw !== 'object') return ''
  for (const alias of aliases) {
    const value = cleanString(raw[alias])
    if (value) return value
  }
  return ''
}

function splitOption(arg) {
  const eq = arg.indexOf('=')
  if (eq < 0) return [arg, null]
  return [arg.slice(0, eq), arg.slice(eq + 1)]
}

function readRequiredOptionValue(argv, index, inlineValue, optionName) {
  if (inlineValue !== null) return { value: inlineValue, nextIndex: index }
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${optionName} requires a value`)
  }
  return { value, nextIndex: index + 1 }
}

function assignOption(options, name, value) {
  switch (name) {
    case '--json':
    case '--payload':
      options.json = value
      return
    case '--source':
    case '--app':
      options.source = value
      return
    case '--sender':
    case '--from':
      options.sender = value
      return
    case '--text':
    case '--message':
    case '--body':
      options.text = value
      return
    case '--chat-title':
    case '--title':
      options.chatTitle = value
      return
    case '--conversation-id':
    case '--chat-id':
    case '--room-id':
      options.conversationId = value
      return
    case '--message-id':
    case '--event-id':
      options.messageId = value
      return
    case '--capture-method':
    case '--ingest-method':
    case '--access-method':
      options.captureMethod = value
      return
    case '--output':
    case '--output-file':
    case '--evidence-file':
      options.outputPath = value
      return
    case '--template':
    case '--payload-template':
      options.template = value
      return
    default:
      throw new Error(`Unknown option: ${name}`)
  }
}

export function parseMessageAdapterContractArgs(argv) {
  const options = {
    json: '',
    source: '',
    sender: '',
    text: '',
    chatTitle: '',
    conversationId: '',
    messageId: '',
    captureMethod: '',
    outputPath: '',
    template: '',
    requireReady: false,
    list: false,
    help: false,
  }
  const positional = []

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }
    if (arg === '--list') {
      options.list = true
      continue
    }
    if (arg === '--require-ready') {
      options.requireReady = true
      continue
    }
    if (arg.startsWith('--')) {
      const [name, inlineValue] = splitOption(arg)
      const parsed = readRequiredOptionValue(argv, index, inlineValue, name)
      assignOption(options, name, parsed.value)
      index = parsed.nextIndex
      continue
    }
    positional.push(arg)
  }

  if (!options.text && positional.length > 0) {
    options.text = positional.join(' ')
  }

  return options
}

export function resolveMessageAdapterPayloadTemplate(templateId) {
  const normalized = cleanString(templateId).toLowerCase()
  if (!normalized) return null
  return MESSAGE_ADAPTER_PAYLOAD_TEMPLATES.find((template) => (
    template.id === normalized || template.aliases.includes(normalized)
  )) ?? null
}

export function buildMessageAdapterPayloadTemplate(templateId, {
  generatedAt = new Date(),
} = {}) {
  const template = resolveMessageAdapterPayloadTemplate(templateId)
  if (!template) {
    throw new Error(`Unknown message adapter payload template: ${templateId}`)
  }
  return {
    schemaVersion: 1,
    gate: MESSAGE_ADAPTER_CONTRACT_GATE,
    generatedAt: normalizeIso(generatedAt),
    template: {
      id: template.id,
      category: template.category,
      label: template.label,
      notes: template.notes,
    },
    payload: { ...template.payload },
    checkCommand: `npm run message:adapter:check -- --json ./message-adapter-${template.id}.json`,
    evidenceCommand: `npm run message:adapter:check -- --json ./message-adapter-${template.id}.json --output artifacts/v0.3.4/message-adapter-${template.id}.json --require-ready`,
  }
}

function normalizeIso(value = new Date()) {
  const parsed = Date.parse(String(value))
  if (!Number.isFinite(parsed)) return new Date().toISOString()
  return new Date(parsed).toISOString()
}

export function normalizeMessageAdapterPayload(raw) {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const payload = obj.payload && typeof obj.payload === 'object' && !Array.isArray(obj.payload)
    ? obj.payload
    : obj
  return {
    kind: cleanString(payload.kind),
    source: firstString(payload, SOURCE_ALIASES),
    sender: firstString(payload, SENDER_ALIASES),
    text: firstString(payload, TEXT_ALIASES),
    chatTitle: firstString(payload, TITLE_ALIASES),
    conversationId: firstString(payload, CONVERSATION_ALIASES),
    messageId: firstString(payload, MESSAGE_ID_ALIASES),
    captureMethod: normalizeCaptureMethod(firstString(payload, CAPTURE_METHOD_ALIASES)),
  }
}

function normalizeCaptureMethod(value) {
  const cleaned = cleanString(value).toLowerCase()
  if (!cleaned) return ''
  const normalized = cleaned.replace(/[_\s]+/g, '-')
  if (/sqlite|sql|db|database|private-store|app-store|scrap(e|ing)/.test(normalized)) return 'private-database'
  if (/notification-center|system-notification|notifications?/.test(normalized)) return 'system-notification'
  if (/shortcut|shortcuts|hammerspoon|shell|script|automation|user-automation/.test(normalized)) return 'user-automation'
  if (/mail-rule|mailrule|forwarder|forward/.test(normalized)) return 'mail-rule'
  if (/imap|mailbox/.test(normalized)) return 'imap-api'
  if (/public-api|\bapi\b|oauth/.test(normalized)) return 'public-api'
  if (/export|csv|json-file/.test(normalized)) return 'export-file'
  return normalized
}

export function classifyMessageAdapterSource(source) {
  const normalized = cleanString(source).toLowerCase()
  if (!normalized) {
    return {
      category: 'unknown',
      supportPath: 'local-webhook',
      supportStatus: 'needs-source',
      note: 'Add a source/app name so release evidence can explain where the adapter event came from.',
    }
  }
  if (/telegram/.test(normalized)) {
    return {
      category: 'native-bridge',
      supportPath: 'telegram-native',
      supportStatus: 'available-live-gated',
      note: 'Telegram has a native bridge; webhook adapters should avoid duplicating native Telegram events.',
    }
  }
  if (/discord/.test(normalized)) {
    return {
      category: 'native-bridge',
      supportPath: 'discord-native',
      supportStatus: 'available-live-gated',
      note: 'Discord has a native bridge; webhook adapters should avoid duplicating native Discord events.',
    }
  }
  if (/mail|gmail|outlook|imap|smtp|邮箱|郵箱|邮件|郵件|email/.test(normalized)) {
    return {
      category: 'email',
      supportPath: 'email-forwarder',
      supportStatus: 'planned-contract',
      note: 'Email should enter through a user-owned forwarder, mail rule, API, or automation that posts to the local webhook.',
    }
  }
  if (/wechat|wecom|微信|企业微信|企業微信|qq|dingtalk|钉钉|釘釘|feishu|飞书|飛書|lark|slack|teams/.test(normalized)) {
    return {
      category: 'im',
      supportPath: 'im-notification-exporter',
      supportStatus: 'planned-contract',
      note: 'More IM support should use public APIs, system notifications, or user-owned automation; do not claim private database access.',
    }
  }
  return {
    category: 'generic-webhook',
    supportPath: 'local-webhook',
    supportStatus: 'available',
    note: 'Generic adapters can post message events to the local webhook when they provide the required fields.',
  }
}

function check(id, pass, severity, detail) {
  return { id, pass: Boolean(pass), severity, detail }
}

function buildPermissionBoundary(payload, classification) {
  const captureMethod = payload.captureMethod || null
  if (captureMethod === 'private-database') {
    return {
      required: true,
      status: 'blocked',
      captureMethod,
      allowed: false,
      note: 'Private app database scraping is outside the Nexus adapter boundary.',
    }
  }
  if (!PLANNED_PERMISSIONED_CATEGORIES.has(classification.category)) {
    return {
      required: false,
      status: captureMethod ? 'declared' : 'not-required',
      captureMethod,
      allowed: true,
      note: 'This source category does not require a planned email/IM adapter permission boundary.',
    }
  }
  if (!captureMethod) {
    return {
      required: true,
      status: 'missing',
      captureMethod: null,
      allowed: false,
      note: 'Planned email and additional-IM adapters must declare a permissioned captureMethod before wiring.',
    }
  }
  if (!PERMISSIONED_CAPTURE_METHODS.has(captureMethod)) {
    return {
      required: true,
      status: 'unknown',
      captureMethod,
      allowed: false,
      note: 'Capture method is not in the permissioned adapter allowlist.',
    }
  }
  return {
    required: true,
    status: 'permissioned',
    captureMethod,
    allowed: true,
    note: 'Capture method is permissioned for planned email/additional-IM adapter groundwork.',
  }
}

function buildPrivacyWarnings(payload, classification, permissionBoundary) {
  const warnings = []
  if (payload.text.length > 500) {
    warnings.push({
      id: 'long-message-body',
      severity: 'privacy',
      detail: 'Payload text is long; prefer a summary or subject-level excerpt for speech-safe adapters.',
    })
  }
  if (classification.category === 'native-bridge') {
    warnings.push({
      id: 'native-bridge-duplicate-risk',
      severity: 'routing',
      detail: classification.note,
    })
  }
  if (classification.category === 'im') {
    warnings.push({
      id: 'no-private-database-scraping',
      severity: 'privacy',
      detail: 'Use system notifications, public APIs, or user-owned automation instead of private app database scraping.',
    })
  }
  if (permissionBoundary.status === 'missing') {
    warnings.push({
      id: 'missing-permissioned-capture-method',
      severity: 'privacy',
      detail: permissionBoundary.note,
    })
  }
  if (permissionBoundary.status === 'blocked') {
    warnings.push({
      id: 'private-database-access-blocked',
      severity: 'privacy',
      detail: permissionBoundary.note,
    })
  }
  if (permissionBoundary.status === 'unknown') {
    warnings.push({
      id: 'unknown-capture-method',
      severity: 'privacy',
      detail: permissionBoundary.note,
    })
  }
  return warnings
}

export function buildMessageAdapterContractReport(rawPayload, {
  generatedAt = new Date(),
} = {}) {
  const payload = normalizeMessageAdapterPayload(rawPayload)
  const classification = classifyMessageAdapterSource(payload.source)
  const permissionBoundary = buildPermissionBoundary(payload, classification)
  const checks = [
    check(
      'kind-message',
      payload.kind === 'message',
      'required',
      payload.kind === 'message'
        ? 'Payload is explicitly marked as a communication message.'
        : 'Set kind to "message"; otherwise Nexus treats the event as a generic notification.',
    ),
    check('has-source', payload.source, 'required', 'Adapter payload includes a source/app name.'),
    check('has-text', payload.text, 'required', 'Adapter payload includes message text or a safe excerpt.'),
    check(
      'has-permissioned-capture-method',
      permissionBoundary.allowed,
      permissionBoundary.required ? 'required-boundary' : 'informational',
      permissionBoundary.note,
    ),
    check('has-conversation-id', payload.conversationId, 'recommended', 'Stable conversationId enables dedupe across repeated adapter events.'),
    check('has-message-id', payload.messageId, 'recommended', 'Stable messageId enables replay-safe dedupe.'),
  ]
  const requiredPass = checks
    .filter((entry) => entry.severity === 'required' || entry.severity === 'required-boundary')
    .every((entry) => entry.pass)
  const dedupeReady = checks
    .filter((entry) => entry.id === 'has-conversation-id' || entry.id === 'has-message-id')
    .every((entry) => entry.pass)
  const privacyWarnings = buildPrivacyWarnings(payload, classification, permissionBoundary)
  const nextActions = []
  if (permissionBoundary.status === 'missing') {
    nextActions.push('Declare captureMethod as system-notification, public-api, user-automation, mail-rule, imap-api, or export-file.')
  }
  if (permissionBoundary.status === 'blocked') {
    nextActions.push('Replace private database access with a permissioned capture method before wiring this adapter.')
  }
  if (permissionBoundary.status === 'unknown') {
    nextActions.push('Map the adapter to an allowed permissioned captureMethod before wiring it.')
  }
  if (!payload.conversationId) nextActions.push('Add a stable conversationId, chatId, roomId, channelId, or threadId.')
  if (!payload.messageId) nextActions.push('Add a stable messageId, id, or eventId.')
  if (classification.category === 'native-bridge') {
    nextActions.push('Prefer the native Telegram/Discord bridge when possible, or disable duplicate notification/webhook paths.')
  }
  if (classification.category === 'im') {
    nextActions.push('Document the adapter source as system notification, public API, export, or user-owned automation.')
  }

  return {
    schemaVersion: 1,
    gate: MESSAGE_ADAPTER_CONTRACT_GATE,
    generatedAt: normalizeIso(generatedAt),
    ok: requiredPass,
    dedupeReady,
    sourceCategory: classification.category,
    support: {
      path: classification.supportPath,
      status: classification.supportStatus,
      note: classification.note,
    },
    payloadSummary: {
      kind: payload.kind || null,
      source: payload.source || null,
      captureMethod: payload.captureMethod || null,
      textLength: payload.text.length,
      senderPresent: Boolean(payload.sender),
      chatTitlePresent: Boolean(payload.chatTitle),
      conversationIdPresent: Boolean(payload.conversationId),
      messageIdPresent: Boolean(payload.messageId),
    },
    permissionBoundary,
    checks,
    privacyWarnings,
    nextActions,
  }
}

async function readStdinText() {
  const chunks = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function readJsonInput(value) {
  const input = cleanString(value)
  if (!input || input === '-') {
    return JSON.parse(await readStdinText())
  }
  if (input.startsWith('{')) {
    return JSON.parse(input)
  }
  return JSON.parse(await fs.readFile(path.resolve(process.cwd(), input), 'utf8'))
}

async function buildPayloadFromOptions(options) {
  if (options.json) return readJsonInput(options.json)
  const text = options.text === '-' ? await readStdinText() : options.text
  return {
    kind: 'message',
    source: options.source,
    sender: options.sender,
    text,
    chatTitle: options.chatTitle,
    conversationId: options.conversationId,
    messageId: options.messageId,
    captureMethod: options.captureMethod,
  }
}

async function writeReportFile(report, outputPath) {
  const cleanPath = cleanString(outputPath)
  if (!cleanPath) return
  const resolvedPath = path.resolve(process.cwd(), cleanPath)
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true })
  await fs.writeFile(resolvedPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

async function writeJsonFile(value, outputPath) {
  const cleanPath = cleanString(outputPath)
  if (!cleanPath) return
  const resolvedPath = path.resolve(process.cwd(), cleanPath)
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true })
  await fs.writeFile(resolvedPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

export async function runMessageAdapterContractCli(argv = process.argv.slice(2)) {
  const options = parseMessageAdapterContractArgs(argv)
  if (options.help) {
    printUsage(process.stdout)
    return 0
  }
  if (options.list) {
    process.stdout.write(`${JSON.stringify({
      schemaVersion: 1,
      gate: MESSAGE_ADAPTER_CONTRACT_GATE,
      adapters: MESSAGE_ADAPTER_SURFACES,
      captureMethods: MESSAGE_ADAPTER_CAPTURE_METHODS,
      payloadTemplates: MESSAGE_ADAPTER_PAYLOAD_TEMPLATES.map((template) => ({
        id: template.id,
        aliases: template.aliases,
        category: template.category,
        label: template.label,
        notes: template.notes,
        captureMethod: template.payload.captureMethod,
        source: template.payload.source,
      })),
    }, null, 2)}\n`)
    return 0
  }
  if (options.template) {
    const template = buildMessageAdapterPayloadTemplate(options.template)
    await writeJsonFile(template, options.outputPath)
    process.stdout.write(`${JSON.stringify(template, null, 2)}\n`)
    return 0
  }

  const payload = await buildPayloadFromOptions(options)
  const report = buildMessageAdapterContractReport(payload)
  await writeReportFile(report, options.outputPath)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  return report.ok ? 0 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runMessageAdapterContractCli().then((code) => {
    process.exitCode = code
  }).catch((error) => {
    console.error(error?.message ?? error)
    process.exitCode = 1
  })
}
