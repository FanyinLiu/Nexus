import type { ReactNode } from 'react'

export function renderSettingsCardIcon(iconKey: string): ReactNode {
  switch (iconKey) {
    case 'console':
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path fill="currentColor" d="M16 4a12 12 0 1 0 0 24 12 12 0 0 0 0-24Zm5.74 8.88-6.6 7.44a1.25 1.25 0 0 1-1.83.05l-3.1-3.1a1.25 1.25 0 1 1 1.76-1.77l2.16 2.16 5.74-6.47a1.25 1.25 0 0 1 1.87 1.66Z" />
        </svg>
      )
    case 'model':
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path fill="currentColor" d="M16 4a1.5 1.5 0 0 1 1.3.76l2.38 4.12 4.62 1.1a1.5 1.5 0 0 1 .83 2.46L21.8 16l1.02 4.72a1.5 1.5 0 0 1-2.17 1.58L16 19.8l-4.65 2.5a1.5 1.5 0 0 1-2.17-1.58L10.2 16l-3.33-3.56a1.5 1.5 0 0 1 .83-2.46l4.62-1.1 2.38-4.12A1.5 1.5 0 0 1 16 4Z" />
        </svg>
      )
    case 'chat':
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path fill="currentColor" d="M7 6a4 4 0 0 0-4 4v10a4 4 0 0 0 4 4h2v4a1 1 0 0 0 1.6.8L16 24h9a4 4 0 0 0 4-4V10a4 4 0 0 0-4-4H7Zm4 9.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z" />
        </svg>
      )
    case 'history':
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path fill="currentColor" d="M16 4C9.37 4 4 9.37 4 16s5.37 12 12 12 12-5.37 12-12S22.63 4 16 4Zm1 5a1 1 0 1 0-2 0v7a1 1 0 0 0 .45.83l4 2.67a1 1 0 0 0 1.1-1.67L17 15.56V9Z" />
        </svg>
      )
    case 'letters':
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path fill="currentColor" d="M7 5.5A3.5 3.5 0 0 0 3.5 9v14A3.5 3.5 0 0 0 7 26.5h18a3.5 3.5 0 0 0 3.5-3.5V9A3.5 3.5 0 0 0 25 5.5H7Zm-.55 4.12a1 1 0 0 1 1.4-.18L16 15.56l8.15-6.12a1 1 0 1 1 1.2 1.6l-8.75 6.56a1 1 0 0 1-1.2 0l-8.75-6.56a1 1 0 0 1-.2-1.42Z" />
        </svg>
      )
    case 'memory':
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path fill="currentColor" d="M16 4a1 1 0 0 1 .86.5C18.5 7.5 22 11.24 22 15a6 6 0 0 1-5 5.91V24h3a1 1 0 1 1 0 2h-3v2a1 1 0 1 1-2 0v-2h-3a1 1 0 1 1 0-2h3v-3.09A6 6 0 0 1 10 15c0-3.76 3.5-7.5 5.14-10.5A1 1 0 0 1 16 4Z" />
        </svg>
      )
    case 'voice':
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <rect fill="currentColor" x="11" y="4" width="10" height="14" rx="5" />
          <path fill="currentColor" d="M7 15a1 1 0 0 1 2 0 7 7 0 0 0 14 0 1 1 0 1 1 2 0 9 9 0 0 1-8 8.94V27h3a1 1 0 1 1 0 2h-8a1 1 0 1 1 0-2h3v-3.06A9 9 0 0 1 7 15Z" />
        </svg>
      )
    case 'window':
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path fill="currentColor" d="M4 8a4 4 0 0 1 4-4h16a4 4 0 0 1 4 4v16a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8Zm4-1.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm4 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm4 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM4 12h24v12a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V12Z" />
        </svg>
      )
    case 'integrations':
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path fill="currentColor" d="M14 4a1 1 0 0 0-1 1v4.05A3.5 3.5 0 0 1 9.05 13H5a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h4.05A3.5 3.5 0 0 1 13 22.95V27a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-4.05A3.5 3.5 0 0 1 22.95 19H27a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1h-4.05A3.5 3.5 0 0 1 19 9.05V5a1 1 0 0 0-1-1h-4Z" />
        </svg>
      )
    case 'tools':
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path fill="currentColor" d="M14 4a10 10 0 1 0 6.32 17.74l5.47 5.47a1.5 1.5 0 0 0 2.12-2.12l-5.47-5.47A10 10 0 0 0 14 4Zm0 3a7 7 0 1 1 0 14 7 7 0 0 1 0-14Z" />
        </svg>
      )
    case 'autonomy':
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path fill="currentColor" d="M16 3a1 1 0 0 1 .87.5l2.5 4.33 4.96 1.17a1 1 0 0 1 .58 1.62L21.5 14.5l.78 5.13a1 1 0 0 1-1.45 1.05L16 18l-4.83 2.68a1 1 0 0 1-1.45-1.05l.78-5.13-3.41-3.88a1 1 0 0 1 .58-1.62l4.96-1.17 2.5-4.33A1 1 0 0 1 16 3ZM8 24a1 1 0 1 0 0 2h16a1 1 0 1 0 0-2H8Zm2 4a1 1 0 1 0 0 2h12a1 1 0 1 0 0-2H10Z" />
        </svg>
      )
    default:
      return null
  }
}
