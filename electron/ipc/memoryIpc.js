import { ipcMain } from 'electron'
import * as memoryVectorStore from '../services/memoryVectorStore.js'
import { requireTrustedSender } from './validate.js'

export function register() {
  ipcMain.handle('memory:vector-index', async (event, payload) => {
    requireTrustedSender(event)
    const { id, content, embedding, layer } = payload ?? {}
    await memoryVectorStore.indexMemory(id, content, embedding, layer)
    return { ok: true }
  })

  ipcMain.handle('memory:vector-index-batch', async (event, payload) => {
    requireTrustedSender(event)
    if (!Array.isArray(payload)) return { ok: false }
    await memoryVectorStore.indexBatch(payload)
    return { ok: true, count: payload.length }
  })

  ipcMain.handle('memory:vector-search', async (event, payload) => {
    requireTrustedSender(event)
    const { queryEmbedding, limit, threshold, layer } = payload ?? {}
    return memoryVectorStore.searchSimilar(queryEmbedding, { limit, threshold, layer })
  })

  ipcMain.handle('memory:vector-remove', async (event, payload) => {
    requireTrustedSender(event)
    if (Array.isArray(payload?.ids)) {
      const count = await memoryVectorStore.removeMemories(payload.ids)
      return { ok: true, count }
    }
    const deleted = await memoryVectorStore.removeMemory(String(payload?.id ?? ''))
    return { ok: deleted }
  })

  ipcMain.handle('memory:vector-stats', async (event) => {
    requireTrustedSender(event)
    return memoryVectorStore.getStats()
  })

  ipcMain.handle('memory:keyword-search', async (event, payload) => {
    requireTrustedSender(event)
    const { query, limit, threshold, layer } = payload ?? {}
    return memoryVectorStore.searchKeyword(query, { limit, threshold, layer })
  })

  ipcMain.handle('memory:hybrid-search', async (event, payload) => {
    requireTrustedSender(event)
    const { queryEmbedding, queryText, limit, threshold, layer } = payload ?? {}
    return memoryVectorStore.searchHybrid(queryEmbedding, queryText, { limit, threshold, layer })
  })
}
