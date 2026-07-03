#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const CHECKED_FILES = [
  'src/app/controllers/useAutonomyController.ts',
  'src/app/controllers/messagingAnnouncement.ts',
  'src/app/controllers/telegramMessageRouter.ts',
  'src/app/controllers/discordMessageRouter.ts',
  'src/app/controllers/useTelegramBridge.ts',
  'src/app/controllers/useDiscordBridge.ts',
  'src/app/views/PanelView.tsx',
  'electron/services/notificationBridge.js',
  'electron/services/tencentAsr.js',
  'electron/services/ttsService.js',
  'electron/ttsStreamService.js',
  'src/hooks/useNotificationBridge.ts',
  'src/components/settingsSections/AutonomySection.tsx',
  'src/lib/privacy/bridgeMessagePrivacy.ts',
  'src/lib/privacy/notificationPrivacy.ts',
  'src/vite-env.d.ts',
]

const UNSAFE_PATTERNS = [
  {
    id: 'notification-message-body-forwarded-to-chat',
    file: 'src/app/controllers/useAutonomyController.ts',
    pattern: /notificationChatQueueRef\.current\?\.push\([\s\S]{0,500}message\.body/,
    message: 'desktop notification message bodies must not be pushed into chat/model forwarding',
  },
  {
    id: 'notification-message-body-topic-hint',
    file: 'src/app/controllers/useAutonomyController.ts',
    pattern: /topicHint\s*:\s*message\.body|message\.body\.slice/,
    message: 'missed-message follow-up records must not store third-party message body snippets',
  },
  {
    id: 'notification-body-chat-history-template',
    file: 'src/app/controllers/useAutonomyController.ts',
    pattern: /chat\.prefix\.notification['"]/,
    message: 'notification chat history must use a metadata-only template',
  },
  {
    id: 'message-announcement-preview-in-chat-history',
    file: 'src/app/controllers/messagingAnnouncement.ts',
    pattern: /chat\.bridge\.messaging_announcement_chat_preview/,
    message: 'message previews may be used for local bubble/TTS, not persisted chat history',
  },
  {
    id: 'notification-reply-draft-copies-message-content',
    file: 'src/app/views/PanelView.tsx',
    pattern: /handleNotificationDraft[\s\S]{0,500}(?:getNotificationSummary|message\.summary|message\.body)/,
    message: 'notification reply drafts must not copy third-party message content into the chat composer',
  },
  {
    id: 'notification-message-storage-raw-write',
    file: 'src/hooks/useNotificationBridge.ts',
    pattern: /writeJson\(\s*AUTONOMY_NOTIFICATIONS_MESSAGES_STORAGE_KEY\s*,\s*messages\s*\)/,
    message: 'notification messages must be sanitized before renderer localStorage persistence',
  },
  {
    id: 'telegram-external-text-forwarding',
    file: 'src/app/controllers/telegramMessageRouter.ts',
    pattern: /【Telegram · \$\{msg\.fromUser\}】\$\{msg\.text\}|if\s*\(\s*deps\.sendMessage\s*&&\s*msg\.text\s*\)/,
    message: 'Telegram external-contact text must not be forwarded into chat/model input',
  },
  {
    id: 'discord-external-text-forwarding',
    file: 'src/app/controllers/discordMessageRouter.ts',
    pattern: /【Discord · \$\{msg\.fromUser\}】\$\{msg\.text\}|if\s*\(\s*deps\.sendMessage\s*&&\s*msg\.text\s*\)/,
    message: 'Discord external-contact text must not be forwarded into chat/model input',
  },
  {
    id: 'telegram-raw-text-debug',
    file: 'src/app/controllers/telegramMessageRouter.ts',
    pattern: /detail:\s*`[^`]*\$\{msg\.text\}|announcement\.speechContent/,
    message: 'Telegram debug events must stay metadata-only',
  },
  {
    id: 'discord-raw-text-debug',
    file: 'src/app/controllers/discordMessageRouter.ts',
    pattern: /detail:\s*`[^`]*\$\{msg\.text\}|announcement\.speechContent/,
    message: 'Discord debug events must stay metadata-only',
  },
  {
    id: 'telegram-external-voice-transcription',
    file: 'src/app/controllers/useTelegramBridge.ts',
    pattern: /if\s*\(\s*wasVoice\s*&&\s*msg\.voiceBase64\s*\)\s*\{/,
    message: 'Telegram voice transcription must be owner-only',
  },
  {
    id: 'webhook-token-returned-to-renderer',
    file: 'electron/services/notificationBridge.js',
    pattern: /return\s*\{\s*[\s\S]{0,260}\btoken\b|authHeader\s*:/,
    message: 'notification webhook info must not return bearer token material to the renderer',
  },
  {
    id: 'webhook-token-typed-in-renderer',
    file: 'src/vite-env.d.ts',
    pattern: /getNotificationWebhookInfo[\s\S]{0,260}(?:\btoken:\s*string|authHeader:\s*string)/,
    message: 'renderer webhook info type must not expose bearer token material',
  },
  {
    id: 'webhook-token-rendered-in-settings',
    file: 'src/components/settingsSections/AutonomySection.tsx',
    pattern: /webhookInfo\?\.authHeader|Authorization:\s*\{webhookInfo/,
    message: 'settings UI must not render the plaintext notification webhook token',
  },
  {
    id: 'tencent-asr-raw-transcript-log',
    file: 'electron/services/tencentAsr.js',
    pattern: /console\.(?:log|info|warn|error)\([^\n]*(?:text\.slice|voice_text_str)|console\.(?:log|info|warn|error)\([^\n]*,\s*text\b/,
    message: 'speech recognition logs must stay metadata-only and never include transcript snippets',
  },
  {
    id: 'edge-tts-raw-speech-log',
    file: 'electron/services/ttsService.js',
    pattern: /console\.(?:log|info|warn|error)\([^\n]*(?:content\.slice|text\.slice)|console\.(?:log|info|warn|error)\([^\n]*,\s*content\b/,
    message: 'speech synthesis logs must stay metadata-only and never include text-to-speech content snippets',
  },
  {
    id: 'tts-stream-raw-speech-log',
    file: 'electron/ttsStreamService.js',
    pattern: /console\.(?:log|info|warn|error)\([\s\S]{0,260}(?:text\?\.slice|text\.slice)|console\.(?:log|info|warn|error)\([\s\S]{0,180},\s*text\b/,
    message: 'TTS stream support logs must stay metadata-only and never include speech text snippets',
  },
]

const REQUIRED_PHRASES = [
  {
    id: 'notification-forward-helper-used',
    file: 'src/app/controllers/useAutonomyController.ts',
    phrases: ['buildNotificationMessageChatForwardText(message, t)'],
  },
  {
    id: 'notification-follow-up-helper-used',
    file: 'src/app/controllers/useAutonomyController.ts',
    phrases: ['recordMessageFollowUp(buildNotificationMessageFollowUpInput(message))'],
  },
  {
    id: 'notification-storage-sanitizer-used',
    file: 'src/hooks/useNotificationBridge.ts',
    phrases: ['sanitizeNotificationMessagesForStorage(messages)'],
  },
  {
    id: 'notification-storage-body-stripped',
    file: 'src/lib/privacy/notificationPrivacy.ts',
    phrases: ['body: \'\',', 'summary: undefined'],
  },
  {
    id: 'notification-reply-draft-helper-used',
    file: 'src/app/views/PanelView.tsx',
    phrases: ['buildNotificationReplyDraftText(message, ti)'],
  },
  {
    id: 'telegram-owner-only-forwarding',
    file: 'src/app/controllers/telegramMessageRouter.ts',
    phrases: ['shouldForwardBridgeIncomingToChat({ isOwner, text: msg.text })'],
  },
  {
    id: 'discord-owner-only-forwarding',
    file: 'src/app/controllers/discordMessageRouter.ts',
    phrases: ['shouldForwardBridgeIncomingToChat({ isOwner, text: msg.text })'],
  },
  {
    id: 'bridge-debug-metadata-helper',
    file: 'src/lib/privacy/bridgeMessagePrivacy.ts',
    phrases: ['textLength=', 'media='],
  },
  {
    id: 'telegram-owner-only-voice-transcription',
    file: 'src/app/controllers/useTelegramBridge.ts',
    phrases: ['if (wasVoice && msg.voiceBase64 && isOwner)'],
  },
  {
    id: 'webhook-info-token-file-only',
    file: 'electron/services/notificationBridge.js',
    phrases: ['requiresAuth: true', 'tokenFileName: WEBHOOK_TOKEN_FILE'],
  },
  {
    id: 'webhook-settings-token-placeholder',
    file: 'src/components/settingsSections/AutonomySection.tsx',
    phrases: ['Authorization: Bearer &lt;{webhookInfo.tokenFileName'],
  },
  {
    id: 'tencent-asr-transcript-log-metadata',
    file: 'electron/services/tencentAsr.js',
    phrases: ['formatTranscriptLogMeta(text)', 'chars=${String(text ?? \'\').length}'],
  },
  {
    id: 'edge-tts-speech-log-metadata',
    file: 'electron/services/ttsService.js',
    phrases: ['formatSpeechTextLogMeta(content)', 'chars=${String(text ?? \'\').length}'],
  },
  {
    id: 'tts-stream-speech-log-metadata',
    file: 'electron/ttsStreamService.js',
    phrases: ['formatStreamTextLogMeta(text)', 'chars=${String(text ?? \'\').length}'],
  },
]

function readText(root, path) {
  return readFileSync(join(root, path), 'utf8')
}

export function buildMessagePrivacyReport(root = ROOT) {
  const missingFiles = []
  const unsafePatterns = []
  const missingRequiredPhrases = []
  const sourceByFile = new Map()

  for (const file of CHECKED_FILES) {
    const fullPath = join(root, file)
    if (!existsSync(fullPath)) {
      missingFiles.push({ file })
      continue
    }
    sourceByFile.set(file, readText(root, file))
  }

  for (const item of UNSAFE_PATTERNS) {
    const source = sourceByFile.get(item.file)
    if (!source) continue
    if (item.pattern.test(source)) {
      unsafePatterns.push({
        id: item.id,
        file: item.file,
        message: item.message,
      })
    }
  }

  for (const item of REQUIRED_PHRASES) {
    const source = sourceByFile.get(item.file)
    if (!source) continue
    for (const phrase of item.phrases) {
      if (!source.includes(phrase)) {
        missingRequiredPhrases.push({ id: item.id, file: item.file, phrase })
      }
    }
  }

  const errors = { missingFiles, unsafePatterns, missingRequiredPhrases }
  const errorCount = Object.values(errors).reduce((sum, list) => sum + list.length, 0)

  return {
    checkedFiles: CHECKED_FILES,
    errors,
    summary: {
      ok: errorCount === 0,
      errors: errorCount,
      warnings: 0,
    },
    privacy: {
      staticSourceOnly: true,
      readsUserData: false,
      readsMessageContent: false,
    },
  }
}

function formatHumanReport(report) {
  const lines = ['Message privacy audit']
  lines.push(`- checked files: ${report.checkedFiles.length}`)
  lines.push(`- static source only: ${report.privacy.staticSourceOnly}`)
  lines.push('')
  for (const [name, items] of Object.entries(report.errors)) {
    lines.push(`ERROR ${name}: ${items.length}`)
    if (items.length) {
      lines.push(`  ${items.slice(0, 8).map((item) => `${item.file}: ${item.id ?? item.phrase ?? item.message}`).join(', ')}`)
    }
  }
  lines.push('')
  lines.push(`Summary: ok=${report.summary.ok} errors=${report.summary.errors}`)
  return lines.join('\n')
}

function main(argv) {
  const report = buildMessagePrivacyReport(ROOT)
  const json = argv.includes('--json') || argv.includes('--format=json')
  process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : `${formatHumanReport(report)}\n`)
  if (!report.summary.ok) process.exit(1)
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (invokedPath && resolve(fileURLToPath(import.meta.url)) === invokedPath) {
  main(process.argv.slice(2))
}
