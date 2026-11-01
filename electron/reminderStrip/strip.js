// Reminder strip page. Renders the head of the queue the main process owns
// and reports clicks. A reminder nobody touches collapses on its own; hovering
// the strip holds it open.
//
// This is a sandboxed static page with no bundler and no type imports, so the
// bridge surface is declared locally with JSDoc instead.

// @ts-check

/**
 * @typedef {{ done: string, snooze: string, open: string }} StripLabels
 * @typedef {{ id: string, title: string, body: string, labels: StripLabels }} StripItem
 * @typedef {{ items: StripItem[] }} StripSnapshot
 * @typedef {{
 *   ready: () => Promise<StripSnapshot>,
 *   act: (id: string, action: string) => Promise<unknown>,
 *   onItems: (callback: (payload: StripSnapshot) => void) => () => void,
 * }} ReminderStripBridge
 */

;(() => {
  const AUTO_COLLAPSE_MS = 12_000
  const RESUME_AFTER_HOVER_MS = 5_000

  /** @type {ReminderStripBridge | undefined} */
  const bridge = /** @type {{ reminderStrip?: ReminderStripBridge }} */ (
    /** @type {unknown} */ (window)
  ).reminderStrip

  /**
   * @param {string} id
   * @returns {HTMLElement}
   */
  function requiredElement(id) {
    const element = document.getElementById(id)
    if (!element) throw new Error(`missing strip element: ${id}`)
    return element
  }

  if (!bridge) return
  const stripBridge = bridge
  const strip = requiredElement('strip')
  const text = requiredElement('strip-text')
  const count = requiredElement('strip-count')
  const done = requiredElement('strip-done')
  const snooze = requiredElement('strip-snooze')

  /** @type {StripItem | null} */
  let current = null
  /** @type {ReturnType<typeof setTimeout> | null} */
  let collapseTimer = null
  let hovering = false

  function clearCollapse() {
    if (collapseTimer) {
      clearTimeout(collapseTimer)
      collapseTimer = null
    }
  }

  // A rejected action or initial read means the main side failed or the strip
  // is being torn down. Drop the local render state so the next onItems push
  // (the main process always sends the queue again) draws a fresh row.
  function resetRenderState() {
    current = null
    hovering = false
    clearCollapse()
    strip.hidden = true
  }

  /** @param {number} delayMs */
  function scheduleCollapse(delayMs) {
    clearCollapse()
    if (!current || hovering) return
    const id = current.id
    collapseTimer = setTimeout(() => {
      collapseTimer = null
      act(id, 'expire')
    }, delayMs)
  }

  /**
   * @param {string} id
   * @param {string} action
   */
  function act(id, action) {
    clearCollapse()
    stripBridge.act(id, action).then(
      () => {},
      () => resetRenderState(),
    )
  }

  /** @param {StripSnapshot} payload */
  function render(payload) {
    const items = payload && Array.isArray(payload.items) ? payload.items : []
    const head = items[0] ?? null
    if (!head) {
      current = null
      clearCollapse()
      strip.hidden = true
      return
    }
    const changed = !current || current.id !== head.id
    current = head
    const line = head.title && head.body ? `${head.title} · ${head.body}` : head.title || head.body
    text.textContent = line
    text.title = line
    text.setAttribute('aria-label', `${line} · ${head.labels.open}`)
    done.textContent = head.labels.done
    snooze.textContent = head.labels.snooze
    count.hidden = items.length < 2
    count.textContent = items.length > 1 ? `+${items.length - 1}` : ''
    strip.hidden = false
    if (changed) scheduleCollapse(AUTO_COLLAPSE_MS)
  }

  done.addEventListener('click', () => current && act(current.id, 'done'))
  snooze.addEventListener('click', () => current && act(current.id, 'snooze'))
  text.addEventListener('click', () => current && act(current.id, 'open'))
  strip.addEventListener('mouseenter', () => {
    hovering = true
    clearCollapse()
  })
  strip.addEventListener('mouseleave', () => {
    hovering = false
    scheduleCollapse(RESUME_AFTER_HOVER_MS)
  })

  stripBridge.onItems(render)
  stripBridge.ready().then(render, resetRenderState)
})()
