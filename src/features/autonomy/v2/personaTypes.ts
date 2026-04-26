/**
 * Shape of a persona loaded from disk (userData/personas/<id>/...).
 *
 * All fields are nullable because a partial persona directory — only a
 * soul.md, for example — must still load cleanly. The v2 decision engine
 * handles each missing field with a sensible fallback (empty signature list,
 * no few-shot examples, global voice defaults, etc.).
 */

export interface PersonaStyle {
  /** Phrases the character is known to say. Positive anchor for the guardrail. */
  signaturePhrases?: string[]
  /** Phrases the character is NOT allowed to say. Hard negative anchor. */
  forbiddenPhrases?: string[]
  /** Free-form tone tags (e.g. "warm", "playful", "sarcastic-lite"). Advisory. */
  toneTags?: string[]
}

export interface PersonaFewShotExample {
  user: string
  assistant: string
}

/**
 * TTS voice override for this persona. Any omitted field falls back to the
 * global speechOutput* settings, so a persona can override just the voice
 * without also overriding the provider/model.
 */
export interface PersonaVoice {
  providerId?: string
  voice?: string
  model?: string
  instructions?: string
  apiBaseUrl?: string
}

/**
 * Tool access controls. Empty or missing means the persona inherits the
 * global tool settings; explicit allowlist wins over blocklist when both
 * are specified.
 */
export interface PersonaTools {
  allowlist?: string[]
  blocklist?: string[]
}

/**
 * The fully loaded persona, ready to feed into the decision engine and
 * the persona guardrail. Missing source files show up as undefined/null
 * here; callers must handle that.
 */
export interface LoadedPersona {
  /** Profile id, matching the directory name under userData/personas/. */
  id: string
  /** Resolved absolute directory the files were read from. */
  rootDir: string
  /** Raw markdown body of soul.md — identity + speaking voice + backstory. */
  soul: string
  /** Raw markdown body of memory.md — persona-private memory. */
  memory: string
  /** Raw markdown body of examples.md (for reference; structured list below). */
  examplesRaw: string
  /** Parsed few-shot examples extracted from examples.md. */
  examples: PersonaFewShotExample[]
  style: PersonaStyle
  voice: PersonaVoice
  tools: PersonaTools
  /**
   * True iff at least one file was present in the profile directory.
   * When false, the loader has populated the fields with empty defaults
   * and the caller should treat the persona as "not configured".
   */
  present: boolean
}

/** The persona profile loaded by autonomy + proactive features when the
 *  user hasn't picked a different one. Lives here so all consumers stay
 *  in sync when the default ever changes. */
export const DEFAULT_PERSONA_PROFILE_ID = 'xinghui'

export function createEmptyLoadedPersona(id: string, rootDir: string): LoadedPersona {
  return {
    id,
    rootDir,
    soul: '',
    memory: '',
    examplesRaw: '',
    examples: [],
    style: {},
    voice: {},
    tools: {},
    present: false,
  }
}
