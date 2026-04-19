/**
 * Autonomy Engine V2 — decision orchestrator.
 *
 * Public entry point the tick loop will call (in Phase 5) to answer
 * "should the companion say something right now, and if so what?".
 *
 * Design notes:
 *
 * - The actual chat call is injected as a ChatCaller so the engine can
 *   be unit-tested without hitting a provider. Production wires this to
 *   `window.desktopPet.completeChat` in the renderer.
 *
 * - Every failure path returns `{ kind: 'silent', reason }`. The
 *   companion doesn't announce an error to the user; it just doesn't
 *   speak this tick. Errors are logged via the onError callback for the
 *   host to collect.
 *
 * - Phase 4 (persona guardrail) wraps the output of this function — it
 *   can downgrade a `speak` to `silent` when the text fails signature /
 *   forbidden checks. The engine itself does NOT run the guardrail.
 */

import type { AutonomyContextV2 } from './contextGatherer.ts'
import type { LoadedPersona } from './personaTypes.ts'
import {
  type ChatMessage,
  type DecisionPromptHints,
  buildDecisionPrompt,
} from './decisionPrompt.ts'

export type DecisionResult =
  | { kind: 'silent'; reason?: string; rawResponse?: string }
  | { kind: 'speak'; text: string; rawResponse: string }

export interface ChatCallerPayload {
  providerId: string
  baseUrl: string
  apiKey: string
  model: string
  messages: ChatMessage[]
  temperature: number
  maxTokens: number
}

export type ChatCaller = (payload: ChatCallerPayload) => Promise<{
  content: string
  finishReason?: string
}>

export interface DecisionEngineConfig {
  /** Resolved provider id (e.g. 'anthropic', 'openai', 'kimi-coding'). */
  providerId: string
  baseUrl: string
  apiKey: string
  model: string
  /**
   * Sampling temperature. Default 0.7 — decisions need enough variance
   * to not feel scripted, but not so much that the response drifts.
   */
  temperature?: number
  /**
   * Hard cap. Decision replies are short — a 256-token ceiling keeps
   * costs tight and prevents the model from rambling past the JSON.
   */
  maxTokens?: number
}

export interface RunDecisionOptions {
  context: AutonomyContextV2
  persona: LoadedPersona
  config: DecisionEngineConfig
  chat: ChatCaller
  hints?: DecisionPromptHints
  onError?: (error: unknown) => void
}

// ── JSON extraction ───────────────────────────────────────────────────────

/**
 * Try to pull a single JSON object out of the model's response. Handles:
 *   - clean JSON: `{"action":"silent"}`
 *   - markdown-fenced: ```json {...} ```
 *   - leading reasoning: `I think...\n\n{...}`
 *   - trailing commentary: `{...}\n\nlet me know...`
 *
 * Returns null when no object literal is found or parsing fails — caller
 * treats that as silent.
 */
export function extractDecisionJson(raw: string): { action: string; text?: string } | null {
  if (!raw) return null

  const trimmed = raw.trim()
  // Fast path: whole response is clean JSON.
  try {
    const parsed = JSON.parse(trimmed)
    if (parsed && typeof parsed === 'object' && typeof parsed.action === 'string') {
      return parsed
    }
  } catch { /* fall through */ }

  // Strip common fenced-code wrappers.
  const fenceMatch = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1].trim())
      if (parsed && typeof parsed === 'object' && typeof parsed.action === 'string') {
        return parsed
      }
    } catch { /* fall through */ }
  }

  // Last resort: find the first `{...}` balanced block and try to parse.
  const start = trimmed.indexOf('{')
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < trimmed.length; i += 1) {
    const ch = trimmed[i]
    if (escape) { escape = false; continue }
    if (ch === '\\') { escape = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        const candidate = trimmed.slice(start, i + 1)
        try {
          const parsed = JSON.parse(candidate)
          if (parsed && typeof parsed === 'object' && typeof parsed.action === 'string') {
            return parsed
          }
        } catch { /* parsing failed — give up */ }
        return null
      }
    }
  }
  return null
}

// ── Main entry ────────────────────────────────────────────────────────────

export async function runDecisionEngine(opts: RunDecisionOptions): Promise<DecisionResult> {
  const messages = buildDecisionPrompt(opts.context, opts.persona, opts.hints)

  let response: { content: string; finishReason?: string }
  try {
    response = await opts.chat({
      providerId: opts.config.providerId,
      baseUrl: opts.config.baseUrl,
      apiKey: opts.config.apiKey,
      model: opts.config.model,
      messages,
      temperature: opts.config.temperature ?? 0.7,
      maxTokens: opts.config.maxTokens ?? 256,
    })
  } catch (error) {
    opts.onError?.(error)
    return {
      kind: 'silent',
      reason: error instanceof Error ? `chat_call_failed: ${error.message}` : 'chat_call_failed',
    }
  }

  const parsed = extractDecisionJson(response.content ?? '')

  if (!parsed) {
    return {
      kind: 'silent',
      reason: 'unparseable_response',
      rawResponse: response.content,
    }
  }

  if (parsed.action === 'silent') {
    return { kind: 'silent', rawResponse: response.content }
  }

  if (parsed.action === 'speak') {
    const text = String(parsed.text ?? '').trim()
    if (!text) {
      // Model said "speak" but gave empty text — treat as silent so the UI
      // doesn't flash an empty bubble.
      return { kind: 'silent', reason: 'empty_speak_text', rawResponse: response.content }
    }
    return { kind: 'speak', text, rawResponse: response.content }
  }

  // Unknown action value — safest is silent.
  return {
    kind: 'silent',
    reason: `unknown_action:${parsed.action}`,
    rawResponse: response.content,
  }
}
