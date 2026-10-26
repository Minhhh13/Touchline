import { describe, expect, it } from 'vitest'
import { shareLocation } from '../../platform'

describe('the address shared with another manager', () => {
  it('uses the public game for native challenges, including a local WebView subpath', () => {
    for (const origin of ['capacitor://localhost', 'https://localhost']) {
      const base = shareLocation({ origin, pathname: '/index.html' }, true)
      const url = new URL(`${base.origin}${base.pathname}#c=challenge`)
      expect(url.href).toBe('https://touchline.quest/#c=challenge')
    }
  })

  it('keeps a web preview or subpath deployment on its own address', () => {
    for (const origin of ['http://localhost:4173', 'https://touchline.quest', 'https://preview.example']) {
      const base = shareLocation({ origin, pathname: '/touchline/' }, false)
      const url = new URL(`${base.origin}${base.pathname}#s=K7Q2MX9A`)
      expect(url.origin).toBe(origin)
      expect(url.pathname).toBe('/touchline/')
      expect(url.hash).toBe('#s=K7Q2MX9A')
    }
  })
})
