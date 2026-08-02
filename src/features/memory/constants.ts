import type { TranslationKey } from '../../types/i18n.ts'

export const LOCAL_HASH_MEMORY_MODEL_ID = 'local-hash-v1'

export type MemoryEmbeddingModelOption = {
  value: string
  label: TranslationKey
  hint: TranslationKey
}

export const MEMORY_EMBEDDING_MODEL_OPTIONS: readonly MemoryEmbeddingModelOption[] = [
  {
    value: LOCAL_HASH_MEMORY_MODEL_ID,
    label: 'memory.embedding.local-hash-v1.label',
    hint: 'memory.embedding.local-hash-v1.hint',
  },
  {
    value: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    label: 'memory.embedding.paraphrase-multilingual-MiniLM-L12-v2.label',
    hint: 'memory.embedding.paraphrase-multilingual-MiniLM-L12-v2.hint',
  },
  {
    value: 'Xenova/all-MiniLM-L6-v2',
    label: 'memory.embedding.all-MiniLM-L6-v2.label',
    hint: 'memory.embedding.all-MiniLM-L6-v2.hint',
  },
] as const

// Alias for the settings default — the local-hash model id doubles as the
// fallback embedding model when no remote model is configured. Kept as a
// separate name so the two call sites (model selection vs settings default)
// stay semantically distinct.
export const DEFAULT_MEMORY_EMBEDDING_MODEL = LOCAL_HASH_MEMORY_MODEL_ID

export type ScreenVlmModelOption = {
  value: string
  label: TranslationKey
  hint: TranslationKey
}

export const SCREEN_VLM_MODEL_OPTIONS: readonly ScreenVlmModelOption[] = [
  {
    value: 'gpt-4o-mini',
    label: 'memory.vlm.gpt-4o-mini.label',
    hint: 'memory.vlm.gpt-4o-mini.hint',
  },
  {
    value: 'gpt-4o',
    label: 'memory.vlm.gpt-4o.label',
    hint: 'memory.vlm.gpt-4o.hint',
  },
  {
    value: 'gpt-4.1-mini',
    label: 'memory.vlm.gpt-4.1-mini.label',
    hint: 'memory.vlm.gpt-4.1-mini.hint',
  },
  {
    value: 'gpt-4.1',
    label: 'memory.vlm.gpt-4.1.label',
    hint: 'memory.vlm.gpt-4.1.hint',
  },
  {
    value: 'qwen-vl-max-latest',
    label: 'memory.vlm.qwen-vl-max-latest.label',
    hint: 'memory.vlm.qwen-vl-max-latest.hint',
  },
  {
    value: 'qwen-vl-plus-latest',
    label: 'memory.vlm.qwen-vl-plus-latest.label',
    hint: 'memory.vlm.qwen-vl-plus-latest.hint',
  },
  {
    value: 'glm-4v-plus',
    label: 'memory.vlm.glm-4v-plus.label',
    hint: 'memory.vlm.glm-4v-plus.hint',
  },
] as const
