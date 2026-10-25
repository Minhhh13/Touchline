import { describe, expect, it } from 'vitest'
import { shareText, type SeasonSummaryForShare } from '../awards'

const base: SeasonSummaryForShare = {
  teamName: 'Spinners',
  tier: 'CHAMPIONS',
  row: { teamId: 'user', played: 38, won: 30, drawn: 5, lost: 3, goalsFor: 90, goalsAgainst: 25, points: 95, form: [] },
  position: 1,
  cupWon: false,
  leagueSeason: 2025,
  hostClubName: 'Burnley',
  mode: 'Quick Draft',
  seed: 'K7Q2-MX9A',
}

describe('share text', () => {
  it('prints the season in order with the seed last', () => {
    const lines = shareText(base).split('\n')
    expect(lines[0]).toBe('Touchline · Quick Draft')
    expect(lines[1]).toBe('Spinners as Burnley, 2025-26')
    expect(lines[3]).toBe('30-5-3 · 95 pts · 1st')
    expect(lines.at(-1)).toBe('Seed K7Q2-MX9A')
    expect(lines).toHaveLength(6)
  })
  it('names a quick season by its team alone, never "as" a club', () => {
    expect(shareText({ ...base, hostClubName: '' }).split('\n')[1]).toBe('Spinners, 2025-26')
    expect(shareText({ ...base, hostClubName: '' })).not.toMatch(/ as /)
  })
  it('appends extra lines before the seed and skips blank ones', () => {
    const lines = shareText({ ...base, potsName: 'K. De Bruyne', extraLines: ['One nation: 🇧🇷 Brazil', '', '📜 3rd-best points total in PL history'] }).split('\n')
    expect(lines.slice(-4)).toEqual(['⭐ K. De Bruyne', 'One nation: 🇧🇷 Brazil', '📜 3rd-best points total in PL history', 'Seed K7Q2-MX9A'])
    expect(shareText(base)).toBe(shareText({ ...base, extraLines: [] }))
  })
  it('names the finish in plain words, split by the position', () => {
    const row = { ...base.row, won: 20, drawn: 8, lost: 10, points: 68 }
    expect(shareText({ ...base, tier: 'EUROPEAN', position: 4, row }).split('\n')[2]).toBe('Top 4')
    expect(shareText({ ...base, tier: 'EUROPEAN', position: 6, row }).split('\n')[2]).toBe('Top 6')
    expect(shareText({ ...base, tier: 'PERFECT', cupWon: true }).split('\n')[2]).toBe('Perfect season + Cup')
    expect(shareText({ ...base, tier: 'EUROPEAN', position: 4, row })).not.toMatch(/nights/i)
  })
})
