import { Component, Suspense, lazy } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import './App.css'
import { useAppController } from './controllers'
import { PetView, PanelView } from './views'

class AppErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[App] Uncaught render error:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, fontFamily: 'system-ui', color: '#333' }}>
          <h2 style={{ margin: '0 0 12px' }}>出了点问题</h2>
          <p style={{ margin: '0 0 16px', color: '#666' }}>
            应用遇到意外错误，请重启应用。
          </p>
          <pre style={{ fontSize: 12, color: '#999', whiteSpace: 'pre-wrap' }}>
            {this.state.error.message}
          </pre>
          <button
            type="button"
            style={{
              marginTop: 16,
              padding: '8px 20px',
              border: '1px solid #ccc',
              borderRadius: 6,
              background: '#fff',
              cursor: 'pointer',
            }}
            onClick={() => window.location.reload()}
          >
            重新加载
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

const SettingsDrawer = lazy(async () => {
  const module = await import('../components/SettingsDrawer')
  return { default: module.SettingsDrawer }
})

const OnboardingGuide = lazy(async () => {
  const module = await import('../features/onboarding')
  return { default: module.OnboardingGuide }
})

function App() {
  const controller = useAppController()

  const onboardingGuide = (
    <Suspense fallback={null}>
      <OnboardingGuide {...controller.overlays.onboardingGuideProps} />
    </Suspense>
  )

  const settingsDrawer = (
    <Suspense fallback={null}>
      <SettingsDrawer {...controller.overlays.settingsDrawerProps} />
    </Suspense>
  )

  if (controller.view === 'pet') {
    return (
      <AppErrorBoundary>
        <PetView
          {...controller.petView}
          onboardingGuide={onboardingGuide}
        />
      </AppErrorBoundary>
    )
  }

  return (
    <AppErrorBoundary>
      <PanelView
        {...controller.panelView}
        settingsDrawer={settingsDrawer}
        onboardingGuide={onboardingGuide}
      />
    </AppErrorBoundary>
  )
}

export default App
