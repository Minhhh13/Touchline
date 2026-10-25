import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { assistantChoice, assistantTurn, autoDraft, bottomHalf, canSpin, chooseSlot, CRAZY_SURPRISE_CHANCE, forcedSlotOf, hasLegend, isComplete, LEGENDS_RATING, modesOf, newDraft, picksMade, pick, QUICK_RULES, spin, targetSlot, TWISTS, type DraftRules, type QuickMode } from '@engine/draft'
import { activeModeCards, crazyFormation, MODE_CARDS, modesLine, toggleModeCard, withModes } from '@engine/modes'
import { decodeChallenge, encodeChallenge, isRulesDiff, rulesDiff, rulesFromPayload } from '@engine/challenge'
import { FORMATIONS, getFormation } from '@engine/formations'
import { canCover } from '@engine/positions'
import type { LoadedUniverse } from '@engine/universe'
import { createGame, describeRules, setupRules, startFormation, summariseSetup, type SetupChoices } from '../logic/setup'
import { challengeFromGame, replayChallenge } from '../logic/challenge'
import { kickOff, toKickoff } from '../logic/quick'
import type { Game, GameSettings } from '../types'

const u = loadTestUniverse(['england'])

function rules(modes: QuickMode[], extra: Partial<DraftRules> = {}): DraftRules {
  return { ...QUICK_RULES, leagues: ['england'], ...(modes.length ? { modes } : {}), ...extra }
}

function settings(partial: Partial<GameSettings> = {}): GameSettings {
  return { mode: 'quick', seed: 'MODES-1', formationId: '4-3-3', teamName: 'Modes XI', shortName: 'MXI', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2025, rules: rules([]), jobSecurity: false, difficulty: 'calibrated', january: false, ...partial }
}

/** A game drafted by the assistant, then (when `season`) played to the summary. */
function drafted(partial: Partial<GameSettings>, season = false, universe: LoadedUniverse = u): Game {
  const g = createGame(settings(partial))
  const rng = Rng.fromState(g.rngState)
  autoDraft(universe, g.draft!, rng)
  g.rngState = rng.getState()
  if (season) {
    toKickoff(g, universe)
    kickOff(g, universe, true)
  }
  return g
}

const landed = (g: Game) => g.draft!.history.map((h) => u.clubSeasonByKey[`${h.clubId}@${h.season}`])

describe('the Modes row', () => {
  it('toggles cards on and off, several at once, Underdog and Legends excluding each other', () => {
    let on = toggleModeCard([], 'crazy')
    on = toggleModeCard(on, 'speedrun')
    on = toggleModeCard(on, 'hard')
    expect(on).toEqual(['crazy', 'hard', 'speedrun'])
    on = toggleModeCard(on, 'underdog')
    expect(on).toEqual(['crazy', 'hard', 'underdog', 'speedrun'])
    on = toggleModeCard(on, 'legends')
    expect(on).toEqual(['crazy', 'hard', 'legends', 'speedrun'])
    expect(toggleModeCard(on, 'crazy')).toEqual(['hard', 'legends', 'speedrun'])
    expect(MODE_CARDS).toEqual(['crazy', 'hard', 'underdog', 'legends', 'speedrun'])
  })

  it('links the Hard card to the difficulty both ways', () => {
    const hard = withModes(QUICK_RULES, ['hard'])
    expect(hard).toMatchObject({ difficulty: 'hard', respins: 0, hardMode: true, showRatings: false })
    expect(activeModeCards(hard)).toEqual(['hard'])
    const back = withModes(hard, [])
    expect(back).toMatchObject({ difficulty: 'normal', respins: 1, hardMode: false, showRatings: true })
    expect(back.modes).toBeUndefined()
    // The Difficulty cards set hard and the Hard card shows on
    const choices: SetupChoices = { difficulty: 'hard', showRatings: true, draftMode: 'squad', ratings: 'season', eraFrom: 2008, eraTo: 2026, first: 2008, last: 2026, twists: false, leagues: ['england'], modes: ['underdog'] }
    const r = setupRules(QUICK_RULES, choices)
    expect(activeModeCards(r)).toEqual(['hard', 'underdog'])
    expect(r.modes).toEqual(['underdog'])
    expect(setupRules(QUICK_RULES, { ...choices, modes: ['crazy'], difficulty: 'easy' })).toMatchObject({ difficulty: 'easy', respins: 3, twists: true, modes: ['crazy'] })
    // No modes: the rules are exactly what they were before the row existed
    expect(setupRules(QUICK_RULES, { ...choices, modes: [] })).not.toHaveProperty('modes')
  })

  it('names the modes in the setup line, the fixed-rules pills and the share line', () => {
    const r = rules(['crazy', 'speedrun'], { difficulty: 'hard', hardMode: true, respins: 0, showRatings: false })
    expect(modesLine(r)).toBe('🌀 Crazy · 💀 Hard · ⏱️ Speedrun')
    expect(describeRules(u, r)).toEqual(expect.arrayContaining(['🌀 Crazy', '⏱️ Speedrun']))
    const line = summariseSetup(u, settings({ seed: 'S', rules: r }))
    expect(line).toContain('crazy mode')
    expect(line).toContain('speedrun mode')
    expect(line).toContain('hard mode')
    expect(modesLine(rules([]))).toBe('')
    expect(modesOf({ ...QUICK_RULES, modes: ['speedrun', 'crazy', 'crazy'] })).toEqual(['crazy', 'speedrun'])
  })
})

describe('Underdog', () => {
  it('lands only on bottom-half sides, by the final table', () => {
    for (let i = 0; i < 30; i++) {
      const g = drafted({ seed: `UNDER-${i}`, rules: rules(['underdog']) })
      expect(isComplete(g.draft!)).toBe(true)
      for (const cs of landed(g)) {
        const n = u.tables[cs.leagueId]![cs.season]!.length
        expect(cs.position, `${cs.clubId} ${cs.season}`).toBeGreaterThan(n / 2)
      }
    }
  })

  it('ranks a league without tables by squad strength, half of each season', () => {
    const fr = loadTestUniverse(['france'])
    const groups = new Map<number, number>()
    for (const cs of fr.clubSeasons) if (bottomHalf(fr, cs)) groups.set(cs.season, (groups.get(cs.season) ?? 0) + 1)
    for (const season of new Set(fr.clubSeasons.map((cs) => cs.season))) {
      const all = fr.clubSeasons.filter((cs) => cs.season === season).length
      expect(groups.get(season) ?? 0).toBe(all - Math.ceil(all / 2))
    }
    const g = drafted({ seed: 'UNDER-FR', leagueId: 'france', wheelLeagues: ['france'], hostClubId: fr.clubSeasons[0].clubId, leagueSeason: fr.clubSeasons[0].season, rules: { ...rules(['underdog']), leagues: ['france'] } }, false, fr)
    expect(isComplete(g.draft!)).toBe(true)
  })
})

describe('Legends', () => {
  it(`lands only on club-seasons with a ${LEGENDS_RATING}+ player`, () => {
    for (let i = 0; i < 30; i++) {
      const g = drafted({ seed: `LEGEND-${i}`, rules: rules(['legends']) })
      expect(isComplete(g.draft!)).toBe(true)
      for (const cs of landed(g)) expect(hasLegend(cs)).toBe(true)
    }
  })
})

describe('Crazy', () => {
  it('puts a twist on every spin', () => {
    for (let i = 0; i < 20; i++) {
      const g = drafted({ seed: `CRAZY-${i}`, rules: rules(['crazy']) })
      expect(isComplete(g.draft!)).toBe(true)
      for (const h of g.draft!.history) expect(TWISTS).toContain(h.twist)
    }
  })

  it('draws the formation from the seed, the same every time, across the shapes', () => {
    expect(crazyFormation('K7Q2-MX9A')).toBe(crazyFormation('K7Q2-MX9A'))
    const shapes = new Set(Array.from({ length: 200 }, (_, i) => crazyFormation(`shape-${i}`)))
    expect(shapes.size).toBeGreaterThanOrEqual(Math.min(6, FORMATIONS.length))
    for (const id of shapes) expect(getFormation(id).id).toBe(id)
  })

  it('rolls surprises from its own stream, near the stated chance, and never moves the game stream', () => {
    // The game's stream starts the same with Crazy on or off
    expect(createGame(settings({ rules: rules(['crazy']) })).rngState).toEqual(createGame(settings()).rngState)
    let rolls = 0
    let hits = 0
    const kinds = new Set<string>()
    for (let i = 0; i < 60; i++) {
      const g = createGame(settings({ seed: `SURPRISE-${i}`, rules: rules(['crazy']) }))
      const d = g.draft!
      expect(d.crazyRng).toBeDefined()
      const rng = Rng.fromState(g.rngState)
      let guard = 0
      while (!isComplete(d) && guard++ < 40) {
        const before = d.surprise?.atSpin
        const respins = d.respinsLeft
        const cs = spin(u, d, rng)
        const forced = forcedSlotOf(d)
        const p = cs.squad.filter((x) => !d.takenPlayers.includes(x.playerId) && d.formation.slots.some((s) => !d.lineup[s.id] && (!forced || s.id === forced.id) && canCover(x, s.position, d.rules.minFit)))[0]
        const slot = d.formation.slots.find((s) => !d.lineup[s.id] && (!forced || s.id === forced.id) && canCover(p, s.position, d.rules.minFit))!
        // A forced slot refuses any other slot
        if (forced) {
          const other = d.formation.slots.find((s) => !d.lineup[s.id] && s.id !== forced.id && canCover(p, s.position, d.rules.minFit))
          if (other) expect(() => pick(u, d, p.id, other.id)).toThrow(/fills/)
        }
        pick(u, d, p.id, slot.id)
        if (!isComplete(d)) {
          rolls++
          if (d.surprise && d.surprise.atSpin !== before) {
            hits++
            kinds.add(d.surprise.kind)
            if (d.surprise.kind === 'respin') expect(d.respinsLeft).toBe(respins + 1)
            if (d.surprise.kind === 'forced') expect(forcedSlotOf(d)?.id).toBe(d.surprise.slotId)
            if (d.surprise.kind === 'golden') expect(d.forcedTwist).toBe('golden')
          }
        }
      }
      expect(isComplete(d)).toBe(true)
    }
    expect(hits / rolls).toBeGreaterThan(CRAZY_SURPRISE_CHANCE - 0.1)
    expect(hits / rolls).toBeLessThan(CRAZY_SURPRISE_CHANCE + 0.1)
    expect([...kinds].sort()).toEqual(['forced', 'golden', 'respin'])
  })

  it('announces a golden surprise only when it happens: never under Underdog, always golden otherwise', () => {
    for (const modes of [['crazy', 'underdog'], ['crazy']] as QuickMode[][]) {
      let golden = 0
      for (let i = 0; i < 40; i++) {
        const g = createGame(settings({ seed: `GOLD-${i}`, rules: rules(modes) }))
        const d = g.draft!
        const rng = Rng.fromState(g.rngState)
        let pending = false
        while (!isComplete(d)) {
          const cs = spin(u, d, rng)
          if (pending) expect(d.twist, `GOLD-${i}`).toBe('golden')
          const before = d.surprise
          const b = assistantChoice(u, d, cs)!
          pick(u, d, b.id, b.slot)
          pending = !isComplete(d) && d.surprise !== before && d.surprise?.kind === 'golden'
          if (pending) golden++
        }
      }
      if (modes.includes('underdog')) expect(golden).toBe(0)
      else expect(golden).toBeGreaterThan(0)
    }
  })

  it('starts in the shape the seed draws, whatever formation was chosen', () => {
    expect(startFormation(rules(['crazy']), 'K7Q2-MX9A', '4-4-2')).toBe(crazyFormation('K7Q2-MX9A'))
    expect(startFormation(rules(['speedrun']), 'K7Q2-MX9A', '4-4-2')).toBe('4-4-2')
    expect(startFormation(rules([]), 'K7Q2-MX9A', '3-5-2')).toBe('3-5-2')
  })

  it('makes a golden surprise spin golden and blocks choosing another slot while one is forced', () => {
    const d = newDraft(getFormation('4-3-3'), rules(['crazy'], { draftMode: 'position' }), 'X')
    d.forcedTwist = 'golden'
    d.forcedSlot = 'st'
    expect(targetSlot(d)?.id).toBe('st')
    expect(() => chooseSlot(u, d, 'gk')).toThrow(/Crazy surprise/)
    const cs = spin(u, d, new Rng('golden'))
    expect(d.twist).toBe('golden')
    expect(cs.champions).toBe(true)
    expect(d.forcedTwist).toBeNull()
    // The pick must go into the forced slot, and that clears it
    const p = cs.squad.find((x) => canCover(x, 'ST', 'accomplished'))!
    pick(u, d, p.id, 'st')
    expect(d.forcedSlot).toBeNull()
  })
})

describe('Speedrun', () => {
  it('lets the assistant take one pick on expiry, spinning first when needed, the same way every time', () => {
    const run = () => {
      const g = createGame(settings({ seed: 'SPEED-1', rules: rules(['speedrun']) }))
      const rng = Rng.fromState(g.rngState)
      const d = g.draft!
      assistantTurn(u, d, rng)
      expect(picksMade(d)).toBe(1)
      spin(u, d, rng)
      assistantTurn(u, d, rng)
      expect(picksMade(d)).toBe(2)
      expect(d.history.length).toBe(2)
      return JSON.stringify(d.history)
    }
    expect(run()).toBe(run())
  })

  it('chooses a slot first under Position First', () => {
    const g = createGame(settings({ seed: 'SPEED-2', rules: rules(['speedrun'], { draftMode: 'position' }) }))
    const rng = Rng.fromState(g.rngState)
    assistantTurn(u, g.draft!, rng)
    expect(picksMade(g.draft!)).toBe(1)
  })
})

describe('no dry wheel across the modes', () => {
  it('completes 200 assistant drafts over every mode, both draft modes, with and without a bench', () => {
    const sets: QuickMode[][] = [['underdog'], ['legends'], ['crazy'], ['crazy', 'underdog'], ['crazy', 'legends', 'speedrun']]
    for (let i = 0; i < 200; i++) {
      const modes = sets[i % sets.length]
      const extra: Partial<DraftRules> = { ...(i % 2 ? { draftMode: 'position' as const } : {}), ...(i % 3 === 0 ? { benchPicks: 3 } : {}) }
      const g = drafted({ seed: `DRY-${i}`, formationId: FORMATIONS[i % FORMATIONS.length].id, rules: rules(modes, extra) })
      expect(isComplete(g.draft!), `seed DRY-${i} ${modes.join('+')}`).toBe(true)
      expect(canSpin(u, g.draft!) || isComplete(g.draft!)).toBe(true)
    }
  })
})

describe('modes in challenge links', () => {
  it('travel in the rules diff and replay verified', () => {
    for (const modes of [['crazy', 'underdog'], ['legends', 'speedrun']] as QuickMode[][]) {
      const g = drafted({ seed: `LINK-${modes[0]}`, formationId: crazyFormation(`LINK-${modes[0]}`), rules: rules(modes) }, true)
      expect(g.phase).toBe('summary')
      const c = challengeFromGame(g, u, 'Minh')!
      expect(c.s.r.modes).toEqual(modes)
      const back = decodeChallenge(encodeChallenge(c))
      expect(rulesFromPayload(back).modes).toEqual(modes)
      const out = replayChallenge(u, back)
      expect(out.verified, out.reason).toBe('yes')
    }
  })

  it('replay a Crazy Position First draft, forced positions and free re-spins included', () => {
    let forcedSeen = 0
    for (let i = 0; i < 6; i++) {
      const g = drafted({ seed: `LINK-PF-${i}`, rules: rules(['crazy'], { draftMode: 'position' }) }, true)
      if (g.draft!.surprise) forcedSeen++
      const out = replayChallenge(u, decodeChallenge(encodeChallenge(challengeFromGame(g, u, 'Minh')!)))
      expect(out.verified, out.reason).toBe('yes')
    }
    expect(forcedSeen).toBeGreaterThan(0)
  })

  it('accepts only known mode flags, each once', () => {
    expect(isRulesDiff({ modes: ['crazy', 'legends'] })).toBe(true)
    expect(isRulesDiff({ modes: [] })).toBe(true)
    expect(isRulesDiff({ modes: ['hard'] })).toBe(false)
    expect(isRulesDiff({ modes: ['crazy', 'crazy'] })).toBe(false)
    expect(isRulesDiff({ modes: 'crazy' })).toBe(false)
    expect(rulesDiff(rules([]))).not.toHaveProperty('modes')
  })
})
