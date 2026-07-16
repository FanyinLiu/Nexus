#!/usr/bin/env node

import { createHash } from 'node:crypto'
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDocument } from 'yaml'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

export const RELEASE_ARTIFACT_CONTRACTS = Object.freeze({
  windows: Object.freeze({
    artifactPatterns: Object.freeze(['*.exe', '*.exe.blockmap', 'latest.yml']),
    updaterArtifactPatterns: Object.freeze(['*.exe']),
    checksumFile: 'SHA256SUMS-windows.txt',
  }),
  macos: Object.freeze({
    artifactPatterns: Object.freeze(['*.dmg', '*.dmg.blockmap', '*.zip', '*.zip.blockmap', 'latest-mac.yml']),
    updaterArtifactPatterns: Object.freeze(['*.dmg', '*.zip']),
    checksumFile: 'SHA256SUMS-macos.txt',
  }),
  linux: Object.freeze({
    artifactPatterns: Object.freeze(['*.AppImage', '*.deb', '*.tar.gz', 'latest-linux*.yml']),
    updaterArtifactPatterns: Object.freeze(['*.AppImage', '*.deb']),
    checksumFile: 'SHA256SUMS-linux.txt',
  }),
})

function globToRegExp(pattern) {
  let source = '^'
  for (const character of pattern) {
    if (character === '*') source += '.*'
    else if (character === '?') source += '.'
    else source += character.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
  }
  return new RegExp(`${source}$`)
}

function matchesPattern(fileName, pattern) {
  return globToRegExp(pattern).test(fileName)
}

function releaseVersionFromTag(tag) {
  const normalized = String(tag ?? '').trim()
  if (!/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$/.test(normalized)) {
    throw new Error(`invalid or missing release tag: ${normalized || '<empty>'}`)
  }
  return normalized.slice(1)
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function hasExactVersionToken(fileName, version) {
  return new RegExp(`(?:^|[^0-9A-Za-z])${escapeRegExp(version)}(?:[^0-9A-Za-z]|$)`).test(fileName)
}

function isUpdateMetadata(fileName) {
  return /^latest(?:-mac|-linux[^/]*)?\.yml$/.test(fileName)
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeMetadataArtifactName(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('artifact URL/path must be a non-empty string')
  if (/[?#]/.test(value)) throw new Error(`artifact URL/path must not contain a query or fragment: ${value}`)
  let decoded
  try {
    decoded = decodeURIComponent(value)
  } catch {
    throw new Error(`artifact URL/path has invalid percent encoding: ${value}`)
  }
  if (basename(decoded) !== decoded || decoded === '.' || decoded === '..' || decoded.includes('\\')) {
    throw new Error(`artifact URL/path must be a safe top-level filename: ${value}`)
  }
  return decoded
}

function listTopLevelFiles(releaseDir) {
  if (!existsSync(releaseDir)) throw new Error(`release directory does not exist: ${releaseDir}`)
  return readdirSync(releaseDir)
    .filter((name) => statSync(join(releaseDir, name)).isFile())
    .sort()
}

function hashFile(filePath, algorithm, encoding) {
  const hash = createHash(algorithm)
  const file = openSync(filePath, 'r')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    let bytesRead = 0
    do {
      bytesRead = readSync(file, buffer, 0, buffer.length, null)
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead))
    } while (bytesRead > 0)
  } finally {
    closeSync(file)
  }
  return hash.digest(encoding)
}

function sha256(filePath) {
  return hashFile(filePath, 'sha256', 'hex')
}

function sha512(filePath) {
  return hashFile(filePath, 'sha512', 'base64')
}

function validateUpdateMetadata(releaseDir, fileName, version, expectedArtifacts) {
  const errors = []
  const contents = readFileSync(join(releaseDir, fileName), 'utf8')
  let metadata
  try {
    const document = parseDocument(contents, { strict: true, uniqueKeys: true })
    if (document.errors.length) throw document.errors[0]
    metadata = document.toJS({ maxAliasCount: 0 })
  } catch (error) {
    return [`invalid updater metadata YAML: ${error instanceof Error ? error.message : String(error)}`]
  }

  if (!isRecord(metadata)) return ['updater metadata must be a mapping']
  if (metadata.version !== version) errors.push(`metadata version must equal ${version}`)
  if (!Array.isArray(metadata.files) || metadata.files.length === 0) {
    errors.push('metadata files must be a non-empty list')
    return errors
  }

  const expected = new Set(expectedArtifacts)
  const referenced = new Map()
  for (const [index, entry] of metadata.files.entries()) {
    if (!isRecord(entry)) {
      errors.push(`files[${index}] must be a mapping`)
      continue
    }
    let artifactName
    try {
      artifactName = normalizeMetadataArtifactName(entry.url)
    } catch (error) {
      errors.push(`files[${index}]: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    if (!expected.has(artifactName)) {
      errors.push(`files[${index}] references an unexpected updater artifact: ${artifactName}`)
      continue
    }
    if (referenced.has(artifactName)) {
      errors.push(`metadata files contains a duplicate artifact: ${artifactName}`)
      continue
    }

    const artifactPath = join(releaseDir, artifactName)
    const actualSize = statSync(artifactPath).size
    const actualSha512 = sha512(artifactPath)
    if (!Number.isSafeInteger(entry.size) || entry.size <= 0) {
      errors.push(`files[${index}] size must be a positive integer for ${artifactName}`)
    } else if (entry.size !== actualSize) {
      errors.push(`files[${index}] size mismatch for ${artifactName}`)
    }
    if (typeof entry.sha512 !== 'string' || entry.sha512 !== actualSha512) {
      errors.push(`files[${index}] sha512 mismatch for ${artifactName}`)
    }
    referenced.set(artifactName, entry)
  }

  for (const artifactName of expected) {
    if (!referenced.has(artifactName)) errors.push(`metadata files is missing updater artifact: ${artifactName}`)
  }

  let primaryName = null
  try {
    primaryName = normalizeMetadataArtifactName(metadata.path)
  } catch (error) {
    errors.push(`path: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (primaryName !== null) {
    if (!expected.has(primaryName)) {
      errors.push(`path references an unexpected updater artifact: ${primaryName}`)
    } else if (!referenced.has(primaryName)) {
      errors.push(`path artifact is absent from files: ${primaryName}`)
    } else {
      const actualSha512 = sha512(join(releaseDir, primaryName))
      if (typeof metadata.sha512 !== 'string' || metadata.sha512 !== actualSha512) {
        errors.push(`top-level sha512 mismatch for ${primaryName}`)
      }
    }
  }

  return errors
}

function contractFor(platform) {
  const contract = RELEASE_ARTIFACT_CONTRACTS[platform]
  if (!contract) throw new Error(`unknown release platform: ${platform}`)
  return contract
}

export function collectPlatformArtifacts(releaseDir, platform, tag) {
  const contract = contractFor(platform)
  const version = releaseVersionFromTag(tag)
  const files = listTopLevelFiles(releaseDir)
  const errors = []
  const matches = new Map()

  for (const pattern of contract.artifactPatterns) {
    const matched = files.filter((fileName) => matchesPattern(fileName, pattern))
    matches.set(pattern, matched)
    if (matched.length !== 1) {
      errors.push(`${platform}: required artifact pattern must match exactly once: ${pattern} (matched ${matched.length})`)
    }
  }

  const artifacts = [...new Set([...matches.values()].flat())].sort()
  const updaterArtifacts = artifacts
    .filter((fileName) => contract.updaterArtifactPatterns.some((pattern) => matchesPattern(fileName, pattern)))
    .sort()
  const smokeArtifacts = artifacts.filter((fileName) => /smoke/i.test(fileName))
  if (smokeArtifacts.length) {
    errors.push(`${platform}: smoke identity leaked into formal artifacts: ${smokeArtifacts.join(', ')}`)
  }

  for (const fileName of artifacts) {
    if (isUpdateMetadata(fileName)) {
      for (const error of validateUpdateMetadata(releaseDir, fileName, version, updaterArtifacts)) {
        errors.push(`${platform}: ${fileName}: ${error}`)
      }
    } else if (!hasExactVersionToken(fileName, version)) {
      errors.push(`${platform}: artifact is not bound to release version ${version}: ${fileName}`)
    }
  }

  return { platform, contract, files, artifacts, updaterArtifacts, errors, tag, version }
}

export function writePlatformChecksum(releaseDir, platform, tag) {
  const report = collectPlatformArtifacts(releaseDir, platform, tag)
  if (report.errors.length) throw new Error(report.errors.join('\n'))

  const lines = report.artifacts.map((fileName) => `${sha256(join(releaseDir, fileName))}  ${fileName}`)
  const checksumPath = join(releaseDir, report.contract.checksumFile)
  writeFileSync(checksumPath, `${lines.join('\n')}\n`)
  return { ...report, checksumPath, checksumFile: report.contract.checksumFile, lines }
}

function parseChecksumFile(releaseDir, checksumFile) {
  const lines = readFileSync(join(releaseDir, checksumFile), 'utf8').split(/\r?\n/).filter(Boolean)
  const entries = new Map()
  const errors = []

  for (const line of lines) {
    const match = line.match(/^([a-f0-9]{64}) {2}(.+)$/i)
    if (!match) {
      errors.push(`${checksumFile}: malformed checksum line: ${line}`)
      continue
    }
    const fileName = match[2]
    if (basename(fileName) !== fileName || fileName === '.' || fileName === '..') {
      errors.push(`${checksumFile}: unsafe checksum path: ${fileName}`)
      continue
    }
    if (entries.has(fileName)) {
      errors.push(`${checksumFile}: duplicate checksum entry: ${fileName}`)
      continue
    }
    entries.set(fileName, match[1].toLowerCase())
  }

  return { entries, errors }
}

export function verifyReleaseDirectory(releaseDir, tag) {
  const version = releaseVersionFromTag(tag)
  const files = listTopLevelFiles(releaseDir)
  const errors = []
  const allowedPatterns = Object.values(RELEASE_ARTIFACT_CONTRACTS)
    .flatMap((contract) => [...contract.artifactPatterns, contract.checksumFile])
  const unrecognized = files.filter((fileName) => !allowedPatterns.some((pattern) => matchesPattern(fileName, pattern)))
  if (unrecognized.length) errors.push(`unrecognized release assets: ${unrecognized.join(', ')}`)

  const smokeArtifacts = files.filter((fileName) => /smoke/i.test(fileName))
  if (smokeArtifacts.length) errors.push(`smoke identity leaked into release assets: ${smokeArtifacts.join(', ')}`)

  const platforms = {}
  for (const platform of Object.keys(RELEASE_ARTIFACT_CONTRACTS)) {
    const collected = collectPlatformArtifacts(releaseDir, platform, tag)
    const { checksumFile } = collected.contract
    errors.push(...collected.errors)
    if (!files.includes(checksumFile)) {
      errors.push(`${platform}: missing checksum file: ${checksumFile}`)
      platforms[platform] = { ...collected, checksumFile, checksumEntries: [] }
      continue
    }

    const parsed = parseChecksumFile(releaseDir, checksumFile)
    errors.push(...parsed.errors)
    const expected = new Set(collected.artifacts)
    const actual = new Set(parsed.entries.keys())
    for (const fileName of expected) {
      if (!actual.has(fileName)) errors.push(`${checksumFile}: missing entry for ${fileName}`)
    }
    for (const fileName of actual) {
      if (!expected.has(fileName)) errors.push(`${checksumFile}: unexpected entry for ${fileName}`)
    }
    for (const [fileName, expectedDigest] of parsed.entries) {
      const filePath = join(releaseDir, fileName)
      if (!existsSync(filePath)) continue
      const actualDigest = sha256(filePath)
      if (actualDigest !== expectedDigest) errors.push(`${checksumFile}: checksum mismatch for ${fileName}`)
    }
    platforms[platform] = {
      ...collected,
      checksumFile,
      checksumEntries: [...parsed.entries.keys()].sort(),
    }
  }

  return {
    ok: errors.length === 0,
    releaseDir,
    tag,
    version,
    files,
    platforms,
    errors,
  }
}

export function parseReleaseArtifactArgs(argv) {
  const options = {
    platform: null,
    tag: null,
    releaseDir: resolve(ROOT, 'release'),
    writeChecksums: false,
    verifyAll: false,
  }
  const seen = new Set()
  const setValue = (name, value) => {
    if (seen.has(name)) throw new Error(`${name} may only be provided once`)
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
    seen.add(name)
    return value
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--platform' || argument === '--tag' || argument === '--release-dir') {
      const value = setValue(argument, argv[index + 1])
      if (argument === '--platform') options.platform = value
      else if (argument === '--tag') options.tag = value
      else options.releaseDir = resolve(ROOT, value)
      index += 1
    } else if (argument.startsWith('--platform=')) {
      options.platform = setValue('--platform', argument.slice('--platform='.length))
    } else if (argument.startsWith('--tag=')) {
      options.tag = setValue('--tag', argument.slice('--tag='.length))
    } else if (argument.startsWith('--release-dir=')) {
      options.releaseDir = resolve(ROOT, setValue('--release-dir', argument.slice('--release-dir='.length)))
    } else if (argument === '--write-checksums') {
      if (options.writeChecksums) throw new Error('--write-checksums may only be provided once')
      options.writeChecksums = true
    } else if (argument === '--verify-all') {
      if (options.verifyAll) throw new Error('--verify-all may only be provided once')
      options.verifyAll = true
    } else {
      throw new Error(`unknown argument: ${argument}`)
    }
  }

  if (options.writeChecksums === options.verifyAll) {
    throw new Error('select exactly one mode: --write-checksums or --verify-all')
  }
  return options
}

function main(argv) {
  try {
    const args = parseReleaseArtifactArgs(argv)
    if (args.writeChecksums) {
      if (!args.platform) throw new Error('--platform is required with --write-checksums')
      const report = writePlatformChecksum(args.releaseDir, args.platform, args.tag)
      console.log(`Release artifact checksum passed for ${args.platform}`)
      for (const pattern of report.contract.artifactPatterns) {
        console.log(`- ${pattern}: ${report.artifacts.filter((name) => matchesPattern(name, pattern)).length}`)
      }
      console.log(`- wrote ${report.checksumFile} with ${report.lines.length} entries`)
      return
    }
    if (args.verifyAll) {
      const report = verifyReleaseDirectory(args.releaseDir, args.tag)
      if (!report.ok) throw new Error(report.errors.join('\n'))
      console.log('Remote release artifact audit passed')
      for (const [platform, platformReport] of Object.entries(report.platforms)) {
        console.log(`- ${platform}: ${platformReport.artifacts.length} artifacts + ${platformReport.checksumFile}`)
      }
      return
    }
  } catch (error) {
    console.error('Release artifact audit failed')
    for (const line of String(error instanceof Error ? error.message : error).split('\n')) console.error(`- ${line}`)
    process.exit(1)
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (invokedPath && resolve(fileURLToPath(import.meta.url)) === invokedPath) {
  main(process.argv.slice(2))
}
