import type { Game, LiveMatch } from '../types'
import type { LoadedUniverse } from '@engine/universe'
import { Rng } from '@engine/rng'
import { beginMatch, finishMatch, simulateMatch, type FullMatchResult, type MatchTeamInput, type SecondHalfOptions, type TeamTalk } from '@engine/match'
import { aiTeamInput, applyMatchToState, benchMoraleDrift, computeTable, cupRounds, describeImportance, drawNextCupRound, positionOf, recoverWeek, seasonTier, shootout, updateConfidence, USER_TEAM, userTeamInput, type CupTie, type NewsItem } from '@engine/season'
import { TRAINING } from '@engine/training'
import { rollEvent, resolveEvent, type EventContext } from '@engine/events'
import { advanceWindow, openWindow, prizeMoney, weeklyCashFlow } from '@engine/market'
import { computeAwards } from '@engine/awards'
import { playerLookup, squadPlayers } from './players'
import { autoPick, lineupProblems, squadWages } from './squad'
import { getFormation } from '@engine/formations'
import { autoPickLineup } from '@engine/ratings'
import type { Tactics } from '@engine/types'

function news(game: Game, item: Omit<NewsItem, 'matchweek'>): void {
  game.season!.news.unshift({ matchweek: game.season!.matchweek, ...item })
  if (game.season!.news.length > 120) game.season!.news.length = 120
}

function userInput(game: Game, u: LoadedUniverse): MatchTeamInput {
  const get = playerLookup(game, u)
  const input = userTeamInput(u, { teamName: game.settings.teamName, shortName: game.settings.shortName, tactics: game.tactics, lineup: game.lineup, bench: game.bench, state: game.squad, teamTalk: game.teamTalk })
  return { ...input, getPlayer: get }
}

function userLookups(game: Game, u: LoadedUniverse) {
  return { getPlayer: playerLookup(game, u), getState: (id: string) => game.squad[id] }
}

function aiLookups(game: Game, u: LoadedUniverse, clubId: string) {
  const club = game.season!.ai[clubId]
  return { getPlayer: (id: string) => u.index[id], getState: (id: string) => club?.state[id] }
}

function matchBoosts(game: Game): { attack: number; defence: number } {
  const t = TRAINING[game.training]
  let attack = t.attack
  let defence = t.defence
  if (game.nextMatchBoost?.attack) attack *= 1 + game.nextMatchBoost.attack / 100
  if (game.nextMatchBoost?.defence) defence *= 1 - game.nextMatchBoost.defence / 100
  return { attack, defence }
}

function applyResultToUser(game: Game, u: LoadedUniverse, res: FullMatchResult, userIsHome: boolean, countStats = true): void {
  const stats = userIsHome ? res.homeStats : res.awayStats
  const gf = userIsHome ? res.homeGoals : res.awayGoals
  const ga = userIsHome ? res.awayGoals : res.homeGoals
  const result: 'W' | 'D' | 'L' = gf > ga ? 'W' : gf === ga ? 'D' : 'L'
  const starters = new Set(Object.values(game.lineup))
  const played = new Set<string>()
  const get = playerLookup(game, u)
  for (const st of stats) {
    const s = game.squad[st.playerSeasonId]
    if (!s) continue
    played.add(st.playerSeasonId)
    if (!countStats) {
      s.condition = Math.max(40, s.condition - Math.round((res.conditionLoss[st.playerSeasonId] ?? 0) * 0.6))
      s.sharpness = Math.min(100, s.sharpness + 9)
      s.familiarity = Math.min(100, s.familiarity + 8)
      if (st.injured) s.injury = { ...st.injured }
      continue
    }
    applyMatchToState(s, st, starters.has(st.playerSeasonId), res.conditionLoss[st.playerSeasonId] ?? 0, ga === 0, res.motmId === st.playerSeasonId, result)
    if (st.injured) news(game, { kind: 'injury', title: `${get(st.playerSeasonId)?.name} injured`, body: `${st.injured.description}. Out for around ${st.injured.weeksOut} week${st.injured.weeksOut === 1 ? '' : 's'}.` })
    if (st.red) news(game, { kind: 'suspension', title: `${get(st.playerSeasonId)?.name} sent off`, body: `Suspended for ${s.suspension} match${s.suspension === 1 ? '' : 'es'}.` })
    if (st.yellow && s.yellowCards % 5 === 0) news(game, { kind: 'suspension', title: `${get(st.playerSeasonId)?.name} suspended`, body: `Five yellow cards: a one-match ban.` })
  }
  if (!countStats) return
  for (const id of played) game.weekPlayed.push(id)
  for (const id of Object.keys(game.squad)) {
    if (played.has(id)) game.consecutiveMissed[id] = 0
    else game.consecutiveMissed[id] = (game.consecutiveMissed[id] ?? 0) + 1
  }
  if (game.promisedStart) {
    const kept = starters.has(game.promisedStart)
    const s = game.squad[game.promisedStart]
    if (s) {
      s.morale = Math.max(10, Math.min(100, s.morale + (kept ? 5 : -16)))
      news(game, { kind: 'event', title: kept ? 'Promise kept' : 'Promise broken', body: kept ? `${get(game.promisedStart)?.name} started as promised.` : `${get(game.promisedStart)?.name} was promised a start and did not get one. He is furious.` })
    }
    game.promisedStart = undefined
  }
  game.nextMatchBoost = undefined
}

function applyResultToAi(game: Game, teamId: string, res: FullMatchResult, isHome: boolean): void {
  const club = game.season!.ai[teamId]
  if (!club) return
  const stats = isHome ? res.homeStats : res.awayStats
  const gf = isHome ? res.homeGoals : res.awayGoals
  const ga = isHome ? res.awayGoals : res.homeGoals
  const result: 'W' | 'D' | 'L' = gf > ga ? 'W' : gf === ga ? 'D' : 'L'
  for (const st of stats) {
    const s = club.state[st.playerSeasonId]
    if (!s) continue
    applyMatchToState(s, st, true, res.conditionLoss[st.playerSeasonId] ?? 0, ga === 0, res.motmId === st.playerSeasonId, result)
  }
}

function weeklyRecovery(game: Game, u: LoadedUniverse): void {
  const get = playerLookup(game, u)
  const t = TRAINING[game.training]
  const played = new Set(game.weekPlayed)
  for (const [id, s] of Object.entries(game.squad)) {
    const p = get(id)
    if (!p) continue
    recoverWeek(s, p, played.has(id), t.recovery)
    s.sharpness = Math.max(20, Math.min(100, s.sharpness + t.sharpness))
    s.familiarity = Math.min(100, s.familiarity + t.familiarity)
    benchMoraleDrift(s, p, game.consecutiveMissed[id] ?? 0)
  }
  for (const club of Object.values(game.season!.ai)) {
    for (const [id, s] of Object.entries(club.state)) {
      const p = get(id)
      if (p) recoverWeek(s, p, true, 0)
    }
  }
  game.weekPlayed = []
}

function trainingInjuries(game: Game, u: LoadedUniverse, rng: Rng): void {
  const t = TRAINING[game.training]
  const get = playerLookup(game, u)
  for (const [id, s] of Object.entries(game.squad)) {
    if (s.injury) continue
    const p = get(id)
    if (!p) continue
    if (rng.chance(0.006 * t.injuryRisk * (0.5 + p.traits.injuryProneness))) {
      s.injury = { description: rng.pick(['Training ground knock', 'Tight calf', 'Rolled ankle in training']), weeksOut: rng.int(1, 3) }
      news(game, { kind: 'injury', title: `${p.name} hurt in training`, body: `${s.injury.description}. Out for ${s.injury.weeksOut} week${s.injury.weeksOut === 1 ? '' : 's'}.` })
    }
  }
}

function userFixture(game: Game) {
  return game.season!.fixtures.find((f) => f.matchweek === game.season!.matchweek + 1 && (f.homeTeamId === USER_TEAM || f.awayTeamId === USER_TEAM))!
}

export function nextOpponent(game: Game): { clubId: string; home: boolean } | null {
  if (!game.season || game.season.matchweek >= game.season.matchweeks) return null
  const f = userFixture(game)
  const home = f.homeTeamId === USER_TEAM
  return { clubId: home ? f.awayTeamId : f.homeTeamId, home }
}

export function upcomingCupTie(game: Game): CupTie | null {
  if (!game.season || game.season.cupEliminated || game.season.cupWon) return null
  const mw = game.season.matchweek + 1
  return game.season.cup.find((t) => !t.result && t.afterMatchweek === mw && (t.homeTeamId === USER_TEAM || t.awayTeamId === USER_TEAM)) ?? null
}

/**
 * Play the next matchweek. Interactive play stops at half time of the user's
 * match (`game.live`); `autoManage` plays everything through with the
 * assistant picking the team and answering decisions.
 */
export function playMatchweek(game: Game, u: LoadedUniverse, autoManage = false): void {
  const season = game.season
  if (!season || season.matchweek >= season.matchweeks || season.sacked) return
  if (game.live) finishLiveMatch(game, u, undefined, true)
  if (game.phase === 'summary') return
  const rng = Rng.fromState(game.rngState)

  if (game.pendingEvent && autoManage) {
    const ev = game.pendingEvent
    applyEventChoice(game, u, ev.choices[Math.min(1, ev.choices.length - 1)].id)
  }
  if (lineupProblems(game, u).length || autoManage) autoPick(game, u, !autoManage)

  const mw = season.matchweek + 1
  const table = computeTable(season.fixtures, [USER_TEAM, ...Object.keys(season.ai)])
  const week = season.fixtures.filter((f) => f.matchweek === mw)
  const boosts = matchBoosts(game)

  for (const f of week) {
    const userIsHome = f.homeTeamId === USER_TEAM
    const userIsAway = f.awayTeamId === USER_TEAM
    if (userIsHome || userIsAway) {
      const opponentId = userIsHome ? f.awayTeamId : f.homeTeamId
      const imp = describeImportance(u, season.hostClubId, opponentId, table, mw)
      const user = userInput(game, u)
      const opp = aiTeamInput(u, season.ai[opponentId], season.aiOffset)
      const opts = { rng, home: userIsHome ? user : opp, away: userIsHome ? opp : user, importance: imp.importance, importanceLabel: imp.label, neutral: false, detail: 'full' as const, boosts: userIsHome ? { home: boosts } : { away: boosts } }
      const ctx = { matchweek: mw, competition: 'league' as const, opponentClubId: opponentId, home: userIsHome, importanceLabel: imp.label }
      if (autoManage) {
        const res = simulateMatch(opts)
        f.result = res
        recordUserLeagueResult(game, u, res, userIsHome, opponentId, ctx)
      } else {
        game.live = { kind: 'league', mp: beginMatch(opts), ctx, userIsHome, opponentId }
      }
    } else {
      const home = aiTeamInput(u, season.ai[f.homeTeamId], season.aiOffset)
      const away = aiTeamInput(u, season.ai[f.awayTeamId], season.aiOffset)
      const res = simulateMatch({ rng, home, away, detail: 'summary' })
      f.result = res
      applyResultToAi(game, f.homeTeamId, res, true)
      applyResultToAi(game, f.awayTeamId, res, false)
    }
  }
  game.lastCupMatch = null
  game.lastCupContext = null
  game.phase = 'match'
  game.rngState = rng.getState()

  if (autoManage) {
    season.matchweek = mw
    afterLeagueMatch(game, u, true)
  }
}

function recordUserLeagueResult(game: Game, u: LoadedUniverse, res: FullMatchResult, userIsHome: boolean, opponentId: string, ctx: LiveMatch['ctx']): void {
  const season = game.season!
  applyResultToUser(game, u, res, userIsHome)
  applyResultToAi(game, opponentId, res, !userIsHome)
  game.lastMatch = res
  game.lastMatchContext = ctx
  const gf = userIsHome ? res.homeGoals : res.awayGoals
  const ga = userIsHome ? res.awayGoals : res.homeGoals
  news(game, { kind: 'result', title: `${userIsHome ? game.settings.shortName : season.ai[opponentId].shortName} ${res.homeGoals}-${res.awayGoals} ${userIsHome ? season.ai[opponentId].shortName : game.settings.shortName}`, body: gf > ga ? 'Three points.' : gf === ga ? 'A point apiece.' : 'A defeat to learn from.' })
}

/** Finish the paused match (second half), then carry on with the week. */
export function finishLiveMatch(game: Game, u: LoadedUniverse, second?: { talk?: TeamTalk; tactics?: Tactics; substitutions?: Array<{ off: string; on: string }> }, autoManage = false): void {
  const live = game.live
  if (!live || !game.season) return
  const season = game.season
  const userSide: 'home' | 'away' = live.userIsHome ? 'home' : 'away'
  const lookups = live.kind === 'friendly' ? { home: userLookups(game, u), away: friendlyLookups(u, live.opponentId) } : live.userIsHome ? { home: userLookups(game, u), away: aiLookups(game, u, live.opponentId) } : { home: aiLookups(game, u, live.opponentId), away: userLookups(game, u) }
  const opts: SecondHalfOptions | undefined = second ? { side: userSide, talk: second.talk, tactics: second.tactics, substitutions: second.substitutions } : undefined
  if (second?.tactics) game.tactics = second.tactics
  const res = finishMatch(live.mp, lookups, opts)
  game.live = null
  // Persist the half-time changes to the lineup so the squad screen matches what finished the match
  if (second?.substitutions?.length) {
    for (const s of second.substitutions) {
      const slot = Object.keys(game.lineup).find((k) => game.lineup[k] === s.off)
      if (slot && game.squad[s.on]) {
        game.lineup[slot] = s.on
        game.bench = game.bench.filter((id) => id !== s.on)
        if (!game.bench.includes(s.off)) game.bench.push(s.off)
      }
    }
  }
  if (live.kind === 'friendly') {
    applyResultToUser(game, u, res, true, false)
    for (const s of Object.values(game.squad)) s.condition = Math.min(100, s.condition + 14)
    game.friendliesPlayed++
    game.lastMatch = res
    game.lastMatchContext = live.ctx
    news(game, { kind: 'info', title: `Friendly: ${res.homeGoals}-${res.awayGoals} v ${res.awayName}`, body: 'Legs loosened, patterns rehearsed.' })
    game.phase = 'match'
    return
  }
  if (live.kind === 'league') {
    const f = season.fixtures.find((x) => x.matchweek === live.ctx.matchweek && (x.homeTeamId === USER_TEAM || x.awayTeamId === USER_TEAM))!
    f.result = res
    recordUserLeagueResult(game, u, res, live.userIsHome, live.opponentId, live.ctx)
    season.matchweek = live.ctx.matchweek
    afterLeagueMatch(game, u, autoManage)
    return
  }
  // Cup
  const tie = season.cup[live.cupTieIndex!]
  completeUserCupTie(game, u, tie, res, live)
  const rng = Rng.fromState(game.rngState)
  drawNext(game, u, rng, tie.round)
  game.rngState = rng.getState()
  afterMatchweek(game, u)
}

function friendlyLookups(u: LoadedUniverse, clubSeasonKey: string) {
  const cs = u.clubSeasonByKey[clubSeasonKey]
  const byId = new Map((cs?.squad ?? []).map((p) => [p.id, p]))
  return { getPlayer: (id: string) => byId.get(id), getState: () => undefined }
}

/** After the league match: cup ties this week (AI ones now, the user's live), then housekeeping. */
function afterLeagueMatch(game: Game, u: LoadedUniverse, autoManage: boolean): void {
  const season = game.season!
  const mw = season.matchweek
  const roundInfo = cupRounds(season.matchweeks).find((r) => r.afterMatchweek === mw)
  if (roundInfo) {
    const rng = Rng.fromState(game.rngState)
    simulateAiCupTies(game, u, rng, roundInfo.round)
    const idx = season.cup.findIndex((t) => t.round === roundInfo.round && !t.result && (t.homeTeamId === USER_TEAM || t.awayTeamId === USER_TEAM))
    if (idx >= 0) {
      const tie = season.cup[idx]
      const userIsHome = tie.homeTeamId === USER_TEAM
      const opponentId = userIsHome ? tie.awayTeamId : tie.homeTeamId
      if (lineupProblems(game, u).length || autoManage) autoPick(game, u, !autoManage)
      const user = userInput(game, u)
      const imp = describeImportance(u, season.hostClubId, opponentId, null, mw, roundInfo.round)
      const opp = aiTeamInput(u, season.ai[opponentId], season.aiOffset)
      const neutral = roundInfo.round === 'F'
      const opts = { rng, home: userIsHome ? user : opp, away: userIsHome ? opp : user, importance: imp.importance, importanceLabel: imp.label ?? roundInfo.label, neutral, detail: 'full' as const }
      const ctx = { matchweek: mw, competition: 'cup' as const, roundLabel: roundInfo.label, opponentClubId: opponentId, home: userIsHome, importanceLabel: imp.label }
      if (autoManage) {
        const res = simulateMatch(opts)
        completeUserCupTie(game, u, tie, res, { kind: 'cup', mp: null as never, ctx, userIsHome, opponentId, cupTieIndex: idx })
        drawNext(game, u, rng, roundInfo.round)
        game.rngState = rng.getState()
      } else {
        game.live = { kind: 'cup', mp: beginMatch(opts), ctx, userIsHome, opponentId, cupTieIndex: idx }
        game.rngState = rng.getState()
        game.phase = 'match'
        return
      }
    } else {
      drawNext(game, u, rng, roundInfo.round)
      game.rngState = rng.getState()
    }
  }
  afterMatchweek(game, u)
}

function simulateAiCupTies(game: Game, u: LoadedUniverse, rng: Rng, round: CupTie['round']): void {
  const season = game.season!
  for (const tie of season.cup.filter((t) => t.round === round && !t.result)) {
    if (tie.homeTeamId === USER_TEAM || tie.awayTeamId === USER_TEAM) continue
    const home = aiTeamInput(u, season.ai[tie.homeTeamId], season.aiOffset)
    const away = aiTeamInput(u, season.ai[tie.awayTeamId], season.aiOffset)
    const res = simulateMatch({ rng, home, away, neutral: round === 'F', detail: 'summary' })
    applyResultToAi(game, tie.homeTeamId, res, true)
    applyResultToAi(game, tie.awayTeamId, res, false)
    let winner = res.homeGoals > res.awayGoals ? tie.homeTeamId : res.awayGoals > res.homeGoals ? tie.awayTeamId : null
    let pens: { home: number; away: number } | undefined
    if (!winner) {
      pens = shootout(rng, res.homeReport.strength.overall, res.awayReport.strength.overall)
      winner = pens.home > pens.away ? tie.homeTeamId : tie.awayTeamId
    }
    tie.result = { ...res, penalties: pens }
    tie.winnerId = winner
  }
}

function completeUserCupTie(game: Game, u: LoadedUniverse, tie: CupTie, res: FullMatchResult, live: LiveMatch): void {
  const season = game.season!
  const rng = Rng.fromState(game.rngState)
  applyResultToUser(game, u, res, live.userIsHome)
  applyResultToAi(game, live.opponentId, res, !live.userIsHome)
  game.lastCupMatch = res
  game.lastCupContext = live.ctx
  let winner = res.homeGoals > res.awayGoals ? tie.homeTeamId : res.awayGoals > res.homeGoals ? tie.awayTeamId : null
  let pens: { home: number; away: number } | undefined
  if (!winner) {
    pens = shootout(rng, res.homeReport.strength.overall, res.awayReport.strength.overall)
    winner = pens.home > pens.away ? tie.homeTeamId : tie.awayTeamId
  }
  tie.result = { ...res, penalties: pens }
  tie.winnerId = winner
  const won = winner === USER_TEAM
  const info = cupRounds(season.matchweeks).find((r) => r.round === tie.round)!
  if (!won) season.cupEliminated = true
  if (won && tie.round === 'F') season.cupWon = true
  news(game, { kind: 'cup', title: `${info.label}: ${won ? 'through' : 'out'}`, body: `${res.homeGoals}-${res.awayGoals}${pens ? ` (${pens.home}-${pens.away} on penalties)` : ''} against ${season.ai[live.opponentId].name}.${won && tie.round === 'F' ? ' The cup is yours!' : ''}` })
  game.rngState = rng.getState()
}

function drawNext(game: Game, u: LoadedUniverse, rng: Rng, round: CupTie['round']): void {
  const season = game.season!
  const rounds = cupRounds(season.matchweeks)
  const idx = rounds.findIndex((r) => r.round === round)
  if (idx < 0 || idx >= rounds.length - 1) return
  const next = drawNextCupRound(season.cup, rounds[idx + 1].round, rng, season.matchweeks)
  season.cup.push(...next)
  const userTie = next.find((t) => t.homeTeamId === USER_TEAM || t.awayTeamId === USER_TEAM)
  if (userTie) {
    const oppId = userTie.homeTeamId === USER_TEAM ? userTie.awayTeamId : userTie.homeTeamId
    news(game, { kind: 'cup', title: `${rounds[idx + 1].label} draw`, body: `${userTie.homeTeamId === USER_TEAM ? 'Home' : 'Away'} to ${season.ai[oppId]?.name ?? u.clubById[oppId]?.name ?? oppId}, after matchweek ${rounds[idx + 1].afterMatchweek}.` })
  }
}

/** Weekly housekeeping once every match of the week is done. */
function afterMatchweek(game: Game, u: LoadedUniverse): void {
  const season = game.season!
  const mw = season.matchweek
  const rng = Rng.fromState(game.rngState)
  trainingInjuries(game, u, rng)
  weeklyRecovery(game, u)
  const wages = squadWages(game, u)
  game.finances.wagesPaid += wages / 1000
  const flow = weeklyCashFlow(game.finances, wages)
  game.finances.budget = Math.round((game.finances.budget + flow) * 10) / 10
  if (flow > 0) game.finances.income += flow

  const newTable = computeTable(season.fixtures, [USER_TEAM, ...Object.keys(season.ai)])
  const userRow = newTable.find((r) => r.teamId === USER_TEAM)!
  const last = userRow.form[userRow.form.length - 1] ?? null
  season.confidence = updateConfidence(season.confidence, newTable, USER_TEAM, season.boardTarget, mw, last)
  if (game.settings.jobSecurity && mw >= 10 && season.confidence < 12 && mw < season.matchweeks) {
    season.sacked = true
    news(game, { kind: 'board', title: 'Sacked', body: 'The board has relieved you of your duties. The season ends here.' })
  }
  if (season.confidence < 20 && !game.unlocked.includes('survivor-pending')) game.unlocked.push('survivor-pending')

  // Transfer window: opens at the halfway point; three market days pass per matchweek, so it shuts three matchweeks later
  if (mw === Math.floor(season.matchweeks / 2) && !game.window) {
    game.window = openWindow({ u, rng, ownedPlayerIds: new Set(squadPlayers(game, u).map((x) => x.p.playerId)), leagueSeason: season.leagueSeason, priceLevel: 1.05, fromSeason: game.settings.rules.fromSeason, toSeason: game.settings.rules.toSeason, leagues: game.settings.wheelLeagues }, 'january')
    news(game, { kind: 'transfer', title: 'January window open', body: `${game.window.listings.length} players are available. Budget £${game.finances.budget}M.` })
  } else if (game.window && game.window.kind === 'january') {
    for (let i = 0; i < 3; i++) {
      if (game.window.day < game.window.days) advanceWindow({ u, rng, ownedPlayerIds: new Set(squadPlayers(game, u).map((x) => x.p.playerId)), leagueSeason: season.leagueSeason, priceLevel: 1.05, leagues: game.settings.wheelLeagues }, game.window, squadPlayers(game, u).map((x) => ({ ...x, listed: game.contracts[x.p.id]?.listed })), Object.keys(season.ai))
    }
    if (game.window.day >= game.window.days) {
      news(game, { kind: 'transfer', title: 'Window closed', body: 'The January window has shut.' })
      game.window = null
    }
  }

  game.pendingEvent = null
  if (mw < season.matchweeks && rng.chance(0.42)) {
    const ctx = eventContext(game, u, rng, newTable)
    const ev = rollEvent(ctx)
    if (ev) game.pendingEvent = ev
  }
  game.phase = 'match'
  game.rngState = rng.getState()
  if (mw >= season.matchweeks || season.sacked) finishSeason(game, u)
}

export function eventContext(game: Game, u: LoadedUniverse, rng: Rng, table?: ReturnType<typeof computeTable>): EventContext {
  const season = game.season!
  const t = table ?? computeTable(season.fixtures, [USER_TEAM, ...Object.keys(season.ai)])
  const row = t.find((r) => r.teamId === USER_TEAM)!
  const next = nextOpponent(game)
  const host = u.clubById[season.hostClubId]
  const lastFixture = [...season.fixtures].filter((f) => f.result && (f.homeTeamId === USER_TEAM || f.awayTeamId === USER_TEAM)).sort((a, b) => b.matchweek - a.matchweek)[0]
  let beatRival = false
  if (lastFixture?.result && host) {
    const home = lastFixture.homeTeamId === USER_TEAM
    const opp = home ? lastFixture.awayTeamId : lastFixture.homeTeamId
    const gf = home ? lastFixture.result.homeGoals : lastFixture.result.awayGoals
    const ga = home ? lastFixture.result.awayGoals : lastFixture.result.homeGoals
    beatRival = host.rivals.includes(opp) && gf > ga
  }
  return {
    rng,
    matchweek: season.matchweek,
    expiring: squadPlayers(game, u).filter((x) => (game.contracts[x.p.id]?.years ?? 1) <= 1 && !game.contracts[x.p.id]?.renewed && !game.contracts[x.p.id]?.declined),
    recentForm: row.form,
    beatRival,
    squad: squadPlayers(game, u).map((x) => ({ p: x.p, s: x.s, consecutiveMissed: game.consecutiveMissed[x.p.id] ?? 0 })),
    unbeaten: row.lost === 0,
    wins: row.won,
    losses: row.lost,
    position: positionOf(t, USER_TEAM),
    boardTarget: season.boardTarget,
    confidence: season.confidence,
    nextOpponentIsRival: !!next && !!host && host.rivals.includes(next.clubId),
    budget: game.finances.budget,
  }
}

export function applyEventChoice(game: Game, u: LoadedUniverse, choiceId: string): void {
  const ev = game.pendingEvent
  if (!ev) return
  const rng = Rng.fromState(game.rngState)
  const ctx = eventContext(game, u, rng)
  const out = resolveEvent(ev, choiceId, ctx)
  for (const m of out.moraleDelta ?? []) {
    const s = game.squad[m.playerSeasonId]
    if (s) s.morale = Math.max(10, Math.min(100, s.morale + m.delta))
  }
  if (out.teamMoraleDelta) for (const s of Object.values(game.squad)) s.morale = Math.max(10, Math.min(100, s.morale + out.teamMoraleDelta))
  for (const c of out.conditionDelta ?? []) {
    const s = game.squad[c.playerSeasonId]
    if (s) s.condition = Math.max(5, Math.min(100, s.condition + c.delta))
  }
  if (out.confidenceDelta && game.season) game.season.confidence = Math.max(0, Math.min(100, game.season.confidence + out.confidenceDelta))
  if (out.budgetDelta) game.finances.budget = Math.round((game.finances.budget + out.budgetDelta) * 10) / 10
  if (out.promiseStart) game.promisedStart = out.promiseStart
  if (out.nextMatchBoost) game.nextMatchBoost = out.nextMatchBoost
  if (out.captain) game.captainId = out.captain
  if (out.renewContract) {
    const c = game.contracts[out.renewContract.playerSeasonId]
    if (c) {
      c.renewed = true
      c.years = Math.max(c.years, 1)
    }
    const p = playerLookup(game, u)(out.renewContract.playerSeasonId)
    if (p) game.customPlayers[p.id] = { ...p, wage: Math.round(p.wage * 1.2) }
  }
  if (out.declineContract) {
    const c = game.contracts[out.declineContract]
    if (c) c.declined = true
  }
  if (out.transferList) {
    const c = game.contracts[out.transferList]
    if (c) c.listed = true
  }
  if (out.clearInjury) {
    const s = game.squad[out.clearInjury.playerSeasonId]
    if (s && s.injury) {
      if (rng.chance(out.clearInjury.setbackChance)) {
        s.injury.weeksOut += rng.int(2, 4)
        news(game, { kind: 'injury', title: 'Setback', body: `${playerLookup(game, u)(out.clearInjury.playerSeasonId)?.name} broke down in training. ${s.injury.weeksOut} more weeks.` })
      } else {
        s.injury = null
        s.sharpness = Math.max(40, s.sharpness - 10)
      }
    }
  }
  if (ev.id === 'agent' && choiceId === 'meet') game.bonusSpins += 1
  news(game, { kind: 'event', title: ev.title, body: out.text })
  game.pendingEvent = null
  game.rngState = rng.getState()
}

/** Pre-season friendly, played live like any other match. */
export function playFriendly(game: Game, u: LoadedUniverse): void {
  if (!game.season || game.friendliesPlayed >= 3 || game.live) return
  const rng = Rng.fromState(game.rngState)
  if (lineupProblems(game, u).length) autoPick(game, u, true)
  const user = userInput(game, u)
  const pool = u.clubSeasons.filter((cs) => (cs.position >= 8 || cs.position === 0) && (!game.settings.wheelLeagues.length || game.settings.wheelLeagues.includes(cs.leagueId)))
  const cs = rng.pick(pool)
  const club = u.clubById[cs.clubId]
  const oppTactics = { ...game.season.ai[Object.keys(game.season.ai)[0]].tactics }
  const byId = new Map(cs.squad.map((p) => [p.id, p]))
  const formation = getFormation(oppTactics.formationId)
  const picked = autoPickLineup(formation, cs.squad, oppTactics)
  const key = `${cs.clubId}@${cs.season}`
  const label = `${club?.name ?? cs.clubId} ${cs.season}-${String((cs.season + 1) % 100).padStart(2, '0')}`
  const opp: MatchTeamInput = { teamId: `friendly-${cs.clubId}`, teamName: label, shortName: club?.shortName ?? cs.clubId, tactics: oppTactics, lineup: picked.lineup, bench: picked.bench, getPlayer: (id) => byId.get(id), getState: () => undefined, ratingOffset: game.season.aiOffset }
  const mp = beginMatch({ rng, home: user, away: opp, neutral: true, detail: 'full', importance: 0.9, importanceLabel: 'Pre-season friendly' })
  game.live = { kind: 'friendly', mp, ctx: { matchweek: 0, competition: 'league', roundLabel: 'Friendly', opponentClubId: cs.clubId, home: true, importanceLabel: `Pre-season friendly v ${label}` }, userIsHome: true, opponentId: key }
  game.phase = 'match'
  game.rngState = rng.getState()
}

export function startSeasonProper(game: Game): void {
  if (game.phase === 'preseason') {
    game.phase = 'week'
    if (game.window?.kind === 'summer') {
      game.season?.news.unshift({ matchweek: 0, kind: 'transfer', title: 'Summer window closed', body: 'The season is under way. The next window opens in January.' })
      game.window = null
    }
  }
}

export function finishSeason(game: Game, u: LoadedUniverse): void {
  const season = game.season!
  const table = computeTable(season.fixtures, [USER_TEAM, ...Object.keys(season.ai)])
  const row = table.find((r) => r.teamId === USER_TEAM)!
  const pos = positionOf(table, USER_TEAM)
  const tier = season.sacked ? 'RELEGATED' : seasonTier(table, USER_TEAM, season.cupWon, season.matchweeks)
  game.tier = tier
  const squad = squadPlayers(game, u)
  game.awards = computeAwards(squad, season.matchweeks)
  const prize = season.sacked ? 0 : prizeMoney(pos, season.cupWon)
  game.finances.budget = Math.round((game.finances.budget + prize) * 10) / 10
  game.finances.income += prize
  game.history.push({
    year: game.year,
    leagueId: season.leagueId,
    leagueSeason: season.leagueSeason,
    teamName: game.settings.teamName,
    hostClubId: season.hostClubId,
    position: pos,
    points: row.points,
    won: row.won,
    drawn: row.drawn,
    lost: row.lost,
    goalsFor: row.goalsFor,
    goalsAgainst: row.goalsAgainst,
    tier,
    cupWon: season.cupWon,
    potsName: game.awards.playerOfTheSeason?.name,
    bootName: game.awards.goldenBoot?.name,
    bootGoals: game.awards.goldenBoot ? Number(game.awards.goldenBoot.value.split(' ')[0]) : undefined,
  })
  const unlock = (id: string) => {
    if (!game.unlocked.includes(id)) game.unlocked.push(id)
  }
  if (tier === 'PERFECT') unlock('perfect')
  if (tier === 'PERFECT' || tier === 'INVINCIBLE') unlock('invincible')
  if (pos === 1) unlock('champions')
  if (row.points >= 100) unlock('centurions')
  if (season.cupWon) unlock('cup')
  if (season.cupWon && pos === 1) unlock('double')
  if (game.awards.goldenBoot && Number(game.awards.goldenBoot.value.split(' ')[0]) >= 30) unlock('boot30')
  if (game.awards.goldenGlove && Number(game.awards.goldenGlove.value.split(' ')[0]) >= 20) unlock('glove20')
  if (pos === 1 && game.settings.rules.hardMode) unlock('hard-champions')
  if (pos === 1 && game.settings.rules.onlyClub) unlock('one-club-champions')
  if (game.unlocked.includes('survivor-pending') && !season.sacked) unlock('survivor')
  const titles = game.history.slice(-3).filter((h) => h.position === 1).length
  if (titles >= 3) unlock('dynasty-3')
  game.unlocked = game.unlocked.filter((x) => x !== 'survivor-pending')
  news(game, { kind: 'award', title: 'Season over', body: `${row.won}W ${row.drawn}D ${row.lost}L, ${row.points} points, ${pos}${['th', 'st', 'nd', 'rd'][pos % 10 > 3 || (pos % 100 >= 11 && pos % 100 <= 13) ? 0 : pos % 10]}. Prize money £${prize}M.` })
  game.phase = 'summary'
}
