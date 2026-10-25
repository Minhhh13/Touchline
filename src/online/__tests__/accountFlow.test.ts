import { describe, expect, it } from 'vitest'
import { checkDisplayName, nameVerdictFrom } from '../auth'
import { ago, savedLine } from '../core/status'

describe('the profile setup step: the name rules mirror the database', () => {
  it('checks locally what profiles and private.is_clean_name refuse, with kind messages', () => {
    expect(checkDisplayName('  Gina   Tactics ')).toEqual({ ok: true, name: 'Gina Tactics' })
    expect(checkDisplayName('Ga')).toMatchObject({ ok: false, message: 'A name needs at least 3 characters.' })
    expect(checkDisplayName('x'.repeat(25))).toMatchObject({ ok: false, message: 'A name is at most 24 characters.' })
    expect(checkDisplayName('<b>Hal</b>')).toMatchObject({ ok: false })
    // a zero-width space and a bidi override: look-alikes the boards refuse
    expect(checkDisplayName('Gina​ Tactics')).toMatchObject({ ok: false, message: 'Use visible letters, digits and punctuation only.' })
    expect(checkDisplayName('Gina ‮Tactics')).toMatchObject({ ok: false })
  })

  it('reads display_name_check: free, taken, a server-side refusal said kindly, and no answer at all', () => {
    expect(nameVerdictFrom('Hal 9000', { name: 'Hal 9000', available: true })).toEqual({ state: 'free', name: 'Hal 9000' })
    expect(nameVerdictFrom('gina tactics', { available: false, reason: 'taken' })).toEqual({ state: 'taken', name: 'gina tactics' })
    expect(nameVerdictFrom('Gina Tactics', { available: false, reason: 'shape' })).toMatchObject({ state: 'invalid' })
    // offline, or the migration not applied yet: saving still checks, the step never blocks on it
    for (const reply of [null, undefined, {}, 'x', { available: 'yes' }]) expect(nameVerdictFrom('Hal 9000', reply)).toEqual({ state: 'unknown', name: 'Hal 9000' })
    // the local rules win before any server answer
    expect(nameVerdictFrom('Ga', { available: true })).toMatchObject({ state: 'invalid' })
  })
})

describe('the save status line', () => {
  const now = Date.UTC(2026, 9, 25, 12)
  it('says when the account was last saved, in short words', () => {
    expect(ago(now - 10_000, now)).toBe('just now')
    expect(ago(now - 2 * 60_000, now)).toBe('2 min ago')
    expect(ago(now - 3 * 3_600_000, now)).toBe('3 h ago')
    expect(ago(now - 26 * 3_600_000, now)).toBe('1 day ago')
    expect(savedLine('idle', new Date(now - 120_000).toISOString(), now)).toEqual({ text: 'Saved to your account ✓ · 2 min ago', tone: 'good' })
  })
  it('says what is happening instead when it is not saved', () => {
    expect(savedLine('syncing', null, now).tone).toBe('busy')
    expect(savedLine('offline', null, now).text).toMatch(/^Offline: saved on this device/)
    expect(savedLine('paused', null, now).text).toMatch(/Sync now/)
    expect(savedLine('error', null, now).tone).toBe('warn')
    expect(savedLine('idle', null, now)).toEqual({ text: 'Getting your account ready…', tone: 'busy' })
  })
})
