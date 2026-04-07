import { ipcMain } from 'electron'
import * as memoryVectorStore from '../services/memoryVectorStore.js'

export function register() {
  ipcMain.handle('memory:vector-index', async (_event, payload) => {
    const { id, content, embedding, layer } = payload ?? {}
    await memoryVectorStore.indexMemory(id, content, embedding, layer)
    return { ok: true }
  })

  ipcMain.handle('memory:vector-index-batch', async (_event, payload) => {
    if (!Array.isArray(payload)) return { ok: false }
    await memoryVectorStore.indexBatch(payload)
    return { ok: true, count: payload.length }
  })

  ipcMain.handle('memory:vector-search', async (_event, payload) => {
    const { queryEmbedding, limit, threshold, layer } = payload ?? {}
    return memoryVectorStore.searchSimilar(queryEmbedding, { limit, threshold, layer })
  })

  ipcMain.handle('memory:vector-remove', async (_event, payload) => {
    if (Array.isArray(payload?.ids)) {
      const count = await memoryVectorStore.removeMemories(payload.ids)
      return { ok: true, count }
    }
    const deleted = await memoryVectorStore.removeMemory(String(payload?.id ?? ''))
    return { ok: deleted }
  })

  ipcMain.handle('memory:vector-stats', async () => {
    return memoryVectorStore.getStats()
  })
}
