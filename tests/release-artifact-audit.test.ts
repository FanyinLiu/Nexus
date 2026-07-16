import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  parseReleaseArtifactArgs,
  verifyReleaseDirectory,
  writePlatformChecksum,
} from '../scripts/release-artifact-audit.mjs'

function createReleaseFixture() {
  const root = mkdtempSync(join(tmpdir(), 'nexus-release-artifacts-'))
  const files = [
    'Nexus Setup 0.4.3.exe',
    'Nexus Setup 0.4.3.exe.blockmap',
    'Nexus-0.4.3-arm64.dmg',
    'Nexus-0.4.3-arm64.dmg.blockmap',
    'Nexus-0.4.3-arm64-mac.zip',
    'Nexus-0.4.3-arm64-mac.zip.blockmap',
    'Nexus-0.4.3-x86_64.AppImage',
    'nexus_0.4.3_amd64.deb',
    'nexus-0.4.3-x64.tar.gz',
  ]
  mkdirSync(root, { recursive: true })
  for (const fileName of files) {
    writeFileSync(join(root, fileName), `fixture:${fileName}`)
  }
  writeUpdateMetadata(root, 'latest.yml', ['Nexus Setup 0.4.3.exe'])
  writeUpdateMetadata(root, 'latest-mac.yml', [
    'Nexus-0.4.3-arm64-mac.zip',
    'Nexus-0.4.3-arm64.dmg',
  ])
  writeUpdateMetadata(root, 'latest-linux.yml', [
    'Nexus-0.4.3-x86_64.AppImage',
    'nexus_0.4.3_amd64.deb',
  ])
  return root
}

function fixtureSha512(filePath: string) {
  return createHash('sha512').update(readFileSync(filePath)).digest('base64')
}

function writeUpdateMetadata(root: string, fileName: string, artifactNames: string[]) {
  const entries = artifactNames.map((artifactName) => {
    const artifactPath = join(root, artifactName)
    return [
      `  - url: ${JSON.stringify(artifactName)}`,
      `    sha512: ${fixtureSha512(artifactPath)}`,
      `    size: ${readFileSync(artifactPath).byteLength}`,
    ].join('\n')
  })
  const primaryName = artifactNames[0]
  writeFileSync(join(root, fileName), [
    'version: 0.4.3',
    'files:',
    ...entries,
    `path: ${JSON.stringify(primaryName)}`,
    `sha512: ${fixtureSha512(join(root, primaryName))}`,
    '',
  ].join('\n'))
}

function withFixture(callback: (root: string) => void) {
  const root = createReleaseFixture()
  try {
    callback(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function writeAllChecksums(root: string) {
  for (const platform of ['windows', 'macos', 'linux']) writePlatformChecksum(root, platform, 'v0.4.3')
}

test('release artifact audit requires every declared platform pattern and verifies all checksums', () => {
  withFixture((root) => {
    writeAllChecksums(root)
    const report = verifyReleaseDirectory(root, 'v0.4.3')

    assert.equal(report.ok, true)
    assert.equal(report.errors.length, 0)
    assert.equal(report.platforms.macos.artifacts.length, 5)
  })
})

test('checksum generation fails when one required artifact family is absent', () => {
  withFixture((root) => {
    rmSync(join(root, 'Nexus-0.4.3-arm64-mac.zip.blockmap'))
    assert.throws(
      () => writePlatformChecksum(root, 'macos', 'v0.4.3'),
      /required artifact pattern must match exactly once: \*\.zip\.blockmap \(matched 0\)/,
    )
  })
})

test('remote release audit rejects stale, smoke, and unrecognized assets', () => {
  withFixture((root) => {
    writeAllChecksums(root)
    writeFileSync(join(root, 'Nexus Smoke 0.4.2.dmg'), 'stale smoke')
    writeFileSync(join(root, 'legacy-checksum.asc'), 'stale signature')
    const report = verifyReleaseDirectory(root, 'v0.4.3')

    assert.equal(report.ok, false)
    assert.ok(report.errors.some((error) => error.includes('unrecognized release assets')))
    assert.ok(report.errors.some((error) => error.includes('smoke identity leaked')))
  })
})

test('remote release audit fails closed when an uploaded artifact differs from its checksum', () => {
  withFixture((root) => {
    writeAllChecksums(root)
    const installer = join(root, 'Nexus Setup 0.4.3.exe')
    writeFileSync(installer, `${readFileSync(installer, 'utf8')}:tampered`)
    const report = verifyReleaseDirectory(root, 'v0.4.3')

    assert.equal(report.ok, false)
    assert.ok(report.errors.some((error) => error.includes('checksum mismatch for Nexus Setup 0.4.3.exe')))
  })
})

test('artifact and metadata versions are bound to the requested tag', () => {
  withFixture((root) => {
    assert.throws(
      () => writePlatformChecksum(root, 'windows', 'v0.4.4'),
      /not bound to release version 0\.4\.4/,
    )

    writeFileSync(join(root, 'latest.yml'), 'version: 0.4.2\npath: Nexus Setup 0.4.3.exe\n')
    assert.throws(
      () => writePlatformChecksum(root, 'windows', 'v0.4.3'),
      /latest\.yml: metadata version must equal 0\.4\.3/,
    )
  })
})

test('updater metadata is cryptographically and structurally bound to real artifacts', () => {
  withFixture((root) => {
    const metadataPath = join(root, 'latest.yml')
    const validMetadata = readFileSync(metadataPath, 'utf8')

    writeFileSync(metadataPath, validMetadata.replace(
      'path: "Nexus Setup 0.4.3.exe"',
      'path: "Nexus-0.4.3"',
    ))
    assert.throws(
      () => writePlatformChecksum(root, 'windows', 'v0.4.3'),
      /path references an unexpected updater artifact: Nexus-0\.4\.3/,
    )

    writeFileSync(metadataPath, validMetadata.replace(/size: \d+/, 'size: 1'))
    assert.throws(
      () => writePlatformChecksum(root, 'windows', 'v0.4.3'),
      /size mismatch for Nexus Setup 0\.4\.3\.exe/,
    )

    writeFileSync(metadataPath, validMetadata.replace(/sha512: [^\n]+/, 'sha512: invalid'))
    assert.throws(
      () => writePlatformChecksum(root, 'windows', 'v0.4.3'),
      /files\[0\] sha512 mismatch for Nexus Setup 0\.4\.3\.exe/,
    )

    writeFileSync(metadataPath, validMetadata.replace(/\nsha512: [^\n]+/, '\nsha512: invalid'))
    assert.throws(
      () => writePlatformChecksum(root, 'windows', 'v0.4.3'),
      /top-level sha512 mismatch for Nexus Setup 0\.4\.3\.exe/,
    )
  })
})

test('updater metadata files list must cover each updater-capable artifact exactly once', () => {
  withFixture((root) => {
    writeUpdateMetadata(root, 'latest-mac.yml', ['Nexus-0.4.3-arm64-mac.zip'])
    assert.throws(
      () => writePlatformChecksum(root, 'macos', 'v0.4.3'),
      /metadata files is missing updater artifact: Nexus-0\.4\.3-arm64\.dmg/,
    )
  })
})

test('remote audit rejects an old asset even when it is checksum-listed and otherwise whitelisted', () => {
  withFixture((root) => {
    writeFileSync(join(root, 'Nexus Setup 0.4.2.exe'), 'old installer')
    assert.throws(
      () => writePlatformChecksum(root, 'windows', 'v0.4.3'),
      /required artifact pattern must match exactly once: \*\.exe \(matched 2\)/,
    )
  })
})

test('release artifact audit requires a valid explicit tag', () => {
  withFixture((root) => {
    assert.throws(() => writePlatformChecksum(root, 'windows', undefined), /invalid or missing release tag/)
    assert.throws(() => verifyReleaseDirectory(root, '0.4.3'), /invalid or missing release tag/)
  })
})

test('release artifact CLI parser fails closed on missing, duplicate, or unknown arguments', () => {
  assert.equal(
    parseReleaseArtifactArgs(['--platform', 'macos', '--release-dir=out', '--tag=v0.4.3', '--write-checksums']).tag,
    'v0.4.3',
  )
  for (const argv of [
    [],
    ['--verify-all', '--write-checksums'],
    ['--tag'],
    ['--tag=v0.4.3', '--tag=v0.4.3', '--verify-all'],
    ['--unknown', '--verify-all'],
  ]) {
    assert.throws(
      () => parseReleaseArtifactArgs(argv),
      /exactly one mode|requires a value|only be provided once|unknown argument/,
    )
  }
})
