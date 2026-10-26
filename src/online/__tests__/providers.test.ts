import { describe, expect, it } from 'vitest'
import { googleEnabledIn, googleForced } from '../core/providers'

describe('sign-in providers', () => {
  it('offers Google only when the build forces it or the project reports it enabled', () => {
    expect(googleForced('1')).toBe(true)
    for (const f of [undefined, '', '0', 'true', 'yes']) expect(googleForced(f)).toBe(false)
    // The shape of GET /auth/v1/settings on the project (2026-10-25: google false, email true)
    expect(googleEnabledIn({ external: { google: false, email: true } })).toBe(false)
    expect(googleEnabledIn({ external: { google: true, email: true } })).toBe(true)
    for (const bad of [null, undefined, 'x', 1, {}, { external: null }, { external: { google: 'true' } }]) expect(googleEnabledIn(bad)).toBe(false)
  })
})
