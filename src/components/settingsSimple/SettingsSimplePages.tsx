/**
 * Five settings pages. Each one shows the short list, then a single
 * advanced disclosure with the older sections.
 */

import { useState } from 'react'
import {
  SETTINGS_SIMPLE_PAGE_SECTIONS,
  settingsPageForSection,
} from '../../features/settingsSimplify/index.ts'
import { SettingsDrawerActiveSection, type SettingsDrawerActiveSectionProps } from '../SettingsDrawerActiveSection.tsx'
import type { AppSettings } from '../../types/index.ts'
import { AboutSimplePage } from './AboutSimplePage.tsx'
import { AppearanceSimplePage } from './AppearanceSimplePage.tsx'
import { ConnectSimplePage } from './ConnectSimplePage.tsx'
import { MemorySimplePage } from './MemorySimplePage.tsx'
import { simpleTranslate } from './settingsSimpleCopy.ts'
import { SimpleAdvanced } from './settingsSimpleShared.tsx'
import { VoiceKeepTalking, VoiceSimplePage } from './VoiceSimplePage.tsx'

export type SettingsSimplePagesProps = SettingsDrawerActiveSectionProps & {
  onOpenOnboarding: () => void
  onSelectLanguage: (language: AppSettings['uiLanguage']) => void
}

export function SettingsSimplePages(props: SettingsSimplePagesProps) {
  const { onOpenOnboarding, onSelectLanguage, ...sectionProps } = props
  const page = settingsPageForSection(props.activeSectionId)
  const ti = simpleTranslate(props.draft.uiLanguage)
  const lead = SETTINGS_SIMPLE_PAGE_SECTIONS[page][0]
  const [seenPage, setSeenPage] = useState(page)
  const [advancedOpen, setAdvancedOpen] = useState(props.activeSectionId !== lead)
  if (seenPage !== page) {
    setSeenPage(page)
    setAdvancedOpen(props.activeSectionId !== lead)
  }

  return (
    <div className="settings-v3-page">
      {page === 'appearance' ? (
        <AppearanceSimplePage
          draft={props.draft}
          setDraft={props.setDraft}
          petModelPresets={props.petModelPresets}
        />
      ) : null}
      {page === 'voice' ? (
        <VoiceSimplePage
          draft={props.draft}
          setDraft={props.setDraft}
          platformProfile={props.platformProfile}
          speechVoiceOptions={props.speechVoices.speechVoiceOptions}
          onLoadSpeechVoices={() => void props.speechVoices.handleLoadSpeechVoices()}
        />
      ) : null}
      {page === 'memory' ? (
        <MemorySimplePage
          draft={props.draft}
          setDraft={props.setDraft}
          memories={props.memories}
          dailyMemoryEntries={props.dailyMemoryEntries}
          confirm={props.confirm}
          onCommitMemoryPaused={props.onCommitMemoryPaused}
          onOpenAdvanced={() => setAdvancedOpen(true)}
          onUpdateMemory={props.onUpdateMemory}
          onRemoveMemory={props.onRemoveMemory}
          onUpdateDailyEntry={props.onUpdateDailyEntry}
          onRemoveDailyEntry={props.onRemoveDailyEntry}
        />
      ) : null}
      {page === 'connect' ? (
        <ConnectSimplePage
          draft={props.draft}
          setDraft={props.setDraft}
          testing={props.connectionTests.isTesting('text')}
          saveError={props.saveError}
          onApplyTextProviderPreset={props.onApplyTextProviderPreset}
          onRunTextConnectionTest={() => void props.connectionTests.runConnectionTest('text')}
        />
      ) : null}
      {page === 'about' ? (
        <AboutSimplePage
          draft={props.draft}
          onSelectLanguage={onSelectLanguage}
          onOpenOnboarding={onOpenOnboarding}
        />
      ) : null}
      <SimpleAdvanced
        title={ti('settings.simple.advanced')}
        hint={ti(`settings.simple.advanced_${page}`)}
        open={advancedOpen}
        onOpenChange={setAdvancedOpen}
      >
        {page === 'voice' ? <VoiceKeepTalking draft={props.draft} setDraft={props.setDraft} /> : null}
        {SETTINGS_SIMPLE_PAGE_SECTIONS[page].map((sectionId) => (
          <SettingsDrawerActiveSection
            key={sectionId}
            {...sectionProps}
            activeSectionId={sectionId}
            surface="rest"
          />
        ))}
      </SimpleAdvanced>
    </div>
  )
}
