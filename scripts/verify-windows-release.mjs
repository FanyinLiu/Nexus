#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { closeSync, existsSync, openSync, readFileSync, readSync } from 'node:fs'
import { basename, dirname, join, resolve, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'

import { verifyPackagedResources } from './release-resource-verifier.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OFFICIAL_PRODUCT_NAME = 'Nexus'
const OFFICIAL_EXECUTABLE_NAME = 'Nexus.exe'

const POWERSHELL_INSPECTION = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
$securityModule = Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1'
Import-Module -Name $securityModule -Force -ErrorAction Stop
$targets = @(
  [pscustomobject]@{ Role = 'installer'; Path = $env:NEXUS_VERIFY_WINDOWS_INSTALLER },
  [pscustomobject]@{ Role = 'app'; Path = $env:NEXUS_VERIFY_WINDOWS_APP }
)

$records = foreach ($target in $targets) {
  if ([string]::IsNullOrWhiteSpace($target.Path)) {
    throw "Missing path for $($target.Role)"
  }

  $item = Get-Item -LiteralPath $target.Path -ErrorAction Stop
  if ($item.PSIsContainer) {
    throw "$($target.Role) path is a directory"
  }

  $signature = Microsoft.PowerShell.Security\Get-AuthenticodeSignature -LiteralPath $item.FullName -ErrorAction Stop
  $version = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($item.FullName)

  [pscustomobject]@{
    Role = $target.Role
    Path = $item.FullName
    SignatureStatus = [string]$signature.Status
    SignatureStatusMessage = [string]$signature.StatusMessage
    ProductName = [string]$version.ProductName
    ProductVersion = [string]$version.ProductVersion
    FileVersion = [string]$version.FileVersion
    FileDescription = [string]$version.FileDescription
    OriginalFilename = [string]$version.OriginalFilename
    InternalName = [string]$version.InternalName
    CompanyName = [string]$version.CompanyName
  }
}

@($records) | ConvertTo-Json -Compress -Depth 4
`

function environmentValue(environment, name) {
  const key = Object.keys(environment).find((candidate) => candidate.toLowerCase() === name.toLowerCase())
  return key ? cleanText(environment[key]) : ''
}

export function createPowerShellInspectionInvocation(paths, inheritedEnvironment = process.env) {
  const env = {}
  for (const [key, value] of Object.entries(inheritedEnvironment)) {
    // A pwsh 7 parent exports its own module roots. Passing those roots into
    // Windows PowerShell 5.1 can make Security-module autoload select an
    // incompatible module on current GitHub Windows runners.
    if (key.toLowerCase() !== 'psmodulepath') env[key] = value
  }

  const systemRoot = environmentValue(env, 'SystemRoot') || environmentValue(env, 'WINDIR')
  const command = systemRoot
    ? win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : 'powershell.exe'

  return {
    command,
    args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', POWERSHELL_INSPECTION],
    env: {
      ...env,
      NEXUS_VERIFY_WINDOWS_INSTALLER: paths.installer,
      NEXUS_VERIFY_WINDOWS_APP: paths.app,
    },
  }
}

function runPowerShellInspection(paths) {
  const invocation = createPowerShellInspectionInvocation(paths)
  const result = spawnSync(
    invocation.command,
    invocation.args,
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: invocation.env,
    },
  )

  if (result.error) {
    return { ok: false, error: `failed to start PowerShell: ${result.error.message}`, records: [] }
  }
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
    return {
      ok: false,
      error: `PowerShell inspection failed with exit code ${String(result.status)}${detail ? `: ${detail}` : ''}`,
      records: [],
    }
  }

  try {
    return { ok: true, error: '', records: parsePowerShellInspection(result.stdout) }
  } catch (error) {
    return {
      ok: false,
      error: `PowerShell returned invalid release metadata: ${error instanceof Error ? error.message : String(error)}`,
      records: [],
    }
  }
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function parsePowerShellInspection(output) {
  const parsed = JSON.parse(String(output).trim())
  const records = Array.isArray(parsed) ? parsed : [parsed]
  const roles = new Set()

  if (records.length !== 2) {
    throw new Error(`expected exactly two inspection records, got ${records.length}`)
  }

  return records.map((record) => {
    if (!isRecord(record)) throw new Error('inspection record must be an object')
    const role = cleanText(record.Role)
    if (role !== 'installer' && role !== 'app') throw new Error(`unexpected inspection role: ${role || '<missing>'}`)
    if (roles.has(role)) throw new Error(`duplicate inspection role: ${role}`)
    roles.add(role)

    const path = cleanText(record.Path)
    const signatureStatus = cleanText(record.SignatureStatus)
    if (!path) throw new Error(`${role} inspection path is missing`)
    if (!signatureStatus) throw new Error(`${role} Authenticode status is missing`)

    return {
      role,
      path,
      signatureStatus,
      signatureStatusMessage: cleanText(record.SignatureStatusMessage),
      productName: cleanText(record.ProductName),
      productVersion: cleanText(record.ProductVersion),
      fileVersion: cleanText(record.FileVersion),
      fileDescription: cleanText(record.FileDescription),
      originalFilename: cleanText(record.OriginalFilename),
      internalName: cleanText(record.InternalName),
      companyName: cleanText(record.CompanyName),
    }
  })
}

export function inspectPeArchitecture(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value ?? [])
  if (bytes.length < 64 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) {
    return { valid: false, machine: null, architecture: 'invalid' }
  }

  const peOffset = bytes.readUInt32LE(0x3c)
  if (peOffset > bytes.length - 6 || bytes.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0') {
    return { valid: false, machine: null, architecture: 'invalid' }
  }

  const machine = bytes.readUInt16LE(peOffset + 4)
  const architecture = machine === 0x8664
    ? 'x64'
    : machine === 0x014c
      ? 'x86'
      : machine === 0xaa64
        ? 'arm64'
        : `unknown-0x${machine.toString(16).padStart(4, '0')}`
  return { valid: true, machine, architecture }
}

function readPeHeader(path) {
  const descriptor = openSync(path, 'r')
  try {
    const dosHeader = Buffer.alloc(64)
    const dosBytes = readSync(descriptor, dosHeader, 0, dosHeader.length, 0)
    if (dosBytes < dosHeader.length) return dosHeader.subarray(0, dosBytes)

    const peOffset = dosHeader.readUInt32LE(0x3c)
    if (peOffset > 1024 * 1024) throw new Error('PE header offset exceeds the 1 MiB safety limit')

    const header = Buffer.alloc(peOffset + 6)
    dosHeader.copy(header)
    const remaining = header.length - dosHeader.length
    if (remaining > 0) {
      const bytesRead = readSync(descriptor, header, dosHeader.length, remaining, dosHeader.length)
      if (bytesRead !== remaining) return header.subarray(0, dosHeader.length + bytesRead)
    }
    return header
  } finally {
    closeSync(descriptor)
  }
}

export function windowsNumericVersion(expected) {
  const normalizedExpected = cleanText(expected)
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(normalizedExpected)
  if (!match) return ''

  const prerelease = match[4]
  if (prerelease && prerelease.split('.').some((identifier) => /^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith('0'))) {
    return ''
  }

  // electron-builder writes the fixed Windows version without SemVer
  // prerelease/build metadata. The exact prerelease identity remains bound by
  // the installer filename and release tag; VersionInfo can only prove this
  // deterministic numeric projection.
  return `${match[1]}.${match[2]}.${match[3]}.0`
}

export function windowsVersionMatches(actual, expected) {
  const normalizedActual = cleanText(actual)
  const normalizedExpected = cleanText(expected)
  const numericExpected = windowsNumericVersion(normalizedExpected)
  if (!normalizedActual || !numericExpected) return false

  // NSIS string metadata can retain the full SemVer while rcedit/fixed
  // VersionInfo can expose the numeric Windows projection instead.
  return normalizedActual === normalizedExpected || normalizedActual === numericExpected
}

function verifyRecord(record, role, expectedVersion, expectedPath, errors) {
  if (!record) {
    errors.push(`${role} PowerShell inspection record is missing`)
    return
  }

  const expectedName = role === 'installer'
    ? `Nexus-Setup-${expectedVersion}.exe`
    : OFFICIAL_EXECUTABLE_NAME

  if (basename(record.path).toLowerCase() !== expectedName.toLowerCase()) {
    errors.push(`${role} inspected file must be named ${expectedName}`)
  }
  if (resolve(record.path).toLowerCase() !== resolve(expectedPath).toLowerCase()) {
    errors.push(`${role} PowerShell result does not match the requested release path`)
  }
  if (/smoke/i.test(record.path)) errors.push(`${role} inspected path must not contain the smoke identity`)
  if (record.signatureStatus !== 'NotSigned') {
    errors.push(`${role} Authenticode status must be NotSigned (got ${record.signatureStatus || '<missing>'})`)
  }
  if (record.productName !== OFFICIAL_PRODUCT_NAME) {
    errors.push(`${role} ProductName must be ${OFFICIAL_PRODUCT_NAME} (got ${record.productName || '<missing>'})`)
  }
  if (!windowsVersionMatches(record.productVersion, expectedVersion)) {
    errors.push(`${role} ProductVersion must be ${expectedVersion} (got ${record.productVersion || '<missing>'})`)
  }
  if (!windowsVersionMatches(record.fileVersion, expectedVersion)) {
    errors.push(`${role} FileVersion must be ${expectedVersion} (got ${record.fileVersion || '<missing>'})`)
  }
  if (!record.fileDescription) errors.push(`${role} FileDescription must be embedded`)

  const identityFields = [
    record.productName,
    record.fileDescription,
    record.originalFilename,
    record.internalName,
  ]
  if (identityFields.some((value) => /smoke/i.test(value))) {
    errors.push(`${role} version metadata must not contain the smoke identity`)
  }
}

export function verifyWindowsRelease(paths, options = {}) {
  const {
    expectedVersion = '',
    expectUnsigned = false,
    pathExists = existsSync,
    readBinary = readPeHeader,
    inspectFiles = runPowerShellInspection,
    resourceVerifier = verifyPackagedResources,
    resourceVerifierOptions = {},
  } = options
  const errors = []
  const installerPath = cleanText(paths?.installer)
  const appPath = cleanText(paths?.app)

  if (!expectUnsigned) errors.push('current Windows release verifier requires the explicit --expect-unsigned profile')
  if (!cleanText(expectedVersion)) errors.push('expected package version is required')
  else if (!windowsNumericVersion(expectedVersion)) errors.push('expected package version must be a valid semantic version')
  if (!installerPath) errors.push('installer path is required')
  if (!appPath) errors.push('unpacked Nexus executable path is required')

  const expectedInstallerName = expectedVersion ? `Nexus-Setup-${expectedVersion}.exe` : ''
  if (installerPath && expectedInstallerName && basename(installerPath).toLowerCase() !== expectedInstallerName.toLowerCase()) {
    errors.push(`formal installer must be named ${expectedInstallerName}`)
  }
  if (appPath && basename(appPath).toLowerCase() !== OFFICIAL_EXECUTABLE_NAME.toLowerCase()) {
    errors.push(`formal unpacked executable must be named ${OFFICIAL_EXECUTABLE_NAME}`)
  }
  if ([installerPath, appPath].some((path) => /smoke/i.test(path))) {
    errors.push('smoke identity must not appear in formal Windows release paths')
  }

  const existingPaths = [installerPath, appPath].filter(Boolean)
  const existence = new Map()
  for (const path of existingPaths) {
    const exists = pathExists(path)
    existence.set(path, exists)
    if (!exists) errors.push(`release artifact not found: ${path}`)
  }

  const architectures = { installer: 'unavailable', app: 'unavailable' }
  const resourcesRoot = appPath ? join(dirname(appPath), 'resources') : ''
  let resourceReport = null
  if (appPath && existence.get(appPath) === true) {
    try {
      resourceReport = resourceVerifier(resourcesRoot, resourceVerifierOptions)
      if (!resourceReport?.ok) {
        const resourceErrors = Array.isArray(resourceReport?.errors) && resourceReport.errors.length > 0
          ? resourceReport.errors
          : ['packaged resource verifier returned an ambiguous result']
        for (const error of resourceErrors) errors.push(`resources: ${error}`)
      }
    } catch (error) {
      errors.push(`resources: verifier failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (existingPaths.length === 2 && existingPaths.every((path) => existence.get(path) === true)) {
    for (const [role, path] of [['installer', installerPath], ['app', appPath]]) {
      try {
        const pe = inspectPeArchitecture(readBinary(path))
        architectures[role] = pe.architecture
        if (!pe.valid) {
          errors.push(`${role} is not a valid PE executable`)
        } else if (role === 'app' && pe.architecture !== 'x64') {
          errors.push(`unpacked Nexus.exe must be PE x64 (got ${pe.architecture})`)
        } else if (role === 'installer' && pe.architecture !== 'x64' && pe.architecture !== 'x86') {
          errors.push(`installer PE architecture must be x64 or x86 (got ${pe.architecture})`)
        }
      } catch (error) {
        errors.push(`failed to inspect ${role} PE architecture: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    let inspection
    try {
      inspection = inspectFiles({ installer: installerPath, app: appPath })
    } catch (error) {
      inspection = {
        ok: false,
        error: `Windows inspection tool threw: ${error instanceof Error ? error.message : String(error)}`,
        records: [],
      }
    }

    if (!inspection || inspection.ok !== true || !Array.isArray(inspection.records)) {
      errors.push(inspection?.error || 'Windows Authenticode/VersionInfo inspection failed')
    } else {
      const installerRecord = inspection.records.find((record) => record.role === 'installer')
      const appRecord = inspection.records.find((record) => record.role === 'app')
      verifyRecord(installerRecord, 'installer', expectedVersion, installerPath, errors)
      verifyRecord(appRecord, 'app', expectedVersion, appPath, errors)
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    mode: 'unsigned',
    expectedVersion,
    paths: { installer: installerPath, app: appPath },
    architectures,
    resourcesRoot,
    resourceReport,
  }
}

function readOption(argv, name) {
  const inline = argv.find((arg) => arg.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] ?? '' : ''
}

function parseArgs(argv, version) {
  return {
    expectUnsigned: argv.includes('--expect-unsigned'),
    installer: readOption(argv, '--installer') || join(ROOT, 'release', `Nexus-Setup-${version}.exe`),
    app: readOption(argv, '--app') || join(ROOT, 'release', 'win-unpacked', OFFICIAL_EXECUTABLE_NAME),
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (invokedPath && resolve(fileURLToPath(import.meta.url)) === invokedPath) {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const args = parseArgs(process.argv.slice(2), pkg.version)
  const result = verifyWindowsRelease(
    { installer: args.installer, app: args.app },
    { expectUnsigned: args.expectUnsigned, expectedVersion: pkg.version },
  )

  if (!result.ok) {
    console.error('Windows unsigned release verification failed')
    for (const error of result.errors) console.error(`- ${error}`)
    process.exit(1)
  }

  console.log('Windows unsigned release verification passed')
  console.log(`- installer: ${result.paths.installer} (${result.architectures.installer})`)
  console.log(`- app: ${result.paths.app} (${result.architectures.app})`)
  console.log(`- resources: ${result.resourcesRoot} (app.asar + required voice assets verified)`)
  console.log('- Authenticode status: NotSigned for installer and unpacked Nexus.exe')
  console.log(`- formal Nexus VersionInfo: ${result.expectedVersion}`)
}
