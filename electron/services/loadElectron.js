/**
 * Electron API for main-process modules that node:test must be able to load.
 *
 * A named ESM import of `electron` fails under node:test: the package is
 * CJS, and outside the Electron runtime `require('electron')` is the binary
 * path string rather than the API. Inside the app the same require returns
 * the real API, so callers keep their current behavior.
 */

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/**
 * The Electron API when this process is the app, otherwise null.
 * @returns {typeof import('electron') | null}
 */
export function loadElectron() {
  try {
    const electron = require('electron')
    if (!electron || typeof electron !== 'object') return null
    if (typeof electron.app?.getPath !== 'function') return null
    return electron
  } catch {
    return null
  }
}
