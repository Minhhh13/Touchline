import type { Game } from '../types'
import type { LoadedUniverse } from '@engine/universe'
import { Rng } from '@engine/rng'
import { simulateMatch, type FullMatchResult, type MatchTeamInput } from '@engine/match'
import { aiTeamInput, applyMatchToState, benchMoraleDrift, computeTable, CUP_ROUNDS, describeImportance, drawNextCupRound, MATCHWEEKS, positionOf, recoverWeek, seasonTier, shootout, updateConfidence, USER_TEAM, userTeamInput, type CupTie, type NewsItem } from '@engine/season'
import { TRAINING } from '@engine/training'
import { rollEvent, resolveEvent, type EventContext } from '@engine/events'
import { advanceWindow, openWindow, prizeMoney, weeklyCashFlow } from '@engine/market'
import { computeAwards } from '@engine/awards'
import { playerLookup, squadPlayers } from './players'
import { autoPick, lineupProblems, squadWages } from './squad'
import { getFormation } from '@engine/formations'
import { autoPickLineup } from '@engine/ratings'

function news(game: Game, item: Omit<NewsItem, 'matchweek'>): void {
  game.season!.news.unshift({ matchweek: game.season!.matchweek, ...item })
  if (game.season!.news.length > 120) game.season!.news.length = 120
}

function userInput(game: Game, u: LoadedUniverse): MatchTeamInput {
  const get = playerLookup(game, u)
  const input = userTeamInput(u, { teamName: game.settings.teamName, shortName: game.settings.shortName, tactics: game.tactics, lineup: game.lineup, bench: game.bench, state: game.squad, teamTalk: game.teamTalk })
  return { ...input, getPlayer: get }
}

/** Apply training and one-off boosts as multipliers on the user's tactics for this match only. */
function matchBoosts(game: Game): { attack: number; defence: number } {
  const t = TRAINING[game.training]
  let attack = t.attack
  let defence = t.defence
  if (game.nextMatchBoost?.attack) attack *= 1 + game.nextMatchBoost.attack / 100
  if (game.nextMatchBoost?.defence) defence *= 1 - game.nextMatchBoost.defence / 100
  return { attack, defence }
}

/** Simulate the user's match with training and one-off boosts applied to expected goals. */
function simulateUserMatch(rng: Rng, home: MatchTeamInput, away: MatchTeamInput, opts: { importance: number; label?: string; neutral: boolean; userIsHome: boolean; attack: number; defence: number }): FullMatchResult {
  const boost = { attack: opts.attack, defence: opts.defence }
  return simulateMatch({ rng, home, away, importance: opts.importance, importanceLabel: opts.label, neutral: opts.neutral, detail: 'full', boosts: opts.userIsHome ? { home: boost } : { away: boost } })
}

function applyResultToUser(game: Game, u: LoadedUniverse, res: FullMatchResult, userIsHome: boolean): void {
  const stats = userIsHome ? res.homeStats : res.awayStats
  const gf = userIsHome ? res.homeGoals : res.awayGoals
  const ga = userIsHome ? res.awayGoals : res.homeGoals
  const result: 'W' | 'D' | 'L' = gf > ga ? 'W' : gf === ga ? 'D' : 'L'
  const starters = new Set(Object.values(game.lineup))
  const played = new Set<string>()
  for (const st of stats) {
    const s = game.squad[st.playerSeasonId]
    if (!s) continue
    played.add(st.playerSeasonId)
    applyMatchToState(s, st, starters.has(st.playerSeasonId), res.conditionLoss[st.playerSeasonId] ?? 0, ga === 0, res.motmId === st.playerSeasonId, result)
    if (st.injured) news(game, { kind: 'injury', title: `${playerLookup(game, u)(st.playerSeasonId)?.name} injured`, body: `${st.injured.description}. Out for around ${st.injured.weeksOut} week${st.injured.weeksOut === 1 ? '' : 's'}.` })
    if (st.red) news(game, { kind: 'suspension', title: `${playerLookup(game, u)(st.playerSeasonId)?.name} sent off`, body: `Suspended for ${s.suspension} match${s.suspension === 1 ? '' : 'es'}.` })
    if (st.yellow && s.yellowCards % 5 === 0) news(game, { kind: 'suspension', title: `${playerLookup(game, u)(st.playerSeasonId)?.name} suspended`, body: `Five yellow cards: a one-match ban.` })
  }
  for (const id of Object.keys(game.squad)) {
    if (played.has(id)) game.consecutiveMissed[id] = 0
    else game.consecutiveMissed[id] = (game.consecutiveMissed[id] ?? 0) + 1
  }
  // Promise check
  if (game.promisedStart) {
    const kept = starters.has(game.promisedStart)
    const s = game.squad[game.promisedStart]
    if (s) {
      s.morale = Math.max(10, Math.min(100, s.morale + (kept ? 5 : -16)))
      news(game, { kind: 'event', title: kept ? 'Promise kept' : 'Promise broken', body: kept ? `${playerLookup(game, u)(game.promisedStart)?.name} started as promised.` : `${playerLookup(game, u)(game.promisedStart)?.name} was promised a start and did not get one. He is furious.` })
    }
    game.promisedStart = undefined
  }
  game.nextMatchBoost = undefined
}

function applyResultToAi(game: Game, u: LoadedUniverse, teamId: string, res: FullMatchResult, isHome: boolean): void {
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
  void u
}

function weeklyRecovery(game: Game, u: LoadedUniverse, playedIds: Set<string>): void {
  const get = playerLookup(game, u)
  const t = TRAINING[game.training]
  for (const [id, s] of Object.entries(game.squad)) {
    const p = get(id)
    if (!p) continue
    recoverWeek(s, p, playedIds.has(id), t.recovery)
    s.sharpness = Math.max(20, Math.min(100, s.sharpness + t.sharpness))
    s.familiarity = Math.min(100, s.familiarity + t.familiarity)
    benchMoraleDrift(s, p, game.consecutiveMissed[id] ?? 0)
  }
  for (const club of Object.values(game.season!.ai)) {
    for (const [id, s] of Object.entries(club.state)) {
      const p = get(id)
      if (!p) continue
      recoverWeek(s, p, true, 0)
    }
  }
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
  if (!game.season || game.season.matchweek >= MATCHWEEKS) return null
  const f = userFixture(game)
  const home = f.homeTeamId === USER_TEAM
  return { clubId: home ? f.awayTeamId : f.homeTeamId, home }
}

export function upcomingCupTie(game: Game): CupTie | null {
  if (!game.season || game.season.cupEliminated || game.season.cupWon) return null
  const mw = game.season.matchweek + 1
  return game.season.cup.find((t) => !t.result && t.afterMatchweek === mw && (t.homeTeamId === USER_TEAM || t.awayTeamId === USER_TEAM)) ?? null
}

/** Play the next matchweek (and any cup tie scheduled after it). */
export function playMatchweek(game: Game, u: LoadedUniverse, autoManage = false): void {
  const season = game.season
  if (!season || season.matchweek >= MATCHWEEKS || season.sacked) return
  const rng = Rng.fromState(game.rngState)

  if (game.pendingEvent && autoManage) {
    const ev = game.pendingEvent
    applyEventChoice(game, u, ev.choices[Math.min(1, ev.choices.length - 1)].id)
  }
  if (lineupProblems(game, u).length || autoManage) autoPick(game, u, !autoManage)

  const mw = season.matchweek + 1
  const table = computeTable(season.fixtures, [USER_TEAM, ...Object.keys(season.ai)])
  const week = season.fixtures.filter((f) => f.matchweek === mw)
  const playedIds = new Set<string>()
  const user = userInput(game, u)
  const boosts = matchBoosts(game)

  for (const f of week) {
    const userIsHome = f.homeTeamId === USER_TEAM
    const userIsAway = f.awayTeamId === USER_TEAM
    if (userIsHome || userIsAway) {
      const opponentId = userIsHome ? f.awayTeamId : f.homeTeamId
      const imp = describeImportance(u, season.hostClubId, opponentId, table, mw)
      const opp = aiTeamInput(u, season.ai[opponentId], season.aiOffset)
      const res = simulateUserMatch(rng, userIsHome ? user : opp, userIsHome ? opp : user, { importance: imp.importance, label: imp.label, neutral: false, userIsHome, attack: boosts.attack, defence: boosts.defence })
      f.result = res
      applyResultToUser(game, u, res, userIsHome)
      applyResultToAi(game, u, opponentId, res, !userIsHome)
      for (const st of userIsHome ? res.homeStats : res.awayStats) playedIds.add(st.playerSeasonId)
      game.lastMatch = res
      game.lastMatchContext = { matchweek: mw, competition: 'league', opponentClubId: opponentId, home: userIsHome, importanceLabel: imp.label }
      const gf = userIsHome ? res.homeGoals : res.awayGoals
      const ga = userIsHome ? res.awayGoals : res.homeGoals
      news(game, { kind: 'result', title: `${userIsHome ? game.settings.shortName : season.ai[opponentId].shortName} ${res.homeGoals}-${res.awayGoals} ${userIsHome ? season.ai[opponentId].shortName : game.settings.shortName}`, body: gf > ga ? 'Three points.' : gf === ga ? 'A point apiece.' : 'A defeat to learn from.' })
    } else {
      const home = aiTeamInput(u, season.ai[f.homeTeamId], season.aiOffset)
      const away = aiTeamInput(u, season.ai[f.awayTeamId], season.aiOffset)
      const res = simulateMatch({ rng, home, away, detail: 'summary' })
      f.result = res
      applyResultToAi(game, u, f.homeTeamId, res, true)
      applyResultToAi(game, u, f.awayTeamId, res, false)
    }
  }
  season.matchweek = mw

  // Cup tie this week?
  game.lastCupMatch = null
  game.lastCupContext = null
  const roundInfo = CUP_ROUNDS.find((r) => r.afterMatchweek === mw)
  if (roundInfo) playCupRound(game, u, rng, roundInfo.round, playedIds)

  // Weekly housekeeping
  trainingInjuries(game, u, rng)
  weeklyRecovery(game, u, playedIds)
  const wages = squadWages(game, u)
  game.finances.wagesPaid += wages / 1000
  const flow = weeklyCashFlow(game.finances, wages)
  game.finances.budget = Math.round((game.finances.budget + flow) * 10) / 10
  if (flow > 0) game.finances.income += flow

  const newTable = computeTable(season.fixtures, [USER_TEAM, ...Object.keys(season.ai)])
  const userRow = newTable.find((r) => r.teamId === USER_TEAM)!
  const last = userRow.form[userRow.form.length - 1] ?? null
  season.confidence = updateConfidence(season.confidence, newTable, USER_TEAM, season.boardTarget, mw, last)
  if (game.settings.jobSecurity && mw >= 10 && season.confidence < 12 && mw < MATCHWEEKS) {
    season.sacked = true
    news(game, { kind: 'board', title: 'Sacked', body: 'The board has relieved you of your duties. The season ends here.' })
  }
  if (season.confidence < 20 && !game.unlocked.includes('survivor-pending')) game.unlocked.push('survivor-pending')

  // Transfer window: opens after matchweek 19; three market days pass per matchweek, so it shuts after matchweek 22
  if (mw === 19 && !game.window) {
    game.window = openWindow({ u, rng, ownedPlayerIds: new Set(squadPlayers(game, u).map((x) => x.p.playerId)), leagueSeason: season.leagueSeason, priceLevel: 1.05, fromSeason: game.settings.rules.fromSeason, toSeason: game.settings.rules.toSeason }, 'january')
    news(game, { kind: 'transfer', title: 'January window open', body: `${game.window.listings.length} players are available. Budget £${game.finances.budget}M.` })
  } else if (game.window && game.window.kind === 'january') {
    for (let i = 0; i < 3; i++) {
      if (game.window.day < game.window.days) advanceWindow({ u, rng, ownedPlayerIds: new Set(squadPlayers(game, u).map((x) => x.p.playerId)), leagueSeason: season.leagueSeason, priceLevel: 1.05 }, game.window, squadPlayers(game, u), Object.keys(season.ai))
    }
    if (game.window.day >= game.window.days) {
      news(game, { kind: 'transfer', title: 'Window closed', body: 'The January window has shut.' })
      game.window = null
    }
  }

  // Random event
  game.pendingEvent = null
  if (mw < MATCHWEEKS && rng.chance(0.42)) {
    const ctx = eventContext(game, u, rng, newTable)
    const ev = rollEvent(ctx)
    if (ev) game.pendingEvent = ev
  }

  game.phase = 'match'
  game.rngState = rng.getState()

  if (mw >= MATCHWEEKS || season.sacked) finishSeason(game, u)
}

function playCupRound(game: Game, u: LoadedUniverse, rng: Rng, round: CupTie['round'], playedIds: Set<string>): void {
  const season = game.season!
  const ties = season.cup.filter((t) => t.round === round && !t.result)
  const info = CUP_ROUNDS.find((r) => r.round === round)!
  for (const tie of ties) {
    const userIsHome = tie.homeTeamId === USER_TEAM
    const userIsAway = tie.awayTeamId === USER_TEAM
    const neutral = round === 'F'
    let res: FullMatchResult
    if (userIsHome || userIsAway) {
      // Second match of the week: tired legs. The user lineup is re-validated; rotation is up to them.
      if (lineupProblems(game, u).length) autoPick(game, u, true)
      const user = userInput(game, u)
      const opponentId = userIsHome ? tie.awayTeamId : tie.homeTeamId
      const imp = describeImportance(u, season.hostClubId, opponentId, null, season.matchweek, round)
      const opp = aiTeamInput(u, season.ai[opponentId], season.aiOffset)
      res = simulateMatch({ rng, home: userIsHome ? user : opp, away: userIsHome ? opp : user, importance: imp.importance, importanceLabel: imp.label ?? info.label, neutral, detail: 'full' })
      applyResultToUser(game, u, res, userIsHome)
      applyResultToAi(game, u, opponentId, res, !userIsHome)
      for (const st of userIsHome ? res.homeStats : res.awayStats) playedIds.add(st.playerSeasonId)
      game.lastCupMatch = res
      game.lastCupContext = { matchweek: season.matchweek, competition: 'cup', roundLabel: info.label, opponentClubId: opponentId, home: userIsHome, importanceLabel: imp.label }
    } else {
      const home = aiTeamInput(u, season.ai[tie.homeTeamId], season.aiOffset)
      const away = aiTeamInput(u, season.ai[tie.awayTeamId], season.aiOffset)
      res = simulateMatch({ rng, home, away, neutral, detail: 'summary' })
      applyResultToAi(game, u, tie.homeTeamId, res, true)
      applyResultToAi(game, u, tie.awayTeamId, res, false)
    }
    let winner = res.homeGoals > res.awayGoals ? tie.homeTeamId : res.awayGoals > res.homeGoals ? tie.awayTeamId : null
    let pens: { home: number; away: number } | undefined
    if (!winner) {
      pens = shootout(rng, res.homeReport.strength.overall, res.awayReport.strength.overall)
      winner = pens.home > pens.away ? tie.homeTeamId : tie.awayTeamId
    }
    tie.result = { ...res, penalties: pens }
    tie.winnerId = winner
    if (userIsHome || userIsAway) {
      const won = winner === USER_TEAM
      if (!won) season.cupEliminated = true
      if (won && round === 'F') season.cupWon = true
      news(game, { kind: 'cup', title: `${info.label}: ${won ? 'through' : 'out'}`, body: `${res.homeGoals}-${res.awayGoals}${pens ? ` (${pens.home}-${pens.away} on penalties)` : ''} against ${season.ai[userIsHome ? tie.awayTeamId : tie.homeTeamId].name}.${won && round === 'F' ? ' The cup is yours!' : ''}` })
    }
  }
  // Draw the next round
  const idx = CUP_ROUNDS.findIndex((r) => r.round === round)
  if (idx >= 0 && idx < CUP_ROUNDS.length - 1) {
    const next = drawNextCupRound(season.cup, CUP_ROUNDS[idx + 1].round, rng)
    season.cup.push(...next)
    const userTie = next.find((t) => t.homeTeamId === USER_TEAM || t.awayTeamId === USER_TEAM)
    if (userTie) {
      const oppId = userTie.homeTeamId === USER_TEAM ? userTie.awayTeamId : userTie.homeTeamId
      news(game, { kind: 'cup', title: `${CUP_ROUNDS[idx + 1].label} draw`, body: `${userTie.homeTeamId === USER_TEAM ? 'Home' : 'Away'} to ${season.ai[oppId]?.name ?? oppId}, after matchweek ${CUP_ROUNDS[idx + 1].afterMatchweek}.` })
    }
  }
}

export function eventContext(game: Game, u: LoadedUniverse, rng: Rng, table?: ReturnType<typeof computeTable>): EventContext {
  const season = game.season!
  const t = table ?? computeTable(season.fixtures, [USER_TEAM, ...Object.keys(season.ai)])
  const row = t.find((r) => r.teamId === USER_TEAM)!
  const next = nextOpponent(game)
  const host = u.clubById[season.hostClubId]
  return {
    rng,
    matchweek: season.matchweek,
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
  if (ev.id === 'agent' && choiceId === 'meet') game.bonusSpins += 1
  news(game, { kind: 'event', title: ev.title, body: out.text })
  game.pendingEvent = null
  game.rngState = rng.getState()
}

/** Preseason friendly: sharpness and familiarity up, with a small injury risk. */
export function playFriendly(game: Game, u: LoadedUniverse): void {
  if (!game.season || game.friendliesPlayed >= 3) return
  const rng = Rng.fromState(game.rngState)
  if (lineupProblems(game, u).length) autoPick(game, u, true)
  const user = userInput(game, u)
  // Opponent: a random club-season of modest strength from any era
  const pool = u.clubSeasons.filter((cs) => cs.position >= 8 || cs.position === 0)
  const cs = rng.pick(pool)
  const club = u.clubById[cs.clubId]
  const oppTactics = { ...game.season.ai[Object.keys(game.season.ai)[0]].tactics }
  const byId = new Map(cs.squad.map((p) => [p.id, p]))
  const formation = getFormation(oppTactics.formationId)
  const picked = autoPickLineup(formation, cs.squad, oppTactics)
  const opp: MatchTeamInput = { teamId: `friendly-${cs.clubId}`, teamName: `${club?.name ?? cs.clubId} ${cs.season}`, shortName: club?.shortName ?? cs.clubId, tactics: oppTactics, lineup: picked.lineup, bench: picked.bench, getPlayer: (id) => byId.get(id), getState: () => undefined, ratingOffset: game.season.aiOffset }
  const res = simulateMatch({ rng, home: user, away: opp, neutral: true, detail: 'full', importance: 0.9, importanceLabel: 'Pre-season friendly' })
  // Friendlies: lighter condition cost, bigger sharpness/familiarity gain, stats not counted
  for (const st of res.homeStats) {
    const s = game.squad[st.playerSeasonId]
    if (!s) continue
    s.condition = Math.max(40, s.condition - Math.round((res.conditionLoss[st.playerSeasonId] ?? 0) * 0.6))
    s.sharpness = Math.min(100, s.sharpness + 9)
    s.familiarity = Math.min(100, s.familiarity + 8)
    if (st.injured) s.injury = { ...st.injured }
  }
  for (const s of Object.values(game.squad)) s.condition = Math.min(100, s.condition + 14)
  game.friendliesPlayed++
  game.lastMatch = res
  game.lastMatchContext = { matchweek: 0, competition: 'league', roundLabel: 'Friendly', opponentClubId: cs.clubId, home: true, importanceLabel: `Pre-season friendly v ${club?.name ?? cs.clubId} ${cs.season}-${String((cs.season + 1) % 100).padStart(2, '0')}` }
  news(game, { kind: 'info', title: `Friendly: ${res.homeGoals}-${res.awayGoals} v ${club?.shortName ?? cs.clubId} (${cs.season})`, body: 'Legs loosened, patterns rehearsed.' })
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
  const tier = season.sacked ? 'RELEGATED' : seasonTier(table, USER_TEAM, season.cupWon)
  game.tier = tier
  const squad = squadPlayers(game, u)
  game.awards = computeAwards(squad)
  const prize = season.sacked ? 0 : prizeMoney(pos, season.cupWon)
  game.finances.budget = Math.round((game.finances.budget + prize) * 10) / 10
  game.finances.income += prize
  game.history.push({
    year: game.year,
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
  // Achievements
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
