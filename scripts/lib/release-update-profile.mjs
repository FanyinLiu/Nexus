// Shared release-time update-channel profile rules.
//
// Two profiles exist:
//
//   signed          Windows/Linux publish `latest*.yml` plus the detached
//                   Ed25519 `.sig` produced from NEXUS_UPDATE_SIGNING_KEY.
//   unsigned-manual Windows/Linux publish no updater metadata at all. The
//                   clients refuse unverified manifests, so shipping an
//                   unsigned manifest would produce a dead "available" state;
//                   the profile removes it and keeps installers + checksums.
//
// macOS is intentionally unchanged: the unsigned macOS runtime never consumes
// `latest-mac.yml`, so the file is inert in both profiles.

import { readdirSync, rmSync } from 'node:fs'

/** Profile that publishes signed Windows/Linux updater manifests. */
export const RELEASE_UPDATE_PROFILE_SIGNED = 'signed'

/** Profile that omits Windows/Linux updater manifests entirely. */
export const RELEASE_UPDATE_PROFILE_UNSIGNED_MANUAL = 'unsigned-manual'

/** Default profile keeps the pre-existing signed behavior. */
export const DEFAULT_RELEASE_UPDATE_PROFILE = RELEASE_UPDATE_PROFILE_SIGNED

/** Profiles accepted by the release artifact audit and workflow. */
export const RELEASE_UPDATE_PROFILES = Object.freeze([
  RELEASE_UPDATE_PROFILE_SIGNED,
  RELEASE_UPDATE_PROFILE_UNSIGNED_MANUAL,
])

/** Environment variable that carries the Ed25519 PKCS8 private key. */
export const UPDATE_SIGNING_KEY_ENV = 'NEXUS_UPDATE_SIGNING_KEY'

/**
 * Normalize an explicitly supplied update profile.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeReleaseUpdateProfile(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`update profile must be one of: ${RELEASE_UPDATE_PROFILES.join(', ')}`)
  }
  const normalized = value.trim()
  if (!RELEASE_UPDATE_PROFILES.includes(normalized)) {
    throw new Error(`unknown update profile '${normalized}'; expected one of: ${RELEASE_UPDATE_PROFILES.join(', ')}`)
  }
  return normalized
}

/**
 * Choose the update profile from the presence of the signing secret.
 * An empty/whitespace secret is treated as absent, never as a fake key.
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function resolveReleaseUpdateProfile(env = process.env) {
  const raw = env?.[UPDATE_SIGNING_KEY_ENV]
  return typeof raw === 'string' && raw.trim()
    ? RELEASE_UPDATE_PROFILE_SIGNED
    : RELEASE_UPDATE_PROFILE_UNSIGNED_MANUAL
}

/**
 * Return the electron-updater manifest globs owned by a platform.
 * macOS returns an empty list because its unsigned runtime is manual-download.
 * @param {string} platform
 * @returns {string[]}
 */
export function getUpdateManifestGlobs(platform) {
  if (platform === 'windows') return ['latest.yml']
  if (platform === 'linux') return ['latest-linux*.yml']
  if (platform === 'macos') return []
  throw new Error(`unknown release platform: ${platform}`)
}

/**
 * @param {string} pattern
 * @returns {RegExp}
 */
function globToRegExp(pattern) {
  let source = '^'
  for (const character of pattern) {
    if (character === '*') source += '.*'
    else if (character === '?') source += '.'
    else source += character.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
  }
  return new RegExp(`${source}$`)
}

/**
 * True for a platform's updater manifest or its detached `.sig` file.
 * @param {string} fileName
 * @param {string} platform
 * @returns {boolean}
 */
export function isUpdateManifestAsset(fileName, platform) {
  return getUpdateManifestGlobs(platform).some((glob) => (
    globToRegExp(glob).test(fileName) || globToRegExp(`${glob}.sig`).test(fileName)
  ))
}

/**
 * Inspect release workflow and docs text for the expected profile wiring.
 * Kept here so both the release trust audit and focused tests share one
 * definition of "the workflow is key-aware".
 * @param {{ releaseWorkflow?: string, releasingDoc?: string }} [input]
 * @returns {{
 *   resolvesFromSecret: boolean,
 *   appliesBeforeUpload: boolean,
 *   auditsWithProfile: boolean,
 *   signsWhenConfigured: boolean,
 *   docsRecordUnsignedProfile: boolean,
 * }}
 */
export function classifyReleaseUpdateProfileWiring({
  releaseWorkflow = '',
  releasingDoc = '',
} = {}) {
  return {
    resolvesFromSecret:
      releaseWorkflow.includes('release-update-profile.mjs --resolve') &&
      releaseWorkflow.includes('secrets.NEXUS_UPDATE_SIGNING_KEY'),
    appliesBeforeUpload:
      releaseWorkflow.includes('release-update-profile.mjs') &&
      releaseWorkflow.includes('--profile "$UPDATE_PROFILE"') &&
      releaseWorkflow.includes('unsigned-manual profile must not upload updater metadata'),
    auditsWithProfile:
      releaseWorkflow.includes('--update-profile "${{ needs.ensure-release.outputs.update_profile }}"') &&
      releaseWorkflow.includes('--update-profile "$UPDATE_PROFILE"'),
    signsWhenConfigured: releaseWorkflow.includes('sign-update-manifest.mjs'),
    docsRecordUnsignedProfile:
      /unsigned-manual/i.test(releasingDoc) &&
      /Windows and Linux publish no automatic|no Windows\/Linux auto|manual download/i.test(releasingDoc),
  }
}

/**
 * Enforce a release profile inside one platform's release directory.
 *
 * `signed` requires the platform's manifest to exist so a missing secret never
 * silently degrades into an unsigned publish. `unsigned-manual` deletes the
 * manifest and signature, then re-reads the directory and fails if either is
 * still present.
 *
 * @param {{
 *   profile: unknown,
 *   platform: string,
 *   releaseDir: string,
 *   readdir?: (path: string) => string[],
 *   removeFile?: (path: string) => void,
 * }} input
 * @returns {{ profile: string, platform: string, releaseDir: string, removed: string[], kept: string[] }}
 */
export function applyReleaseUpdateProfile({
  profile,
  platform,
  releaseDir,
  readdir = readdirSync,
  removeFile = (path) => rmSync(path, { force: false }),
}) {
  const normalizedProfile = normalizeReleaseUpdateProfile(profile)
  const manifestGlobs = getUpdateManifestGlobs(platform)
  const files = readdir(releaseDir)
  const updateAssets = files
    .filter((fileName) => isUpdateManifestAsset(fileName, platform))
    .sort()

  if (normalizedProfile === RELEASE_UPDATE_PROFILE_SIGNED) {
    const manifests = files.filter((fileName) => manifestGlobs.some((glob) => globToRegExp(glob).test(fileName)))
    if (manifests.length === 0) {
      throw new Error(`${platform}: signed update profile requires ${manifestGlobs.join(' / ') || 'no manifest'} in ${releaseDir}`)
    }
    if (platform === 'windows' && manifests.length !== 1) {
      throw new Error(`windows: signed update profile requires exactly one latest.yml (found ${manifests.length})`)
    }
    return {
      profile: normalizedProfile,
      platform,
      releaseDir,
      removed: [],
      kept: files.slice().sort(),
    }
  }

  for (const fileName of updateAssets) {
    removeFile(`${releaseDir}/${fileName}`)
  }

  const remaining = readdir(releaseDir)
    .filter((fileName) => isUpdateManifestAsset(fileName, platform))
    .sort()
  if (remaining.length > 0) {
    throw new Error(`${platform}: unsigned-manual profile still contains updater metadata: ${remaining.join(', ')}`)
  }

  return {
    profile: normalizedProfile,
    platform,
    releaseDir,
    removed: updateAssets,
    kept: readdir(releaseDir).slice().sort(),
  }
}
