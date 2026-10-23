/** Electron stub for memory-vector disk tests. userData comes from the test. */
export const app = {
  getPath(name) {
    if (name !== 'userData') {
      throw new Error(`unexpected app.getPath(${name})`)
    }
    const root = globalThis.__nexusMemoryVectorUserData
    if (typeof root !== 'string' || !root) {
      throw new Error('memory vector test userData is not set')
    }
    return root
  },
  once() {},
}
