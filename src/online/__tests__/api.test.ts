import { describe, expect, it, vi } from 'vitest'
import { loadTestUniverse } from '@engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft } from '@engine/draft'
import { createGame, dailyGameSettings } from '@game/logic/setup'
import { runQuickSeason } from '@game/logic/quick'
import { DAILY_RULES } from '@game/logic/daily'
import { challengeFromGame } from '@game/logic/challenge'
import * as api from '../api'
import { dailyStartSettings } from '../daily'

vi.hoisted(() => {
  Object.defineProperty(globalThis, 'location', { value: { origin: 'https://touchline.quest', pathname: '/', href: 'https://touchline.quest/' }, configurable: true })
})

const u = loadTestUniverse()

describe('the online API in a build without Supabase (CLAUDE.md invariant 13)', () => {
  it('is off, and every action falls back to the offline behaviour without loading anything', async () => {
    expect(api.onlineAvailable()).toBe(false)
    expect(await api.startOnline()).toBe(false)
    expect(await api.emailCode('a@b.co')).toEqual({ ok: false, message: 'Online features are not available in this build.' })
    expect(await api.saveAccount('Minh', 'VN')).toMatchObject({ ok: false })
    expect(await api.board('daily', '2026-10-25', null)).toEqual([])
    expect(await api.alltime('points', null)).toEqual([])
    expect(await api.resolveShort('K7Q2-MX9A')).toMatchObject({ ok: false })
    await expect(api.syncNow()).resolves.toBeUndefined()
  })

  it('makes the long challenge link, which works offline', async () => {
    const g = createGame({ ...dailyGameSettings(u, 'daily-2026-10-25'), mode: 'quick', seed: 'API-TEST' })
    const rng = Rng.fromState(g.rngState)
    autoDraft(u, g.draft!, rng)
    g.rngState = rng.getState()
    runQuickSeason(g, u)
    const link = await api.shareLink(challengeFromGame(g, u, 'Minh')!)
    expect(link).toMatchObject({ code: null, fallback: 'not_configured' })
    expect(link.url).toMatch(/^https:\/\/touchline\.quest\/#c=/)
  })

  it('starts the Daily exactly as before when there is no pin', () => {
    for (const day of ['2026-10-25', '2026-10-26', '2027-01-01']) {
      const seed = `daily-${day}`
      expect(dailyStartSettings(u, seed, 'Touchline XI', null)).toEqual({ settings: dailyGameSettings(u, seed), source: 'local', ranked: false })
      expect(dailyStartSettings(u, seed, 'Touchline XI', null).settings.rules.respins).toBe(DAILY_RULES.respins)
    }
  })
})
