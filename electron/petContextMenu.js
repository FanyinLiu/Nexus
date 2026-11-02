/**
 * Pet right-click menu: a pure template builder plus the promise that reports
 * which row the user picked. Keeping both here lets windowManager own the
 * Electron plumbing while tests drive the same template and settlement logic
 * without booting Electron.
 *
 * On macOS `popup`'s close callback can fire before the item's `click`, so a
 * close only resolves `null` after a short grace period; a click settles first.
 */

import { mainT } from './mainMessages.js'

/** Grace period for macOS to deliver `click` after `popup`'s close callback. */
export const PET_CONTEXT_MENU_CLOSE_GRACE_MS = 250

/**
 * @typedef {{
 *   messages: () => void,
 *   chat: () => void,
 *   settings: () => void,
 *   resetPosition: () => void,
 *   hidePet: () => void,
 *   quit: () => void,
 * }} PetMenuHandlers
 */

/**
 * Build the flat pet context-menu template. Item order is contractual:
 * Messages sits first and the destructive rows keep their separator.
 * @param {PetMenuHandlers} handlers
 * @returns {import('electron').MenuItemConstructorOptions[]}
 */
export function buildPetContextMenuTemplate(handlers) {
  return [
    {
      label: mainT('menu.messages'),
      click: handlers.messages,
    },
    {
      label: mainT('menu.chat'),
      click: handlers.chat,
    },
    {
      label: mainT('menu.settings'),
      click: handlers.settings,
    },
    {
      label: mainT('menu.resetPosition'),
      click: handlers.resetPosition,
    },
    {
      type: 'separator',
    },
    {
      label: mainT('menu.hidePet'),
      click: handlers.hidePet,
    },
    {
      label: mainT('menu.quit'),
      click: handlers.quit,
    },
  ]
}

/**
 * Open the pet menu and resolve `'messages'` when that row was chosen,
 * otherwise `null` once the menu closed. Every other row keeps its own
 * handler; only the messages row changes the result.
 * @param {{
 *   popup: (template: import('electron').MenuItemConstructorOptions[], onClose: () => void) => void,
 *   handlers: Omit<PetMenuHandlers, 'messages'>,
 *   graceMs?: number,
 *   schedule?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>,
 *   cancel?: (handle: ReturnType<typeof setTimeout>) => void,
 * }} options
 * @returns {Promise<'messages' | null>}
 */
export function popupPetContextMenu({
  popup,
  handlers,
  graceMs = PET_CONTEXT_MENU_CLOSE_GRACE_MS,
  schedule = (callback, ms) => setTimeout(callback, ms),
  cancel = (handle) => clearTimeout(handle),
}) {
  return new Promise((resolve) => {
    let settled = false
    /** @type {ReturnType<typeof setTimeout> | null} */
    let closeTimer = null

    /** @param {'messages' | null} value */
    const settle = (value) => {
      if (settled) return
      settled = true
      if (closeTimer !== null) {
        cancel(closeTimer)
        closeTimer = null
      }
      resolve(value)
    }

    const template = buildPetContextMenuTemplate({
      ...handlers,
      messages: () => settle('messages'),
    })

    popup(template, () => {
      if (settled) return
      // Let a click that races the close callback settle first.
      closeTimer = schedule(() => settle(null), graceMs)
    })
  })
}
