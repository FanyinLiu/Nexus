import type { ReactNode } from 'react'

export type SettingsCardIconKey =
  | 'console'
  | 'model'
  | 'chat'
  | 'history'
  | 'letters'
  | 'memory'
  | 'lorebooks'
  | 'voice'
  | 'window'
  | 'integrations'
  | 'tools'
  | 'autonomy'
  | 'onboarding'

/**
 * Stroke icons, same weight as the line icons already used in the panel.
 * Filled marks were easy to read as a character inside the small badge.
 */
function lineIcon(children: ReactNode) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  )
}

export function renderSettingsCardIcon(iconKey: SettingsCardIconKey): ReactNode {
  switch (iconKey) {
    case 'console':
      return lineIcon(
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="m8.5 12.2 2.2 2.2 4.8-5" />
        </>,
      )
    case 'model':
      return lineIcon(
        <>
          <path d="M12 3.2 13.5 8.1 18.4 9.6 13.5 11.1 12 16 10.5 11.1 5.6 9.6 10.5 8.1Z" />
          <path d="M18 14.2 18.7 16.4 18.9 16.6 20.8 17.3 18.7 18 18 20.2 17.3 18 15.2 17.3 17.3 16.6Z" />
        </>,
      )
    case 'chat':
      return lineIcon(
        <path d="M21 15a2 2 0 0 1-2 2H8l-4 3.5V6a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z" />,
      )
    case 'history':
      return lineIcon(
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v4.2l2.8 1.8" />
        </>,
      )
    case 'letters':
      return lineIcon(
        <>
          <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
          <path d="m4 7 8 6 8-6" />
        </>,
      )
    case 'memory':
      return lineIcon(
        <path d="M12 20.2s-6.4-3.7-6.4-8.4a3.7 3.7 0 0 1 6.4-2.5 3.7 3.7 0 0 1 6.4 2.5c0 4.7-6.4 8.4-6.4 8.4z" />,
      )
    case 'lorebooks':
      return lineIcon(
        <>
          <path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H19v16H7.5A2.5 2.5 0 0 0 5 21.5z" />
          <path d="M5 5.5A2.5 2.5 0 0 1 7.5 8H19" />
          <path d="M9 12h6M9 15h4" />
        </>,
      )
    case 'voice':
      return lineIcon(
        <>
          <rect x="9" y="3.5" width="6" height="10" rx="3" />
          <path d="M6.5 11a5.5 5.5 0 0 0 11 0" />
          <path d="M12 16.5V20" />
          <path d="M9 20h6" />
        </>,
      )
    case 'window':
      return lineIcon(
        <>
          <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
          <path d="M3.5 9h17" />
        </>,
      )
    case 'integrations':
      return lineIcon(
        <>
          <path d="M9 12a4 4 0 0 1 0-6l1.5-1.5a4 4 0 0 1 5.7 5.6L15 11" />
          <path d="M15 12a4 4 0 0 1 0 6l-1.5 1.5a4 4 0 0 1-5.7-5.6L9 13" />
        </>,
      )
    case 'tools':
      return lineIcon(
        <>
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4 4" />
        </>,
      )
    case 'autonomy':
      return lineIcon(
        <>
          <path d="M12 3.2 13.2 7.4 17.5 8.6 13.2 9.8 12 14 10.8 9.8 6.5 8.6 10.8 7.4Z" />
          <path d="M6 16h12" />
          <path d="M8 19.5h8" />
        </>,
      )
    case 'onboarding':
      return lineIcon(
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="m15.8 8.2-1.6 4.6-4.6 1.6 1.6-4.6z" />
        </>,
      )
    default:
      return null
  }
}
