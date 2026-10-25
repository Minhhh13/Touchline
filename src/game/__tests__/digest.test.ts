import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { createGame, beginSeason } from '../logic/setup'
import { playMatchweek, startSeasonProper } from '../logic/week'
import { autoDraft, SEASON_RULES } from '@engine/draft'
import { Rng } from '@engine/rng'
import { computeTable, positionOf, USER_TEAM } from '@engine/season'
import type { GameEvent } from '@engine/events'
import { ASSISTANT_DECIDED, buildDigest, DIGEST_GROUP_CAP, digestSnapshot, digestTitle } from '../logic/digest'
import { NEWS_CAP, newsTotal, postNews, unseenNews } from '../logic/news'
import type { Game, GameSettings } from '../types'

function settings(partial: Partial<GameSettings> = {}): GameSettings {
  return {
    mode: 'season',
    seed: 'digest-test',
    formationId: '4-3-3',
    teamName: 'Test XI',
    shortName: 'TST',
    leagueId: 'england',
    wheelLeagues: ['england'],
    hostClubId: 'everton',
    leagueSeason: 2023,
    rules: { ...SEASON_RULES, leagues: ['england'] },
    jobSecurity: false,
    difficulty: 'calibrated',
    ...partial,
  }
}

function newGame(u: ReturnType<typeof loadTestUniverse>, partial: Partial<GameSettings> = {}): Game {
  const g = createGame(settings(partial))
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  beginSeason(g, u)
  return g
}

/** What the store does for Sim n: snapshot, then the assistant plays n weeks. */
function sim(g: Game, u: ReturnType<typeof loadTestUniverse>, n: number) {
  const before = digestSnapshot(g)!
  if (g.phase === 'preseason') startSeasonProper(g)
  for (let i = 0; i < n; i++) {
    if (g.phase === 'summary' || !g.season || g.season.sacked) break
    playMatchweek(g, u, true)
    if (g.phase === 'match') g.phase = 'week'
  }
  return { before, digest: buildDigest(before, g) }
}

const agentCall: GameEvent = {
  id: 'agent',
  title: 'An agent calls',
  body: 'An agent is pitching a client who is between clubs.',
  choices: [
    { id: 'meet', label: 'Take the meeting', hint: 'A bonus spin.' },
    { id: 'pass', label: 'Not interested', hint: 'Nothing happens.' },
  ],
}

describe('while you were away', () => {
  const u = loadTestUniverse()

  it('a new season opens with every inbox item unread and the counter equal to the feed', () => {
    const g = newGame(u)
    expect(g.newsSeen).toBe(0)
    expect(g.newsTotal).toBe(g.season!.news.length)
    expect(g.season!.news.length).toBeGreaterThan(0)
    expect(unseenNews(g)).toBe(g.season!.news.length)
    // Opening the inbox (newsSeen = newsTotal) reads everything
    g.newsSeen = newsTotal(g)
    expect(unseenNews(g)).toBe(0)
  })

  it('a save from before the fields existed counts as read, and the counter picks up from the feed length', () => {
    const g = newGame(u)
    delete g.newsSeen
    delete g.newsTotal
    expect(unseenNews(g)).toBe(0)
    // A full feed on an old save: the first post bootstraps the counter from its length, and the cap still holds
    while (g.season!.news.length < NEWS_CAP) g.season!.news.push({ matchweek: 0, kind: 'info', title: 'Old', body: 'Filler.' })
    postNews(g, { matchweek: 1, kind: 'info', title: 'Fresh', body: 'New item.' })
    expect(g.newsTotal).toBe(NEWS_CAP + 1)
    expect(g.season!.news.length).toBe(NEWS_CAP)
    expect(g.season!.news[0].title).toBe('Fresh')
    // Still read until the inbox is opened once; from then on the unread count follows the counter, not the length
    expect(unseenNews(g)).toBe(0)
    g.newsSeen = newsTotal(g)
    for (let i = 0; i < 130; i++) postNews(g, { matchweek: 2, kind: 'info', title: `Item ${i}`, body: '.' })
    expect(g.season!.news.length).toBe(NEWS_CAP)
    expect(unseenNews(g)).toBe(130)
  })

  it('Sim 5 from pre-season digests the results, the table move, the board and the new inbox items', () => {
    const g = newGame(u)
    g.newsSeen = newsTotal(g)
    const { before, digest } = sim(g, u, 5)
    expect(before.matchweek).toBe(0)
    expect(before.position).toBeGreaterThanOrEqual(1)
    expect(before.position).toBeLessThanOrEqual(20)
    expect(digest).not.toBeNull()
    const d = digest!
    expect(d.fromMatchweek).toBe(0)
    expect(d.toMatchweek).toBe(5)
    expect(digestTitle(d)).toBe('Matchweeks 1 to 5')
    // One league result per matchweek in a 20-club league, in matchweek order, with the points they earned
    const league = d.results.filter((r) => r.comp === 'league')
    expect(league.map((r) => r.matchweek)).toEqual([1, 2, 3, 4, 5])
    expect(d.results.some((r) => r.comp !== 'league')).toBe(false)
    const season = g.season!
    for (const r of league) {
      const f = season.fixtures.find((f) => f.matchweek === r.matchweek && (f.homeTeamId === USER_TEAM || f.awayTeamId === USER_TEAM))!
      expect(r.home).toBe(f.homeTeamId === USER_TEAM)
      expect(r.opponentId).toBe(r.home ? f.awayTeamId : f.homeTeamId)
      expect(r.gf).toBe(r.home ? f.result!.homeGoals : f.result!.awayGoals)
      expect(r.ga).toBe(r.home ? f.result!.awayGoals : f.result!.homeGoals)
      expect(r.outcome).toBe(r.gf > r.ga ? 'W' : r.gf === r.ga ? 'D' : 'L')
    }
    const table = computeTable(season.fixtures, [USER_TEAM, ...Object.keys(season.ai)])
    expect(d.points).toBe(table.find((r) => r.teamId === USER_TEAM)!.points)
    expect(d.positionTo).toBe(positionOf(table, USER_TEAM))
    expect(d.confidenceFrom).toBe(60)
    expect(d.confidenceTo).toBe(season.confidence)
    // Every item posted during the run, newest first, and nothing older
    expect(d.news.length).toBe(newsTotal(g) - before.newsTotal)
    expect(d.news.length).toBe(unseenNews(g))
    expect(d.news).toEqual(season.news.slice(0, d.news.length))
    expect(d.news.filter((n) => n.kind === 'result').length).toBe(5)
    expect(d.truncated).toBe(false)
    // The groups are the new items split by kind
    expect(d.injuries).toEqual(d.news.filter((n) => n.kind === 'injury'))
    expect(d.suspensions).toEqual(d.news.filter((n) => n.kind === 'suspension'))
    expect(d.transfers).toEqual(d.news.filter((n) => n.kind === 'transfer'))
    expect(d.development).toEqual(d.news.filter((n) => n.kind === 'training'))
    expect(d.development.length).toBe(1)
    expect(d.development[0].title).toBe('Development report')
  })

  it('a cup week lists the tie after the league match, labelled by round, and a single week is titled as one', () => {
    const g = newGame(u)
    sim(g, u, 5)
    const { digest } = sim(g, u, 1)
    const d = digest!
    expect(digestTitle(d)).toBe('Matchweek 6')
    // The inbox was never opened, so the unread count also holds the opening news and the first five weeks
    expect(unseenNews(g)).toBe(newsTotal(g))
    expect(unseenNews(g)).toBeGreaterThan(d.news.length)
    expect(d.results.map((r) => r.comp)).toEqual(['league', 'cup'])
    const tie = d.results[1]
    expect(tie.matchweek).toBe(6)
    expect(tie.roundLabel).toBeDefined()
    const real = g.season!.cup.find((t) => t.afterMatchweek === 6 && (t.homeTeamId === USER_TEAM || t.awayTeamId === USER_TEAM))!
    expect(tie.outcome).toBe(real.winnerId === USER_TEAM ? 'W' : 'L')
    if (real.result!.penalties) expect(tie.penalties).toBeDefined()
    else expect(tie.gf === tie.ga).toBe(false)
    // Points in the digest are the points of these weeks only
    const table = computeTable(g.season!.fixtures, [USER_TEAM, ...Object.keys(g.season!.ai)])
    const f = g.season!.fixtures.find((f) => f.matchweek === 6 && (f.homeTeamId === USER_TEAM || f.awayTeamId === USER_TEAM))!
    const gf = f.homeTeamId === USER_TEAM ? f.result!.homeGoals : f.result!.awayGoals
    const ga = f.homeTeamId === USER_TEAM ? f.result!.awayGoals : f.result!.homeGoals
    expect(d.points).toBe(gf > ga ? 3 : gf === ga ? 1 : 0)
    expect(d.points).toBeLessThanOrEqual(table.find((r) => r.teamId === USER_TEAM)!.points)
  })

  it('records the decision the assistant took as an inbox item and lists it in the digest with its outcome', () => {
    const g = newGame(u)
    sim(g, u, 2)
    g.pendingEvent = agentCall
    const { digest } = sim(g, u, 1)
    const d = digest!
    const record = g.season!.news.find((n) => n.title === `${ASSISTANT_DECIDED}An agent calls`)!
    expect(record).toBeDefined()
    expect(record.kind).toBe('event')
    // The second option, by its label
    expect(record.body).toBe('Not interested')
    expect(record.matchweek).toBe(2)
    // The event's own item follows it in the feed, so the digest pairs them
    const idx = g.season!.news.indexOf(record)
    expect(g.season!.news[idx - 1].title).toBe('An agent calls')
    expect(d.decisions).toEqual([{ title: 'An agent calls', choice: 'Not interested', outcome: g.season!.news[idx - 1].body }])
    expect(g.pendingEvent === agentCall).toBe(false)
    expect(g.bonusSpins).toBe(0)
  })

  it('pairs a decision with its outcome across a training setback posted between them, but never across a result', () => {
    const g = newGame(u)
    sim(g, u, 1)
    const snap = digestSnapshot(g)!
    // Week 2 as playMatchweek posts it: the record, a setback from the rushed return, the event's own item, the result
    postNews(g, { matchweek: 1, kind: 'event', title: `${ASSISTANT_DECIDED}Rushed back?`, body: 'Rush him back' })
    postNews(g, { matchweek: 1, kind: 'injury', title: 'Setback', body: 'He broke down in training.' })
    postNews(g, { matchweek: 1, kind: 'event', title: 'Rushed back?', body: 'Declared fit. Fingers crossed.' })
    postNews(g, { matchweek: 2, kind: 'result', title: 'Won', body: '2-0' })
    // Week 3: a record with no item of its own before the result must not borrow a later one
    postNews(g, { matchweek: 2, kind: 'event', title: `${ASSISTANT_DECIDED}Press day`, body: 'Say nothing' })
    postNews(g, { matchweek: 3, kind: 'result', title: 'Lost', body: '0-1' })
    postNews(g, { matchweek: 3, kind: 'event', title: 'Press day', body: 'A later, unrelated item.' })
    g.season!.matchweek += 2
    const d = buildDigest(snap, g)!
    expect(d.decisions).toEqual([
      { title: 'Press day', choice: 'Say nothing' },
      { title: 'Rushed back?', choice: 'Rush him back', outcome: 'Declared fit. Fingers crossed.' },
    ])
    expect(d.injuries.map((n) => n.title)).toEqual(['Setback'])
  })

  it('a managed week makes no decision item without a pending event, and a hand-played one never does', () => {
    const g = newGame(u)
    sim(g, u, 1)
    expect(g.season!.news.some((n) => n.title.startsWith(ASSISTANT_DECIDED))).toBe(false)
    g.pendingEvent = agentCall
    playMatchweek(g, u, false)
    // Played by hand the event waits for the manager
    expect(g.pendingEvent).toBe(agentCall)
    expect(g.season!.news.some((n) => n.title.startsWith(ASSISTANT_DECIDED))).toBe(false)
  })

  it('returns no digest when nothing was played, and marks a run that outgrew the feed', () => {
    const g = newGame(u)
    const before = digestSnapshot(g)!
    expect(buildDigest(before, g)).toBeNull()
    expect(digestSnapshot({ ...g, season: null })).toBeNull()
    sim(g, u, 3)
    // More posted than the feed can hold: the digest shows what is left and says so
    const snap = digestSnapshot(g)!
    playMatchweek(g, u, true)
    for (let i = 0; i < NEWS_CAP + 5; i++) postNews(g, { matchweek: 4, kind: 'injury', title: `Injury ${i}`, body: '.' })
    const d = buildDigest(snap, g)!
    expect(d.news.length).toBe(NEWS_CAP)
    expect(d.truncated).toBe(true)
    expect(d.injuries.length).toBe(NEWS_CAP)
    expect(d.injuries.length).toBeGreaterThan(DIGEST_GROUP_CAP)
  })

  it('a run that ends in the sack reaches the summary, so the store shows no digest over it', () => {
    const g = newGame(u, { jobSecurity: true })
    sim(g, u, 10)
    // Confidence on the floor after matchweek 10: the next managed week ends in the sack and the run stops there
    g.season!.confidence = 0
    sim(g, u, 5)
    expect(g.season!.sacked).toBe(true)
    expect(g.season!.matchweek).toBe(11)
    expect(g.phase).toBe('summary')
  })

  it('a sim to the end of the season is left to the summary', () => {
    const g = newGame(u)
    const before = digestSnapshot(g)!
    startSeasonProper(g)
    while (g.phase !== 'summary') playMatchweek(g, u, true)
    // The store builds no digest once the phase is summary; the function itself still describes the whole run
    const d = buildDigest(before, g)!
    expect(d.toMatchweek).toBe(38)
    expect(d.results.filter((r) => r.comp === 'league').length).toBe(38)
    expect(g.phase).toBe('summary')
  })
})
