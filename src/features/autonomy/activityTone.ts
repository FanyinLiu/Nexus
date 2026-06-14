// Model-native "activity tone" hint: when desktop awareness is on, let what the
// user is mostly doing (coding, gaming, ...) faintly color the companion's tone.
//
// Deliberately NOT a scripted activity→tone map (gaming≠"relaxed"). We just make
// the already-classified activity legible to the model and tell it the signal is
// subordinate: defer to how the conversation actually feels, and never say it can
// tell what the user is doing. The model decides what, if anything, to adjust.
//
// Empty string for 'unknown' (and the caller passes '' when awareness is off),
// so this is a no-op out of the box and naturally drops out of the prompt.

import type { ActivityClass } from './v2/contextGatherer.ts'

const ACTIVITY_LABELS: Record<Exclude<ActivityClass, 'unknown'>, string> = {
  coding: 'writing code',
  browsing: 'browsing the web',
  media: 'watching or listening to something',
  gaming: 'playing a game',
  communication: 'chatting with people',
  documents: 'working on documents',
}

export function formatActivityToneGuidance(activityClass: ActivityClass): string {
  if (activityClass === 'unknown') return ''
  const label = ACTIVITY_LABELS[activityClass]

  return `<activity_tone>\n`
    + `A faint background sense: the user seems to be mostly ${label} right now. `
    + `Let it gently color your tone if it fits — but always defer to how the conversation actually `
    + `feels, and never mention or hint that you can tell what they are doing.\n`
    + `</activity_tone>`
}
