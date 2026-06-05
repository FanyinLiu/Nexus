#!/usr/bin/env node

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import {
  DEFAULT_WEBHOOK_URL,
  postMessageWebhookPayload,
  readWebhookToken,
} from '../send-message-webhook.mjs'

const execFileAsync = promisify(execFile)

export const DEFAULT_COMMUNICATION_APP_PATTERN = [
  '微信',
  'WeChat',
  '企业微信',
  'WeCom',
  'QQ',
  'Telegram',
  'Discord',
  '钉钉',
  'DingTalk',
  '飞书',
  'Feishu',
  'Lark',
  'Slack',
  'Teams',
  'com.tencent.xinWeChat',
  'com.tencent.WeWorkMac',
  'com.tencent.qq',
  'ph.telegra.Telegraph',
  'com.hnc.Discord',
  'com.microsoft.teams',
].join('|')

const DEFAULT_POLL_MS = 2_000
const DEFAULT_LIMIT = 60
const DEFAULT_STATE_FILE = path.join(os.tmpdir(), 'nexus-macos-notification-center-watch.json')
const MAX_SEEN_KEYS = 500

function printUsage(stream = process.stderr) {
  stream.write([
    'Usage: node scripts/communication-adapters/macos-notification-center-watch.mjs [options]',
    '',
    'Options:',
    '  --db <path>              Notification Center sqlite DB path. Auto-detected when omitted.',
    '  --apps <regex>           App/title regex filter. Defaults to Chinese + common chat apps.',
    '  --poll-ms <ms>           Poll interval for continuous watch mode.',
    '  --limit <n>              Rows to inspect per poll.',
    '  --state-file <path>      Seen-key state file.',
    '  --url <url>              Nexus webhook URL.',
    '  --token <token>          Nexus webhook bearer token.',
    '  --token-file <path>      Nexus webhook token file.',
    '  --sqlite <path>          sqlite3 executable path.',
    '  --once                   Poll once and exit.',
    '  --dry-run                Print payload JSON lines instead of sending.',
    '',
    'This adapter reads macOS Notification Center history, not private app chat databases.',
    'It may require Full Disk Access for the terminal or automation host process.',
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

function toPositiveInteger(value, fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.floor(parsed)
}

function assignOption(options, name, value) {
  switch (name) {
    case '--db':
      options.db = value
      return
    case '--apps':
      options.apps = value
      return
    case '--poll-ms':
      options.pollMs = toPositiveInteger(value, DEFAULT_POLL_MS)
      return
    case '--limit':
      options.limit = toPositiveInteger(value, DEFAULT_LIMIT)
      return
    case '--state-file':
      options.stateFile = value
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
    case '--sqlite':
      options.sqlite = value
      return
    default:
      throw new Error(`Unknown option: ${name}`)
  }
}

export function parseMacNotificationWatchArgs(argv) {
  const options = {
    db: '',
    apps: DEFAULT_COMMUNICATION_APP_PATTERN,
    pollMs: DEFAULT_POLL_MS,
    limit: DEFAULT_LIMIT,
    stateFile: DEFAULT_STATE_FILE,
    url: DEFAULT_WEBHOOK_URL,
    token: '',
    tokenFile: '',
    sqlite: 'sqlite3',
    once: false,
    dryRun: false,
    help: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }
    if (arg === '--once') {
      options.once = true
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

    throw new Error(`Unexpected argument: ${arg}`)
  }

  return options
}

function cleanString(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function quoteIdentifier(name) {
  return `"${String(name).replace(/"/g, '""')}"`
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function collectNotificationCenterDbs(home = os.homedir()) {
  const candidates = [
    path.join(home, 'Library', 'Group Containers', 'group.com.apple.usernoted', 'db2', 'db'),
    path.join(home, 'Library', 'Group Containers', 'group.com.apple.UserNotifications', 'db2', 'db'),
  ]

  const notificationCenterRoot = path.join(home, 'Library', 'Application Support', 'NotificationCenter')
  try {
    const entries = await fs.readdir(notificationCenterRoot, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.db')) {
        candidates.push(path.join(notificationCenterRoot, entry.name))
      } else if (entry.isDirectory()) {
        candidates.push(path.join(notificationCenterRoot, entry.name, 'db'))
        candidates.push(path.join(notificationCenterRoot, entry.name, 'db2', 'db'))
      }
    }
  } catch {
    // Missing NotificationCenter folder is normal on some macOS versions.
  }

  const existing = []
  for (const candidate of [...new Set(candidates)]) {
    if (await pathExists(candidate)) existing.push(candidate)
  }
  return existing
}

export async function resolveMacNotificationDb(options = {}) {
  if (options.db) return path.resolve(process.cwd(), options.db)
  const candidates = await collectNotificationCenterDbs(options.home ?? os.homedir())
  if (candidates.length > 0) return candidates[0]
  throw new Error(
    'No macOS Notification Center database found. Pass --db <path>, '
      + 'or grant Full Disk Access to the process running this adapter.',
  )
}

function resolveSqliteCommand(sqlitePath) {
  if (/\.(?:cjs|mjs|js)$/iu.test(sqlitePath)) {
    return { executable: process.execPath, args: [sqlitePath] }
  }
  return { executable: sqlitePath, args: [] }
}

async function runSqliteJson(sqlitePath, dbPath, sql) {
  const command = resolveSqliteCommand(sqlitePath)
  const { stdout } = await execFileAsync(command.executable, [...command.args, '-json', dbPath, sql], {
    maxBuffer: 10 * 1024 * 1024,
  })
  const trimmed = stdout.trim()
  return trimmed ? JSON.parse(trimmed) : []
}

async function listTables(sqlitePath, dbPath) {
  const rows = await runSqliteJson(
    sqlitePath,
    dbPath,
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
  )
  return rows.map((row) => cleanString(row.name)).filter(Boolean)
}

async function listColumns(sqlitePath, dbPath, tableName) {
  const rows = await runSqliteJson(sqlitePath, dbPath, `PRAGMA table_info(${quoteIdentifier(tableName)})`)
  return rows.map((row) => cleanString(row.name)).filter(Boolean)
}

function pickColumn(columns, names) {
  const lower = new Map(columns.map((column) => [column.toLowerCase(), column]))
  for (const name of names) {
    const column = lower.get(name.toLowerCase())
    if (column) return column
  }
  return ''
}

function chooseNotificationTable(tables) {
  const preferred = [
    'notifications',
    'notification',
    'record',
    'records',
    'requests',
    'delivered_notifications',
  ]
  const lower = new Map(tables.map((table) => [table.toLowerCase(), table]))
  for (const name of preferred) {
    const table = lower.get(name)
    if (table) return table
  }
  return tables.find((table) => /notification|record|request/i.test(table)) ?? tables[0] ?? ''
}

export function buildMacNotificationSelectSql(tableName, columns, { limit = DEFAULT_LIMIT } = {}) {
  const selectedColumns = [
    pickColumn(columns, ['id', 'uuid', 'identifier', 'request_id', 'record_id']),
    pickColumn(columns, ['source', 'sourceName', 'app', 'app_name', 'bundle_id', 'bundleIdentifier', 'app_id', 'appIdentifier']),
    pickColumn(columns, ['title', 'conversationTitle', 'chatTitle']),
    pickColumn(columns, ['subtitle', 'sender', 'fromUser', 'from']),
    pickColumn(columns, ['body', 'text', 'message', 'informativeText']),
    pickColumn(columns, ['delivered_at', 'delivered_date', 'date', 'timestamp', 'created_at', 'time']),
  ].filter(Boolean)

  const dataColumn = pickColumn(columns, ['data', 'archive', 'payload', 'blob', 'request'])
  const selectParts = ['rowid AS __rowid']
  for (const column of selectedColumns) {
    selectParts.push(`${quoteIdentifier(column)} AS ${quoteIdentifier(column)}`)
  }
  if (dataColumn) {
    selectParts.push(`hex(${quoteIdentifier(dataColumn)}) AS __data_hex`)
  }

  return [
    `SELECT ${selectParts.join(', ')}`,
    `FROM ${quoteIdentifier(tableName)}`,
    'ORDER BY rowid DESC',
    `LIMIT ${Math.min(500, Math.max(1, Number(limit) || DEFAULT_LIMIT))}`,
  ].join(' ')
}

export async function queryMacNotificationRows({
  sqlitePath = 'sqlite3',
  dbPath,
  limit = DEFAULT_LIMIT,
} = {}) {
  const tables = await listTables(sqlitePath, dbPath)
  const table = chooseNotificationTable(tables)
  if (!table) return []
  const columns = await listColumns(sqlitePath, dbPath, table)
  const sql = buildMacNotificationSelectSql(table, columns, { limit })
  return runSqliteJson(sqlitePath, dbPath, sql)
}

function decodeHexBytes(hex) {
  if (!hex || hex.length % 2 !== 0) return Buffer.alloc(0)
  return Buffer.from(hex, 'hex')
}

function extractPrintableRuns(text) {
  return String(text)
    .split(/[^\p{L}\p{N}\p{P}\p{S}\p{Zs}]+/u)
    .map(cleanString)
    .filter((part) => part.length >= 2 && !/^[\d\s.,:;_-]+$/u.test(part))
}

export function extractStringsFromBlobHex(hex) {
  const buffer = decodeHexBytes(cleanString(hex))
  if (!buffer.length) return []

  const results = new Set()
  for (const text of extractPrintableRuns(buffer.toString('utf8'))) {
    results.add(text)
  }
  for (const text of extractPrintableRuns(buffer.toString('utf16le'))) {
    results.add(text)
  }
  return [...results].slice(0, 20)
}

function getRowValue(row, names) {
  const lower = new Map(Object.entries(row).map(([key, value]) => [key.toLowerCase(), value]))
  for (const name of names) {
    const value = lower.get(name.toLowerCase())
    const normalized = cleanString(value)
    if (normalized) return normalized
  }
  return ''
}

function buildFallbackFromBlob(row) {
  const blobStrings = extractStringsFromBlobHex(row.__data_hex)
  return {
    source: blobStrings.find((item) => /wechat|微信|qq|telegram|discord|slack|teams|lark|飞书|钉钉|dingtalk/i.test(item)) ?? '',
    title: blobStrings[0] ?? '',
    subtitle: blobStrings[1] ?? '',
    body: blobStrings[2] ?? '',
  }
}

export function macNotificationRowToMessage(row) {
  const fallback = buildFallbackFromBlob(row)
  const source = getRowValue(row, [
    'source',
    'sourceName',
    'app',
    'app_name',
    'bundle_id',
    'bundleIdentifier',
    'app_id',
    'appIdentifier',
  ]) || fallback.source || 'macOS Notification'
  const title = getRowValue(row, ['title', 'conversationTitle', 'chatTitle']) || fallback.title
  const subtitle = getRowValue(row, ['subtitle', 'sender', 'fromUser', 'from']) || fallback.subtitle
  const body = getRowValue(row, ['body', 'text', 'message', 'informativeText']) || fallback.body
  const rowId = getRowValue(row, ['id', 'uuid', 'identifier', 'request_id', 'record_id', '__rowid'])
  const text = body || subtitle || title

  if (!text) return null

  return {
    source,
    sender: subtitle || title || source,
    chatTitle: title || source,
    text,
    conversationId: `${source}:${title || subtitle || 'conversation'}`,
    messageId: `${source}:${rowId || title || subtitle || text}`,
  }
}

export function matchesCommunicationFilter(message, pattern = DEFAULT_COMMUNICATION_APP_PATTERN) {
  const regex = new RegExp(pattern, 'iu')
  return regex.test([
    message.source,
    message.sender,
    message.chatTitle,
    message.text,
  ].filter(Boolean).join('\n'))
}

export function filterNewNotificationMessages(rows, {
  pattern = DEFAULT_COMMUNICATION_APP_PATTERN,
  seenKeys = new Set(),
} = {}) {
  const messages = []
  for (const row of rows) {
    const message = macNotificationRowToMessage(row)
    if (!message) continue
    if (!matchesCommunicationFilter(message, pattern)) continue
    if (seenKeys.has(message.messageId)) continue
    messages.push(message)
  }
  return messages.reverse()
}

async function loadState(stateFile) {
  try {
    const parsed = JSON.parse(await fs.readFile(stateFile, 'utf8'))
    const seen = Array.isArray(parsed?.seen) ? parsed.seen.map(cleanString).filter(Boolean) : []
    return { seen }
  } catch {
    return { seen: [] }
  }
}

async function saveState(stateFile, seenKeys) {
  const seen = [...seenKeys].slice(-MAX_SEEN_KEYS)
  await fs.mkdir(path.dirname(stateFile), { recursive: true })
  await fs.writeFile(stateFile, JSON.stringify({ seen, updatedAt: new Date().toISOString() }, null, 2))
}

async function deliverMessage(message, options, token) {
  const payload = {
    kind: 'message',
    source: message.source,
    sender: message.sender,
    chatTitle: message.chatTitle,
    text: message.text,
    conversationId: message.conversationId,
    messageId: message.messageId,
  }
  if (options.dryRun) {
    process.stdout.write(`${JSON.stringify(payload)}\n`)
    return
  }
  await postMessageWebhookPayload(payload, {
    url: options.url,
    token,
  })
}

export async function pollMacNotificationCenter(options) {
  const dbPath = await resolveMacNotificationDb(options)
  const state = await loadState(options.stateFile)
  const seenKeys = new Set(state.seen)
  const rows = await queryMacNotificationRows({
    sqlitePath: options.sqlite,
    dbPath,
    limit: options.limit,
  })
  const messages = filterNewNotificationMessages(rows, {
    pattern: options.apps,
    seenKeys,
  })
  const token = options.dryRun ? '' : await readWebhookToken(options)

  for (const message of messages) {
    await deliverMessage(message, options, token)
    seenKeys.add(message.messageId)
  }
  await saveState(options.stateFile, seenKeys)
  return messages
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function runMacNotificationWatchCli(argv = process.argv.slice(2)) {
  const options = parseMacNotificationWatchArgs(argv)
  if (options.help) {
    printUsage(process.stdout)
    return 0
  }

  if (options.once) {
    await pollMacNotificationCenter(options)
    return 0
  }

  while (true) {
    try {
      await pollMacNotificationCenter(options)
    } catch (error) {
      console.error(`[macos-notification-watch] ${error?.message ?? error}`)
    }
    await sleep(options.pollMs)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runMacNotificationWatchCli().then((code) => {
    process.exitCode = code
  }).catch((error) => {
    console.error(error?.message ?? error)
    process.exitCode = 1
  })
}
