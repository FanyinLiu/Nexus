export function createSettingsReturnFocusCoordinator(onConsume) {
  let pending = false

  return {
    request() {
      pending = true
    },
    cancel() {
      pending = false
    },
    isPending() {
      return pending
    },
    consume() {
      if (!pending) return false
      pending = false
      onConsume()
      return true
    },
  }
}
