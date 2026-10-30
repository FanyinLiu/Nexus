/**
 * Shape of a persona loaded from disk (userData/personas/<id>/...).
 *
 * All fields are nullable because a partial persona directory — only a
 * soul.md, for example — must still load cleanly. The v2 decision engine
 * handles each missing field with a sensible fallback (empty signature list,
 * no few-shot examples, global voice defaults, etc.).
 */

/**
 * Structured speech dials a persona may carry in style.json.
 *
 * Every field is optional: hand-written style files predate the dials, and a
 * persona that sets one dial should not be forced to set the rest. Values are
 * clamped by the reader, not by the type.
 */
export interface PersonaSpeechStyle {
  /** Preferred maximum sentences per reply. */
  maxSentences?: number
  /** 0 = never asks for company, 3 = openly asks to stay. */
  clingy?: number
  /** 0 = openly warm, 3 = keeps care unspoken. */
  aloof?: number
  /** Denies the feeling while acting on it, especially when praised. */
  tsundere?: boolean
  /** 0 = dry, 3 = quick jokes and teasing. */
  playful?: number
  /** How she refers to herself. */
  selfRef?: string
  /** How she addresses the user. */
  callUser?: string
  /** Sentence-final particles she actually uses. */
  particles?: string[]
  /** Whether emoji fit the voice. */
  emojiOk?: boolean
  /** Whether lists and headings fit the voice. */
  markdownOk?: boolean
}

/**
 * One compact rule derived from the speech dials, ready to be phrased by the
 * active locale. Thresholds are decided once in the reminder builder so the
 * five locale files only own wording, never dial semantics.
 */
export type PersonaSpeechRule =
  | { kind: 'aloof' }
  | { kind: 'clingy' }
  | { kind: 'tsundere' }
  | { kind: 'playful' }
  | { kind: 'maxSentences'; count: number }
  | { kind: 'selfRef'; name: string }
  | { kind: 'callUser'; name: string }
  | { kind: 'noEmoji' }
  | { kind: 'noMarkdown' }

export interface PersonaStyle {
  /** Phrases the character is known to say. Positive anchor for the guardrail. */
  signaturePhrases?: string[]
  /** Phrases the character is NOT allowed to say. Hard negative anchor. */
  forbiddenPhrases?: string[]
  /** Free-form tone tags (e.g. "warm", "playful", "sarcastic-lite"). Advisory. */
  toneTags?: string[]
  /**
   * Card author's post-history instructions. They are meant to apply after the
   * conversation history, so they are stored here instead of being pasted at
   * the top of soul.md, and the post-history reminder injects them there.
   */
  postHistory?: string
  /** Optional dials that describe how she actually talks. */
  speechStyle?: PersonaSpeechStyle
}

interface PersonaFewShotExample {
  user: string
  assistant: string
}

/**
 * TTS voice override for this persona. Any omitted field falls back to the
 * global speechOutput* settings, so a persona can override just the voice
 * without also overriding the provider/model.
 */
interface PersonaVoice {
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
interface PersonaTools {
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
  /**
   * mtime of soul.md, when the loader could stat it. The renderer cannot
   * read files itself; the resolver records this with its cached persona so
   * a stale entry can be recognised after a re-read.
   */
  soulMtimeMs?: number
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
