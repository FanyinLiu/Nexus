import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { buildMessagePrivacyReport } from '../scripts/message-privacy-audit.mjs'

const BASELINE_FILES: Record<string, string> = {
  'src/app/controllers/useAutonomyController.ts': `
buildNotificationMessageChatForwardText(message, t)
recordMessageFollowUp(buildNotificationMessageFollowUpInput(message))
`,
  'src/app/controllers/messagingAnnouncement.ts': 'export const announcement = true\n',
  'src/app/controllers/telegramMessageRouter.ts': `
shouldForwardBridgeIncomingToChat({ isOwner, text: msg.text })
detail: \`textLength=\${msg.text.length}\`
`,
  'src/app/controllers/discordMessageRouter.ts': `
shouldForwardBridgeIncomingToChat({ isOwner, text: msg.text })
detail: \`textLength=\${msg.text.length}\`
`,
  'src/app/controllers/useTelegramBridge.ts': `
if (wasVoice && msg.voiceBase64 && isOwner) {
  transcribeOwnerVoice()
}
`,
  'src/app/controllers/useDiscordBridge.ts': 'export const bridge = true\n',
  'src/app/views/PanelView.tsx': 'buildNotificationReplyDraftText(message, ti)\n',
  'electron/services/notificationBridge.js': `
const info = {
  requiresAuth: true,
  tokenFileName: WEBHOOK_TOKEN_FILE,
}
`,
  'electron/services/tencentAsr.js': `
function formatTranscriptLogMeta(text) {
  return \`chars=\${String(text ?? '').length}\`
}
console.info('[TencentASR] final transcript received:', formatTranscriptLogMeta(text))
`,
  'electron/services/ttsService.js': `
function formatSpeechTextLogMeta(text) {
  return \`chars=\${String(text ?? '').length}\`
}
console.info('[Edge-TTS] synthesize:', formatSpeechTextLogMeta(content), 'voice:', voice)
`,
  'electron/ttsStreamService.js': `
function formatStreamTextLogMeta(text) {
  return \`chars=\${String(text ?? '').length}\`
}
console.warn('[TTS-Stream] remote pcmStream ended without emitting any data:', formatStreamTextLogMeta(text))
`,
  'src/hooks/useNotificationBridge.ts': 'writeJson(AUTONOMY_NOTIFICATIONS_MESSAGES_STORAGE_KEY, sanitizeNotificationMessagesForStorage(messages))\n',
  'src/hooks/chat/assistantReply.ts': `
logVoiceEvent('sending message to assistant', { contentLength: content.length })
logVoiceEvent('assistant reply received', { responseLength: response.response.content.length })
`,
  'src/hooks/useChat.ts': `
logVoiceEvent('assistant is busy, voice transcript was not sent', { contentLength: content.length })
`,
  'src/hooks/voice/transcriptHandling.ts': `
logVoiceEvent('recognized transcript', {
  rawTranscriptLength: rawTranscript.length,
  transcriptLength: transcript.length,
  wakeWordConfigured: true,
})
`,
  'src/components/settingsSections/AutonomySection.tsx': 'Authorization: Bearer &lt;{webhookInfo.tokenFileName}\n',
  'src/lib/logger.ts': `
function summarizePrivateValue() {}
export function sanitizeLogMeta() {}
export function summarizeConsoleArguments() {}
const entry = { message: \`console \${level} event\` }
consoleOutput = original
`,
  'src/lib/privacy/bridgeMessagePrivacy.ts': 'textLength=\nmedia=\n',
  'src/lib/privacy/notificationPrivacy.ts': `
body: '',
summary: undefined
`,
  'src/vite-env.d.ts': 'getNotificationWebhookInfo(): Promise<{ requiresAuth: boolean }>\n',
}

function createMessagePrivacyFixture(overrides: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'nexus-message-privacy-audit-'))
  for (const [relativePath, baseline] of Object.entries(BASELINE_FILES)) {
    const absolutePath = join(root, relativePath)
    mkdirSync(join(absolutePath, '..'), { recursive: true })
    writeFileSync(absolutePath, overrides[relativePath] ?? baseline)
  }
  return root
}

function withMessagePrivacyFixture<T>(overrides: Record<string, string>, callback: (root: string) => T): T {
  const root = createMessagePrivacyFixture(overrides)
  try {
    return callback(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('message privacy audit passes a minimal metadata-only fixture', () => {
  withMessagePrivacyFixture({}, (root) => {
    const report = buildMessagePrivacyReport(root)

    assert.equal(report.summary.ok, true)
    assert.equal(report.summary.errors, 0)
    assert.equal(report.privacy.staticSourceOnly, true)
    assert.equal(report.privacy.readsMessageContent, false)
  })
})

test('message privacy audit rejects raw notification message persistence', () => {
  withMessagePrivacyFixture({
    'src/hooks/useNotificationBridge.ts': `
sanitizeNotificationMessagesForStorage(messages)
writeJson(AUTONOMY_NOTIFICATIONS_MESSAGES_STORAGE_KEY, messages)
`,
  }, (root) => {
    const report = buildMessagePrivacyReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(
      report.errors.unsafePatterns.some((item) => item.id === 'notification-message-storage-raw-write'),
    )
  })
})

test('message privacy audit rejects renderer-visible webhook tokens', () => {
  withMessagePrivacyFixture({
    'electron/services/notificationBridge.js': `
const info = {
  requiresAuth: true,
  tokenFileName: WEBHOOK_TOKEN_FILE,
}
return { token: 'secret' }
`,
  }, (root) => {
    const report = buildMessagePrivacyReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(
      report.errors.unsafePatterns.some((item) => item.id === 'webhook-token-returned-to-renderer'),
    )
  })
})

test('message privacy audit rejects raw speech transcript logs', () => {
  withMessagePrivacyFixture({
    'electron/services/tencentAsr.js': `
function formatTranscriptLogMeta(text) {
  return \`chars=\${String(text ?? '').length}\`
}
console.log('[TencentASR] final:', text.slice(0, 80))
`,
  }, (root) => {
    const report = buildMessagePrivacyReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(
      report.errors.unsafePatterns.some((item) => item.id === 'tencent-asr-raw-transcript-log'),
    )
  })
})

test('message privacy audit rejects raw speech synthesis text logs', () => {
  withMessagePrivacyFixture({
    'electron/services/ttsService.js': `
function formatSpeechTextLogMeta(text) {
  return \`chars=\${String(text ?? '').length}\`
}
console.info('[Edge-TTS] synthesize:', content.slice(0, 40), 'voice:', voice)
`,
  }, (root) => {
    const report = buildMessagePrivacyReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(
      report.errors.unsafePatterns.some((item) => item.id === 'edge-tts-raw-speech-log'),
    )
  })
})

test('message privacy audit rejects raw TTS stream text logs', () => {
  withMessagePrivacyFixture({
    'electron/ttsStreamService.js': `
function formatStreamTextLogMeta(text) {
  return \`chars=\${String(text ?? '').length}\`
}
console.warn(
  '[TTS-Stream] remote pcmStream ended without emitting any data for text:',
  text?.slice(0, 80),
)
`,
  }, (root) => {
    const report = buildMessagePrivacyReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(
      report.errors.unsafePatterns.some((item) => item.id === 'tts-stream-raw-speech-log'),
    )
  })
})

test('message privacy audit rejects raw renderer chat metadata', () => {
  withMessagePrivacyFixture({
    'src/hooks/chat/assistantReply.ts': `
logVoiceEvent('sending message to assistant', { content })
logVoiceEvent('assistant reply received', { responseLength: response.response.content.length })
`,
  }, (root) => {
    const report = buildMessagePrivacyReport(root)

    assert.equal(report.summary.ok, false)
    assert.ok(
      report.errors.unsafePatterns.some((item) => item.id === 'renderer-private-log-metadata:content'),
    )
  })
})
