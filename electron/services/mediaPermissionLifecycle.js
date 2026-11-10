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
 *   options?: { interactive?: boolean, deps?: unknown }
 * ) => Promise<string>} PermissionCheck
 */

/**
 * @typedef {(
 *   options: {
 *     delayMs?: number,
 *     microphone?: boolean,
 *     screen?: boolean,
 *     interactive?: boolean,
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
  /** @type {boolean | null} */
  let lastMicrophoneActive = null
  /** @type {boolean | null} */
  let lastScreenContextEnabled = null
  /** @type {MediaPermissionState} */
  let microphoneStatus = 'unknown'
  /** @type {MediaPermissionState} */
  let screenRecordingStatus = 'unknown'

  /** @type {(kind: string, error: unknown) => void} */
  const reportError = onError ?? ((kind, error) => {
    console.warn(`[permission] ${kind} check failed:`, getRedactedErrorMessage(error))
  })

  /** @param {Record<string, unknown>} summary */
  function applyStatusSummary(summary) {
    if (typeof summary?.microphone === 'string') {
      microphoneStatus = normalizeStatus(summary.microphone)
    }
    if (typeof summary?.screen === 'string') {
      screenRecordingStatus = normalizeStatus(summary.screen)
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

  /**
   * Read the OS status without prompting or opening Settings. Only the
   * features the caller says are on are inspected.
   * @param {{ microphone?: boolean, screenContextEnabled?: boolean }} [enabled]
   * @returns {Promise<MediaPermissionStatusSnapshot>}
   */
  async function inspectReadOnly({ microphone = false, screenContextEnabled = false } = {}) {
    try {
      if (platform === 'darwin') {
        if (microphone || screenContextEnabled) {
          applyStatusSummary(await macReadOnly({
            delayMs: 0,
            microphone,
            screen: screenContextEnabled,
            interactive: false,
            deps: macDeps,
          }))
        }
      } else if (platform === 'win32' && microphone) {
        applyStatusSummary(await windowsReadOnly({
          delayMs: 0,
          microphone: true,
          interactive: false,
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
      microphoneStatus = normalizeStatus(await check({ interactive, deps }))
    } catch (error) {
      reportError('microphone', error)
    }
    return microphoneStatus
  }

  /** @param {boolean} interactive */
  async function checkScreenRecording(interactive) {
    if (platform !== 'darwin') return screenRecordingStatus
    try {
      screenRecordingStatus = normalizeStatus(
        await macScreenCheck({ interactive, deps: macDeps }),
      )
    } catch (error) {
      reportError('screen-recording', error)
    }
    return screenRecordingStatus
  }

  return {
    getStatusSnapshot,
    inspectReadOnly,

    /**
     * @param {{ microphoneActive?: boolean } | null | undefined} payload
     * @returns {boolean} true only for an off → on user transition
     */
    observeVoiceRuntime(payload) {
      const next = payload?.microphoneActive === true
      const previous = lastMicrophoneActive
      lastMicrophoneActive = next
      if (!next) return false
      if (previous === null) {
        // First sync after launch is a baseline: read state, never prompt.
        void inspectReadOnly({ microphone: true })
        return false
      }
      if (previous === true) return false
      void checkMicrophone(true)
      return true
    },

    /**
     * @param {{ screenContextEnabled?: boolean } | null | undefined} flags
     * @returns {boolean} true only for an off → on user transition
     */
    observeDesktopContext(flags) {
      const next = flags?.screenContextEnabled === true
      const previous = lastScreenContextEnabled
      lastScreenContextEnabled = next
      if (!next) return false
      if (previous === null) {
        void inspectReadOnly({ screenContextEnabled: true })
        return false
      }
      if (previous === true) return false
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
 * is read (never prompted) only when the persisted screenContextEnabled flag
 * says the user already turned it on.
 *
 * @param {{
 *   getDesktopContextFlags?: () => { screenContextEnabled?: boolean } | null | undefined,
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
  if (flags?.screenContextEnabled !== true) return snapshot

  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }
  return lifecycle.inspectReadOnly({ screenContextEnabled: true })
}
