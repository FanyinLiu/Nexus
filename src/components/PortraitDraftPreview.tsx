import { useState } from 'react'
import type { PortraitPreview } from '../../shared/portraitPreview.js'
import { portraitPreviewMotion } from '../features/pet/portraitPreviewMotion.ts'
import { SettingsV3Toolbar } from '../features/settingsV3/SettingsV3Primitives.tsx'
import { useDocumentHidden } from '../hooks/useDocumentHidden.ts'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion.ts'
import { pickTranslatedUiText } from '../lib/uiLanguage.ts'
import type { UiLanguage } from '../types/i18n.ts'

export function PortraitDraftPreview({ preview, active, language }: { preview: PortraitPreview; active: boolean; language: UiLanguage }) {
  const [requested, setRequested] = useState(false)
  const [decoded, setDecoded] = useState({ width: 0, height: 0, failed: false })
  const hidden = useDocumentHidden()
  const reducedMotion = usePrefersReducedMotion()
  const motion = portraitPreviewMotion({ preview, decodedWidth: decoded.width, decodedHeight: decoded.height, failed: decoded.failed, requested, active, hidden, reducedMotion })
  const t = (key: Parameters<typeof pickTranslatedUiText>[1]) => pickTranslatedUiText(language, key)

  return (
    <figure className="settings-v3-portrait-preview" data-testid="portrait-draft-preview">
      <div className="settings-v3-portrait-preview__stage">
        <img src={preview.dataUrl} width={preview.width} height={preview.height} alt={t('settings.chat.portrait_flow.preview_alt')} draggable={false}
          data-testid="portrait-preview-image" data-moving={motion.moving}
          onLoad={(event) => setDecoded({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight, failed: false })}
          onError={() => setDecoded({ width: 0, height: 0, failed: true })} />
      </div>
      <figcaption>
        <strong>{t('settings.chat.portrait_flow.preview_title')}</strong>
        <p>{t('settings.chat.portrait_flow.preview_hint')}</p>
        <p role="status" aria-live="polite" data-testid="portrait-preview-status">{t(motion.messageKey)}</p>
      </figcaption>
      <SettingsV3Toolbar>
        <button type="button" data-testid="portrait-preview-motion" aria-pressed={motion.moving} disabled={!motion.canStart} onClick={() => setRequested(!motion.moving)}>{t(motion.moving ? 'settings.chat.portrait_flow.preview_pause' : 'settings.chat.portrait_flow.preview_start')}</button>
      </SettingsV3Toolbar>
    </figure>
  )
}
