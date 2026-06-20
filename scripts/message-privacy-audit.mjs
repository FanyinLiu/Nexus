#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const CHECKED_FILES = [
  'src/app/controllers/useAutonomyController.ts',
  'src/app/controllers/messagingAnnouncement.ts',
  'src/hooks/useNotificationBridge.ts',
  'src/lib/privacy/notificationPrivacy.ts',
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
    id: 'notification-message-storage-raw-write',
    file: 'src/hooks/useNotificationBridge.ts',
    pattern: /writeJson\(\s*AUTONOMY_NOTIFICATIONS_MESSAGES_STORAGE_KEY\s*,\s*messages\s*\)/,
    message: 'notification messages must be sanitized before renderer localStorage persistence',
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
