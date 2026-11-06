#!/usr/bin/env node

// Release helper for the Windows/Linux updater channel profile.
//
//   --resolve                     print `signed` or `unsigned-manual` from the
//                                 presence of NEXUS_UPDATE_SIGNING_KEY (never
//                                 the key value itself).
//   --apply --profile P ...      enforce P inside one platform release dir.
//
// The signed profile requires the manifest to exist before the signing step.
// The unsigned-manual profile deletes `latest*.yml` / `.sig` for Windows and
// Linux so the upload and remote closure checks cannot publish a manifest the
// client will refuse to verify.

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  applyReleaseUpdateProfile,
  resolveReleaseUpdateProfile,
} from './lib/release-update-profile.mjs'

/**
 * @param {string[]} argv
 * @returns {{ mode: 'resolve' } | { mode: 'apply', profile: string, platform: string, releaseDir: string }}
 */
export function parseReleaseUpdateProfileArgs(argv) {
  if (argv.length === 1 && argv[0] === '--resolve') return { mode: 'resolve' }

  let profile = null
  let platform = null
  let releaseDir = null
  let mode = null
  const seen = new Set()

  const setValue = (name, value) => {
    if (seen.has(name)) throw new Error(`${name} may only be provided once`)
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
    seen.add(name)
    return value
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--apply') {
      if (mode) throw new Error('select exactly one mode: --resolve or --apply')
      mode = 'apply'
    } else if (argument === '--profile' || argument === '--platform' || argument === '--release-dir') {
      const value = setValue(argument, argv[index + 1])
      if (argument === '--profile') profile = value
      else if (argument === '--platform') platform = value
      else releaseDir = value
      index += 1
    } else if (argument.startsWith('--profile=')) {
      profile = setValue('--profile', argument.slice('--profile='.length))
    } else if (argument.startsWith('--platform=')) {
      platform = setValue('--platform', argument.slice('--platform='.length))
    } else if (argument.startsWith('--release-dir=')) {
      releaseDir = setValue('--release-dir', argument.slice('--release-dir='.length))
    } else if (argument === '--resolve') {
      throw new Error('--resolve may not be combined with --apply')
    } else {
      throw new Error(`unknown argument: ${argument}`)
    }
  }

  if (mode !== 'apply') throw new Error('select exactly one mode: --resolve or --apply')
  if (!profile) throw new Error('--profile is required with --apply')
  if (!platform) throw new Error('--platform is required with --apply')
  return {
    mode: 'apply',
    profile,
    platform,
    releaseDir: resolve(releaseDir ?? 'release'),
  }
}

function main(argv) {
  let args
  try {
    args = parseReleaseUpdateProfileArgs(argv)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 2
    return
  }

  if (args.mode === 'resolve') {
    console.log(resolveReleaseUpdateProfile())
    return
  }

  try {
    const result = applyReleaseUpdateProfile(args)
    console.log(`Applied ${result.profile} update profile for ${result.platform}`)
    if (result.removed.length > 0) console.log(`- removed: ${result.removed.join(', ')}`)
    if (result.kept.length > 0) console.log(`- kept: ${result.kept.join(', ')}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (invokedPath && resolve(fileURLToPath(import.meta.url)) === invokedPath) {
  main(process.argv.slice(2))
}
