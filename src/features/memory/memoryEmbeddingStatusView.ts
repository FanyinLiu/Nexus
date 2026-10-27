import type { TranslationKey } from '../../types/i18n.ts'
import {
  getOllamaModelName,
  isOllamaMemoryModel,
  type MemoryEmbeddingBackendStatus,
} from './ollamaEmbedding.ts'

export type MemoryEmbeddingStatusView = {
  tone: 'success' | 'warning'
  key: TranslationKey
  params: Record<string, string | number>
}

/**
 * What the memory settings should say about the selected embedding model's
 * backend. Only Ollama models have a live status; others return null.
 */
export function resolveMemoryEmbeddingStatusView(
  selectedModel: string,
  status: MemoryEmbeddingBackendStatus,
  translate: (key: TranslationKey, params?: Record<string, string | number>) => string,
): MemoryEmbeddingStatusView | null {
  if (!isOllamaMemoryModel(selectedModel)) return null
  if (status.state === 'idle' || status.model !== selectedModel) return null

  if (status.state === 'ready') {
    return { tone: 'success', key: 'memory.embedding.status.ready', params: { dimensions: status.dimensions } }
  }

  const reason = status.code === 'model-missing'
    ? translate('memory.embedding.status.model_missing', { model: getOllamaModelName(selectedModel) })
    : status.code === 'unreachable'
      ? translate('memory.embedding.status.unreachable')
      : translate('memory.embedding.status.error', { message: status.message })
  return { tone: 'warning', key: 'memory.embedding.status.fallback', params: { reason } }
}
