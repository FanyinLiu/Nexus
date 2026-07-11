#!/usr/bin/env node

import { existsSync, readdirSync, statSync, chmodSync, mkdtempSync, rmSync } from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const RELEASE_DIR = path.resolve(ROOT, process.env.PACKAGED_SMOKE_RELEASE_DIR || 'release')
const TIMEOUT_MS = Number.parseInt(process.env.PACKAGED_SMOKE_TIMEOUT_MS || '90000', 10)

function isExecutable(filePath) {
  try {
    const stat = statSync(filePath)
    if (!stat.isFile()) return false
    if (process.platform === 'win32') return /\.exe$/i.test(filePath)
    return Boolean(stat.mode & 0o111)
  } catch {
    return false
  }
}

function listDir(dirPath) {
  try {
    return readdirSync(dirPath, { withFileTypes: true })
  } catch {
    return []
  }
}

function findCommand(commandName) {
  const pathValue = process.env.PATH || ''
  const separators = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : ['']
  for (const dir of pathValue.split(path.delimiter)) {
    if (!dir) continue
    for (const suffix of separators) {
      const candidate = path.join(dir, `${commandName}${suffix}`)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

function findMacExecutable() {
  const appDirs = []
  for (const entry of listDir(RELEASE_DIR)) {
    if (!entry.isDirectory()) continue
    const releaseSubdir = path.join(RELEASE_DIR, entry.name)
    for (const child of listDir(releaseSubdir)) {
      if (child.isDirectory() && child.name.endsWith('.app')) {
        appDirs.push(path.join(releaseSubdir, child.name))
      }
    }
  }

  for (const appDir of appDirs) {
    const macOsDir = path.join(appDir, 'Contents', 'MacOS')
    const preferred = [
      path.join(macOsDir, 'Nexus'),
      path.join(macOsDir, 'Electron'),
    ]
    for (const candidate of preferred) {
      if (isExecutable(candidate)) return candidate
    }
    for (const entry of listDir(macOsDir)) {
      const candidate = path.join(macOsDir, entry.name)
      if (isExecutable(candidate)) return candidate
    }
  }

  return null
}

function findWindowsExecutable() {
  const winDir = path.join(RELEASE_DIR, 'win-unpacked')
  const preferred = [
    path.join(winDir, 'Nexus.exe'),
    path.join(winDir, 'Electron.exe'),
  ]
  for (const candidate of preferred) {
    if (existsSync(candidate)) return candidate
  }

  for (const entry of listDir(winDir)) {
    if (!entry.isFile() || !/\.exe$/i.test(entry.name)) continue
    if (/uninstall/i.test(entry.name)) continue
    return path.join(winDir, entry.name)
  }

  return null
}

function findLinuxExecutable() {
  const linuxDir = path.join(RELEASE_DIR, 'linux-unpacked')
  const preferred = [
    path.join(linuxDir, 'nexus'),
    path.join(linuxDir, 'Nexus'),
    path.join(linuxDir, 'electron'),
  ]
  for (const candidate of preferred) {
    if (existsSync(candidate)) {
      try { chmodSync(candidate, 0o755) } catch {}
      if (isExecutable(candidate)) return candidate
    }
  }

  for (const entry of listDir(linuxDir)) {
    const candidate = path.join(linuxDir, entry.name)
    if (!entry.isFile()) continue
    if (/\.(so|pak|bin|dat)$/i.test(entry.name)) continue
    try { chmodSync(candidate, 0o755) } catch {}
    if (isExecutable(candidate)) return candidate
  }

  return null
}

function findPackagedExecutable() {
  if (process.platform === 'darwin') return findMacExecutable()
  if (process.platform === 'win32') return findWindowsExecutable()
  if (process.platform === 'linux') return findLinuxExecutable()
  return null
}

function getAppArgs() {
  if (process.platform === 'linux' && process.env.CI === 'true') {
    return ['--no-sandbox']
  }
  return []
}

function collectDescendantPids(pid, result = []) {
  if (!pid || process.platform === 'win32') return result
  let childPids = []
  try {
    childPids = execFileSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' })
      .split(/\s+/)
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isInteger(value) && value > 0)
  } catch {
    return result
  }
  for (const childPid of childPids) {
    collectDescendantPids(childPid, result)
    result.push(childPid)
  }
  return result
}

function terminateChild(child) {
  const descendants = collectDescendantPids(child.pid)
  for (const pid of descendants) {
    try { process.kill(pid, 'SIGKILL') } catch {}
  }
  try { child.kill('SIGKILL') } catch {}
}

function runSmoke(executable) {
  return new Promise((resolve, reject) => {
    let command = executable
    const smokeUserDataDir = mkdtempSync(path.join(os.tmpdir(), 'nexus-packaged-smoke-'))
    let args = [...getAppArgs(), `--user-data-dir=${smokeUserDataDir}`]

    if (process.platform === 'linux' && !process.env.DISPLAY) {
      const xvfbRun = findCommand('xvfb-run')
      if (xvfbRun) {
        command = xvfbRun
        args = ['-a', executable, ...args]
      }
    }

    console.log(`[packaged-smoke] Launching ${command}${args.length ? ` ${args.join(' ')}` : ''}`)
    const child = spawn(command, args, {
      cwd: ROOT,
      env: {
        ...process.env,
        SMOKE_TEST: '1',
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      },
      stdio: 'inherit',
      windowsHide: true,
      detached: false,
    })

    let settled = false
    const cleanup = () => {
      try {
        rmSync(smokeUserDataDir, { recursive: true, force: true })
      } catch {
        // Temporary smoke data is best-effort cleanup and must not mask a result.
      }
    }

    const finish = (error) => {
      if (settled) return
      settled = true
      cleanup()
      if (error) reject(error)
      else resolve()
    }

    const timeout = setTimeout(() => {
      terminateChild(child)
      finish(new Error(`packaged smoke timed out after ${TIMEOUT_MS}ms`))
    }, TIMEOUT_MS)

    child.on('error', (error) => {
      clearTimeout(timeout)
      finish(error)
    })

    child.on('exit', (code, signal) => {
      clearTimeout(timeout)
      if (code === 0) {
        finish()
        return
      }
      finish(new Error(`packaged smoke exited with code=${code} signal=${signal || ''}`.trim()))
    })
  })
}

const executable = findPackagedExecutable()
if (!executable) {
  console.error('[packaged-smoke] No packaged executable found. Run `npm run package:dir` first.')
  process.exit(1)
}

try {
  await runSmoke(executable)
  console.log('[packaged-smoke] Packaged app loaded successfully.')
} catch (error) {
  console.error(`[packaged-smoke] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
