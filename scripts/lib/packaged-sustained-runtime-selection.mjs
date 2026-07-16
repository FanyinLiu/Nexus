/**
 * Packaged executable discovery and deterministic selection.
 * Pure filesystem scan helpers — no process launch or CDP.
 */

import {
  existsSync,
  readdirSync,
  statSync,
  chmodSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Default multi-root search order when no single release dir is forced. */
export const DEFAULT_CANDIDATE_RELEASE_DIRS = ['release-smoke', 'release']

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

function safeMtimeMs(filePath) {
  try {
    return statSync(filePath).mtimeMs
  } catch {
    return 0
  }
}

function resolveCandidateRoots({
  root = ROOT,
  forcedReleaseDir = process.env.PACKAGED_SMOKE_RELEASE_DIR,
  candidateDirsEnv = process.env.PACKAGED_RUNTIME_CANDIDATE_DIRS,
  defaultDirs = DEFAULT_CANDIDATE_RELEASE_DIRS,
} = {}) {
  if (forcedReleaseDir) {
    return {
      roots: [path.resolve(root, forcedReleaseDir)],
      mode: 'forced',
      reason: `PACKAGED_SMOKE_RELEASE_DIR=${forcedReleaseDir}`,
    }
  }
  const raw = candidateDirsEnv
    ? candidateDirsEnv.split(',').map((value) => value.trim()).filter(Boolean)
    : defaultDirs
  return {
    roots: raw.map((dir) => path.resolve(root, dir)),
    mode: candidateDirsEnv ? 'env_list' : 'default_multi_root',
    reason: candidateDirsEnv
      ? `PACKAGED_RUNTIME_CANDIDATE_DIRS=${candidateDirsEnv}`
      : `default roots: ${defaultDirs.join(', ')}`,
  }
}

function findMacExecutablesInReleaseDir(releaseDir) {
  const found = []
  for (const entry of listDir(releaseDir)) {
    if (!entry.isDirectory()) continue
    const releaseSubdir = path.join(releaseDir, entry.name)
    for (const child of listDir(releaseSubdir)) {
      if (!child.isDirectory() || !child.name.endsWith('.app')) continue
      const appDir = path.join(releaseSubdir, child.name)
      const macOsDir = path.join(appDir, 'Contents', 'MacOS')
      let executable = null
      for (const preferred of [path.join(macOsDir, 'Nexus'), path.join(macOsDir, 'Nexus Smoke'), path.join(macOsDir, 'Electron')]) {
        if (isExecutable(preferred)) {
          executable = preferred
          break
        }
      }
      if (!executable) {
        for (const macEntry of listDir(macOsDir)) {
          const candidate = path.join(macOsDir, macEntry.name)
          if (isExecutable(candidate)) {
            executable = candidate
            break
          }
        }
      }
      if (!executable) continue
      const mtimeMs = Math.max(safeMtimeMs(executable), safeMtimeMs(appDir))
      found.push({
        platform: 'darwin',
        releaseDir,
        appPath: appDir,
        appName: child.name,
        executable,
        mtimeMs,
        valid: true,
      })
    }
  }
  return found
}

function findWindowsExecutablesInReleaseDir(releaseDir) {
  const winDir = path.join(releaseDir, 'win-unpacked')
  const found = []
  for (const name of ['Nexus.exe', 'Electron.exe']) {
    const candidate = path.join(winDir, name)
    if (!existsSync(candidate)) continue
    found.push({
      platform: 'win32',
      releaseDir,
      appPath: winDir,
      appName: name,
      executable: candidate,
      mtimeMs: safeMtimeMs(candidate),
      valid: true,
    })
    return found
  }
  for (const entry of listDir(winDir)) {
    if (!entry.isFile() || !/\.exe$/i.test(entry.name) || /uninstall/i.test(entry.name)) continue
    const candidate = path.join(winDir, entry.name)
    found.push({
      platform: 'win32',
      releaseDir,
      appPath: winDir,
      appName: entry.name,
      executable: candidate,
      mtimeMs: safeMtimeMs(candidate),
      valid: true,
    })
    break
  }
  return found
}

function findLinuxExecutablesInReleaseDir(releaseDir) {
  const linuxDir = path.join(releaseDir, 'linux-unpacked')
  const found = []
  for (const name of ['nexus', 'Nexus', 'electron']) {
    const candidate = path.join(linuxDir, name)
    if (!existsSync(candidate)) continue
    try { chmodSync(candidate, 0o755) } catch { /* best effort */ }
    if (!isExecutable(candidate)) continue
    found.push({
      platform: 'linux',
      releaseDir,
      appPath: linuxDir,
      appName: name,
      executable: candidate,
      mtimeMs: safeMtimeMs(candidate),
      valid: true,
    })
    return found
  }
  return found
}

/**
 * Discover packaged executables under one or more release roots.
 * Never invents paths — missing roots are reported as rejected/missing.
 */
export function discoverPackagedCandidates({
  root = ROOT,
  platform = process.platform,
  forcedReleaseDir = process.env.PACKAGED_SMOKE_RELEASE_DIR,
  candidateDirsEnv = process.env.PACKAGED_RUNTIME_CANDIDATE_DIRS,
  defaultDirs = DEFAULT_CANDIDATE_RELEASE_DIRS,
} = {}) {
  const { roots, mode, reason } = resolveCandidateRoots({
    root,
    forcedReleaseDir,
    candidateDirsEnv,
    defaultDirs,
  })
  const candidates = []
  const missingRoots = []
  for (const releaseDir of roots) {
    if (!existsSync(releaseDir)) {
      missingRoots.push(releaseDir)
      continue
    }
    if (platform === 'darwin') candidates.push(...findMacExecutablesInReleaseDir(releaseDir))
    else if (platform === 'win32') candidates.push(...findWindowsExecutablesInReleaseDir(releaseDir))
    else if (platform === 'linux') candidates.push(...findLinuxExecutablesInReleaseDir(releaseDir))
  }
  return { roots, mode, reason, candidates, missingRoots }
}

/**
 * Deterministic selection: newest valid package by mtime, then path.
 * Rejects older packages explicitly so a stale release is never chosen silently
 * when a newer release-smoke (or other) package exists.
 */
export function selectPackagedExecutable(options = {}) {
  const discovery = discoverPackagedCandidates(options)
  const sorted = [...discovery.candidates].sort((a, b) => {
    if (b.mtimeMs !== a.mtimeMs) return b.mtimeMs - a.mtimeMs
    return a.executable.localeCompare(b.executable)
  })
  const selected = sorted[0] ?? null
  const rejected = sorted.slice(1).map((candidate) => ({
    executable: candidate.executable,
    appPath: candidate.appPath,
    releaseDir: candidate.releaseDir,
    mtimeMs: candidate.mtimeMs,
    reason: selected
      ? `older than selected package (mtime ${new Date(candidate.mtimeMs).toISOString()} < ${new Date(selected.mtimeMs).toISOString()})`
      : 'not selected',
  }))
  for (const missing of discovery.missingRoots) {
    rejected.push({
      executable: null,
      appPath: null,
      releaseDir: missing,
      mtimeMs: null,
      reason: 'release root missing',
    })
  }

  if (!selected) {
    return {
      ok: false,
      executable: null,
      selection: null,
      rejected,
      discovery,
      reason: `No packaged executable under ${discovery.roots.join(', ')}. Run npm run package:dir:smoke (or package:dir) first.`,
    }
  }

  const why = [
    `selected newest valid package by mtime`,
    `app=${selected.appName}`,
    `releaseDir=${selected.releaseDir}`,
    `mtime=${new Date(selected.mtimeMs).toISOString()}`,
    `mode=${discovery.mode}`,
    discovery.reason,
  ].join('; ')

  return {
    ok: true,
    executable: selected.executable,
    selection: {
      ...selected,
      why,
      rejectedCount: rejected.length,
    },
    rejected,
    discovery,
    reason: why,
  }
}

/**
 * Compatibility helper: return the selected executable path only.
 * Prefer `selectPackagedExecutable` when selection metadata is needed.
 */
export function findPackagedExecutable(releaseDir) {
  if (releaseDir) {
    const candidates = process.platform === 'darwin'
      ? findMacExecutablesInReleaseDir(path.resolve(releaseDir))
      : process.platform === 'win32'
        ? findWindowsExecutablesInReleaseDir(path.resolve(releaseDir))
        : findLinuxExecutablesInReleaseDir(path.resolve(releaseDir))
    const sorted = [...candidates].sort(
      (a, b) => b.mtimeMs - a.mtimeMs || a.executable.localeCompare(b.executable),
    )
    return sorted[0]?.executable ?? null
  }
  return selectPackagedExecutable().executable
}
