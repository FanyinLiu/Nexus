import { createContext } from 'react'
import type { AnalyticsContextValue } from '../../types/analytics.ts'

export const AnalyticsContext = createContext<AnalyticsContextValue | null>(null)
