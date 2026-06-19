export const GITHUB_RELEASES_URL = 'https://github.com/FanyinLiu/Nexus/releases/latest'
export const GITHUB_RELEASES_API_URL = 'https://api.github.com/repos/FanyinLiu/Nexus/releases/latest'

export function resolveUpdaterMode({
  platform = process.platform,
  isPackaged = false,
  macAutoUpdateMode = process.env.NEXUS_MAC_AUTO_UPDATE_MODE,
} = {}) {
  if (!isPackaged) return 'dev'
  if (platform === 'darwin' && macAutoUpdateMode !== 'electron-updater') {
    return 'manual-download'
  }
  return 'auto-download'
}

function parseVersion(value) {
  if (typeof value !== 'string') return null
  const normalized = value.trim().replace(/^v/i, '').split('+')[0]
  if (!normalized) return null
  const [coreRaw, prereleaseRaw = ''] = normalized.split('-', 2)
  const core = coreRaw.split('.').map((part) => {
    if (!/^\d+$/.test(part)) return null
    return Number(part)
  })
  if (core.length < 1 || core.length > 3 || core.some((part) => part === null)) return null
  while (core.length < 3) core.push(0)
  const prerelease = prereleaseRaw
    ? prereleaseRaw.split('.').map((part) => part.trim()).filter(Boolean)
    : []
  return { core, prerelease }
}

function comparePrerelease(left, right) {
  if (left.length === 0 && right.length === 0) return 0
  if (left.length === 0) return 1
  if (right.length === 0) return -1

  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index]
    const rightPart = right[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    if (leftPart === rightPart) continue

    const leftNumeric = /^\d+$/.test(leftPart)
    const rightNumeric = /^\d+$/.test(rightPart)
    if (leftNumeric && rightNumeric) {
      return Number(leftPart) > Number(rightPart) ? 1 : -1
    }
    if (leftNumeric) return -1
    if (rightNumeric) return 1
    return leftPart > rightPart ? 1 : -1
  }

  return 0
}

export function compareReleaseVersions(leftVersion, rightVersion) {
  const left = parseVersion(leftVersion)
  const right = parseVersion(rightVersion)
  if (!left || !right) return 0

  for (let index = 0; index < 3; index += 1) {
    if (left.core[index] === right.core[index]) continue
    return left.core[index] > right.core[index] ? 1 : -1
  }

  return comparePrerelease(left.prerelease, right.prerelease)
}

export function normalizeGithubReleasePayload(payload, fallbackUrl = GITHUB_RELEASES_URL) {
  if (!payload || typeof payload !== 'object') return null
  const tagName = typeof payload.tag_name === 'string' ? payload.tag_name.trim() : ''
  if (!tagName) return null
  if (payload.draft === true) return null
  const version = tagName.replace(/^v/i, '')
  const releaseUrl = typeof payload.html_url === 'string' && /^https:\/\/github\.com\/FanyinLiu\/Nexus\/releases\//.test(payload.html_url)
    ? payload.html_url
    : fallbackUrl
  return {
    version,
    releaseUrl,
    prerelease: payload.prerelease === true,
  }
}
