// @ts-check
/**
 * Location and sentinel for the static pet load fallback page.
 *
 * The page is a packaged HTML file so it works without the renderer server,
 * the Vite bundle, preload, or IPC. Its copy is baked into the document; this
 * module only owns the file path and the retry marker that windowCreation
 * intercepts before the page navigates away.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const PET_LOAD_FALLBACK_FILE = 'pet-load-fallback.html'

/** Absolute path to the packaged fallback document. */
export const PET_LOAD_FALLBACK_PATH = path.join(__dirname, PET_LOAD_FALLBACK_FILE)

/** Fixed navigation marker that the main process turns into a retry. */
export const PET_LOAD_FALLBACK_RETRY_URL = 'nexus-retry://pet'

/** @returns {string} Absolute path to the packaged fallback document. */
export function getPetLoadFallbackPath() {
  return PET_LOAD_FALLBACK_PATH
}
