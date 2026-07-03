import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  formatComponentStackForLog,
  formatErrorBoundaryDetail,
} from '../src/app/errorBoundarySupport.ts'

test('error boundary detail redacts secrets before rendering fallback UI', () => {
  const detail = formatErrorBoundaryDetail(
    new Error('render failed for settings:apiKey token=xai-abcdefghijklmnop at /Users/klein/private.tsx'),
    'Unknown render error',
  )

  assert.match(detail, /token=\*\*\*/)
  assert.match(detail, /~\/private\.tsx/)
  assert.doesNotMatch(detail, /settings:apiKey/)
  assert.doesNotMatch(detail, /xai-abcdefghijklmnop/)
  assert.doesNotMatch(detail, /\/Users\/klein/)
})

test('error boundary component stack log redacts local paths', () => {
  const stack = formatComponentStackForLog('at SecretPanel (/Users/klein/project/src/SecretPanel.tsx:12:4)')

  assert.match(stack, /~\/project\/src\/SecretPanel\.tsx/)
  assert.doesNotMatch(stack, /\/Users\/klein/)
})
