#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { verifyMacRelease } from './verify-mac-release.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  return {
    ok: result.status === 0,
    output: [result.stdout, result.stderr].filter(Boolean).join('\n'),
    status: result.status,
    executed: !result.error,
    error: result.error?.message ?? '',
  }
}

export function selectMacReleaseContainers(releaseDir, listFiles = readdirSync) {
  const files = listFiles(releaseDir).filter((name) => !name.endsWith('.blockmap'))
  const dmgs = files.filter((name) => name.endsWith('.dmg'))
  const zips = files.filter((name) => name.endsWith('.zip'))
  const errors = []
  if (dmgs.length !== 1) errors.push(`expected exactly one DMG, found ${dmgs.length}: ${dmgs.join(', ') || '<none>'}`)
  if (zips.length !== 1) errors.push(`expected exactly one ZIP, found ${zips.length}: ${zips.join(', ') || '<none>'}`)
  const selected = [...dmgs, ...zips]
  if (selected.some((name) => /smoke/i.test(name))) errors.push('formal macOS containers must not use Smoke identity')
  return {
    ok: errors.length === 0,
    dmgPath: dmgs.length === 1 ? join(releaseDir, dmgs[0]) : '',
    zipPath: zips.length === 1 ? join(releaseDir, zips[0]) : '',
    errors,
  }
}

function findFormalApp(directory, listFiles = readdirSync) {
  const apps = listFiles(directory).filter((name) => name.endsWith('.app'))
  if (apps.length !== 1 || apps[0] !== 'Nexus.app') {
    throw new Error(`container must hold exactly one top-level Nexus.app (found ${apps.join(', ') || '<none>'})`)
  }
  return join(directory, 'Nexus.app')
}

function defaultMaterializeContainer({ kind, containerPath, tempRoot, runCommand = run }) {
  if (kind === 'dmg') {
    const mountPoint = join(tempRoot, 'dmg')
    mkdirSync(mountPoint, { recursive: true })
    const attach = runCommand('hdiutil', ['attach', containerPath, '-nobrowse', '-readonly', '-mountpoint', mountPoint])
    if (!attach.executed || !attach.ok) {
      throw new Error(`failed to mount DMG: ${attach.error || attach.output || `status ${attach.status}`}`)
    }
    try {
      const appPath = findFormalApp(mountPoint)
      return {
        appPath,
        cleanup() {
          const detach = runCommand('hdiutil', ['detach', mountPoint])
          if (!detach.executed || !detach.ok) {
            throw new Error(`failed to detach DMG: ${detach.error || detach.output || `status ${detach.status}`}`)
          }
        },
      }
    } catch (error) {
      runCommand('hdiutil', ['detach', mountPoint])
      throw error
    }
  }

  const extractDir = join(tempRoot, 'zip')
  mkdirSync(extractDir, { recursive: true })
  const extract = runCommand('ditto', ['-x', '-k', containerPath, extractDir])
  if (!extract.executed || !extract.ok) {
    throw new Error(`failed to extract ZIP: ${extract.error || extract.output || `status ${extract.status}`}`)
  }
  return { appPath: findFormalApp(extractDir), cleanup() {} }
}

export function verifyMacReleaseContainers(releaseDir, options = {}) {
  const {
    expectUnsigned = true,
    expectedVersion,
    runCommand = run,
    verifyApp = verifyMacRelease,
    materializeContainer = defaultMaterializeContainer,
    makeTempRoot = () => mkdtempSync(join(tmpdir(), 'nexus-mac-release-containers-')),
    removeTempRoot = (path) => rmSync(path, { recursive: true, force: true }),
    pathExists = existsSync,
    listFiles = readdirSync,
  } = options
  const selected = selectMacReleaseContainers(releaseDir, listFiles)
  if (!selected.ok) return { ok: false, errors: selected.errors, containers: [] }

  const tempRoot = makeTempRoot()
  const errors = []
  const containers = []
  try {
    for (const [kind, containerPath] of [['dmg', selected.dmgPath], ['zip', selected.zipPath]]) {
      let handle
      try {
        handle = materializeContainer({ kind, containerPath, tempRoot, runCommand })
        const result = verifyApp(handle.appPath, {
          expectUnsigned,
          expectedVersion,
          runCommand,
          pathExists,
        })
        containers.push({ kind, containerPath, appPath: handle.appPath, result })
        if (!result.ok) {
          for (const error of result.errors) errors.push(`${kind}: ${error}`)
        }
      } catch (error) {
        errors.push(`${kind}: ${error instanceof Error ? error.message : String(error)}`)
      } finally {
        if (handle) {
          try {
            handle.cleanup()
          } catch (error) {
            errors.push(`${kind}: ${error instanceof Error ? error.message : String(error)}`)
          }
        }
      }
    }
  } finally {
    removeTempRoot(tempRoot)
  }
  return { ok: errors.length === 0, errors, containers }
}

function main(argv) {
  const expectUnsigned = argv.includes('--expect-unsigned')
  const releaseDirArg = argv.find((arg) => !arg.startsWith('--'))
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const releaseDir = resolve(ROOT, releaseDirArg ?? 'release')
  const report = verifyMacReleaseContainers(releaseDir, {
    expectUnsigned,
    expectedVersion: pkg.version,
  })
  if (!report.ok) {
    console.error('macOS release container verification failed')
    for (const error of report.errors) console.error(`- ${error}`)
    process.exit(1)
  }
  console.log('macOS release container verification passed')
  for (const container of report.containers) {
    console.log(`- ${container.kind}: ${container.result.bundleIdentifier} ${container.result.bundleVersion} (${container.result.architectures.join(', ')})`)
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (invokedPath && resolve(fileURLToPath(import.meta.url)) === invokedPath) {
  main(process.argv.slice(2))
}
