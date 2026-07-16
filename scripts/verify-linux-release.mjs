#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, posix, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { verifyPackagedResources } from './release-resource-verifier.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FORMAL_PACKAGE_NAME = 'nexus'

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: options.cwd,
  })
  return {
    ok: result.status === 0 && !result.error,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status,
    executed: !result.error,
    error: result.error?.message ?? '',
  }
}

function commandFailure(label, result) {
  if (!result?.executed) return `${label} could not start: ${result?.error || 'tool unavailable'}`
  const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
  return `${label} failed with exit code ${String(result.status)}${detail ? `: ${detail}` : ''}`
}

function commandSucceeded(result) {
  return result?.executed === true && result.ok === true && result.status === 0
}

export function selectLinuxReleaseArtifacts(releaseDir, listFiles = readdirSync) {
  const errors = []
  let files = []
  try {
    files = listFiles(releaseDir)
  } catch (error) {
    return {
      ok: false,
      errors: [`failed to read Linux release directory: ${error instanceof Error ? error.message : String(error)}`],
      appImagePath: '',
      debPath: '',
      tarballPath: '',
    }
  }

  const groups = [
    { label: 'AppImage', names: files.filter((name) => name.endsWith('.AppImage')) },
    { label: 'deb', names: files.filter((name) => name.endsWith('.deb')) },
    { label: 'tar.gz', names: files.filter((name) => name.endsWith('.tar.gz')) },
  ]

  for (const group of groups) {
    if (group.names.length !== 1) {
      errors.push(`expected exactly one ${group.label}, found ${group.names.length}: ${group.names.join(', ') || '<none>'}`)
    }
    if (group.names.some((name) => /smoke/i.test(name))) {
      errors.push(`${group.label} artifact must not contain the Smoke identity`)
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    appImagePath: groups[0].names.length === 1 ? join(releaseDir, groups[0].names[0]) : '',
    debPath: groups[1].names.length === 1 ? join(releaseDir, groups[1].names[0]) : '',
    tarballPath: groups[2].names.length === 1 ? join(releaseDir, groups[2].names[0]) : '',
  }
}

export function isX64ElfFileOutput(output) {
  const text = String(output ?? '').trim()
  return /\bELF 64-bit\b/.test(text) && /\bx86-64\b/.test(text)
}

export function parseDebFields(output) {
  const fields = new Map()
  for (const rawLine of String(output ?? '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const match = /^([A-Za-z][A-Za-z0-9-]*):\s*(\S(?:.*\S)?)$/.exec(line)
    if (!match) throw new Error(`ambiguous dpkg-deb field output: ${line}`)
    const key = match[1].toLowerCase()
    if (fields.has(key)) throw new Error(`duplicate dpkg-deb field: ${match[1]}`)
    fields.set(key, match[2])
  }
  return Object.fromEntries(fields)
}

export function isSafeTarEntry(entry) {
  const value = String(entry ?? '')
  if (!value || value.includes('\0') || value.includes('\\')) return false
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) return false
  const segments = value.split('/')
  if (segments.includes('..')) return false
  const normalized = posix.normalize(value)
  return normalized !== '..' && !normalized.startsWith('../') && !posix.isAbsolute(normalized)
}

function scanExtractedTree(root) {
  const entries = []

  function visit(directory) {
    for (const dirent of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, dirent.name)
      const relativePath = relative(root, path).split('\\').join('/')
      const info = lstatSync(path)
      const kind = info.isDirectory()
        ? 'directory'
        : info.isFile()
          ? 'file'
          : info.isSymbolicLink()
            ? 'symlink'
            : 'special'
      entries.push({ path, relativePath, kind, mode: info.mode })
      if (kind === 'directory') visit(path)
    }
  }

  visit(root)
  return entries
}

export function verifyExtractedLinuxResources(extractionRoot, options = {}) {
  const {
    scanTree = scanExtractedTree,
    resourceVerifier = verifyPackagedResources,
    resourceVerifierOptions = {},
  } = options
  const errors = []
  let extractedEntries
  try {
    extractedEntries = scanTree(extractionRoot)
  } catch (error) {
    return {
      ok: false,
      errors: [`failed to inspect extracted Linux container: ${error instanceof Error ? error.message : String(error)}`],
      resourcesRoot: '',
      resourceReport: null,
    }
  }

  if (!Array.isArray(extractedEntries)) {
    return {
      ok: false,
      errors: ['extracted Linux container scanner returned an ambiguous result'],
      resourcesRoot: '',
      resourceReport: null,
    }
  }

  const appAsarEntries = extractedEntries.filter((entry) => {
    if (!entry || entry.kind !== 'file' || typeof entry.path !== 'string' || !entry.path) return false
    const segments = String(entry.relativePath ?? '').split('/')
    return segments.length >= 2
      && segments.at(-2) === 'resources'
      && segments.at(-1) === 'app.asar'
  })
  if (appAsarEntries.length !== 1) {
    errors.push(`Linux container must contain exactly one packaged resources/app.asar, found ${appAsarEntries.length}`)
    return { ok: false, errors, resourcesRoot: '', resourceReport: null }
  }

  const appAsarEntry = appAsarEntries[0]
  const resourcesRelativePath = dirname(appAsarEntry.relativePath).split('\\').join('/')
  const expectedAppAsarPath = join(extractionRoot, ...appAsarEntry.relativePath.split('/'))
  if (resolve(appAsarEntry.path) !== resolve(expectedAppAsarPath)) {
    errors.push('Linux container scanner returned an app.asar path outside its declared extraction path')
    return { ok: false, errors, resourcesRoot: '', resourceReport: null }
  }
  const resourcesRoot = dirname(appAsarEntry.path)
  const resourcesDirectory = extractedEntries.filter((entry) => (
    entry?.kind === 'directory' && entry.relativePath === resourcesRelativePath
  ))
  if (resourcesDirectory.length !== 1) {
    errors.push(`Linux container resources directory is missing or ambiguous: ${resourcesRelativePath}`)
    return { ok: false, errors, resourcesRoot: '', resourceReport: null }
  }

  const unsafeResourceEntries = extractedEntries.filter((entry) => (
    (entry?.relativePath === resourcesRelativePath || entry?.relativePath?.startsWith(`${resourcesRelativePath}/`))
    && (entry.kind === 'symlink' || entry.kind === 'special')
  ))
  for (const entry of unsafeResourceEntries) {
    errors.push(`packaged resources contain unsupported ${entry.kind} entry: ${entry.relativePath}`)
  }
  if (errors.length > 0) return { ok: false, errors, resourcesRoot, resourceReport: null }

  let resourceReport
  try {
    resourceReport = resourceVerifier(resourcesRoot, resourceVerifierOptions)
  } catch (error) {
    errors.push(`packaged resource verifier failed: ${error instanceof Error ? error.message : String(error)}`)
    return { ok: false, errors, resourcesRoot, resourceReport: null }
  }
  if (!resourceReport || resourceReport.ok !== true) {
    const resourceErrors = Array.isArray(resourceReport?.errors) && resourceReport.errors.length > 0
      ? resourceReport.errors
      : ['packaged resource verifier returned an ambiguous result']
    for (const error of resourceErrors) errors.push(`resources: ${error}`)
  }

  return { ok: errors.length === 0, errors, resourcesRoot, resourceReport }
}

function inspectExtractedResources(extractionRoot, errors, options) {
  const report = verifyExtractedLinuxResources(extractionRoot, options)
  if (!report.ok) errors.push(...report.errors)
  return report
}

export function inspectLinuxAppImage(appImagePath, options = {}) {
  const {
    runCommand = run,
    makeTempRoot = () => mkdtempSync(join(tmpdir(), 'nexus-linux-appimage-')),
    removeTempRoot = (path) => rmSync(path, { recursive: true, force: true }),
    scanTree = scanExtractedTree,
    resourceVerifier = verifyPackagedResources,
    resourceVerifierOptions = {},
  } = options
  const errors = []
  const tempRoot = makeTempRoot()
  let resourceReport = null
  try {
    const extract = runCommand(appImagePath, ['--appimage-extract'], { cwd: tempRoot })
    if (!commandSucceeded(extract)) {
      errors.push(commandFailure('AppImage extraction', extract))
    } else {
      resourceReport = inspectExtractedResources(join(tempRoot, 'squashfs-root'), errors, {
        scanTree,
        resourceVerifier,
        resourceVerifierOptions,
      })
    }
  } finally {
    try {
      removeTempRoot(tempRoot)
    } catch (error) {
      errors.push(`failed to remove temporary AppImage directory: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { ok: errors.length === 0, errors, resourcesRoot: resourceReport?.resourcesRoot ?? '' }
}

export function inspectLinuxDeb(debPath, options = {}) {
  const {
    runCommand = run,
    makeTempRoot = () => mkdtempSync(join(tmpdir(), 'nexus-linux-deb-')),
    removeTempRoot = (path) => rmSync(path, { recursive: true, force: true }),
    scanTree = scanExtractedTree,
    resourceVerifier = verifyPackagedResources,
    resourceVerifierOptions = {},
  } = options
  const errors = []
  const tempRoot = makeTempRoot()
  let resourceReport = null
  try {
    const extract = runCommand('dpkg-deb', ['--extract', debPath, tempRoot])
    if (!commandSucceeded(extract)) {
      errors.push(commandFailure('deb extraction', extract))
    } else {
      resourceReport = inspectExtractedResources(tempRoot, errors, {
        scanTree,
        resourceVerifier,
        resourceVerifierOptions,
      })
    }
  } finally {
    try {
      removeTempRoot(tempRoot)
    } catch (error) {
      errors.push(`failed to remove temporary deb directory: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { ok: errors.length === 0, errors, resourcesRoot: resourceReport?.resourcesRoot ?? '' }
}

export function inspectLinuxTarball(tarballPath, options = {}) {
  const {
    executableName = FORMAL_PACKAGE_NAME,
    runCommand = run,
    makeTempRoot = () => mkdtempSync(join(tmpdir(), 'nexus-linux-release-')),
    removeTempRoot = (path) => rmSync(path, { recursive: true, force: true }),
    scanTree = scanExtractedTree,
    resourceVerifier = verifyPackagedResources,
    resourceVerifierOptions = {},
  } = options
  const errors = []
  const list = runCommand('tar', ['-tzf', tarballPath])
  if (!commandSucceeded(list)) {
    return { ok: false, errors: [commandFailure('tar archive listing', list)], executablePath: '' }
  }

  const archiveEntries = String(list.stdout).split(/\r?\n/).filter(Boolean)
  if (archiveEntries.length === 0) errors.push('tar.gz archive is empty or its listing is ambiguous')
  for (const entry of archiveEntries) {
    if (!isSafeTarEntry(entry)) errors.push(`unsafe tar.gz entry path: ${entry}`)
    if (/smoke/i.test(entry)) errors.push(`tar.gz entry contains the Smoke identity: ${entry}`)
  }
  if (errors.length > 0) return { ok: false, errors, executablePath: '' }

  const tempRoot = makeTempRoot()
  let executablePath = ''
  try {
    const extract = runCommand('tar', [
      '-xzf',
      tarballPath,
      '--no-same-owner',
      '--no-same-permissions',
      '-C',
      tempRoot,
    ])
    if (!commandSucceeded(extract)) {
      errors.push(commandFailure('tar archive extraction', extract))
      return { ok: false, errors, executablePath }
    }

    let extractedEntries
    try {
      extractedEntries = scanTree(tempRoot)
    } catch (error) {
      errors.push(`failed to inspect extracted tar.gz: ${error instanceof Error ? error.message : String(error)}`)
      return { ok: false, errors, executablePath }
    }

    for (const entry of extractedEntries) {
      if (!isSafeTarEntry(entry.relativePath)) errors.push(`unsafe extracted path: ${entry.relativePath}`)
      if (/smoke/i.test(entry.relativePath)) errors.push(`extracted path contains the Smoke identity: ${entry.relativePath}`)
      if (entry.kind === 'symlink' || entry.kind === 'special') {
        errors.push(`tar.gz contains unsupported ${entry.kind} entry: ${entry.relativePath}`)
      }
    }

    inspectExtractedResources(tempRoot, errors, {
      scanTree: () => extractedEntries,
      resourceVerifier,
      resourceVerifierOptions,
    })

    const executables = extractedEntries.filter((entry) => (
      entry.kind === 'file' && basename(entry.relativePath) === executableName
    ))
    if (executables.length !== 1) {
      errors.push(`tar.gz must contain exactly one ${executableName} executable, found ${executables.length}`)
    } else {
      executablePath = executables[0].path
      if ((executables[0].mode & 0o111) === 0) {
        errors.push(`tar.gz ${executableName} file is not executable`)
      }
      const fileResult = runCommand('file', ['--brief', executablePath])
      if (!commandSucceeded(fileResult)) {
        errors.push(commandFailure('file inspection for tar.gz executable', fileResult))
      } else if (!isX64ElfFileOutput(fileResult.stdout)) {
        errors.push(`tar.gz ${executableName} must be an ELF 64-bit x86-64 executable (got ${String(fileResult.stdout).trim() || '<empty>'})`)
      }
    }
  } finally {
    try {
      removeTempRoot(tempRoot)
    } catch (error) {
      errors.push(`failed to remove temporary tar.gz directory: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return { ok: errors.length === 0, errors, executablePath }
}

export function verifyLinuxRelease(releaseDir, options = {}) {
  const {
    expectedVersion = '',
    executableName = FORMAL_PACKAGE_NAME,
    listFiles = readdirSync,
    pathExists = existsSync,
    getMode = (path) => statSync(path).mode,
    runCommand = run,
    inspectAppImage = inspectLinuxAppImage,
    inspectDeb = inspectLinuxDeb,
    inspectTarball = inspectLinuxTarball,
    resourceVerifier = verifyPackagedResources,
    resourceVerifierOptions = {},
  } = options
  const errors = []
  if (!expectedVersion) errors.push('expected package version is required')
  if (executableName !== FORMAL_PACKAGE_NAME) {
    errors.push(`Linux executableName must stay ${FORMAL_PACKAGE_NAME} (got ${executableName || '<missing>'})`)
  }

  const selected = selectLinuxReleaseArtifacts(releaseDir, listFiles)
  errors.push(...selected.errors)
  if (!selected.ok) return { ok: false, errors, artifacts: selected }

  let missingArtifact = false
  for (const path of [selected.appImagePath, selected.debPath, selected.tarballPath]) {
    if (!pathExists(path)) {
      missingArtifact = true
      errors.push(`Linux release artifact not found: ${path}`)
    }
  }
  if (missingArtifact) return { ok: false, errors, artifacts: selected }

  let appImageMode = 0
  try {
    appImageMode = getMode(selected.appImagePath)
  } catch (error) {
    errors.push(`failed to read AppImage permissions: ${error instanceof Error ? error.message : String(error)}`)
  }
  if ((appImageMode & 0o111) === 0) errors.push('AppImage must have at least one executable permission bit')

  const appImageFile = runCommand('file', ['--brief', selected.appImagePath])
  if (!commandSucceeded(appImageFile)) {
    errors.push(commandFailure('file inspection for AppImage', appImageFile))
  } else if (!isX64ElfFileOutput(appImageFile.stdout)) {
    errors.push(`AppImage must be an ELF 64-bit x86-64 executable (got ${String(appImageFile.stdout).trim() || '<empty>'})`)
  }

  try {
    const appImage = inspectAppImage(selected.appImagePath, {
      runCommand,
      resourceVerifier,
      resourceVerifierOptions,
    })
    if (!appImage?.ok) {
      const appImageErrors = Array.isArray(appImage?.errors) && appImage.errors.length > 0
        ? appImage.errors
        : ['AppImage inspection returned an ambiguous result']
      for (const error of appImageErrors) errors.push(`AppImage: ${error}`)
    }
  } catch (error) {
    errors.push(`AppImage verifier failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  const debFields = runCommand('dpkg-deb', [
    '--field',
    selected.debPath,
    'Package',
    'Version',
    'Architecture',
  ])
  if (!commandSucceeded(debFields)) {
    errors.push(commandFailure('dpkg-deb metadata inspection', debFields))
  } else {
    try {
      const fields = parseDebFields(debFields.stdout)
      const expected = {
        package: FORMAL_PACKAGE_NAME,
        version: expectedVersion,
        architecture: 'amd64',
      }
      for (const [field, expectedValue] of Object.entries(expected)) {
        if (fields[field] !== expectedValue) {
          errors.push(`deb ${field} must be ${expectedValue} (got ${fields[field] || '<missing>'})`)
        }
      }
      const unexpected = Object.keys(fields).filter((field) => !(field in expected))
      if (unexpected.length > 0) errors.push(`dpkg-deb returned unexpected fields: ${unexpected.join(', ')}`)
    } catch (error) {
      errors.push(`failed to parse dpkg-deb metadata: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  try {
    const deb = inspectDeb(selected.debPath, {
      runCommand,
      resourceVerifier,
      resourceVerifierOptions,
    })
    if (!deb?.ok) {
      const debErrors = Array.isArray(deb?.errors) && deb.errors.length > 0
        ? deb.errors
        : ['deb inspection returned an ambiguous result']
      for (const error of debErrors) errors.push(`deb: ${error}`)
    }
  } catch (error) {
    errors.push(`deb verifier failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  try {
    const tarball = inspectTarball(selected.tarballPath, {
      executableName,
      runCommand,
      resourceVerifier,
      resourceVerifierOptions,
    })
    if (!tarball?.ok) {
      const tarErrors = Array.isArray(tarball?.errors) && tarball.errors.length > 0
        ? tarball.errors
        : ['tar.gz inspection returned an ambiguous result']
      for (const error of tarErrors) errors.push(`tar.gz: ${error}`)
    }
  } catch (error) {
    errors.push(`tar.gz verifier failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  return { ok: errors.length === 0, errors, artifacts: selected }
}

export function parseLinuxReleaseCli(argv) {
  let releaseDir = 'release'
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--release-dir') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) throw new Error('--release-dir requires a path')
      releaseDir = value
      index += 1
    } else if (argument.startsWith('--release-dir=')) {
      releaseDir = argument.slice('--release-dir='.length)
      if (!releaseDir) throw new Error('--release-dir requires a path')
    } else {
      throw new Error(`unknown argument: ${argument}`)
    }
  }
  return { releaseDir }
}

function main(argv) {
  let cli
  try {
    cli = parseLinuxReleaseCli(argv)
  } catch (error) {
    console.error(`Linux release verification failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }

  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const report = verifyLinuxRelease(resolve(ROOT, cli.releaseDir), {
    expectedVersion: pkg.version,
    executableName: pkg.build?.linux?.executableName,
  })
  if (!report.ok) {
    console.error('Linux release verification failed')
    for (const error of report.errors) console.error(`- ${error}`)
    process.exit(1)
  }

  console.log(`Linux release verification passed for Nexus ${pkg.version}`)
  console.log(`- AppImage: ${basename(report.artifacts.appImagePath)}`)
  console.log(`- deb: ${basename(report.artifacts.debPath)}`)
  console.log(`- tar.gz: ${basename(report.artifacts.tarballPath)}`)
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (invokedPath && resolve(fileURLToPath(import.meta.url)) === invokedPath) {
  main(process.argv.slice(2))
}
