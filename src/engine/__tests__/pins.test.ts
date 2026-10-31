/**
 * Pins: literal outcomes of fixed seeds, so a change that moves an existing
 * spin or pick fails here even when every statistical test still passes.
 *
 * The casual modes (and any other new feature) draw from their own place in
 * the stream and gate every new draft rule on its flag, so they must leave
 * these green unchanged. Re-baseline them only in the commit that
 * deliberately moves the stream: an `ENGINE_VERSION` bump (with its line in
 * docs/GAME_DESIGN.md section 15) or a data rebuild (a new `generatedAt`),
 * such as a later fm-depth retune, the 1992-93 packs or a change to
 * `QUICK_RULES`. Recompute the literals on that branch; never copy them.
 * Baselined on ENGINE_VERSION '4' with the 2026-10-25 packs; re-baselined on '5' (the head-to-head assistant now places
 * by positional fit: spin 3 takes the natural keeper Given, not Robinho into a cover slot; both quick wheels held), and
 * on '6' (the stamp only: the wheels and the head-to-head log draw no differently; engine 6 moved matches, not spins).
 */
import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from './helpers'
import { Rng } from '../rng'
import { autoDraft, newDraft, QUICK_RULES, type DraftState } from '../draft'
import { getFormation } from '../formations'
import { h2hAutoPick, h2hComplete, h2hSpin, newH2HDraft } from '../h2h'
import { ENGINE_VERSION } from '../version'

/** A history row as `clubId@season`, with the twist after a space when the spin had one. */
const row = (h: DraftState['history'][number]) => `${h.clubId}@${h.season}${h.twist ? ` ${h.twist}` : ''}`

describe('pins', () => {
  it('pins the stamps the literals below were computed on', () => {
    const u = loadTestUniverse()
    expect(ENGINE_VERSION).toBe('7')
    expect(u.generatedAt).toBe('2026-10-25')
  })

  it('pins the quick wheel on an England wheel', () => {
    const u = loadTestUniverse()
    const d = newDraft(getFormation('4-3-3'), { ...QUICK_RULES, leagues: ['england'] })
    autoDraft(u, d, new Rng('K7Q2-MX9A'))
    expect(d.history.map(row)).toEqual([
      'west-ham-united@2024',
      'sunderland@2015',
      'arsenal@2025 golden',
      'west-bromwich-albion@2010',
      'liverpool@2016',
      'chelsea@2008 blind',
      'arsenal@2009',
      'liverpool@2009',
      'leicester-city@2015 golden',
      'chelsea@2009',
      'chelsea@2015',
    ])
  })

  it('pins the quick wheel on a three-league wheel', () => {
    const leagues = ['england', 'spain', 'italy']
    const u = loadTestUniverse(leagues)
    const d = newDraft(getFormation('4-3-3'), { ...QUICK_RULES, leagues })
    autoDraft(u, d, new Rng('K7Q2-MX9A'))
    expect(d.history.map(row)).toEqual([
      'roma@2024',
      'empoli@2015',
      'fc-barcelona@2025 golden',
      'lecce@2010',
      'espanyol@2016',
      'middlesbrough@2008 blind',
      'birmingham-city@2009',
      'racing-santander@2009',
      'juventus@2016 golden',
      'wolverhampton-wanderers@2009',
      'newcastle-united@2015',
    ])
  })

  it('pins the head-to-head draft', () => {
    const u = loadTestUniverse()
    const f = getFormation('4-3-3')
    // The rules the store's startH2H uses
    const h = newH2HDraft([f, f], { ...QUICK_RULES, respins: 0, hardMode: false, leagues: ['england'], twists: false })
    const rng = new Rng('pin-h2h')
    while (!h2hComplete(h)) {
      h2hSpin(u, h, rng)
      for (let guard = 0; h.picking !== null && guard < 4; guard++) h2hAutoPick(u, h)
    }
    expect(h.log.slice(0, 8)).toEqual([
      'Spin 1: Manchester United 2012-13. Manager 1 picks first.',
      'Manager 1 drafts R. van Persie.',
      'Manager 2 drafts N. Vidic.',
      'Spin 2: Crystal Palace 2023-24. Manager 2 picks first.',
      'Manager 2 drafts M. Olise.',
      'Manager 1 drafts E. Eze.',
      'Spin 3: Manchester City 2008-09. Manager 1 picks first.',
      'Manager 1 drafts S. Given.',
    ])
    expect(h.log.length).toBe(33)
  })
})
