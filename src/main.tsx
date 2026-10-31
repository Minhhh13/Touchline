import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import { App } from './ui/App'
import './ui/styles.css'
import './ui/mobile.css'
import { onlineConfig } from './online/config'
import { whenScreensFetched } from './ui/lazyScreens'
import { startLanguage } from './ui/i18n/language'

// The viewer's language (Profile, Settings): English at once, a translation as soon as its chunk arrives
startLanguage()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Offline support: register the service worker on production builds only, relative to the deploy path. It caches
// every built asset as it installs (public/sw.js), so it waits for the screens' chunks first (`prefetchScreens`, 30 s
// at most): on a slow first visit the install then finds them in the HTTP cache and never competes with the
// download that puts Home on screen or the first tap's chunk.
// Native builds already bundle the game and packs; the service worker is for the web deploy only.
if (import.meta.env.PROD && !Capacitor.isNativePlatform() && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const register = () => void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => undefined)
    void Promise.race([whenScreensFetched(), new Promise((resolve) => setTimeout(resolve, 30_000))]).then(register)
  })
}

// The online layer loads only when this build carries a Supabase project (CLAUDE.md invariant 13). The first two
// tests are constants Vite folds, so a build without the variables does not even emit the layer's chunks.
if (import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY && onlineConfig()) void import('./online/boot')
