/**
 * Apply user-configured regex transforms to an LLM reply before it reaches
 * the chat view / memory layer. Modeled after SillyTavern's regex extension.
 *
 * Design choices:
 * - Rules are applied in array order so later rules can re-match output of
 *   earlier ones (expected — e.g. strip "thinking" block first, then
 *   whitespace cleanup).
 * - Invalid regex sources silently skip the rule instead of throwing. A
 *   single typo must never break the chat turn that triggered it.
 * - `replace` runs through JS's standard `String.prototype.replace`, which
 *   honours back-references ($1, $2, $&, etc.) and lambda syntax isn't
 *   offered here — replacement must be a static string to keep the rule
 *   serializable to settings JSON.
 * - The function is pure: no storage reads, no logging in the hot path,
 *   no side effects. Call sites decide when + what to pass in.
 */

import type { ChatOutputTransformRule } from '../../types'

export function applyChatOutputTransforms(
  content: string,
  rules: ChatOutputTransformRule[] | undefined | null,
): string {
  if (!content) return content
  if (!Array.isArray(rules) || rules.length === 0) return content

  let result = content
  for (const rule of rules) {
    if (!rule || rule.enabled === false) continue
    const pattern = String(rule.find ?? '')
    if (!pattern) continue
    const flags = String(rule.flags ?? '')
    const replacement = String(rule.replace ?? '')
    try {
      const regex = new RegExp(pattern, flags)
      result = result.replace(regex, replacement)
    } catch {
      // Malformed rule — skip quietly. The UI can surface validation errors
      // separately when it lands.
    }
  }
  return result
}
