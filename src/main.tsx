/**
 * main.tsx — Nerve application entry point.
 *
 * Mounts the React root and wraps {@link App} in the provider hierarchy:
 * ErrorBoundary → StrictMode → Gateway → Settings → Session → Chat.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { GatewayProvider } from '@/contexts/GatewayContext'
import { SettingsProvider } from '@/contexts/SettingsContext'
import { SessionProvider } from '@/contexts/SessionContext'
import { ChatProvider } from '@/contexts/ChatContext'

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <StrictMode>
      <GatewayProvider>
        <SettingsProvider>
          <SessionProvider>
            <ChatProvider>
              <App />
            </ChatProvider>
          </SessionProvider>
        </SettingsProvider>
      </GatewayProvider>
    </StrictMode>
  </ErrorBoundary>,
)
