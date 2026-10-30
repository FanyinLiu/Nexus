import { useEffect, type ReactNode } from 'react'
import { initApp } from '../bootstrap'
import { I18nProvider } from './I18nProvider.tsx'
import { ThemeProvider } from './ThemeProvider.tsx'

type AppProvidersProps = {
  children: ReactNode
}

export function AppProviders({ children }: AppProvidersProps) {
  useEffect(() => {
    void initApp()
  }, [])

  return (
    <ThemeProvider>
      <I18nProvider>{children}</I18nProvider>
    </ThemeProvider>
  )
}
