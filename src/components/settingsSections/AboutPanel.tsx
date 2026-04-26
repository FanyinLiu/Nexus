import { memo, useState } from 'react'
import { useUpdater } from '../../features/updater/useUpdater'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import type { UiLanguage } from '../../types'

type AboutPanelProps = {
  uiLanguage: UiLanguage
}

/**
 * About / Help panel — sits next to the updater in Console settings.
 *
 * What it covers:
 *   - App identity (name, version, project link)
 *   - FAQ for the most common "how do I..." questions
 *   - Open-source attributions
 *
 * Kept inside the Console section instead of a top-level nav entry to
 * stay consistent with UpdaterPanel / DiagnosticsPanel placement (all
 * "info about the app itself" lives together).
 */
export const AboutPanel = memo(function AboutPanel({ uiLanguage }: AboutPanelProps) {
  const ti = (key: Parameters<typeof pickTranslatedUiText>[1], params?: Record<string, string>) =>
    pickTranslatedUiText(uiLanguage, key, params)
  const { currentVersion } = useUpdater()
  const [openFaq, setOpenFaq] = useState<number | null>(null)

  // Cap version display while loading so the layout doesn't jump.
  const versionLabel = currentVersion ?? '…'

  // FAQ entries are 1-indexed for clarity in i18n keys.
  const faqIds = [1, 2, 3, 4, 5, 6] as const

  return (
    <section className="settings-about-panel">
      <header className="settings-about-panel__header">
        <h4 className="settings-about-panel__title">{ti('about.title')}</h4>
        <p className="settings-about-panel__tagline">{ti('about.tagline')}</p>
        <p className="settings-about-panel__version">
          {ti('about.version_label')} <code>{versionLabel}</code>
        </p>
      </header>

      <div className="settings-about-panel__links">
        <a
          className="settings-about-panel__link"
          href="https://github.com/FanyinLiu/Nexus"
          target="_blank"
          rel="noopener noreferrer"
        >
          {ti('about.links.github')}
        </a>
        <a
          className="settings-about-panel__link"
          href="https://github.com/FanyinLiu/Nexus/issues/new"
          target="_blank"
          rel="noopener noreferrer"
        >
          {ti('about.links.report_issue')}
        </a>
        <a
          className="settings-about-panel__link"
          href="https://github.com/FanyinLiu/Nexus/blob/main/CHANGELOG.md"
          target="_blank"
          rel="noopener noreferrer"
        >
          {ti('about.links.changelog')}
        </a>
      </div>

      <div className="settings-about-panel__faq">
        <h5 className="settings-about-panel__section-title">{ti('about.faq.title')}</h5>
        {faqIds.map((n) => {
          const expanded = openFaq === n
          const qKey = `about.faq.q.${n}` as Parameters<typeof pickTranslatedUiText>[1]
          const aKey = `about.faq.a.${n}` as Parameters<typeof pickTranslatedUiText>[1]
          return (
            <details
              key={n}
              className="settings-about-panel__faq-item"
              open={expanded}
              onToggle={(event) => {
                const isOpen = (event.target as HTMLDetailsElement).open
                setOpenFaq(isOpen ? n : null)
              }}
            >
              <summary className="settings-about-panel__faq-question">
                {ti(qKey)}
              </summary>
              <p className="settings-about-panel__faq-answer">{ti(aKey)}</p>
            </details>
          )
        })}
      </div>

      <div className="settings-about-panel__credits">
        <h5 className="settings-about-panel__section-title">{ti('about.credits.title')}</h5>
        <p className="settings-about-panel__credits-intro">{ti('about.credits.intro')}</p>
        <ul className="settings-about-panel__credits-list">
          <li><strong>Electron</strong> — desktop runtime</li>
          <li><strong>React 19</strong> — UI framework</li>
          <li><strong>Vite</strong> — build tool</li>
          <li><strong>pixi.js + pixi-live2d-display</strong> — Live2D rendering</li>
          <li><strong>sherpa-onnx</strong> — local STT + wake-word</li>
          <li><strong>Silero VAD</strong> — voice activity detection</li>
          <li><strong>Hugging Face Transformers.js</strong> — local embeddings</li>
        </ul>
      </div>
    </section>
  )
})
