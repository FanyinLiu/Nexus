/**
 * Settings drawer chrome: window title, language picker, and close control.
 * The language menu keeps its original trigger/menu DOM here so the focus
 * audit contract and menuitemradio semantics stay in one place.
 */

import { UI_LANGUAGE_OPTIONS } from '../../lib/index.ts'
import { PetControlIcon } from '../PetControlIcon.tsx'
import type { useSettingsLanguageControl } from '../settingsDrawerHooks/useSettingsLanguageControl.ts'
import type { AppSettings, Translator } from '../../types/index.ts'

type SettingsLanguageControl = ReturnType<typeof useSettingsLanguageControl>

export type SettingsDrawerHeaderProps = {
  activeSectionLabel: string
  companionName: string
  language: AppSettings['uiLanguage']
  languageControl: SettingsLanguageControl
  settingsView: 'home' | 'section'
  ti: Translator
  onDismiss: () => void
}

export function SettingsDrawerHeader({
  activeSectionLabel,
  companionName,
  language,
  languageControl,
  settingsView,
  ti,
  onDismiss,
}: SettingsDrawerHeaderProps) {
  const {
    languageMenuOpen,
    selectedLanguageIndex,
    languageMenuId,
    languageButtonRef,
    languageMenuRef,
    languageOptionRefs,
    openLanguageMenuAt,
    closeLanguageMenuAndRestoreFocus,
    handleLanguageButtonKeyDown,
    handleLanguageMenuItemKeyDown,
    handleSelectLanguage,
  } = languageControl

  return (
    <div
      className="settings-drawer__header sdh"
      // Body and header share z-index:1; later body paints over the absolute
      // language menu. Elevate only while the menu is open so menuitemradio
      // clicks hit the options instead of settings-home-presence.
      style={languageMenuOpen ? { zIndex: 5 } : undefined}
    >
      <div className="settings-drawer__header-main sdhm">
        <div className="settings-drawer__title-stack sdt">
          <h3 className="settings-drawer__window-title">
            <span className="settings-drawer__window-title-name">
              {ti('settings.title')}
            </span>
            <span className="settings-drawer__window-title-label">
              {settingsView === 'home' ? companionName : activeSectionLabel}
            </span>
          </h3>
        </div>

        <div className="settings-drawer__toolbar sdtb">
          <div className="settings-drawer__language-control" ref={languageMenuRef}>
            <button
              ref={languageButtonRef}
              type="button"
              className="settings-drawer__language-button"
              aria-haspopup="menu"
              aria-expanded={languageMenuOpen}
              aria-controls={languageMenuId}
              aria-label={ti('settings.language_menu.aria_label')}
              title={ti('settings.language_menu.aria_label')}
              onClick={() => {
                if (languageMenuOpen) {
                  closeLanguageMenuAndRestoreFocus()
                  return
                }
                openLanguageMenuAt(selectedLanguageIndex)
              }}
              onKeyDown={handleLanguageButtonKeyDown}
            >
              <svg
                className="settings-drawer__language-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M3 12h18" />
                <path d="M12 3c2.8 3.2 4.2 6.2 4.2 9s-1.4 5.8-4.2 9c-2.8-3.2-4.2-6.2-4.2-9S9.2 6.2 12 3z" />
              </svg>
            </button>
            {languageMenuOpen ? (
              <ul
                id={languageMenuId}
                className="settings-drawer__language-menu"
                role="menu"
                aria-label={ti('settings.language_menu.aria_label')}
              >
                {UI_LANGUAGE_OPTIONS.map((option, optionIndex) => {
                  const isActive = option.value === language
                  return (
                    <li key={option.value} role="none">
                      <button
                        ref={(node) => {
                          languageOptionRefs.current[optionIndex] = node
                        }}
                        type="button"
                        role="menuitemradio"
                        aria-checked={isActive}
                        tabIndex={isActive ? 0 : -1}
                        className={
                          'settings-drawer__language-menu-item'
                          + (isActive ? ' settings-drawer__language-menu-item--active' : '')
                        }
                        onClick={() => {
                          handleSelectLanguage(option.value)
                        }}
                        onKeyDown={(event) => handleLanguageMenuItemKeyDown(event, optionIndex)}
                      >
                        <span className="settings-drawer__language-menu-native">
                          {option.nativeLabel}
                        </span>
                        {option.nativeLabel !== option.englishLabel ? (
                          <span className="settings-drawer__language-menu-meta">
                            {option.englishLabel}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  )
                })}
              </ul>
            ) : null}
          </div>
          <button
            type="button"
            className="settings-drawer__icon-button settings-drawer__icon-button--danger"
            onClick={onDismiss}
            aria-label={ti('common.close')}
            title={ti('common.close')}
          >
            <PetControlIcon name="close" />
          </button>
        </div>
      </div>
    </div>
  )
}
