// Marks the quit electron-updater starts for an update install.
//
// The ordinary before-quit handler waits up to 2.5 s for renderer memory
// flushes. That wait must not delay an installer: once the updater begins its
// own quit sequence, the memory handler steps aside and lets it proceed.

let updateInstallQuit = false

/** Record that the current quit belongs to an update install. */
export function markUpdateInstallQuit() {
  updateInstallQuit = true
}

/** Clear the install marker when the install fails or is cancelled. */
export function clearUpdateInstallQuit() {
  updateInstallQuit = false
}

/** True while the current quit belongs to an update install. */
export function isUpdateInstallQuit() {
  return updateInstallQuit
}
