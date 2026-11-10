// @ts-check
/**
 * Permission lifecycle policy and the single main-process permission state.
 *
 * Startup only inspects features the user already enabled, and does so
 * read-only: no OS prompt and no Settings guidance. The state is a module-level
 * singleton shared by every IPC module and both windows, so the first
 * voice-runtime sync (baseline) and repeated "still on" syncs cannot re-prompt.
 *
 * User-action transitions (off → on) are the only place an OS permission
 * request or a one-shot Settings guide may run. Denied startup remains silent;
 * turning the feature off and on again is a new user action.
 *
 * Every renderer sync carries the persisted settingsRevision. A stale revision
 * is dropped; a same-revision different value is a later write for the same
 * save and wins; a newer revision computes edges normally.
 */

import { getRedactedErrorMessage } from './errorRedaction.js'
import {
  ensureMacMicrophonePermission,
  ensureMacScreenPermission,
  runMacPermissionChecks,
} from './macPermissions.js'
import {
  ensureWindowsMicrophonePermission,
  runWindowsPermissionChecks,
} from './windowsPermissions.js'

/** @typedef {'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown' | string} MediaPermissionState */

/**
 * @typedef {{
 *   platform: NodeJS.Platform,
 *   microphone: MediaPermissionState,
 *   screenRecording: MediaPermissionState,
 * }} MediaPermissionStatusSnapshot
 */

/**
 * @typedef {(
 *   options?: { interactive?: boolean, deps?: unknown, logStatus?: boolean }
 * ) => Promise<string>} PermissionCheck
 */

/**
 * @typedef {(
 *   options: {
 *     delayMs?: number,
 *     microphone?: boolean,
 *     screen?: boolean,
 *     interactive?: boolean,
 *     logStatus?: boolean,
 *     deps?: unknown,
 *   }
 * ) => Promise<Record<string, string>>} MacReadOnlyCheck
 */

/**
 * @typedef {(
 *   options: {
 *     delayMs?: number,
 *     microphone?: boolean,
 *     interactive?: boolean,
 *     logStatus?: boolean,
 *     deps?: unknown,
 *   }
 * ) => Promise<Record<string, string>>} WindowsReadOnlyCheck
 */

const macReadOnlyCheck = /** @type {MacReadOnlyCheck} */ (runMacPermissionChecks)
const windowsReadOnlyCheck = /** @type {WindowsReadOnlyCheck} */ (runWindowsPermissionChecks)

/** @param {unknown} value @returns {MediaPermissionState} */
function normalizeStatus(value) {
  return typeof value === 'string' && value ? value : 'unknown'
}

/** @param {unknown} value */
function normalizeRevision(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}

/**
 * Per-feature revision tracker. The first observation is always a baseline.
 * Later observations follow the latest-commit-wins rules from the settings
 * revision spec.
 */
function createRevisionTracker() {
  let seen = false
  let revision = 0
  let value = false

  return {
    /**
     * @param {unknown} rawRevision
     * @param {unknown} rawValue
     * @returns {{
     *   kind: 'baseline' | 'stale' | 'same' | 'edge' | 'updated',
     *   value: boolean,
     * }}
     */
    observe(rawRevision, rawValue) {
      const nextRevision = normalizeRevision(rawRevision)
      const nextValue = rawValue === true

      if (!seen) {
        seen = true
        revision = nextRevision
        value = nextValue
        return { kind: 'baseline', value: nextValue }
      }

      if (nextRevision < revision) {
        return { kind: 'stale', value }
      }

      if (nextRevision === revision && nextValue === value) {
        return { kind: 'same', value }
      }

      const previous = value
      revision = nextRevision
      value = nextValue
      return {
        kind: previous === false && nextValue === true ? 'edge' : 'updated',
        value: nextValue,
      }
    },
  }
}

/**
 * @param {{
 *   platform?: NodeJS.Platform,
 *   macDeps?: unknown,
 *   windowsDeps?: unknown,
 *   macMicrophoneCheck?: PermissionCheck,
 *   macScreenCheck?: PermissionCheck,
 *   windowsMicrophoneCheck?: PermissionCheck,
 *   macReadOnly?: MacReadOnlyCheck,
 *   windowsReadOnly?: WindowsReadOnlyCheck,
 *   onError?: (kind: string, error: unknown) => void,
 * }} [options]
 */
export function createMediaPermissionLifecycle({
  platform = process.platform,
  macDeps,
  windowsDeps,
  macMicrophoneCheck = ensureMacMicrophonePermission,
  macScreenCheck = ensureMacScreenPermission,
  windowsMicrophoneCheck = ensureWindowsMicrophonePermission,
  macReadOnly = macReadOnlyCheck,
  windowsReadOnly = windowsReadOnlyCheck,
  onError,
} = {}) {
  const microphoneTracker = createRevisionTracker()
  const screenTracker = createRevisionTracker()
  /** @type {MediaPermissionState} */
  let microphoneStatus = 'unknown'
  /** @type {MediaPermissionState} */
  let screenRecordingStatus = 'unknown'

  /** @type {(kind: string, error: unknown) => void} */
  const reportError = onError ?? ((kind, error) => {
    console.warn(`[permission] ${kind} check failed:`, getRedactedErrorMessage(error))
  })

  /** @param {MediaPermissionState} next @param {MediaPermissionState} current */
  function statusChanged(next, current) {
    return next !== current
  }

  /** @param {Record<string, unknown>} summary */
  function applyStatusSummary(summary) {
    if (typeof summary?.microphone === 'string') {
      const next = normalizeStatus(summary.microphone)
      if (statusChanged(next, microphoneStatus)) {
        microphoneStatus = next
        console.info('[permission] microphone:', next)
      }
    }
    if (typeof summary?.screen === 'string') {
      const next = normalizeStatus(summary.screen)
      if (statusChanged(next, screenRecordingStatus)) {
        screenRecordingStatus = next
        console.info('[permission] screen recording:', next)
      }
    }
  }

  /** @returns {MediaPermissionStatusSnapshot} */
  function getStatusSnapshot() {
    return {
      platform,
      microphone: microphoneStatus,
      screenRecording: screenRecordingStatus,
    }
  }

  /** @param {unknown} summary */
  function rememberStatus(summary) {
    applyStatusSummary(/** @type {Record<string, unknown>} */ (summary ?? {}))
  }

  /**
   * Read the OS status without prompting or opening Settings. Only the
   * features the caller says are active are inspected.
   * @param {{ microphone?: boolean, screenContextActive?: boolean }} [enabled]
   * @returns {Promise<MediaPermissionStatusSnapshot>}
   */
  async function inspectReadOnly({ microphone = false, screenContextActive = false } = {}) {
    try {
      if (platform === 'darwin') {
        if (microphone || screenContextActive) {
          rememberStatus(await macReadOnly({
            delayMs: 0,
            microphone,
            screen: screenContextActive,
            interactive: false,
            logStatus: false,
            deps: macDeps,
          }))
        }
      } else if (platform === 'win32' && microphone) {
        rememberStatus(await windowsReadOnly({
          delayMs: 0,
          microphone: true,
          interactive: false,
          logStatus: false,
          deps: windowsDeps,
        }))
      }
    } catch (error) {
      reportError('read-only', error)
    }
    return getStatusSnapshot()
  }

  /** @param {boolean} interactive */
  async function checkMicrophone(interactive) {
    /** @type {PermissionCheck | null} */
    const check = platform === 'darwin'
      ? macMicrophoneCheck
      : platform === 'win32'
        ? windowsMicrophoneCheck
        : null
    if (!check) return microphoneStatus
    try {
      const deps = platform === 'darwin' ? macDeps : windowsDeps
      rememberStatus({ microphone: await check({ interactive, deps, logStatus: false }) })
    } catch (error) {
      reportError('microphone', error)
    }
    return microphoneStatus
  }

  /** @param {boolean} interactive */
  async function checkScreenRecording(interactive) {
    if (platform !== 'darwin') return screenRecordingStatus
    try {
      rememberStatus({
        screen: await macScreenCheck({ interactive, deps: macDeps, logStatus: false }),
      })
    } catch (error) {
      reportError('screen-recording', error)
    }
    return screenRecordingStatus
  }

  return {
    getStatusSnapshot,
    inspectReadOnly,

    /**
     * @param {{ settingsRevision?: number, microphoneActive?: boolean } | null | undefined} payload
     * @returns {boolean} true only for an off → on user transition
     */
    observeVoiceRuntime(payload) {
      const outcome = microphoneTracker.observe(payload?.settingsRevision, payload?.microphoneActive)
      if (outcome.kind === 'baseline') {
        if (outcome.value) void inspectReadOnly({ microphone: true })
        return false
      }
      if (outcome.kind !== 'edge') return false
      void checkMicrophone(true)
      return true
    },

    /**
     * @param {{ settingsRevision?: number, screenshot?: boolean } | null | undefined} flags
     * @returns {boolean} true only for an off → on user transition
     */
    observeDesktopContext(flags) {
      const outcome = screenTracker.observe(flags?.settingsRevision, flags?.screenshot)
      if (outcome.kind === 'baseline') {
        if (outcome.value) void inspectReadOnly({ screenContextActive: true })
        return false
      }
      if (outcome.kind !== 'edge') return false
      void checkScreenRecording(true)
      return true
    },
  }
}

/** Single state shared by every IPC module and both renderer windows. */
export const mediaPermissionLifecycle = createMediaPermissionLifecycle()

/**
 * Boot-time inspection. There is no unconditional probe: the microphone is
 * skipped because its setting lives in renderer storage, and screen recording
 * is read (never prompted) only when the persisted combined screenshot flag
 * says the user already turned context awareness and screen context on.
 *
 * @param {{
 *   getDesktopContextFlags?: () => { screenshot?: boolean } | null | undefined,
 *   delayMs?: number,
 *   lifecycle?: ReturnType<typeof createMediaPermissionLifecycle>,
 * }} [options]
 * @returns {Promise<MediaPermissionStatusSnapshot>}
 */
export async function runStartupPermissionChecks({
  getDesktopContextFlags,
  delayMs = 600,
  lifecycle = mediaPermissionLifecycle,
} = {}) {
  const snapshot = lifecycle.getStatusSnapshot()
  if (snapshot.platform !== 'darwin') return snapshot

  const flags = typeof getDesktopContextFlags === 'function'
    ? getDesktopContextFlags()
    : null
  if (flags?.screenshot !== true) return snapshot

  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }
  return lifecycle.inspectReadOnly({ screenContextActive: true })
}
