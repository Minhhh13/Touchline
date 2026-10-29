/**
 * The logic's English mirrored through `logicLine()` (r10, `src/ui/i18n/logicText.ts`), beside `copyMirror.test.ts`:
 * every message parses and its own words are still in the engine's, the game logic's or the online layer's source; the lines a played
 * Season (the Office worked, player power on), a Dynasty summer and a Quick Draft write are matched by a message that
 * says them again, in English, character for character; in the pseudo-locale a matched line is translated, its names
 * kept, and a line nothing matches comes back as it was.
 */
import { describe, expect, it, vi } from 'vitest'
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) }, configurable: true })
})
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { SEASON_RULES } from '@engine/draft'
import { useStore } from '@game/store'
import { officeActions } from '@game/officeActions'
import { weeklyBriefing } from '@game/logic/briefing'
import { atmosphereOf, hierarchy, squadGroups } from '@game/logic/dynamics'
import { describeMorale } from '@game/logic/happiness'
import { squadPlanner } from '@game/logic/planner'
import { medicalReport } from '@game/logic/medical'
import { pressQuestions, PRESS_ANSWERS } from '@game/logic/pressConference'
import { openRequests } from '@game/logic/transferRequests'
import { formatText, setLocaleMessages } from '../i18n'
import { parseMessage, type Part } from '../i18n/icu'
import { isPseudo, PSEUDO_LOCALE } from '../i18n/pseudo'
import { logicText } from '../i18n/en/logicText'
import { logicLine, matchLogicLine } from '../i18n/logicText'
import { Chooser } from '../../game/__tests__/qaHarness'
import { show } from './qaSsr'

const u = loadTestUniverse(['england'])
const st = () => useStore.getState()

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? (d.name === '__tests__' ? [] : sources(join(dir, d.name))) : d.name.endsWith('.ts') ? [readFileSync(join(dir, d.name), 'utf8')] : []))
}

/** A message's own words, branch by branch. */
function words(parts: Part[]): string[] {
  return parts.flatMap((p) => (p.kind === 'text' ? [p.text] : 'options' in p ? Object.values(p.options).flatMap(words) : []))
}

describe('logicText mirrors the game logic’s English', () => {
  it('every message parses and its words are still in the logic', () => {
    const src = [...sources('src/engine'), ...sources('src/game/logic'), ...sources('src/online')].join('\n').replace(/\\'/g, "'")
    const stale: string[] = []
    for (const [key, msg] of Object.entries(logicText.messages)) {
      const parts = parseMessage(msg)
      // A line put together from pieces (a plural's branches, a clause added on) is checked word by word
      for (const w of words(parts).map((x) => x.trim()).filter((x) => x.length >= 4)) {
        if (src.includes(w)) continue
        for (const x of w.split(/[^A-Za-z'-]+/).filter((y) => y.length >= 4)) if (!src.includes(x)) stale.push(`${key}: "${x}"`)
      }
    }
    expect(stale).toEqual([])
  })

  it('lines a played Season, Dynasty summer and Office write are said again character for character', () => {
    const corpus = new Set<string>()
    const take = (s: string | null | undefined) => s && corpus.add(s)
    const collect = () => {
      const g = st().game!
      for (const n of g.season?.news ?? []) [n.title, n.body].forEach(take)
      for (const b of weeklyBriefing(g, u)) take(b.text)
      atmosphereOf(g, u).lines.forEach(take)
      for (const r of hierarchy(g, u)) r.reasons.forEach(take)
      for (const x of squadGroups(g, u)) take(x.label)
      for (const r of squadPlanner(g, u)) take(r.need)
      const med = medicalReport(g, u)
      for (const r of med.risks) r.reasons.forEach(take)
      for (const r of med.out) take(r.description)
      for (const s of Object.values(g.squad)) for (const e of s.moraleLog ?? []) take(describeMorale(e))
      take(st().toast)
    }
    for (const mode of ['season', 'dynasty'] as const) {
      const seed = `r10-mirror-${mode}`
      const ch = new Chooser(seed)
      show({ universe: u, loadedLeagues: ['england'], game: null, parked: {}, toast: null, digest: null, playback: null, screen: 'game', offseason: null })
      st().startGame({ mode, seed, formationId: '4-3-3', teamName: 'R10', shortName: 'R10', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2022, rules: { ...SEASON_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated', continental: false, playerPower: true })
      st().autoDraftRest()
      st().finishDraft()
      for (let step = 0; step < 300 && st().game!.phase !== 'summary'; step++) {
        const g = st().game!
        if (g.phase === 'match') {
          if (g.live) st().finishLiveNow()
          else st().closeMatch()
          continue
        }
        if (st().digest) st().dismissDigest()
        const ids = Object.keys(g.squad).sort()
        const r = ch.int(0, 4)
        if (r === 0) officeActions.makePromise(ch.pick(ids), ch.pick(['minutes', 'contract', 'signing'] as const))
        else if (r === 1) {
          const qs = pressQuestions(g, u)
          if (qs.length) officeActions.answerPress(qs[0], ch.pick(Object.keys(PRESS_ANSWERS[qs[0]])))
        } else if (r === 2) officeActions.converse(ch.pick(ids), ch.pick(['form', 'minutes', 'role', 'future'] as const), ch.pick(['encourage', 'demand', 'explain', 'promise'] as const))
        else if (r === 3) {
          const req = openRequests(g)[0]
          const id = req && ids.find((x) => (g.customPlayers[x] ?? u.index[x])?.playerId === req.playerId)
          if (id) officeActions.answerRequest(id, ch.pick(['talk', 'list', 'refuse', 'promise-minutes'] as const))
        }
        collect()
        if (ch.chance(0.5)) st().playWeek()
        else st().simWeeks(2)
      }
      collect()
      if (mode === 'dynasty') {
        st().nextSeason()
        collect()
      }
    }
    const wrong: string[] = []
    const missed: string[] = []
    for (const line of corpus) {
      const hit = matchLogicLine(line)
      if (!hit) missed.push(line)
      else {
        const back = formatText(logicText.messages[hit.key as keyof typeof logicText.messages], hit.vars)
        if (back !== line) wrong.push(`${hit.key}: "${line}" read back as "${back}"`)
      }
    }
    expect(wrong).toEqual([])
    if (process.env.MIRROR_REPORT === '1') console.log(`${corpus.size} lines, ${missed.length} unmatched:\n${missed.join('\n')}`)
    expect(corpus.size).toBeGreaterThan(150)
    expect(missed.length / corpus.size).toBeLessThan(0.1)
  }, 240_000)

  it('translates a matched line in the pseudo-locale, keeps its names, and leaves English and strangers alone', () => {
    expect(logicLine('E. Martínez is tired (condition 30): rest him for J. Pickford')).toBe('E. Martínez is tired (condition 30): rest him for J. Pickford')
    setLocaleMessages({ id: PSEUDO_LOCALE, messages: {} })
    try {
      const tired = logicLine('E. Martínez is tired (condition 30): rest him for J. Pickford')
      expect(isPseudo(tired)).toBe(true)
      expect(tired).toContain('E. Martínez')
      expect(tired).toContain('J. Pickford')
      expect(tired).toContain('30')
      // A hole's own text is mirrored too: the fresher man when there is none
      expect(logicLine('E. Martínez is tired (condition 30): rest him for a fresher man')).not.toContain('a fresher man')
      expect(logicLine('Harry Kane')).toBe('Harry Kane')
      expect(isPseudo(logicLine('Suspended for 2 matches.'))).toBe(true)
      expect(logicLine('Suspended for 2 matches.')).toContain('2')
    } finally {
      setLocaleMessages({ id: 'en', messages: {} })
    }
  })
})
