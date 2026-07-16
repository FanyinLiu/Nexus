export const SETTINGS_MUTATION_LOCK_NAME = 'nexus:settings:mutation'

export type SettingsMutationLock = <T>(work: () => Promise<T> | T) => Promise<T>

type NavigatorWithLocks = Navigator & {
  locks?: {
    request<T>(name: string, callback: () => Promise<T> | T): Promise<T>
  }
}

let fallbackQueue: Promise<void> = Promise.resolve()

function withFallbackSettingsMutationLock<T>(work: () => Promise<T> | T): Promise<T> {
  const previous = fallbackQueue
  let release!: () => void
  fallbackQueue = new Promise<void>((resolve) => {
    release = resolve
  })

  return previous.then(work, work).finally(release)
}

export const withSettingsMutationLock: SettingsMutationLock = <T>(
  work: () => Promise<T> | T,
) => {
  const lockManager = typeof navigator !== 'undefined'
    ? (navigator as NavigatorWithLocks).locks
    : undefined

  if (lockManager?.request) {
    return lockManager.request<T>(SETTINGS_MUTATION_LOCK_NAME, () => work())
  }

  return withFallbackSettingsMutationLock(work)
}
