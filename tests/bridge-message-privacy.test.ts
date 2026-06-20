import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildBridgeAnnouncementDebugDetail,
  buildBridgeIncomingDebugDetail,
  buildBridgeOwnerChatForwardText,
  shouldForwardBridgeIncomingToChat,
} from '../src/lib/privacy/bridgeMessagePrivacy.ts'

test('bridge incoming text is forwarded only when it belongs to the owner', () => {
  assert.equal(shouldForwardBridgeIncomingToChat({ isOwner: false, text: 'secret from someone else' }), false)
  assert.equal(shouldForwardBridgeIncomingToChat({ isOwner: true, text: '' }), false)
  assert.equal(shouldForwardBridgeIncomingToChat({ isOwner: true, text: 'hello from me' }), true)
})

test('bridge owner forward text uses the owner prefix only', () => {
  assert.equal(buildBridgeOwnerChatForwardText('Telegram', 'hello'), '【Telegram】hello')
  assert.equal(buildBridgeOwnerChatForwardText('Discord', 'hello'), '【Discord】hello')
})

test('bridge debug detail never includes message body text', () => {
  const detail = buildBridgeIncomingDebugDetail({
    source: 'Telegram',
    container: 'Family',
    sender: 'Ada',
    isOwner: false,
    text: 'private message body',
    media: null,
  })

  assert.equal(detail.includes('private message body'), false)
  assert.match(detail, /textLength=20/)
  assert.match(detail, /media=none/)
})

test('bridge announcement debug detail is metadata-only', () => {
  const detail = buildBridgeAnnouncementDebugDetail({
    source: 'Discord',
    sender: 'Ada',
    text: 'deployment password is 123456',
    media: 'voice',
  })

  assert.equal(detail.includes('deployment password'), false)
  assert.match(detail, /textLength=29/)
  assert.match(detail, /media=voice/)
})
