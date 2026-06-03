#!/usr/bin/env node
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import process from 'node:process'

const DEV_SERVER_URL = 'http://127.0.0.1:47821/'
const DEV_SERVER_TIMEOUT_MS = 30_000
const OLLAMA_API_URL = 'http://127.0.0.1:11434/v1'

function printDoctorHint(detail) {
  console.error(`[electron-dev] ${detail}`)
  console.error('[electron-dev] Run npm run doctor for a focused startup check.')
  console.error(`[electron-dev] Nexus preview uses ${DEV_SERVER_URL}; ${OLLAMA_API_URL} is only the Ollama API.`)
}

function requestDevServer() {
  return new Promise((resolve) => {
    const req = http.get(DEV_SERVER_URL, (res) => {
      res.resume()
      resolve(Boolean(res.statusCode && res.statusCode >= 200 && res.statusCode < 500))
    })
    req.setTimeout(1_000, () => {
      req.destroy()
      resolve(false)
    })
    req.on('error', () => resolve(false))
  })
}

async function waitForDevServer(timeoutMs) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await requestDevServer()) {
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return false
}

function spawnChild(command, args, options = {}) {
  return spawn(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  })
}

let viteProcess = null
let electronProcess = null

function stopStartedVite() {
  if (!viteProcess || viteProcess.killed) return
  viteProcess.kill()
}

function forwardSignal(signal) {
  if (electronProcess && !electronProcess.killed) {
    electronProcess.kill(signal)
  }
  stopStartedVite()
}

process.once('SIGINT', () => forwardSignal('SIGINT'))
process.once('SIGTERM', () => forwardSignal('SIGTERM'))

const devServerAlreadyRunning = await requestDevServer()

if (devServerAlreadyRunning) {
  console.info(`[electron-dev] Reusing Vite dev server at ${DEV_SERVER_URL}`)
} else {
  console.info(`[electron-dev] Starting Vite dev server at ${DEV_SERVER_URL}`)
  viteProcess = spawnChild('npm', ['run', 'dev', '--', '--host', '127.0.0.1'])
  viteProcess.once('error', (error) => {
    printDoctorHint(`Failed to start Vite: ${error.message}`)
  })
  const ready = await waitForDevServer(DEV_SERVER_TIMEOUT_MS)
  if (!ready) {
    stopStartedVite()
    printDoctorHint(`Vite did not become ready within ${DEV_SERVER_TIMEOUT_MS / 1000}s.`)
    process.exit(1)
  }
}

const electronBin = process.platform === 'win32'
  ? path.join('node_modules', '.bin', 'electron.cmd')
  : path.join('node_modules', '.bin', 'electron')

if (!fs.existsSync(electronBin)) {
  printDoctorHint(`Electron binary is missing at ${electronBin}. Run npm install first.`)
  process.exit(1)
}

electronProcess = spawnChild(electronBin, ['.'], {
  env: {
    ...process.env,
    DESKTOP_PET_USE_DEV_SERVER: '1',
  },
})

electronProcess.once('error', (error) => {
  stopStartedVite()
  printDoctorHint(`Failed to start Electron: ${error.message}`)
  process.exit(1)
})

electronProcess.on('exit', (code, signal) => {
  stopStartedVite()
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})
