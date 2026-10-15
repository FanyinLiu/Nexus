/**
 * Voice language choices are the locales Nexus already ships.
 * A stored tag outside that set stays selectable so an upgrade does
 * not blank a working custom value.
 */

import { UI_LANGUAGE_OPTIONS } from '../lib/uiLanguage.ts'
import {
  migrateVoiceLanguageValue,
  VOICE_LANGUAGES,
} from '../features/voiceProfile/voiceLanguages.ts'

type VoiceLanguageSelectProps = {
  value: string
  onChange: (value: string) => void
}

export function VoiceLanguageSelect({ value, onChange }: VoiceLanguageSelectProps) {
  const migrated = migrateVoiceLanguageValue(value)
  const options: Array<{ value: string, label: string }> = VOICE_LANGUAGES.map((language) => ({
    value: language,
    label: UI_LANGUAGE_OPTIONS.find((option) => option.value === language)?.nativeLabel ?? language,
  }))
  if (migrated.value && !migrated.canonical) {
    options.push({ value: migrated.value, label: migrated.value })
  }
  const selected = options.some((option) => option.value === migrated.value)
    ? migrated.value
    : 'zh-CN'

  return (
    <select value={selected} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  )
}
