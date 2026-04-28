/**
 * Shared font / typography constants for exported HTML artifacts
 * (Sunday letter + 12-month yearbook). Kept in one place so a font-
 * license change or a new locale's recommended face only touches one
 * file. Both renderers inline this into their `<style>` block.
 */

/**
 * Serif body stack with CJK + Latin coverage. Avoids forcing a webfont
 * download — every face listed is shipped with at least one mainstream
 * OS so the artifact reads correctly offline in all 5 locales.
 */
export const ARTIFACT_SERIF_FONT_STACK =
  "'Iowan Old Style', 'Apple Garamond', 'Baskerville', 'Times New Roman', "
  + "'Georgia', 'PingFang SC', 'Hiragino Sans', 'Hiragino Mincho ProN', "
  + "'Noto Serif CJK SC', 'Noto Serif CJK TC', 'Noto Serif KR', serif"

/**
 * Sans stack used for small UI affordances inside the artifact —
 * eyebrow labels, footer credit, milestone date columns. Distinct from
 * the body face so secondary text reads as different register.
 */
export const ARTIFACT_SANS_FONT_STACK = "-apple-system, 'Helvetica Neue', sans-serif"
