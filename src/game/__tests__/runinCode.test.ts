import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { runInCatalogue } from '@engine/scenario'
import { runInGameSettings } from '../logic/runin'

const u = loadTestUniverse()

describe('a run-in side is named and coded as its club', () => {
  it('takes the club name and its three-letter code, so the live table and the badges never read the name twice', () => {
    const jobs = (['title', 'europe', 'survival'] as const).flatMap((t) => runInCatalogue(u, t))
    expect(jobs.length).toBeGreaterThan(20)
    for (const job of jobs) {
      const club = u.clubById[job.clubId]
      const s = runInGameSettings(u, job, { seed: 'runin-code' })
      expect(s.teamName).toBe(club.name)
      expect(s.shortName).toBe(club.code)
      expect(s.shortName).toMatch(/^[A-Z0-9]{2,4}$/)
    }
  })
})
