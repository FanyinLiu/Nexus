/**
 * Cross-feature notice that persona soul text was written.
 *
 * The message body is only `{ saved: true }` — persona text never crosses
 * the channel. Kept in the persona feature so the resolver and the settings
 * card can share it without importing each other.
 */
export const PERSONA_SOUL_SAVED_CHANNEL = 'nexus-persona-soul'
