// @ts-check
/**
 * Local fallback page for a pet window whose renderer never loaded once.
 *
 * Hiding the window is wrong on a first launch (Linux without a tray would have
 * nothing visible), and Electron's own error page or a blank view is not a
 * product state. This page is a self-contained data URL: no build step, no
 * renderer server, no app stylesheet. It shows one line of copy and a retry
 * control, and never renders a URL or an error code.
 *
 * The button navigates to a sentinel URL that windowCreation intercepts before
 * the page leaves the fallback and replays the same recovery path a
 * user-initiated show uses (retryIfExhausted). Copy lives in mainMessagesTable
 * so all five locales stay in parity.
 */

import { mainT } from './mainMessages.js'

export const PET_LOAD_FALLBACK_RETRY_URL = 'nexus-retry://pet'
export const PET_LOAD_FALLBACK_RETRY_ID = 'nexus-pet-retry'

/** @type {Record<string, string>} */
const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => HTML_ESCAPES[char])
}

/**
 * Build the fallback document. Pure: the caller supplies already-translated
 * copy, which keeps locale lookup and page markup independently testable.
 * @param {{ message: string, retryLabel: string, retryUrl: string }} copy
 * @returns {string}
 */
export function renderPetLoadFallbackPage({ message, retryLabel, retryUrl }) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nexus</title>
<style>
  html, body { margin: 0; height: 100%; }
  body {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    padding: 24px;
    text-align: center;
    background: #1c1c22;
    color: #f4f4f7;
    font: 14px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif;
    -webkit-user-select: none;
    user-select: none;
  }
  p { margin: 0; }
  button {
    cursor: pointer;
    padding: 8px 20px;
    border: 1px solid #5a5a68;
    border-radius: 8px;
    background: #2b2b35;
    color: inherit;
    font: inherit;
  }
  button:hover { background: #363642; }
</style>
</head>
<body>
<p>${escapeHtml(message)}</p>
<button type="button" id="${PET_LOAD_FALLBACK_RETRY_ID}" data-href="${escapeHtml(retryUrl)}">${escapeHtml(retryLabel)}</button>
<script>
  document.getElementById('${PET_LOAD_FALLBACK_RETRY_ID}').addEventListener('click', function () {
    location.href = this.getAttribute('data-href')
  })
</script>
</body>
</html>`
}

/**
 * Build the `data:` URL loaded into the pet window on first-launch exhaustion.
 * @returns {string}
 */
export function buildPetLoadFallbackUrl() {
  const page = renderPetLoadFallbackPage({
    message: mainT('petLoadFallback.message'),
    retryLabel: mainT('petLoadFallback.retry'),
    retryUrl: PET_LOAD_FALLBACK_RETRY_URL,
  })
  return `data:text/html;charset=utf-8,${encodeURIComponent(page)}`
}
