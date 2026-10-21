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
  | 'palette'
  | 'waveform'
  | 'bookmark'
  | 'plug'
  | 'info'
  | 'laptop'
  | 'speaker'
  | 'book'
  | 'checks'
  | 'refresh'
  | 'bell'

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
    case 'palette':
      return lineIcon(
        <>
          <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
          <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
          <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
          <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
          <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
        </>,
      )
    case 'waveform':
      return lineIcon(
        <>
          <path d="M2 10v3" />
          <path d="M6 6v11" />
          <path d="M10 3v18" />
          <path d="M14 8v7" />
          <path d="M18 5v13" />
          <path d="M22 10v3" />
        </>,
      )
    case 'bookmark':
      return lineIcon(<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />)
    case 'plug':
      return lineIcon(
        <>
          <path d="M12 22v-5" />
          <path d="M9 8V2" />
          <path d="M15 8V2" />
          <path d="M18 8v5a6 6 0 0 1-6 6 6 6 0 0 1-6-6V8Z" />
        </>,
      )
    case 'info':
      return lineIcon(
        <>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </>,
      )
    case 'laptop':
      return lineIcon(
        <>
          <rect width="18" height="12" x="3" y="4" rx="2" />
          <path d="M2 20h20" />
        </>,
      )
    case 'speaker':
      return lineIcon(
        <>
          <path d="M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.6A1.4 1.4 0 0 1 5.4 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.4a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5z" />
          <path d="M16 9a5 5 0 0 1 0 6" />
          <path d="M19.4 18.4a9 9 0 0 0 0-12.8" />
        </>,
      )
    case 'book':
      return lineIcon(
        <>
          <path d="M12 7v14" />
          <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
        </>,
      )
    case 'checks':
      return lineIcon(
        <>
          <path d="m3 17 2 2 4-4" />
          <path d="m3 7 2 2 4-4" />
          <path d="M13 6h8" />
          <path d="M13 12h8" />
          <path d="M13 18h8" />
        </>,
      )
    case 'refresh':
      return lineIcon(
        <>
          <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
          <path d="M21 3v5h-5" />
          <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
          <path d="M8 16H3v5" />
        </>,
      )
    case 'bell':
      return lineIcon(
        <>
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </>,
      )
    default:
      return null
  }
}
