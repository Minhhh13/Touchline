import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './ui/App'
import './ui/styles.css'
import { onlineConfig } from './online/config'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Offline support: register the service worker on production builds only, relative to the deploy path.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => undefined)
  })
}

// The online layer loads only when this build carries a Supabase project (CLAUDE.md invariant 13)
if (onlineConfig()) void import('./online/boot')
