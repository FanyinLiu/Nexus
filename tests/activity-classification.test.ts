import assert from 'node:assert/strict'
import { test } from 'node:test'

import { classifyActivity } from '../src/features/context/activityClassification.ts'

const cases: Array<[string, string]> = [
  ['Reset password - Chrome', 'browsing'],
  ['Reset password - Google Chrome', 'browsing'],
  ['1Password', 'unknown'],
  ['Wordle - Google Chrome', 'browsing'],
  ['Archive - Finder', 'unknown'],
  ['Microsoft Word', 'documents'],
  ['Google Docs - Brave', 'documents'],
  ['Arc', 'browsing'],
  ['YouTube - Google Chrome', 'media'],
  ['Visual Studio Code - foo.ts', 'coding'],
  ['微信', 'communication'],
  ['原神', 'gaming'],
]

test('classifyActivity uses word boundaries for title words', () => {
  for (const [title, expected] of cases) {
    assert.equal(classifyActivity(title), expected, title)
  }
})
