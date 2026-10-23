/**
 * Oversized SOUL draft that has not been saved.
 *
 * The editor keeps the draft in component state, and that state dies when
 * Settings leaves the Memory page. This copy survives that unmount the same
 * way the draft survives closing and reopening the sheet. It is not written
 * to the persona file or to localStorage.
 */

let held: string | null = null

/** Remember an oversized draft until a successful save replaces it. */
export function holdSoulCardDraft(text: string): void {
  held = text
}

/** The oversized draft, if a save was refused and nothing has been saved since. */
export function peekSoulCardDraft(): string | null {
  return held
}

/** Drop the oversized draft after it has been saved. */
export function releaseSoulCardDraft(): void {
  held = null
}
