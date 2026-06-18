#!/usr/bin/env node

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const DEFAULT_WEBHOOK_URL = 'http://127.0.0.1:47830/webhook'
export const WEBHOOK_TOKEN_FILE_NAME = 'notification-webhook-token.txt'

const USER_DATA_DIRECTORY_NAMES = ['Nexus', 'nexus', 'ai.factory.desktoppet']

function printUsage(stream = process.stderr) {
  stream.write([
    'Usage: node scripts/send-message-webhook.mjs --source <app> --sender <name> --text <message> [options]',
    '',
    'Options:',
    '  --source, --app <name>             Communication app name, e.g. WeChat, QQ, 企业微信',
    '  --sender, --from <name>            Message sender display name',
    '  --text, --message, --body <text>   Message body. Use "-" to read stdin',
    '  --chat-title, --title <name>       Conversation or room title',
    '  --conversation-id <id>             Stable conversation id for dedupe',
    '  --message-id <id>                  Stable message id for dedupe',
    '  --url <url>                        Nexus webhook URL',
    '  --token <token>                    Bearer token, with or without "Bearer "',
    '  --token-file <path>                Token file path',
    '  --json <json-or-path>              Send a prebuilt JSON payload. Use "-" for stdin',
    '  --dry-run                         Print the JSON payload instead of sending',
    '',
    'Example:',
    '  node scripts/send-message-webhook.mjs --source 微信 --sender 张三 --chat-title 项目群 --text "晚上同步一下"',
    '',
  ].join('\n'))
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
    case '--url':
      options.url = value
      return
    case '--token':
      options.token = value
      return
    case '--token-file':
      options.tokenFile = value
      return
    case '--json':
    case '--payload':
      options.json = value
      return
    default:
      throw new Error(`Unknown option: ${name}`)
  }
}

export function parseMessageWebhookArgs(argv) {
  const options = {
    source: '',
    sender: '',
    text: '',
    chatTitle: '',
    conversationId: '',
    messageId: '',
    url: DEFAULT_WEBHOOK_URL,
    token: '',
    tokenFile: '',
    json: '',
    dryRun: false,
    help: false,
  }
  const positional = []

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }

    if (arg === '--dry-run') {
      options.dryRun = true
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

function cleanString(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function addIfPresent(target, key, value) {
  const normalized = cleanString(value)
  if (normalized) target[key] = normalized
}

export function normalizeWebhookToken(value) {
  return String(value ?? '').trim().replace(/^Bearer\s+/iu, '').trim()
}

export function getDefaultTokenFileCandidates({
  env = process.env,
  platform = process.platform,
  home = os.homedir(),
} = {}) {
  const candidates = []
  const envFile = cleanString(env.NEXUS_NOTIFICATION_WEBHOOK_TOKEN_FILE)
  if (envFile) candidates.push(envFile)

  if (platform === 'win32') {
    const base = cleanString(env.APPDATA) || path.join(home, 'AppData', 'Roaming')
    for (const name of USER_DATA_DIRECTORY_NAMES) {
      candidates.push(path.join(base, name, WEBHOOK_TOKEN_FILE_NAME))
    }
  } else if (platform === 'darwin') {
    for (const name of USER_DATA_DIRECTORY_NAMES) {
      candidates.push(path.join(home, 'Library', 'Application Support', name, WEBHOOK_TOKEN_FILE_NAME))
    }
  } else {
    const base = cleanString(env.XDG_CONFIG_HOME) || path.join(home, '.config')
    for (const name of USER_DATA_DIRECTORY_NAMES) {
      candidates.push(path.join(base, name, WEBHOOK_TOKEN_FILE_NAME))
    }
  }

  return [...new Set(candidates)]
}

export async function readWebhookToken(options = {}, context = {}) {
  const direct = normalizeWebhookToken(options.token)
  if (direct) return direct

  const explicitFile = cleanString(options.tokenFile)
  const candidates = explicitFile
    ? [explicitFile]
    : getDefaultTokenFileCandidates(context)

  for (const candidate of candidates) {
    try {
      const token = normalizeWebhookToken(await fs.readFile(candidate, 'utf8'))
      if (token) return token
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw new Error(`Failed to read webhook token from ${candidate}: ${error.message}`)
      }
    }
  }

  throw new Error(
    'Nexus webhook token not found. Start Nexus with the notification bridge enabled, '
      + 'or pass --token from the settings panel Authorization header.',
  )
}

export function buildMessageWebhookPayload(options, { now = new Date() } = {}) {
  if (options.jsonPayload && typeof options.jsonPayload === 'object') {
    return {
      kind: 'message',
      ...options.jsonPayload,
    }
  }

  const text = cleanString(options.text)
  if (!text) {
    throw new Error('Message text is required. Pass --text <message>, --text -, or a positional message.')
  }

  const payload = {
    kind: 'message',
    source: cleanString(options.source) || 'Local Message',
    text,
  }

  addIfPresent(payload, 'sender', options.sender)
  addIfPresent(payload, 'chatTitle', options.chatTitle)
  addIfPresent(payload, 'conversationId', options.conversationId)
  addIfPresent(payload, 'messageId', options.messageId || `${payload.source}:${now.getTime()}`)

  return payload
}

export async function postMessageWebhookPayload(payload, {
  url = DEFAULT_WEBHOOK_URL,
  token,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is not available in this Node runtime')
  }

  let response
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${normalizeWebhookToken(token)}`,
      },
      body: JSON.stringify(payload),
    })
  } catch (error) {
    const detail = error?.cause?.code ?? error?.code ?? error?.message ?? String(error)
    throw new Error(
      `Webhook request could not reach Nexus at ${url}: ${detail}. `
        + 'Start Nexus, enable the local notification webhook, and retry the message-awareness gate.',
    )
  }
  const text = await response.text()
  let parsed = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = { raw: text }
  }

  if (!response.ok) {
    throw new Error(`Webhook request failed (${response.status}): ${parsed?.error ?? text}`)
  }

  return parsed ?? { ok: true }
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

export async function runMessageWebhookCli(argv = process.argv.slice(2)) {
  const options = parseMessageWebhookArgs(argv)
  if (options.help) {
    printUsage(process.stdout)
    return 0
  }

  if (options.text === '-') {
    options.text = await readStdinText()
  }
  if (options.json) {
    options.jsonPayload = await readJsonInput(options.json)
  }

  const payload = buildMessageWebhookPayload(options)
  if (options.dryRun) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
    return 0
  }

  const token = await readWebhookToken(options)
  const result = await postMessageWebhookPayload(payload, {
    url: options.url,
    token,
  })
  process.stdout.write(`${JSON.stringify(result)}\n`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runMessageWebhookCli().then((code) => {
    process.exitCode = code
  }).catch((error) => {
    console.error(error?.message ?? error)
    process.exitCode = 1
  })
}
