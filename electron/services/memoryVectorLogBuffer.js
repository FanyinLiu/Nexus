export const MEMORY_VECTOR_LOG_FLUSH_INTERVAL_MS = 75
export const MEMORY_VECTOR_LOG_FLUSH_BATCH_SIZE = 32

export class MemoryVectorLogAppendBuffer {
  constructor({
    append,
    schedule = setTimeout,
    cancel = clearTimeout,
    intervalMs = MEMORY_VECTOR_LOG_FLUSH_INTERVAL_MS,
    batchSize = MEMORY_VECTOR_LOG_FLUSH_BATCH_SIZE,
  }) {
    if (typeof append !== 'function') {
      throw new TypeError('MemoryVectorLogAppendBuffer requires an append function')
    }

    this.append = append
    this.schedule = schedule
    this.cancel = cancel
    this.intervalMs = intervalMs
    this.batchSize = batchSize
    this.lines = []
    this.waiters = []
    this.timer = null
    this.flushing = false
    this.activeFlushPromise = null
  }

  enqueue(line) {
    const promise = new Promise((resolve, reject) => {
      this.lines.push(String(line))
      this.waiters.push({ resolve, reject })
    })

    if (this.lines.length >= this.batchSize) {
      void this.flush()
    } else {
      this.scheduleFlush()
    }

    return promise
  }

  scheduleFlush() {
    if (this.timer) return
    this.timer = this.schedule(() => {
      this.timer = null
      void this.flush()
    }, this.intervalMs)
    if (typeof this.timer?.unref === 'function') {
      this.timer.unref()
    }
  }

  flush() {
    if (this.timer) {
      this.cancel(this.timer)
      this.timer = null
    }

    if (this.flushing) return this.activeFlushPromise
    const batch = this.lines.splice(0)
    const waiters = this.waiters.splice(0)
    if (!batch.length) return Promise.resolve()

    this.flushing = true
    this.activeFlushPromise = (async () => {
      try {
        await this.append(batch.join(''))
        for (const waiter of waiters) waiter.resolve()
      } catch (err) {
        for (const waiter of waiters) waiter.reject(err)
      } finally {
        this.flushing = false
        this.activeFlushPromise = null
        if (this.lines.length) {
          this.scheduleFlush()
        }
      }
    })()
    return this.activeFlushPromise
  }

  async drain() {
    while (this.flushing || this.lines.length) {
      await this.flush()
    }
  }
}
