import { app, ipcMain, session } from 'electron'
import { clearMemoryUserData } from '../services/memoryUserDataClear.js'
import * as memoryVectorStore from '../services/memoryVectorStore.js'
import { requireTrustedSender } from './validate.js'
import {
  validateMemoryClearUserDataPayload,
  validateMemoryHybridSearchPayload,
  validateMemoryKeywordSearchPayload,
  validateMemoryRemovePayload,
  validateMemoryVectorIndexBatchPayload,
  validateMemoryVectorIndexPayload,
  validateMemoryVectorSearchPayload,
} from './payloadSchemas.js'

export function register() {
  ipcMain.handle('memory:vector-index', async (event, payload) => {
    requireTrustedSender(event)
    payload = validateMemoryVectorIndexPayload(payload)
    const { id, content, embedding, layer } = payload ?? {}
    await memoryVectorStore.indexMemory(id, content, embedding, layer)
    return { ok: true }
  })

  ipcMain.handle('memory:vector-index-batch', async (event, payload) => {
    requireTrustedSender(event)
    payload = validateMemoryVectorIndexBatchPayload(payload)
    await memoryVectorStore.indexBatch(payload)
    return { ok: true, count: payload.length }
  })

  ipcMain.handle('memory:vector-search', async (event, payload) => {
    requireTrustedSender(event)
    payload = validateMemoryVectorSearchPayload(payload)
    const { queryEmbedding, limit, threshold, layer } = payload ?? {}
    return memoryVectorStore.searchSimilar(queryEmbedding, { limit, threshold, layer })
  })

  ipcMain.handle('memory:vector-remove', async (event, payload) => {
    requireTrustedSender(event)
    payload = validateMemoryRemovePayload(payload)
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

  ipcMain.handle('memory:clear-user-data', async (event, payload) => {
    requireTrustedSender(event)
    const parsed = validateMemoryClearUserDataPayload(payload)
    const cleared = await clearMemoryUserData({
      userDataPath: app.getPath('userData'),
      needles: parsed?.needles ?? [],
      // Flush first so the log scrub sees the renderer's already-scrubbed
      // values and can drop the older records that still quote them.
      flushStorage: () => session.defaultSession?.flushStorageData?.(),
    })
    return {
      ok: true,
      removed: cleared.removed,
      localDataCleared: cleared.localDataCleared,
    }
  })

  ipcMain.handle('memory:keyword-search', async (event, payload) => {
    requireTrustedSender(event)
    payload = validateMemoryKeywordSearchPayload(payload)
    const { query, limit, threshold, layer } = payload ?? {}
    return memoryVectorStore.searchKeyword(query, { limit, threshold, layer })
  })

  ipcMain.handle('memory:hybrid-search', async (event, payload) => {
    requireTrustedSender(event)
    payload = validateMemoryHybridSearchPayload(payload)
    const { queryEmbedding, queryText, limit, threshold, layer } = payload ?? {}
    return memoryVectorStore.searchHybrid(queryEmbedding, queryText, { limit, threshold, layer })
  })
}
