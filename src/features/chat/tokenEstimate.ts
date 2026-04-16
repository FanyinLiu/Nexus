import type { ChatMessage } from '../../types'

// ── Token estimation ──────────────────────────────────────────────────────
//
// Rule-of-thumb heuristic (no tiktoken dependency):
//   English / mixed:  ceil(chars / 3.5)
//   CJK-heavy text:   ceil(chars / 1.5)
//
// "CJK-heavy" = more than 30% of chars fall in CJK Unicode ranges.
// Images in "low" detail mode cost a fixed 85 tokens each (OpenAI pricing).

const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/u

function cjkRatio(text: string): number {
  if (!text) return 0
  let cjk = 0
  for (const ch of text) {
    if (CJK_RE.test(ch)) cjk++
  }
  return cjk / text.length
}

export function estimateTokensFromText(text: string): number {
  if (!text) return 0
  const ratio = cjkRatio(text)
  const divisor = ratio > 0.3 ? 1.5 : 3.5
  return Math.ceil(text.length / divisor)
}

// Base64 data URIs cost the same fixed amount as a URL image in low-detail.
// OpenAI "low" detail = 85 tokens. We always request detail:'low' in our code.
const IMAGE_LOW_DETAIL_TOKENS = 85

export function estimateImageTokens(imageUrl: string): number {
  if (!imageUrl) return 0
  // base64 data URI — size is embedded in the string but we requested low detail
  // so the model downsamples; billing is fixed at 85 tokens regardless of size.
  return IMAGE_LOW_DETAIL_TOKENS
}

// ── Message-array estimators ──────────────────────────────────────────────

type AnyPart = Record<string, unknown>

export function estimateTokensFromMessages(messages: Array<{ content: unknown }>): number {
  let total = 0
  for (const message of messages) {
    if (typeof message.content === 'string') {
      total += estimateTokensFromText(message.content)
    } else if (Array.isArray(message.content)) {
      for (const raw of message.content) {
        const part = raw as AnyPart
        if (typeof raw === 'string') {
          total += estimateTokensFromText(raw)
        } else if (part && typeof part === 'object') {
          if (part['type'] === 'image_url') {
            const imageUrl = (part['image_url'] as AnyPart | undefined)?.['url']
            total += estimateImageTokens(typeof imageUrl === 'string' ? imageUrl : '')
          } else if (typeof part['text'] === 'string') {
            total += estimateTokensFromText(part['text'] as string)
          }
        }
      }
    }
  }
  return total
}

export function estimateChatMessagesTokens(messages: ChatMessage[]): number {
  let total = 0
  for (const m of messages) {
    total += estimateTokensFromText(m.content)
    // Overhead per message (role name, structural tokens)
    total += 4
    if (m.images?.length) {
      for (const img of m.images) {
        total += estimateImageTokens(img)
      }
    }
  }
  return total
}

/**
 * Estimate tokens for a list of tool/function definitions by serialising them
 * to JSON and estimating the resulting text.
 */
export function estimateToolSchemasTokens(tools: unknown): number {
  if (!tools || !Array.isArray(tools) || tools.length === 0) return 0
  try {
    return estimateTokensFromText(JSON.stringify(tools))
  } catch {
    return 0
  }
}
