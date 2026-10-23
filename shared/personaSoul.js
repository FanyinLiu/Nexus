/**
 * Soul text accepted by a persona save.
 *
 * The settings card and the main-process save channel share this limit so a
 * draft the card refuses is the same draft the channel refuses. Empty text is
 * accepted so a save can clear an override. The writer removes an existing
 * file instead of creating a new empty one; a missing file already falls
 * through to the default persona.
 */

/**
 * Upper bound for one soul write. Character-card identity text is long;
 * this still refuses an unbounded payload so a save cannot fill the disk.
 */
export const PERSONA_SOUL_MAX_CHARS = 500_000

/**
 * Accept soul text for a save, or null when the payload must not be written.
 * Missing text is an empty clear, not a new file. Non-strings are refused
 * so an object is not coerced into a placeholder.
 * @param {unknown} content
 * @returns {string | null}
 */
export function acceptPersonaSoulContent(content) {
  if (content == null) return ''
  if (typeof content !== 'string') return null
  if (content.length > PERSONA_SOUL_MAX_CHARS) return null
  return content
}
