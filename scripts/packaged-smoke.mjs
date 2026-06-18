#!/usr/bin/env node

import { existsSync, readdirSync, statSync, chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const RELEASE_DIR = path.resolve(ROOT, process.env.PACKAGED_SMOKE_RELEASE_DIR || 'release')
const TIMEOUT_MS = Number.parseInt(process.env.PACKAGED_SMOKE_TIMEOUT_MS || '90000', 10)
const EVIDENCE_FILE = process.env.PACKAGED_SMOKE_EVIDENCE_FILE || ''
const M2_PACKAGE_SMOKE_GATE = 'nexus-v1-m2-package-smoke'

function normalizePlatform(value = process.platform) {
  if (value === 'win32') return 'windows'
  if (value === 'darwin') return 'macos'
  if (value === 'linux') return 'linux'
  return 'unknown'
}

function redactLocalPath(value) {
  return String(value ?? '')
    .replaceAll(ROOT, '<repo>')
    .replaceAll(os.homedir(), '<home>')
}

function relativeReleaseDir() {
  const relative = path.relative(ROOT, RELEASE_DIR)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return '<external-release-dir>'
  return relative
}

function executableKind(executable) {
  const normalized = String(executable ?? '')
  if (/\.app\/Contents\/MacOS\//.test(normalized)) return 'macos-app'
  if (/\.exe$/i.test(normalized)) return 'windows-exe'
  if (/linux-unpacked/.test(normalized)) return 'linux-unpacked'
  return executable ? 'executable' : 'missing'
}

function writeEvidence(payload) {
  if (!EVIDENCE_FILE) return
  const resolved = path.resolve(ROOT, EVIDENCE_FILE)
  const report = {
    schemaVersion: 1,
    gate: M2_PACKAGE_SMOKE_GATE,
    generatedAt: new Date().toISOString(),
    platform: normalizePlatform(),
    ok: payload.ok === true,
    releaseDir: relativeReleaseDir(),
    executableKind: executableKind(payload.executable),
    executableFound: Boolean(payload.executable),
    timeoutMs: TIMEOUT_MS,
    status: payload.ok === true ? 'pass' : 'fail',
    error: payload.error ? redactLocalPath(payload.error) : null,
    privacy: {
      artifactContentsCopied: false,
      privateFieldsOmitted: [
        'absolute executable path',
        'user home directory',
        'release operator names and notes',
        'signing secrets',
      ],
    },
  }
  mkdirSync(path.dirname(resolved), { recursive: true })
  writeFileSync(resolved, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

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

function runSmoke(executable) {
  return new Promise((resolve, reject) => {
    let command = executable
    let args = getAppArgs()

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
    })

    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`packaged smoke timed out after ${TIMEOUT_MS}ms`))
    }, TIMEOUT_MS)

    child.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })

    child.on('exit', (code, signal) => {
      clearTimeout(timeout)
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`packaged smoke exited with code=${code} signal=${signal || ''}`.trim()))
    })
  })
}

const executable = findPackagedExecutable()
if (!executable) {
  console.error('[packaged-smoke] No packaged executable found. Run `npm run package:dir` first.')
  writeEvidence({
    ok: false,
    executable: null,
    error: 'No packaged executable found. Run `npm run package:dir` first.',
  })
  process.exit(1)
}

try {
  await runSmoke(executable)
  writeEvidence({ ok: true, executable })
  console.log('[packaged-smoke] Packaged app loaded successfully.')
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  writeEvidence({ ok: false, executable, error: message })
  console.error(`[packaged-smoke] ${message}`)
  process.exit(1)
}
