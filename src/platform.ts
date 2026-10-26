import { Capacitor } from '@capacitor/core'

interface ShareLocation {
  origin: string
  pathname: string
}

/** Shared challenges must open the public game, never a native WebView's private localhost URL. */
export function shareLocation(loc: ShareLocation = location, native = Capacitor.isNativePlatform()): ShareLocation {
  return native ? { origin: 'https://touchline.quest', pathname: '/' } : { origin: loc.origin, pathname: loc.pathname }
}
