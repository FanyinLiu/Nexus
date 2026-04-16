/**
 * Dev-only console logger for voice pipeline debugging.
 *
 * These printf-style traces were historically littered across continuousVoice,
 * conversationEntrypoints, speechReply, streamingSpeechOutput and bus.ts as
 * plain `console.log(...)` calls. Routing them through this helper gives us
 * a single toggle: in production builds Vite replaces `import.meta.env.DEV`
 * with `false` and the branch (along with its argument expressions) gets
 * dead-code eliminated, so there's zero runtime cost in packaged releases.
 *
 * For durable structured events, use the existing VoiceTransitionLog or the
 * debug-console event bus instead — voiceDebug() is specifically for the
 * transient developer-console noise that only matters when hacking on the
 * voice state machine.
 */
const VOICE_DEBUG_ENABLED = import.meta.env.DEV

export function voiceDebug(tag: string, ...args: unknown[]): void {
  if (VOICE_DEBUG_ENABLED) {
    console.log(`[${tag}]`, ...args)
  }
}
