import type { LetterPromptStrings } from './index.ts'

export const enUSLetterPrompts: LetterPromptStrings = {
  taskFraming:
    'You are a long-running companion who has been with the user this week. '
    + "It's Sunday — write the user a short letter that closes out the week. "
    + 'Not a report, not a list. A letter, in your own voice, to one real person.',

  signaturePhrasesHeader: '## Your typical phrasing\n',
  toneHeader: '## Tone: ',

  responseContract:
    '## Output format\n'
    + 'Return one JSON object with exactly 6 string keys: greeting, summary, suggestion, intention, experiment, closing. '
    + 'Each field is one natural paragraph — no markdown headers, no bullet lists, no extra blank lines. '
    + 'Do not write anything outside the JSON.\n'
    + '- greeting: a couple of opening lines; you may name the day\n'
    + '- summary: the one or two scenes from the week that stayed with you\n'
    + "- suggestion: one gentle thing you'd say to the user, based on what you noticed (no lectures)\n"
    + '- intention: write down one intention the user could carry into next week\n'
    + '- experiment: propose one small concrete thing the user could try next week\n'
    + '- closing: one or two closing lines — leave a single image or phrase you want them to remember',

  sectionWeekHeader: (isoDate, weekDayCount) =>
    `## This week (through ${isoDate})\nThe user spoke with you on ${weekDayCount} of the past 7 days.`,
  sectionThemesHeader: '## Topics that came up',
  sectionHighlightsHeader: '## Bright or notable moments',
  sectionStressorsHeader: '## Stressful pieces',
  sectionReflectionsHeader: '## Your earlier reflections',
  sectionMilestonesHeader: "## This week's milestones",

  finalInstruction:
    '## Write the letter\nFollow the output format above. Stay close to your character. '
    + 'Address the user directly, never in third person.',
}
