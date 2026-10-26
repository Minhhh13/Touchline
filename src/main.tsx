import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import { App } from './ui/App'
import './ui/styles.css'
import './ui/mobile.css'
import { onlineConfig } from './online/config'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Native builds already bundle the game and packs; the service worker is for the web deploy only.
if (import.meta.env.PROD && !Capacitor.isNativePlatform() && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => undefined)
  })
}

// The online layer loads only when this build carries a Supabase project (CLAUDE.md invariant 13). The first two
// tests are constants Vite folds, so a build without the variables does not even emit the layer's chunks.
if (import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY && onlineConfig()) void import('./online/boot')
