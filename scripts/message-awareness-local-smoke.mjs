#!/usr/bin/env node

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'

const DEFAULT_EVIDENCE_FILE = 'artifacts/v0.3.4/message-awareness-local.json'
const WEBHOOK_HOST = '127.0.0.1'
const WEBHOOK_PORT = 47830
const DEFAULT_TIMEOUT_MS = 30_000

function printUsage(stream = process.stderr) {
  stream.write([
    'Usage: node scripts/message-awareness-local-smoke.mjs [options] [-- validate args]',
    '',
    'Starts a smoke-only Electron main process, waits for the local Nexus',
    'notification webhook, sends a synthetic message, and writes local evidence.',
    '',
    'Options:',
    `  --evidence-file <path>      Evidence output path (default: ${DEFAULT_EVIDENCE_FILE})`,
    `  --timeout-ms <ms>           Webhook startup timeout (default: ${DEFAULT_TIMEOUT_MS})`,
    '  --help                     Show this help',
    '',
    'Example:',
    '  npm run message:smoke:local',
    '',
  ].join('\n'))
}

function splitOption(arg) {
  const eq = arg.indexOf('=')
  if (eq < 0) return [arg, null]
  return [arg.slice(0, eq), arg.slice(eq + 1)]
}

function readOptionValue(argv, index, inlineValue, optionName) {
  if (inlineValue !== null) return { value: inlineValue, nextIndex: index }
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${optionName} requires a value`)
  }
  return { value, nextIndex: index + 1 }
}

export function parseMessageAwarenessLocalSmokeArgs(argv) {
  const options = {
    evidenceFile: DEFAULT_EVIDENCE_FILE,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    help: false,
    validateArgs: [],
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--') {
      options.validateArgs.push(...argv.slice(index + 1))
      break
    }
    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }
    if (arg.startsWith('--evidence-file') || arg.startsWith('--timeout-ms')) {
      const [name, inlineValue] = splitOption(arg)
      if (name !== '--evidence-file' && name !== '--timeout-ms') {
        throw new Error(`Unknown option: ${name}`)
      }
      const parsed = readOptionValue(argv, index, inlineValue, name)
      if (name === '--evidence-file') {
        options.evidenceFile = String(parsed.value)
      } else {
        const timeoutMs = Number(parsed.value)
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
          throw new Error(`--timeout-ms must be a positive number: ${parsed.value}`)
        }
        options.timeoutMs = timeoutMs
      }
      index = parsed.nextIndex
      continue
    }
    options.validateArgs.push(arg)
  }

  return options
}

function tryConnect(host, port) {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    socket.setTimeout(750)
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
    socket.once('timeout', () => {
      socket.destroy()
      resolve(false)
    })
    socket.connect(port, host)
  })
}

async function waitForWebhook({ timeoutMs }) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await tryConnect(WEBHOOK_HOST, WEBHOOK_PORT)) return true
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  return false
}

function electronBinPath(root = process.cwd()) {
  return process.platform === 'win32'
    ? path.join(root, 'node_modules', '.bin', 'electron.cmd')
    : path.join(root, 'node_modules', '.bin', 'electron')
}

export function getElectronSmokeInstallIssue(root = process.cwd()) {
  const electronBin = electronBinPath(root)
  if (!fs.existsSync(electronBin)) {
    return `Electron binary is missing at ${electronBin}. Run npm install first.`
  }

  const packageDir = path.join(root, 'node_modules', 'electron')
  const pathFile = path.join(packageDir, 'path.txt')
  if (!fs.existsSync(pathFile)) {
    return 'Electron is installed incompletely: node_modules/electron/path.txt is missing. '
      + 'Run npm rebuild electron, or delete node_modules/electron and run npm install.'
  }

  const runtimeRelativePath = fs.readFileSync(pathFile, 'utf8').trim()
  if (!runtimeRelativePath) {
    return 'Electron is installed incompletely: node_modules/electron/path.txt is empty. '
      + 'Run npm rebuild electron, or delete node_modules/electron and run npm install.'
  }

  const runtimePath = path.join(packageDir, 'dist', runtimeRelativePath)
  if (!fs.existsSync(runtimePath)) {
    return `Electron runtime is missing at ${runtimePath}. `
      + 'Run npm rebuild electron, or delete node_modules/electron and run npm install.'
  }

  return null
}

function spawnElectronSmoke() {
  const issue = getElectronSmokeInstallIssue()
  if (issue) throw new Error(issue)

  return spawn(electronBinPath(), ['.'], {
    env: {
      ...process.env,
      NEXUS_MESSAGE_AWARENESS_SMOKE: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  })
}

function pipeChildOutput(child) {
  child.stdout?.on('data', (chunk) => process.stderr.write(chunk))
  child.stderr?.on('data', (chunk) => process.stderr.write(chunk))
}

function isChildExited(child) {
  return !child || child.exitCode !== null || child.signalCode !== null
}

function stopChild(child) {
  if (isChildExited(child)) return
  child.kill('SIGTERM')
  setTimeout(() => {
    if (!isChildExited(child)) child.kill('SIGKILL')
  }, 2_000).unref()
}

function waitForExit(child) {
  return new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })
}

function runValidation(options) {
  const args = [
    'scripts/validate-message-awareness.mjs',
    '--evidence-file',
    options.evidenceFile,
    ...options.validateArgs,
  ]

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`message-awareness validation exited by ${signal}`))
        return
      }
      resolve(code ?? 0)
    })
  })
}

export async function runMessageAwarenessLocalSmoke(argv = process.argv.slice(2)) {
  const options = parseMessageAwarenessLocalSmokeArgs(argv)
  if (options.help) {
    printUsage(process.stdout)
    return 0
  }

  const electronProcess = spawnElectronSmoke()
  pipeChildOutput(electronProcess)

  const exitPromise = waitForExit(electronProcess)
  const stopForSignal = () => {
    stopChild(electronProcess)
  }
  process.once('SIGINT', stopForSignal)
  process.once('SIGTERM', stopForSignal)

  try {
    const ready = await Promise.race([
      waitForWebhook(options),
      exitPromise.then(({ code, signal }) => {
        throw new Error(
          `Electron smoke process exited before the webhook became ready (code=${code ?? 'null'}, signal=${signal ?? 'null'}). `
            + 'Close any already-running Nexus instance or enable the local notification webhook there, then retry.',
        )
      }),
    ])

    if (!ready) {
      throw new Error(
        `Timed out waiting for Nexus webhook at http://${WEBHOOK_HOST}:${WEBHOOK_PORT}/webhook. `
          + 'Close any already-running Nexus instance or inspect the smoke process output above.',
      )
    }

    return await runValidation(options)
  } finally {
    process.removeListener('SIGINT', stopForSignal)
    process.removeListener('SIGTERM', stopForSignal)
    stopChild(electronProcess)
    await Promise.race([
      exitPromise,
      new Promise((resolve) => setTimeout(resolve, 3_000)),
    ])
  }
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  try {
    const exitCode = await runMessageAwarenessLocalSmoke()
    process.exit(exitCode)
  } catch (error) {
    console.error(error?.message ?? error)
    process.exit(1)
  }
}
