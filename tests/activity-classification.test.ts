import assert from 'node:assert/strict'
import { test } from 'node:test'

import { classifyActivity, isUserDeepFocused } from '../src/features/context/activityClassification.ts'

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

test('a title that only contains an app name is not that app', () => {
  const wordBoundaryCases: Array<[string, string]> = [
    ['Reset password', 'unknown'],
    ['My Password Manager', 'unknown'],
    ['Arch - Files', 'unknown'],
    ['Arch Linux Terminal', 'coding'],
    ['Terminal', 'coding'],
    ['iTerm2', 'coding'],
    ['Spotify', 'media'],
    ['Steam', 'gaming'],
    ['Epic Games Launcher', 'gaming'],
    ['Zoom', 'communication'],
    ['Notion', 'documents'],
  ]
  for (const [title, expected] of wordBoundaryCases) {
    assert.equal(classifyActivity(title), expected, title)
  }
})

test('a title that only looks like a work app does not count as deep focus', () => {
  const title = 'Reset password - Chrome'
  const activity = classifyActivity(title)
  assert.equal(activity, 'browsing')
  assert.equal(isUserDeepFocused(activity, 0, title), false)

  const ideTitle = 'VS Code - app.ts'
  assert.equal(isUserDeepFocused(classifyActivity(ideTitle), 0, ideTitle), true)
  assert.equal(isUserDeepFocused(classifyActivity(ideTitle), 3, ideTitle), false)
})
