import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  inspectLinuxAppImage,
  inspectLinuxDeb,
  inspectLinuxTarball,
  isSafeTarEntry,
  isX64ElfFileOutput,
  parseDebFields,
  parseLinuxReleaseCli,
  selectLinuxReleaseArtifacts,
  verifyExtractedLinuxResources,
  verifyLinuxRelease,
} from '../scripts/verify-linux-release.mjs'

const RELEASE_FILES = [
  'Nexus-Setup-0.4.3.AppImage',
  'Nexus-Setup-0.4.3.deb',
  'Nexus-Setup-0.4.3.tar.gz',
  'latest-linux.yml',
  'Nexus-Setup-0.4.3.AppImage.blockmap',
  'SHA256SUMS-linux.txt',
]

function commandResult(stdout = '') {
  return { ok: true, executed: true, status: 0, stdout, stderr: '', error: '' }
}

function failedCommand(error = 'ENOENT') {
  return { ok: false, executed: false, status: null, stdout: '', stderr: '', error }
}

function resourceTree(root: string) {
  return [
    { path: `${root}/Nexus/resources`, relativePath: 'Nexus/resources', kind: 'directory', mode: 0o040755 },
    { path: `${root}/Nexus/resources/app.asar`, relativePath: 'Nexus/resources/app.asar', kind: 'file', mode: 0o100644 },
  ]
}

const resourcesPass = () => ({ ok: true, errors: [] })

test('Linux artifact selector requires one formal artifact of every supported kind', () => {
  const selected = selectLinuxReleaseArtifacts('/release', () => RELEASE_FILES)
  assert.equal(selected.ok, true)
  assert.match(selected.appImagePath, /\.AppImage$/)
  assert.match(selected.debPath, /\.deb$/)
  assert.match(selected.tarballPath, /\.tar\.gz$/)

  const rejected = selectLinuxReleaseArtifacts('/release', () => [
    ...RELEASE_FILES,
    'Nexus Smoke-0.4.3.AppImage',
  ])
  assert.equal(rejected.ok, false)
  assert.match(rejected.errors.join('\n'), /exactly one AppImage/)
  assert.match(rejected.errors.join('\n'), /Smoke identity/)
})

test('Linux parsers accept only unambiguous x86-64 and deb metadata', () => {
  assert.equal(isX64ElfFileOutput('ELF 64-bit LSB pie executable, x86-64, version 1'), true)
  assert.equal(isX64ElfFileOutput('PE32+ executable (GUI) x86-64'), false)
  assert.equal(isX64ElfFileOutput('ELF 32-bit LSB executable, Intel 80386'), false)
  assert.deepEqual(parseDebFields('Package: nexus\nVersion: 0.4.3\nArchitecture: amd64\n'), {
    package: 'nexus',
    version: '0.4.3',
    architecture: 'amd64',
  })
  assert.throws(() => parseDebFields('nexus\n0.4.3\namd64\n'), /ambiguous/)
  assert.throws(() => parseDebFields('Package: nexus\nPackage: other\n'), /duplicate/)
})

test('tar entry validation rejects traversal, absolute, Windows, and ambiguous paths', () => {
  for (const entry of ['nexus-0.4.3/nexus', './nexus-0.4.3/resources/app.asar']) {
    assert.equal(isSafeTarEntry(entry), true, entry)
  }
  for (const entry of ['../outside', 'folder/../../outside', '/absolute', 'C:\\outside', 'folder\\outside', '']) {
    assert.equal(isSafeTarEntry(entry), false, entry)
  }
})

test('tar.gz verifier checks safe members, executable mode, x64 ELF, and cleans up', () => {
  const commands: string[] = []
  let cleaned = false
  let verifiedResourcesRoot = ''
  const result = inspectLinuxTarball('/release/Nexus-Setup-0.4.3.tar.gz', {
    makeTempRoot: () => '/virtual/extract',
    removeTempRoot: () => { cleaned = true },
    scanTree: () => [
      { path: '/virtual/extract/Nexus/nexus', relativePath: 'Nexus/nexus', kind: 'file', mode: 0o100755 },
      ...resourceTree('/virtual/extract'),
    ],
    resourceVerifier: (resourcesRoot: string) => {
      verifiedResourcesRoot = resourcesRoot
      return { ok: true, errors: [] }
    },
    runCommand: (command: string, args: string[]) => {
      commands.push(`${command} ${args.join(' ')}`)
      if (command === 'tar' && args.includes('-tzf')) return commandResult('Nexus/\nNexus/nexus\nNexus/resources/\n')
      if (command === 'tar') return commandResult()
      if (command === 'file') return commandResult('ELF 64-bit LSB pie executable, x86-64, version 1')
      return failedCommand()
    },
  })

  assert.equal(result.ok, true)
  assert.equal(cleaned, true)
  assert.equal(verifiedResourcesRoot, '/virtual/extract/Nexus/resources')
  assert.ok(commands.some((command) => command.startsWith('tar -tzf')))
  assert.ok(commands.some((command) => command.startsWith('tar -xzf')))
  assert.ok(commands.some((command) => command.startsWith('file --brief')))
})

test('AppImage and deb inspectors extract in isolation and verify their unique packaged resource roots', () => {
  const commands: Array<{ command: string, args: string[], cwd?: string }> = []
  const verifiedRoots: string[] = []
  const cleaned: string[] = []
  const runCommand = (command: string, args: string[], options: { cwd?: string } = {}) => {
    commands.push({ command, args, cwd: options.cwd })
    return commandResult()
  }
  const resourceVerifier = (resourcesRoot: string) => {
    verifiedRoots.push(resourcesRoot)
    return { ok: true, errors: [] }
  }

  const appImage = inspectLinuxAppImage('/release/Nexus-Setup-0.4.3.AppImage', {
    runCommand,
    makeTempRoot: () => '/virtual/appimage',
    removeTempRoot: (path: string) => { cleaned.push(path) },
    scanTree: (root: string) => resourceTree(root),
    resourceVerifier,
  })
  const deb = inspectLinuxDeb('/release/Nexus-Setup-0.4.3.deb', {
    runCommand,
    makeTempRoot: () => '/virtual/deb',
    removeTempRoot: (path: string) => { cleaned.push(path) },
    scanTree: (root: string) => resourceTree(root),
    resourceVerifier,
  })

  assert.equal(appImage.ok, true)
  assert.equal(deb.ok, true)
  assert.deepEqual(commands, [
    {
      command: '/release/Nexus-Setup-0.4.3.AppImage',
      args: ['--appimage-extract'],
      cwd: '/virtual/appimage',
    },
    {
      command: 'dpkg-deb',
      args: ['--extract', '/release/Nexus-Setup-0.4.3.deb', '/virtual/deb'],
      cwd: undefined,
    },
  ])
  assert.deepEqual(verifiedRoots.map((path) => path.replaceAll('\\', '/')), [
    '/virtual/appimage/squashfs-root/Nexus/resources',
    '/virtual/deb/Nexus/resources',
  ])
  assert.deepEqual(cleaned, ['/virtual/appimage', '/virtual/deb'])
})

test('extracted resource verifier fails closed on missing, duplicate, scanner, and verifier ambiguity', () => {
  const missing = verifyExtractedLinuxResources('/extract', {
    scanTree: () => [],
    resourceVerifier: resourcesPass,
  })
  assert.equal(missing.ok, false)
  assert.match(missing.errors.join('\n'), /exactly one packaged resources\/app\.asar, found 0/)

  const duplicate = verifyExtractedLinuxResources('/extract', {
    scanTree: () => [
      ...resourceTree('/extract/one'),
      ...resourceTree('/extract/two'),
    ],
    resourceVerifier: resourcesPass,
  })
  assert.equal(duplicate.ok, false)
  assert.match(duplicate.errors.join('\n'), /exactly one packaged resources\/app\.asar, found 2/)

  const scannerFailure = verifyExtractedLinuxResources('/extract', {
    scanTree: () => { throw new Error('scan denied') },
    resourceVerifier: resourcesPass,
  })
  assert.equal(scannerFailure.ok, false)
  assert.match(scannerFailure.errors.join('\n'), /failed to inspect.*scan denied/)

  const ambiguousVerifier = verifyExtractedLinuxResources('/extract', {
    scanTree: () => resourceTree('/extract'),
    resourceVerifier: () => undefined,
  })
  assert.equal(ambiguousVerifier.ok, false)
  assert.match(ambiguousVerifier.errors.join('\n'), /verifier returned an ambiguous result/)

  const linkedResource = verifyExtractedLinuxResources('/extract', {
    scanTree: () => [
      ...resourceTree('/extract'),
      {
        path: '/extract/Nexus/resources/model.onnx',
        relativePath: 'Nexus/resources/model.onnx',
        kind: 'symlink',
        mode: 0o120777,
      },
    ],
    resourceVerifier: resourcesPass,
  })
  assert.equal(linkedResource.ok, false)
  assert.match(linkedResource.errors.join('\n'), /packaged resources contain unsupported symlink entry/)
})

test('Linux container inspectors fail closed on extraction and cleanup failures', () => {
  const appImage = inspectLinuxAppImage('/release/Nexus-Setup-0.4.3.AppImage', {
    runCommand: () => failedCommand('spawn AppImage ENOENT'),
    makeTempRoot: () => '/virtual/appimage',
    removeTempRoot: () => { throw new Error('cleanup denied') },
    scanTree: () => { throw new Error('must not scan') },
    resourceVerifier: resourcesPass,
  })
  assert.equal(appImage.ok, false)
  assert.match(appImage.errors.join('\n'), /AppImage extraction could not start/)
  assert.match(appImage.errors.join('\n'), /failed to remove temporary AppImage directory/)

  const deb = inspectLinuxDeb('/release/Nexus-Setup-0.4.3.deb', {
    runCommand: () => failedCommand('spawn dpkg-deb ENOENT'),
    makeTempRoot: () => '/virtual/deb',
    removeTempRoot: () => {},
    scanTree: () => { throw new Error('must not scan') },
    resourceVerifier: resourcesPass,
  })
  assert.equal(deb.ok, false)
  assert.match(deb.errors.join('\n'), /deb extraction could not start/)
})

test('tar.gz verifier fails before extraction on traversal or Smoke entries', () => {
  let extracted = false
  const result = inspectLinuxTarball('/release/Nexus-Setup-0.4.3.tar.gz', {
    runCommand: (command: string, args: string[]) => {
      if (command === 'tar' && args.includes('-tzf')) {
        return commandResult('../outside\nNexus Smoke/nexus\n')
      }
      extracted = true
      return commandResult()
    },
  })

  assert.equal(result.ok, false)
  assert.equal(extracted, false)
  assert.match(result.errors.join('\n'), /unsafe tar\.gz entry path/)
  assert.match(result.errors.join('\n'), /Smoke identity/)
})

test('tar.gz verifier fails closed on tool failure, symlinks, and ambiguous executable identity', () => {
  const missingTool = inspectLinuxTarball('/release/Nexus-Setup-0.4.3.tar.gz', {
    runCommand: () => failedCommand('spawn tar ENOENT'),
  })
  assert.equal(missingTool.ok, false)
  assert.match(missingTool.errors.join('\n'), /could not start/)

  const unsafeTree = inspectLinuxTarball('/release/Nexus-Setup-0.4.3.tar.gz', {
    makeTempRoot: () => '/virtual/extract',
    removeTempRoot: () => {},
    scanTree: () => [
      { path: '/virtual/extract/Nexus/nexus', relativePath: 'Nexus/nexus', kind: 'file', mode: 0o100644 },
      { path: '/virtual/extract/Nexus/link', relativePath: 'Nexus/link', kind: 'symlink', mode: 0o120777 },
      { path: '/virtual/extract/Other/nexus', relativePath: 'Other/nexus', kind: 'file', mode: 0o100755 },
    ],
    runCommand: (command: string, args: string[]) => (
      command === 'tar' && args.includes('-tzf')
        ? commandResult('Nexus/nexus\nNexus/link\nOther/nexus\n')
        : commandResult('ELF 64-bit LSB pie executable, x86-64')
    ),
  })
  assert.equal(unsafeTree.ok, false)
  assert.match(unsafeTree.errors.join('\n'), /unsupported symlink/)
  assert.match(unsafeTree.errors.join('\n'), /exactly one nexus executable/)
})

test('Linux release verifier accepts one complete formal x64 artifact set', () => {
  const commands: string[] = []
  const report = verifyLinuxRelease('/release', {
    expectedVersion: '0.4.3',
    executableName: 'nexus',
    listFiles: () => RELEASE_FILES,
    pathExists: () => true,
    getMode: () => 0o100755,
    runCommand: (command: string, args: string[]) => {
      commands.push(`${command} ${args.join(' ')}`)
      if (command === 'file') return commandResult('ELF 64-bit LSB pie executable, x86-64')
      if (command === 'dpkg-deb') return commandResult('Package: nexus\nVersion: 0.4.3\nArchitecture: amd64\n')
      return failedCommand()
    },
    inspectAppImage: () => ({ ok: true, errors: [], resourcesRoot: '/extract/AppImage/resources' }),
    inspectDeb: () => ({ ok: true, errors: [], resourcesRoot: '/extract/deb/resources' }),
    inspectTarball: () => ({ ok: true, errors: [], executablePath: '/extract/Nexus/nexus' }),
  })

  assert.equal(report.ok, true)
  assert.ok(commands.some((command) => command.startsWith('file --brief')))
  assert.ok(commands.some((command) => command.startsWith('dpkg-deb --field')))
})

test('Linux release verifier rejects permissions, architecture, deb identity, tar failure, and tool absence', () => {
  const report = verifyLinuxRelease('/release', {
    expectedVersion: '0.4.3',
    executableName: 'Nexus Smoke',
    listFiles: () => RELEASE_FILES,
    pathExists: () => true,
    getMode: () => 0o100644,
    runCommand: (command: string) => {
      if (command === 'file') return commandResult('ELF 64-bit LSB executable, ARM aarch64')
      if (command === 'dpkg-deb') return commandResult('Package: nexus-smoke\nVersion: 0.4.2\nArchitecture: arm64\n')
      return failedCommand()
    },
    inspectAppImage: () => ({ ok: true, errors: [] }),
    inspectDeb: () => ({ ok: true, errors: [] }),
    inspectTarball: () => ({ ok: false, errors: ['tar tool unavailable'], executablePath: '' }),
  })

  const errors = report.errors.join('\n')
  assert.equal(report.ok, false)
  assert.match(errors, /executableName must stay nexus/)
  assert.match(errors, /AppImage must have at least one executable/)
  assert.match(errors, /ELF 64-bit x86-64/)
  assert.match(errors, /deb package must be nexus/)
  assert.match(errors, /deb version must be 0\.4\.3/)
  assert.match(errors, /deb architecture must be amd64/)
  assert.match(errors, /tar tool unavailable/)

  const missingFile = verifyLinuxRelease('/release', {
    expectedVersion: '0.4.3',
    executableName: 'nexus',
    listFiles: () => RELEASE_FILES,
    pathExists: () => true,
    getMode: () => 0o100755,
    runCommand: () => failedCommand('spawn file ENOENT'),
    inspectAppImage: () => ({ ok: true, errors: [] }),
    inspectDeb: () => ({ ok: true, errors: [] }),
    inspectTarball: () => ({ ok: true, errors: [] }),
  })
  assert.equal(missingFile.ok, false)
  assert.match(missingFile.errors.join('\n'), /could not start/)
})

test('Linux verifier CLI defaults to release and rejects unknown or missing arguments', () => {
  assert.deepEqual(parseLinuxReleaseCli([]), { releaseDir: 'release' })
  assert.deepEqual(parseLinuxReleaseCli(['--release-dir', 'output/release']), { releaseDir: 'output/release' })
  assert.deepEqual(parseLinuxReleaseCli(['--release-dir=output/release']), { releaseDir: 'output/release' })
  assert.throws(() => parseLinuxReleaseCli(['--release-dir']), /requires a path/)
  assert.throws(() => parseLinuxReleaseCli(['--typo']), /unknown argument/)
})

test('release workflow runs the Linux verifier and distribution audit locks the exact command', () => {
  const workflow = readFileSync('.github/workflows/release.yml', 'utf8')
  const distributionAudit = readFileSync('scripts/distribution-audit.mjs', 'utf8')
  const command = 'node scripts/verify-linux-release.mjs --release-dir release'

  assert.match(workflow, /if: matrix\.platform == 'linux'\s+run: node scripts\/verify-linux-release\.mjs --release-dir release/)
  assert.ok(distributionAudit.includes(`'${command}'`))
})
