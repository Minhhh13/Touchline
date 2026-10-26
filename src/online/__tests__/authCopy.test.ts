import { describe, expect, it } from 'vitest'
import { AUTH_MODES, NOTE_CREATED, NOTE_EXISTING, authCopy, authOutcomeNote } from '../core/authCopy'

describe('sign in or create account copy', () => {
  it('offers Sign in first, then Create account', () => {
    expect(AUTH_MODES.map((m) => m.value)).toEqual(['signin', 'create'])
    expect(AUTH_MODES.map((m) => m.label)).toEqual(['Sign in', 'Create account'])
  })

  it('words each option on its own and shares the code step', () => {
    const s = authCopy('signin')
    const c = authCopy('create')
    expect(s.heading).toBe('Sign in')
    expect(c.heading).toBe('Create your account')
    expect(s.submit).toBe('Email me a code')
    expect(c.submit).toBe('Create account')
    expect(s.emailHelp).toContain('6-digit code')
    expect(c.emailHelp).toContain('create your account')
    expect(c.emailHelp).toContain('no password')
    expect(s.codeLead).toBe('Enter the code we sent to')
    expect(c.codeLead).toBe(s.codeLead)
  })

  it('notes a sign-in that created an account, and a create that found one', () => {
    expect(authOutcomeNote('signin', false, false)).toBeUndefined()
    expect(authOutcomeNote('create', false, true)).toBeUndefined()
    expect(authOutcomeNote('signin', true, false)).toBe(NOTE_CREATED)
    expect(authOutcomeNote('signin', true, true)).toBeNull()
    expect(authOutcomeNote('create', true, true)).toBe(NOTE_EXISTING)
    expect(authOutcomeNote('create', true, false)).toBeNull()
  })
})
