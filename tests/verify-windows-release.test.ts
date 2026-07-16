import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createPowerShellInspectionInvocation,
  inspectPeArchitecture,
  parsePowerShellInspection,
  verifyWindowsRelease,
  windowsNumericVersion,
  windowsVersionMatches,
} from '../scripts/verify-windows-release.mjs'

function makePe(machine: number) {
  const bytes = Buffer.alloc(256)
  bytes.write('MZ', 0, 'ascii')
  bytes.writeUInt32LE(128, 0x3c)
  bytes.write('PE\0\0', 128, 'ascii')
  bytes.writeUInt16LE(machine, 132)
  return bytes
}

function makeRecords({
  signatureStatus = 'NotSigned',
  productName = 'Nexus',
  productVersion = '0.4.3',
  fileVersion = '0.4.3.0',
  fileDescription = 'Nexus desktop AI companion',
  installerPath = '/release/Nexus-Setup-0.4.3.exe',
  appPath = '/release/win-unpacked/Nexus.exe',
} = {}) {
  return [
    {
      role: 'installer',
      path: installerPath,
      signatureStatus,
      signatureStatusMessage: '',
      productName,
      productVersion,
      fileVersion,
      fileDescription,
      originalFilename: 'Nexus-Setup-0.4.3.exe',
      internalName: 'Nexus Setup',
      companyName: 'FanyinLiu',
    },
    {
      role: 'app',
      path: appPath,
      signatureStatus,
      signatureStatusMessage: '',
      productName,
      productVersion,
      fileVersion,
      fileDescription,
      originalFilename: 'Nexus.exe',
      internalName: 'Nexus',
      companyName: 'FanyinLiu',
    },
  ]
}

const resourcesPass = () => ({ ok: true, errors: [] })

test('Windows inspection isolates Windows PowerShell from pwsh module paths', () => {
  const inheritedEnvironment = {
    SystemRoot: String.raw`C:\Windows`,
    Path: String.raw`C:\tools`,
    PSModulePath: String.raw`C:\Program Files\PowerShell\7\Modules`,
    pSmOdUlEpAtH: String.raw`C:\another-incompatible-module-root`,
  }
  const paths = {
    installer: String.raw`C:\release\Nexus-Setup-0.4.3.exe`,
    app: String.raw`C:\release\win-unpacked\Nexus.exe`,
  }

  const invocation = createPowerShellInspectionInvocation(paths, inheritedEnvironment)

  assert.equal(
    invocation.command,
    String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`,
  )
  assert.equal(invocation.env.NEXUS_VERIFY_WINDOWS_INSTALLER, paths.installer)
  assert.equal(invocation.env.NEXUS_VERIFY_WINDOWS_APP, paths.app)
  assert.equal(
    Object.keys(invocation.env).some((key) => key.toLowerCase() === 'psmodulepath'),
    false,
  )
  assert.deepEqual(invocation.args.slice(0, 6), [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
  ])
  assert.match(invocation.args[6], /\$securityModule = Join-Path \$PSHOME/)
  assert.match(invocation.args[6], /Import-Module -Name \$securityModule -Force -ErrorAction Stop/)
  assert.match(invocation.args[6], /Microsoft\.PowerShell\.Security\\Get-AuthenticodeSignature/)
  assert.match(invocation.args[6], /FileVersionInfo\]::GetVersionInfo/)
  assert.equal(inheritedEnvironment.PSModulePath, String.raw`C:\Program Files\PowerShell\7\Modules`)
})

test('Windows release verifier parses strict PowerShell metadata and PE architectures', () => {
  const parsed = parsePowerShellInspection(JSON.stringify([
    {
      Role: 'installer',
      Path: 'C:\\release\\Nexus-Setup-0.4.3.exe',
      SignatureStatus: 'NotSigned',
      ProductName: 'Nexus',
      ProductVersion: '0.4.3',
      FileVersion: '0.4.3.0',
      FileDescription: 'Nexus desktop AI companion',
    },
    {
      Role: 'app',
      Path: 'C:\\release\\win-unpacked\\Nexus.exe',
      SignatureStatus: 'NotSigned',
      ProductName: 'Nexus',
      ProductVersion: '0.4.3',
      FileVersion: '0.4.3.0',
      FileDescription: 'Nexus desktop AI companion',
    },
  ]))

  assert.equal(parsed.length, 2)
  assert.equal(parsed[0].signatureStatus, 'NotSigned')
  assert.deepEqual(inspectPeArchitecture(makePe(0x8664)), {
    valid: true,
    machine: 0x8664,
    architecture: 'x64',
  })
  assert.equal(inspectPeArchitecture(makePe(0x014c)).architecture, 'x86')
  assert.equal(inspectPeArchitecture(Buffer.from('not-pe')).valid, false)
  assert.equal(windowsNumericVersion('0.4.3-beta.1'), '0.4.3.0')
  assert.equal(windowsVersionMatches('0.4.3.0', '0.4.3'), true)
  assert.equal(windowsVersionMatches('0.4.30', '0.4.3'), false)
})

test('Windows release verifier accepts formal unsigned installer and x64 app', () => {
  const paths = {
    installer: '/release/Nexus-Setup-0.4.3.exe',
    app: '/release/win-unpacked/Nexus.exe',
  }
  const result = verifyWindowsRelease(paths, {
    expectUnsigned: true,
    expectedVersion: '0.4.3',
    pathExists: () => true,
    readBinary: (path: string) => path.endsWith('/Nexus.exe') ? makePe(0x8664) : makePe(0x014c),
    inspectFiles: () => ({ ok: true, error: '', records: makeRecords() }),
    resourceVerifier: resourcesPass,
  })

  assert.equal(result.ok, true)
  assert.equal(result.architectures.installer, 'x86')
  assert.equal(result.architectures.app, 'x64')
})

test('Windows release verifier rejects a package missing app.asar or required voice resources', () => {
  const paths = {
    installer: '/release/Nexus-Setup-0.4.3.exe',
    app: '/release/win-unpacked/Nexus.exe',
  }
  const result = verifyWindowsRelease(paths, {
    expectUnsigned: true,
    expectedVersion: '0.4.3',
    pathExists: () => true,
    readBinary: (path: string) => path.endsWith('/Nexus.exe') ? makePe(0x8664) : makePe(0x014c),
    inspectFiles: () => ({ ok: true, error: '', records: makeRecords() }),
    resourceVerifier: () => ({
      ok: false,
      errors: ['required packaged resource is missing: sensevoice'],
    }),
  })

  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /resources: required packaged resource is missing: sensevoice/)
})

test('Windows release verifier accepts the exact numeric VersionInfo projection for a beta package', () => {
  const paths = {
    installer: '/release/Nexus-Setup-0.4.3-beta.1.exe',
    app: '/release/win-unpacked/Nexus.exe',
  }
  const result = verifyWindowsRelease(paths, {
    expectUnsigned: true,
    expectedVersion: '0.4.3-beta.1',
    pathExists: () => true,
    readBinary: (path: string) => path.endsWith('/Nexus.exe') ? makePe(0x8664) : makePe(0x014c),
    inspectFiles: () => ({
      ok: true,
      error: '',
      records: makeRecords({
        productVersion: '0.4.3.0',
        fileVersion: '0.4.3.0',
        installerPath: paths.installer,
        appPath: paths.app,
      }),
    }),
    resourceVerifier: resourcesPass,
  })

  assert.equal(result.ok, true)
})

test('Windows beta VersionInfo mapping rejects a different beta string or numeric version', () => {
  assert.equal(windowsVersionMatches('0.4.3-beta.2', '0.4.3-beta.1'), false)
  assert.equal(windowsVersionMatches('0.4.4.0', '0.4.3-beta.1'), false)
  assert.equal(windowsVersionMatches('0.4.3.1', '0.4.3-beta.1'), false)
  assert.equal(windowsVersionMatches('0.4.3.0', '0.4.3-beta.01'), false)

  const paths = {
    installer: '/release/Nexus-Setup-0.4.3-beta.1.exe',
    app: '/release/win-unpacked/Nexus.exe',
  }
  const result = verifyWindowsRelease(paths, {
    expectUnsigned: true,
    expectedVersion: '0.4.3-beta.1',
    pathExists: () => true,
    readBinary: (path: string) => path.endsWith('/Nexus.exe') ? makePe(0x8664) : makePe(0x014c),
    inspectFiles: () => ({
      ok: true,
      error: '',
      records: makeRecords({
        productVersion: '0.4.4.0',
        fileVersion: '0.4.3.1',
        installerPath: paths.installer,
        appPath: paths.app,
      }),
    }),
    resourceVerifier: resourcesPass,
  })

  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /ProductVersion must be 0\.4\.3-beta\.1/)
  assert.match(result.errors.join('\n'), /FileVersion must be 0\.4\.3-beta\.1/)
})

test('Windows unsigned verifier rejects signed or smoke identity and non-x64 app', () => {
  const paths = {
    installer: '/release/Nexus Smoke-Setup-0.4.3.exe',
    app: '/release/win-unpacked/Nexus Smoke.exe',
  }
  const result = verifyWindowsRelease(paths, {
    expectUnsigned: true,
    expectedVersion: '0.4.3',
    pathExists: () => true,
    readBinary: () => makePe(0x014c),
    inspectFiles: () => ({
      ok: true,
      error: '',
      records: makeRecords({
        signatureStatus: 'Valid',
        productName: 'Nexus Smoke',
        productVersion: '0.4.2',
        fileVersion: '0.4.2.0',
        fileDescription: 'Nexus Smoke build',
        installerPath: paths.installer,
        appPath: paths.app,
      }),
    }),
    resourceVerifier: resourcesPass,
  })

  const errors = result.errors.join('\n')
  assert.equal(result.ok, false)
  assert.match(errors, /formal installer must be named/)
  assert.match(errors, /formal unpacked executable must be named/)
  assert.match(errors, /smoke identity/i)
  assert.match(errors, /PE x64/)
  assert.match(errors, /Authenticode status must be NotSigned/)
  assert.match(errors, /ProductName must be Nexus/)
  assert.match(errors, /ProductVersion must be 0\.4\.3/)
  assert.match(errors, /FileVersion must be 0\.4\.3/)
})

test('Windows verifier fails closed on absent artifacts, malformed PE, and tool failure', () => {
  const paths = {
    installer: '/release/Nexus-Setup-0.4.3.exe',
    app: '/release/win-unpacked/Nexus.exe',
  }

  const absent = verifyWindowsRelease(paths, {
    expectUnsigned: true,
    expectedVersion: '0.4.3',
    pathExists: () => false,
  })
  assert.equal(absent.ok, false)
  assert.match(absent.errors.join('\n'), /release artifact not found/)

  const failedTool = verifyWindowsRelease(paths, {
    expectUnsigned: true,
    expectedVersion: '0.4.3',
    pathExists: () => true,
    readBinary: () => Buffer.from('malformed'),
    inspectFiles: () => ({ ok: false, error: 'PowerShell unavailable', records: [] }),
    resourceVerifier: resourcesPass,
  })
  assert.equal(failedTool.ok, false)
  assert.match(failedTool.errors.join('\n'), /not a valid PE executable/)
  assert.match(failedTool.errors.join('\n'), /PowerShell unavailable/)

  const omittedMode = verifyWindowsRelease(paths, {
    expectedVersion: '0.4.3',
    pathExists: () => true,
    readBinary: () => makePe(0x8664),
    inspectFiles: () => ({ ok: true, error: '', records: makeRecords() }),
    resourceVerifier: resourcesPass,
  })
  assert.equal(omittedMode.ok, false)
  assert.match(omittedMode.errors.join('\n'), /--expect-unsigned/)
})

test('PowerShell parser rejects missing, duplicate, or malformed inspection records', () => {
  assert.throws(() => parsePowerShellInspection(''), /JSON/)
  assert.throws(
    () => parsePowerShellInspection(JSON.stringify([{ Role: 'installer' }, { Role: 'installer' }])),
    /inspection path is missing|duplicate inspection role/,
  )
  assert.throws(
    () => parsePowerShellInspection(JSON.stringify([{ Role: 'installer' }])),
    /exactly two inspection records/,
  )
})
