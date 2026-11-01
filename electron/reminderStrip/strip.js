// Reminder strip page. Renders the head of the queue the main process owns
// and reports clicks. A reminder nobody touches collapses on its own; hovering
// the strip holds it open.
;(() => {
  const AUTO_COLLAPSE_MS = 12_000
  const RESUME_AFTER_HOVER_MS = 5_000

  const bridge = window.reminderStrip
  const strip = document.getElementById('strip')
  const text = document.getElementById('strip-text')
  const count = document.getElementById('strip-count')
  const done = document.getElementById('strip-done')
  const snooze = document.getElementById('strip-snooze')
  if (!bridge || !strip || !text || !count || !done || !snooze) return

  let current = null
  let collapseTimer = null
  let hovering = false

  function clearCollapse() {
    if (collapseTimer) {
      clearTimeout(collapseTimer)
      collapseTimer = null
    }
  }

  function scheduleCollapse(delayMs) {
    clearCollapse()
    if (!current || hovering) return
    const id = current.id
    collapseTimer = setTimeout(() => {
      collapseTimer = null
      act(id, 'expire')
    }, delayMs)
  }

  function act(id, action) {
    clearCollapse()
    bridge.act(id, action).catch((error) => {
      console.warn('[reminder-strip] action failed:', error instanceof Error ? error.message : String(error))
    })
  }

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

  bridge.onItems(render)
  bridge.ready().then(render).catch((error) => {
    console.warn('[reminder-strip] initial load failed:', error instanceof Error ? error.message : String(error))
  })
})()
