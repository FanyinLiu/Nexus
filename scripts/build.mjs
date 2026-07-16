#!/usr/bin/env node

import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  computeBuildInputFingerprint,
  isBuildFingerprintStable,
} from './build-fingerprint.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BUILD_INTEGRITY_FILE = 'build-integrity.json'
export const BUILD_LOCK_FILE = '.nexus-build.lock'
const BUILD_LOCK_OWNER_PREFIX = 'owner-'
const BUILD_LOCK_OWNER_SUFFIX = '.json'

const DEFAULT_BUILD_LOCK_IO = {
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  rmdir,
  unlink,
}

export const BUILD_STEPS = [
  {
    name: 'tsc -b',
    packageDirectory: 'typescript',
    entry: 'bin/tsc',
    args: ['-b'],
  },
  {
    name: 'vite build',
    packageDirectory: 'vite',
    entry: 'bin/vite.js',
    args: ['build'],
  },
  {
    name: 'scripts/minify-built-css.mjs',
    entry: 'scripts/minify-built-css.mjs',
    args: [],
  },
]

export function createBuildIntegrityStamp(fingerprint) {
  return {
    schemaVersion: 1,
    algorithm: fingerprint.algorithm,
    inputFingerprint: fingerprint.digest,
    inputFileCount: fingerprint.fileCount,
    buildSteps: BUILD_STEPS.map((step) => step.name),
  }
}

export function shouldWriteBuildIntegrityStamp(before, after) {
  return isBuildFingerprintStable(before, after)
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

export function buildLockOwnerFileName(token) {
  return `${BUILD_LOCK_OWNER_PREFIX}${token}${BUILD_LOCK_OWNER_SUFFIX}`
}

function buildLockOwnerPath(lockPath, token) {
  return join(lockPath, buildLockOwnerFileName(token))
}

async function listBuildLockEntries(lockPath, io = DEFAULT_BUILD_LOCK_IO) {
  try {
    return await io.readdir(lockPath)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    if (error?.code === 'ENOTDIR') return []
    throw error
  }
}

function ownerFileNames(entries) {
  return entries.filter((entry) => (
    typeof entry === 'string'
      && entry.startsWith(BUILD_LOCK_OWNER_PREFIX)
      && entry.endsWith(BUILD_LOCK_OWNER_SUFFIX)
  ))
}

async function readBuildLockOwner(lockPath, io = DEFAULT_BUILD_LOCK_IO) {
  const entries = await listBuildLockEntries(lockPath, io)
  if (entries === null) return null

  const ownerFiles = ownerFileNames(entries)
  if (ownerFiles.length !== 1) {
    return {
      validRecord: false,
      ownerFiles,
      reason: ownerFiles.length === 0 ? 'missing owner metadata' : 'multiple owner metadata files',
    }
  }

  const ownerFileName = ownerFiles[0]
  const ownerPath = join(lockPath, ownerFileName)
  let raw
  try {
    raw = await io.readFile(ownerPath, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') {
      const currentEntries = await listBuildLockEntries(lockPath, io)
      if (currentEntries === null) return null
      return { validRecord: false, ownerFiles: ownerFileNames(currentEntries), reason: 'owner metadata disappeared' }
    }
    throw error
  }

  let record = null
  try {
    record = JSON.parse(raw)
  } catch {
    // Invalid metadata is reported as stale and is never auto-removed.
  }

  const token = typeof record?.token === 'string' ? record.token : null
  const pid = Number.isInteger(record?.pid) ? record.pid : null
  const createdAt = typeof record?.createdAt === 'string' ? record.createdAt : null
  const validRecord = Boolean(
    token
      && pid !== null
      && createdAt
      && Number.isFinite(Date.parse(createdAt))
      && ownerFileName === buildLockOwnerFileName(token),
  )
  return {
    validRecord,
    ownerFiles,
    ownerFileName,
    ownerPath,
    raw,
    record,
    token,
    pid,
    createdAt,
    livePid: validRecord && isProcessAlive(pid),
  }
}

function buildLockConflictError(lockPath, owner) {
  if (owner?.validRecord && owner.livePid) {
    return new Error(
      `Build already in progress (pid ${owner.pid}, createdAt ${owner.createdAt}); lock is held at ${lockPath}`,
    )
  }
  return new Error(
    `Stale build lock at ${lockPath}; confirm no build process is running, then remove the lock directory manually`,
  )
}

async function cleanupCreatedBuildLock(lockPath, ownerPath, io = DEFAULT_BUILD_LOCK_IO) {
  try {
    await io.unlink(ownerPath)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  try {
    await io.rmdir(lockPath)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

async function createBuildLock(lockPath, record, io = DEFAULT_BUILD_LOCK_IO) {
  await io.mkdir(lockPath)
  const ownerPath = buildLockOwnerPath(lockPath, record.token)
  try {
    const handle = await io.open(ownerPath, 'wx')
    let failure = null
    try {
      await handle.writeFile(`${JSON.stringify(record)}\n`, 'utf8')
    } catch (error) {
      failure = error
    }
    try {
      await handle.close()
    } catch (error) {
      failure ??= error
    }

    if (failure) throw failure
    return { lockPath, ownerPath, token: record.token, record, io }
  } catch (error) {
    try {
      await cleanupCreatedBuildLock(lockPath, ownerPath, io)
    } catch {
      // Preserve the original owner write/close error for the caller.
    }
    throw error
  }
}

export async function releaseBuildLock(lock, io = lock.io ?? DEFAULT_BUILD_LOCK_IO) {
  const currentOwner = await readBuildLockOwner(lock.lockPath, io)
  if (!currentOwner?.validRecord || currentOwner.token !== lock.token) return false

  try {
    await io.unlink(buildLockOwnerPath(lock.lockPath, lock.token))
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }

  const remainingEntries = await listBuildLockEntries(lock.lockPath, io)
  if (remainingEntries === null) return true
  if (ownerFileNames(remainingEntries).length > 0) return false

  try {
    await io.rmdir(lock.lockPath)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return true
    if (error?.code === 'ENOTEMPTY' || error?.code === 'EEXIST') return false
    throw error
  }
}

export async function acquireBuildLock(
  root = ROOT,
  now = Date.now(),
  { io = DEFAULT_BUILD_LOCK_IO } = {},
) {
  const lockPath = join(root, BUILD_LOCK_FILE)
  const record = {
    token: randomUUID(),
    pid: process.pid,
    createdAt: new Date(now).toISOString(),
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await createBuildLock(lockPath, record, io)
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      const existingOwner = await readBuildLockOwner(lockPath, io)
      if (!existingOwner) {
        if (attempt === 1) {
          throw new Error(`Build lock changed while checking ${lockPath}`)
        }
        continue
      }
      throw buildLockConflictError(lockPath, existingOwner)
    }
  }

  throw new Error(`Build lock changed while checking ${lockPath}`)
}

function buildStepPath(root, step) {
  return step.packageDirectory
    ? join(root, 'node_modules', step.packageDirectory, step.entry)
    : join(root, step.entry)
}

export function runBuildStep(step, root = ROOT) {
  const entryPath = buildStepPath(root, step)
  return new Promise((resolveStep, rejectStep) => {
    const child = spawn(process.execPath, [entryPath, ...step.args], {
      cwd: root,
      stdio: 'inherit',
      windowsHide: false,
    })
    child.once('error', rejectStep)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolveStep()
        return
      }
      rejectStep(new Error(`${step.name} failed${signal ? ` (${signal})` : ` with exit code ${code}`}`))
    })
  })
}

async function writeAtomicJson(path, value) {
  const temporaryPath = `${path}.${process.pid}.tmp`
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await rename(temporaryPath, path)
  } catch (error) {
    await rm(temporaryPath, { force: true })
    throw error
  }
}

export async function buildProject(
  root = ROOT,
  { runStep = runBuildStep, lockIo = DEFAULT_BUILD_LOCK_IO } = {},
) {
  const distDirectory = join(root, 'dist')
  const integrityPath = join(distDirectory, BUILD_INTEGRITY_FILE)
  const lock = await acquireBuildLock(root, Date.now(), { io: lockIo })
  let stamp
  let buildFailure = null
  let releaseFailure = null

  try {
    await rm(integrityPath, { force: true })
    const before = computeBuildInputFingerprint(root)
    for (const step of BUILD_STEPS) {
      await runStep(step, root)
    }

    const after = computeBuildInputFingerprint(root)
    if (!shouldWriteBuildIntegrityStamp(before, after)) {
      throw new Error('Build inputs changed during build; build-integrity.json was not written')
    }

    await mkdir(distDirectory, { recursive: true })
    stamp = createBuildIntegrityStamp(after)
    await writeAtomicJson(integrityPath, stamp)
  } catch (error) {
    buildFailure = error
    try {
      await rm(integrityPath, { force: true })
    } catch {
      // Preserve the original build failure; the release path below still
      // makes a best effort to remove the stamp.
    }
  } finally {
    try {
      const released = await releaseBuildLock(lock)
      if (!released) releaseFailure = new Error(`Failed to release build lock at ${lock.lockPath}`)
    } catch (error) {
      releaseFailure = error
    }
    if (releaseFailure) {
      try {
        await rm(integrityPath, { force: true })
      } catch {
        // Preserve the release failure as the command failure.
      }
    }
  }

  if (releaseFailure) throw releaseFailure
  if (buildFailure) throw buildFailure
  return stamp
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (invokedPath && resolve(fileURLToPath(import.meta.url)) === invokedPath) {
  try {
    const stamp = await buildProject(ROOT)
    console.log(`Build integrity: ${stamp.inputFingerprint} (${stamp.inputFileCount} input files)`)
  } catch (error) {
    console.error(`[build] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
