export const SHORT_TEXT_MAX = 256
export const URL_TEXT_MAX = 2_048
export const SECRET_TEXT_MAX = 20_000
export const BODY_TEXT_MAX = 20_000
export const TEXT_FILE_CONTENT_MAX = 10_000_000
export const AUDIO_BASE64_MAX = 50_000_000
export const PATH_TEXT_MAX = 4_096
export const CHAT_MESSAGE_TEXT_MAX = 200_000
export const SAFE_SKILL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
export const SAFE_FILE_EXTENSION_PATTERN = /^[A-Za-z0-9*][A-Za-z0-9+._-]{0,31}$/

export const optionalBoolean = { type: 'boolean', optional: true }
export const optionalShortString = {
  type: 'string',
  optional: true,
  maxLength: SHORT_TEXT_MAX,
  clamp: true,
}

export const integrationPermissionModeSchema = {
  type: 'enum',
  values: ['read-only', 'confirm', 'auto'],
}
