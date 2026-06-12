import assert from 'node:assert/strict'
import { test } from 'node:test'

import { appendIdToCsvList } from '../src/features/integrations/allowlists.ts'

// parseTelegramChatIdList / parseDiscordChannelIdList are covered in
// integrations.test.ts; this file pins the pairing-approval CSV helper.

test('appendIdToCsvList appends, dedupes and normalizes spacing', () => {
  assert.equal(appendIdToCsvList('', '42'), '42')
  assert.equal(appendIdToCsvList('42', '99'), '42, 99')
  assert.equal(appendIdToCsvList('42, 99', '42'), '42, 99')
  assert.equal(appendIdToCsvList(' 42 ,, 99 ', '7'), '42, 99, 7')
  assert.equal(appendIdToCsvList(undefined, '5'), '5')
  assert.equal(appendIdToCsvList('42', '  '), '42')
})
