/**
 * Stable updater error codes. The main process broadcasts these instead of
 * prose; the renderer maps the paired messageKey to i18n. Same-process
 * callers also read `error.code`. IPC does not preserve custom error fields,
 * so the broadcast payload carries the code itself.
 */

/** Flush or close of a durable store failed. Install must not continue. */
export const UPDATE_INSTALL_PREP_FAILED = 'NEXUS_ERR_UPDATE_INSTALL_PREP_FAILED'

/** Copying the pre-install snapshot failed. Install must not continue. */
export const UPDATE_INSTALL_SNAPSHOT_FAILED = 'NEXUS_ERR_UPDATE_INSTALL_SNAPSHOT_FAILED'

/** The signed update manifest did not verify. Download and install are refused. */
export const UPDATE_MANIFEST_UNVERIFIED = 'NEXUS_ERR_UPDATE_MANIFEST_UNVERIFIED'
