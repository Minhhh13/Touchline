/**
 * Gameplay sweep: a test-side recorder wrapped around the engine's match functions (see `matchMock.ts`). Every match
 * any mode plays passes through `onBegin` and `onFinish`, which check it against the match's own live sheets and
 * collect the feel numbers. It never draws from a game's stream: it only reads what the engine produced.
 */
import type { FullMatchResult, LivePlayer, MatchInProgress, MatchOptions, TeamLookups } from '@engine/match'
import type { MatchEvent, PlayerSeason } from '@engine/types'

export interface Finding {
  kind: string
  detail: string
  ctx: string
}

const MAX_KEEP = 40

/** Glitches by kind: a count and the first few examples. */
export const findings = new Map<string, { n: number; examples: Finding[] }>()
let context = ''
export function setContext(label: string): void {
  context = label
}
export function flag(kind: string, detail: string): void {
  const f = findings.get(kind) ?? { n: 0, examples: [] }
  f.n++
  if (f.examples.length < MAX_KEEP) f.examples.push({ kind, detail, ctx: context })
  findings.set(kind, f)
}
/** How many times each check ran, so a check that never ran is not read as a clean bill. */
export const ticks: Record<string, number> = {}
export function tick(name: string): void {
  ticks[name] = (ticks[name] ?? 0) + 1
}
export function resetFindings(): void {
  findings.clear()
  for (const k of Object.keys(feel)) delete feel[k]
}

/** Feel numbers by bucket (a bucket per competition kind): sums and counts. */
export const feel: Record<string, Record<string, number>> = {}
let bucket = 'other'
export function setBucket(b: string): void {
  bucket = b
}
function add(key: string, v = 1): void {
  const b = (feel[bucket] ??= {})
  b[key] = (b[key] ?? 0) + v
}

/** Starters of both sides, a key that survives the store's copies of a live match. */
function startersKey(mp: Pick<MatchInProgress, 'hLive' | 'aLive' | 'home' | 'away'>): string {
  const ids = (l: LivePlayer[]) => l.filter((p) => p.onAt === 0).map((p) => p.psId).sort().join(',')
  return `${mp.home.teamId}|${mp.away.teamId}|${ids(mp.hLive)}|${ids(mp.aLive)}`
}

/** Who was unavailable at kick-off, per side, by starters key (a live match finishes in a later call). */
const unavailable = new Map<string, { home: Set<string>; away: Set<string> }>()

const keeperOnly = (ps: PlayerSeason | undefined) => !!ps && ps.positions.every((x) => x === 'GK')

export function onBegin(mp: MatchInProgress, opts: Pick<MatchOptions, 'home' | 'away'>): void {
  const sides = { home: new Set<string>(), away: new Set<string>() }
  for (const side of ['home', 'away'] as const) {
    const input = opts[side]
    // beginMatch has played the first half: the starters are the men on at 0
    const live = (side === 'home' ? mp.hLive : mp.aLive).filter((p) => p.onAt === 0)
    for (const id of new Set([...input.bench, ...live.map((p) => p.psId)])) {
      const st = input.getState(id)
      if (st?.injury || (st?.suspension ?? 0) > 0) sides[side].add(id)
    }
    const name = side === 'home' ? mp.home.teamName : mp.away.teamName
    for (const p of live) {
      if (sides[side].has(p.psId)) flag('unavailable-starter', `${name}: ${p.psId} starts ${input.getState(p.psId)?.injury ? 'injured' : 'suspended'}`)
      const ps = input.getPlayer(p.psId)
      if (!ps) flag('unknown-player', `${name}: ${p.psId}`)
      if (p.position !== 'GK' && keeperOnly(ps)) flag('keeper-starts-outfield', `${name}: ${ps!.name} in ${p.slotId} (${p.position})`)
    }
    if (!live.some((p) => p.position === 'GK')) flag('no-keeper-slot', name)
    else if (!live.some((p) => p.position === 'GK' && input.getPlayer(p.psId)?.positions.includes('GK'))) {
      const gk = live.find((p) => p.position === 'GK')!
      const bench = input.bench.map((id) => input.getPlayer(id)).filter((ps) => ps?.positions.includes('GK') && !sides[side].has(ps.id))
      flag(bench.length ? 'outfielder-in-goal-with-keeper-on-bench' : 'outfielder-in-goal', `${name}: ${input.getPlayer(gk.psId)?.name} (${input.getPlayer(gk.psId)?.positions.join('/')})`)
    }
    if (live.length !== 11) flag('not-eleven', `${name}: ${live.length} starters`)
  }
  const ids = new Set<string>()
  for (const p of [...mp.hLive, ...mp.aLive].filter((q) => q.onAt === 0)) {
    if (ids.has(p.psId)) flag('player-twice-at-kickoff', `${p.psId} for ${mp.home.teamName} and ${mp.away.teamName}`)
    ids.add(p.psId)
  }
  const people = new Map<string, string>()
  for (const [side, live, input] of [['home', mp.hLive, opts.home], ['away', mp.aLive, opts.away]] as const) {
    for (const p of live.filter((q) => q.onAt === 0)) {
      const pid = input.getPlayer(p.psId)?.playerId
      if (!pid) continue
      const other = people.get(pid)
      if (other && other !== side) flag('same-person-both-sides', `${input.getPlayer(p.psId)?.name} (${p.psId}) for ${mp.home.teamName} and ${mp.away.teamName}`)
      people.set(pid, side)
    }
  }
  unavailable.set(startersKey(mp), sides)
}

const SCORING = new Set(['goal', 'penalty'])
/** Events naming a man who must be on the pitch at that minute (the substitution's off man is checked apart). */
const ACTING = new Set(['goal', 'penalty', 'yellow', 'red', 'injury', 'chance', 'save'])

/** Men taken off by the manager (at a stop or in play): the change applies after the minute's events. */
const byHand = new Set<LivePlayer>()

function onAtMinute(l: LivePlayer, minute: number, type: string): boolean {
  const m = Math.min(minute, 90)
  if (l.onAt > m) return false
  // The event that takes him off happens at his off minute, and a manager's change comes after the minute's play
  if (l.offAt < 90 && m >= l.offAt) return m === l.offAt && (byHand.has(l) || type === 'red' || type === 'injury' || type === 'yellow')
  return true
}

export function onFinish(mp: MatchInProgress, res: FullMatchResult, lookups: { home: TeamLookups; away: TeamLookups }): void {
  tick('match')
  if (res.homeReport.substitutions.length + res.awayReport.substitutions.length) tick('match-with-subs')
  const key = startersKey(mp)
  const unav = unavailable.get(key)
  unavailable.delete(key)
  const label = `${res.homeName} ${res.homeGoals}-${res.awayGoals} ${res.awayName}`
  // Score against the events
  const goals = { home: 0, away: 0 }
  const ht = { home: 0, away: 0 }
  for (const e of res.events) {
    if (SCORING.has(e.type) || e.type === 'own_goal') {
      goals[e.side]++
      if (e.minute <= 45) ht[e.side]++
    }
  }
  if (goals.home !== res.homeGoals || goals.away !== res.awayGoals) flag('score-vs-events', `${label}: events say ${goals.home}-${goals.away}`)
  if (res.homeGoals < 0 || res.awayGoals < 0 || res.homeGoals > 12 || res.awayGoals > 12) flag('impossible-score', label)
  if (Math.max(res.homeGoals, res.awayGoals) >= 7) {
    const sheet = (l: LivePlayer[], look: TeamLookups) => l.filter((p) => p.onAt === 0).map((p) => { const ps = look.getPlayer(p.psId); const st = look.getState(p.psId); return `${p.position}:${ps?.positions.join('/')}:${ps?.overall}:c${Math.round(st?.condition ?? -1)}` }).join(' ')
    flag('seven-plus-detail', `${label} xg ${mp.lamH.toFixed(2)}-${mp.lamA.toFixed(2)} str ${mp.home.strength.overall.toFixed(1)}(off ${mp.home.ratingOffset})-${mp.away.strength.overall.toFixed(1)}(off ${mp.away.ratingOffset}) imp ${mp.importance} | H ${sheet(mp.hLive, lookups.home)} | A ${sheet(mp.aLive, lookups.away)}`)
  }
  if (ht.home !== res.halfTimeScore.home || ht.away !== res.halfTimeScore.away) flag('half-time-vs-events', `${label}: HT ${res.halfTimeScore.home}-${res.halfTimeScore.away}, events ${ht.home}-${ht.away}`)
  // Order and the whistle
  const ft = res.events.filter((e) => e.type === 'full_time')
  if (ft.length !== 1) flag('full-time-count', `${label}: ${ft.length}`)
  const ftAt = res.events.findIndex((e) => e.type === 'full_time')
  if (ftAt >= 0 && ftAt !== res.events.length - 1) flag('event-after-full-time', `${label}: ${res.events.slice(ftAt + 1).map((e) => `${e.minute}' ${e.type}`).join(', ')}`)
  for (let i = 1; i < res.events.length; i++) if (res.events[i].minute < res.events[i - 1].minute) flag('events-out-of-order', `${label}: ${res.events[i - 1].minute}' then ${res.events[i].minute}'`)
  for (const e of res.events) {
    if (e.minute < 0 || e.minute > 95) flag('event-minute-out-of-range', `${label}: ${e.minute}' ${e.type}`)
    if (e.minute > 90 && e.type !== 'goal' && e.type !== 'penalty' && e.type !== 'own_goal' && e.type !== 'full_time') flag('non-goal-in-stoppage', `${label}: ${e.minute}' ${e.type}`)
  }
  byHand.clear()
  for (const side of ['home', 'away'] as const) {
    const live = side === 'home' ? mp.hLive : mp.aLive
    for (const s of side === 'home' ? mp.hSubs : mp.aSubs) {
      const off = live.find((p) => p.psId === s.off)
      if (off && (s.reason === 'manager' || s.reason === 'half-time' || s.reason === '70th minute')) byHand.add(off)
    }
  }
  // The sheets: each man once, each slot one man at a time, eleven at most
  for (const side of ['home', 'away'] as const) {
    const live = side === 'home' ? mp.hLive : mp.aLive
    const subs = side === 'home' ? mp.hSubs : mp.aSubs
    const look = lookups[side]
    const name = side === 'home' ? res.homeName : res.awayName
    const seen = new Set<string>()
    for (const p of live) {
      if (seen.has(p.psId)) flag('player-twice-on-sheet', `${name}: ${p.psId}`)
      seen.add(p.psId)
      if (p.offAt < p.onAt) flag('off-before-on', `${name}: ${p.psId} on ${p.onAt} off ${p.offAt}`)
    }
    for (let m = 1; m <= 90; m++) {
      const on = live.filter((p) => p.onAt <= m && p.offAt > m && !p.red)
      if (on.length > 11) flag('more-than-eleven', `${label} ${name} at ${m}': ${on.length}`)
      const slots = new Map<string, number>()
      for (const p of on) slots.set(p.slotId, (slots.get(p.slotId) ?? 0) + 1)
      for (const [slot, n] of slots) if (n > 1) flag('two-in-one-slot', `${label} ${name} ${slot} at ${m}'`)
    }
    const subEvents = res.events.filter((e) => e.type === 'substitution' && e.side === side)
    if (subs.length > 5 || subEvents.length > 5) flag('subs-over-max', `${label} ${name}: ${subs.length} subs, ${subEvents.length} events`)
    if (subs.length !== subEvents.length) flag('subs-vs-events', `${label} ${name}: ${subs.length} subs, ${subEvents.length} events`)
    for (const s of subs) {
      const on = look.getPlayer(s.on)
      const slot = live.find((p) => p.psId === s.on)
      if (!slot) {
        flag('sub-not-on-sheet', `${label} ${name}: ${s.on}`)
        continue
      }
      if (slot.position !== 'GK' && keeperOnly(on)) flag(s.reason === 'manager' || s.reason === 'half-time' || s.reason === '70th minute' ? 'keeper-outfield-by-hand' : 'keeper-outfield-auto', `${label} ${name}: ${on!.name} for ${s.off} in ${slot.slotId} (${s.reason}, ${s.minute}')`)
      if (unav?.[side].has(s.on)) flag(s.reason === 'manager' || s.reason === 'half-time' || s.reason === '70th minute' ? 'unavailable-sub-by-hand' : 'unavailable-sub-auto', `${label} ${name}: ${on?.name} (${s.reason})`)
      const off = live.find((p) => p.psId === s.off)
      if (off?.red && off.offAt <= s.minute) flag('sent-off-man-substituted', `${label} ${name}: ${s.off} red at ${off.offAt}, subbed at ${s.minute}`)
      if (off?.injury && off.offAt < s.minute && s.reason !== 'injury') flag('injured-man-substituted-late', `${label} ${name}: ${s.off} injured at ${off.offAt}, subbed at ${s.minute}`)
    }
    // Every acting event names a man on the pitch then
    const reds = new Map<string, number>()
    const yellows = new Map<string, number>()
    for (const e of res.events) {
      if (!e.playerId) continue
      if (e.type === 'own_goal') {
        // The own goal's man is the other side's
        if (e.side === side) continue
        const l = live.find((p) => p.psId === e.playerId)
        if (!l || !onAtMinute(l, e.minute, e.type)) flag('own-goal-by-absent-man', `${label}: ${e.playerName} ${e.minute}'`)
        continue
      }
      if (e.side !== side) continue
      if (e.type === 'yellow') yellows.set(e.playerId, (yellows.get(e.playerId) ?? 0) + 1)
      if (ACTING.has(e.type)) {
        const l = live.find((p) => p.psId === e.playerId)
        if (!l) flag('event-by-man-not-on-sheet', `${label}: ${e.minute}' ${e.type} ${e.playerName}`)
        else if (!onAtMinute(l, e.minute, e.type)) flag(e.type === 'goal' || e.type === 'penalty' ? 'goal-by-man-off-the-pitch' : 'event-by-man-off-the-pitch', `${label}: ${e.minute}' ${e.type} ${e.playerName} (on ${l.onAt}, off ${l.offAt}${l.red ? ' red' : ''}${l.injury ? ' injured' : ''})`)
        const red = reds.get(e.playerId)
        if (red !== undefined && e.minute > red) flag('red-carded-man-acts', `${label}: ${e.playerName} red at ${red}, ${e.type} at ${e.minute}`)
        if (e.type === 'red') reds.set(e.playerId, e.minute)
      }
      if (e.type === 'substitution') {
        const off = live.find((p) => p.psId === e.playerId)
        const on = e.secondaryId ? live.find((p) => p.psId === e.secondaryId) : undefined
        if (!off || !on) flag('substitution-unknown-man', `${label}: ${e.text}`)
        else {
          if (off.onAt > e.minute) flag('subbed-off-before-on', `${label}: ${e.text}`)
          if (on.onAt !== e.minute) flag('sub-minute-mismatch', `${label}: ${e.text} at ${e.minute}, sheet ${on.onAt}`)
          const red = reds.get(off.psId)
          if (red !== undefined) flag('red-carded-man-subbed', `${label}: ${e.text}`)
        }
      }
      if ((e.type === 'goal' || e.type === 'penalty') && e.secondaryId) {
        if (e.secondaryId === e.playerId) flag('self-assist', `${label}: ${e.text}`)
        const a = live.find((p) => p.psId === e.secondaryId)
        if (!a || !onAtMinute(a, e.minute, 'goal')) flag('assist-by-man-off-the-pitch', `${label}: ${e.minute}' ${e.text}`)
      }
    }
    for (const [id, n] of yellows) {
      if (n > 1) flag('two-yellows-one-man', `${label}: ${id}`)
    }
    for (const [id] of reds) {
      const l = live.find((p) => p.psId === id)
      if (l && !l.red) flag('red-event-not-on-sheet', `${label}: ${id}`)
    }
    for (const p of live) if (p.red && !reds.has(p.psId)) flag('red-on-sheet-no-event', `${label}: ${p.psId}`)
    // Stats
    const stats = side === 'home' ? res.homeStats : res.awayStats
    let statGoals = 0
    for (const s of stats) {
      if (s.minutes < 0 || s.minutes > 90) flag('stat-minutes-out-of-range', `${label}: ${s.playerSeasonId} ${s.minutes}`)
      if (s.rating < 1 || s.rating > 10) flag('match-rating-out-of-range', `${label}: ${s.rating}`)
      statGoals += s.goals
      const evGoals = res.events.filter((e) => e.side === side && SCORING.has(e.type) && e.playerId === s.playerSeasonId).length
      if (evGoals !== s.goals) flag('stat-goals-vs-events', `${label}: ${s.playerSeasonId} ${s.goals} vs ${evGoals}`)
    }
    const ogFor = res.events.filter((e) => e.type === 'own_goal' && e.side === side).length
    if (statGoals + ogFor !== (side === 'home' ? res.homeGoals : res.awayGoals)) flag('stat-goals-vs-score', `${label} ${name}: stats ${statGoals} + og ${ogFor}`)
  }
  // Feel
  add('matches')
  add('goals', res.homeGoals + res.awayGoals)
  add('xg', mp.lamH + mp.lamA)
  if (mp.home.ratingOffset || mp.away.ratingOffset) add('offsetMatches')
  if (!res.neutral && !mp.neutral) {
    add('venueMatches')
    if (res.homeGoals > res.awayGoals) add('homeWins')
    else if (res.homeGoals === res.awayGoals) add('draws')
    else add('awayWins')
    add('homeGoals', res.homeGoals)
    add('awayGoals', res.awayGoals)
  }
  const diff = mp.home.strength.overall - mp.away.strength.overall
  if (Math.abs(diff) >= 5) {
    add('mismatches')
    const weakerWon = diff > 0 ? res.awayGoals > res.homeGoals : res.homeGoals > res.awayGoals
    if (weakerWon) add('upsets')
  }
  const count = (t: MatchEvent['type']) => res.events.filter((e) => e.type === t).length
  add('yellows', count('yellow'))
  add('reds', count('red'))
  add('injuries', count('injury'))
  add('penalties', count('penalty'))
  add('ownGoals', count('own_goal'))
  add('subs', mp.hSubs.length + mp.aSubs.length)
  add('stoppageGoals', res.events.filter((e) => e.minute > 90 && (SCORING.has(e.type) || e.type === 'own_goal')).length)
  if (res.homeGoals + res.awayGoals === 0) add('goalless')
  if (res.homeGoals + res.awayGoals >= 7) add('sevenPlus')
  const keeperCards = res.events.filter((e) => (e.type === 'yellow' || e.type === 'red') && [...mp.hLive, ...mp.aLive].find((p) => p.psId === e.playerId)?.position === 'GK').length
  add('keeperCards', keeperCards)
}

/** A plain-text report of the findings and feel, for the sweep's output. */
export function report(): string {
  const lines: string[] = [`checks run: ${JSON.stringify(ticks)}`]
  for (const [kind, f] of [...findings].sort((a, b) => b[1].n - a[1].n)) {
    lines.push(`${kind}: ${f.n}`)
    for (const e of f.examples.slice(0, 4)) lines.push(`    [${e.ctx}] ${e.detail}`)
  }
  for (const [b, v] of Object.entries(feel)) {
    const m = v.matches || 1
    const vm = v.venueMatches || 1
    lines.push(`feel ${b}: ${v.matches} matches, ${(v.goals / m).toFixed(2)} goals/game (kick-off xG ${((v.xg ?? 0) / m).toFixed(2)}, ${(100 * (v.offsetMatches ?? 0) / m).toFixed(0)}% calibrated), home ${(100 * (v.homeWins ?? 0) / vm).toFixed(1)}% draw ${(100 * (v.draws ?? 0) / vm).toFixed(1)}% away ${(100 * (v.awayWins ?? 0) / vm).toFixed(1)}%, home goals ${((v.homeGoals ?? 0) / vm).toFixed(2)} away ${((v.awayGoals ?? 0) / vm).toFixed(2)}, upsets ${(100 * (v.upsets ?? 0) / (v.mismatches || 1)).toFixed(1)}% of ${v.mismatches ?? 0} mismatches (5+ overall), yellows ${((v.yellows ?? 0) / m).toFixed(2)} reds ${((v.reds ?? 0) / m).toFixed(3)} injuries ${((v.injuries ?? 0) / m).toFixed(2)} pens ${((v.penalties ?? 0) / m).toFixed(3)} og ${((v.ownGoals ?? 0) / m).toFixed(3)} subs ${((v.subs ?? 0) / m).toFixed(2)} 0-0 ${(100 * (v.goalless ?? 0) / m).toFixed(1)}% 7+ ${(100 * (v.sevenPlus ?? 0) / m).toFixed(2)}% stoppage goals ${(100 * (v.stoppageGoals ?? 0) / (v.goals || 1)).toFixed(1)}% keeper cards ${v.keeperCards ?? 0}`)
  }
  return lines.join('\n')
}

type MatchModule = typeof import('@engine/match')

/** The engine's match entry points with the recorder around them, for `vi.mock('@engine/match')`. */
export function wrap(m: MatchModule): Pick<MatchModule, 'beginMatch' | 'finishMatch' | 'simulateMatch'> {
  return {
    beginMatch: (opts) => {
      const mp = m.beginMatch(opts)
      onBegin(mp, opts)
      return mp
    },
    finishMatch: (mp, lookups, second) => {
      const res = m.finishMatch(mp, lookups, second)
      onFinish(mp, res, lookups)
      return res
    },
    // simulateMatch is beginMatch, advanceMatch to 70 and finishMatch (tested event for event), so the recorder sees its sheets
    simulateMatch: (opts) => {
      const mp = m.beginMatch(opts)
      onBegin(mp, opts)
      const lookups = { home: opts.home, away: opts.away }
      m.advanceMatch(mp, lookups, undefined, 70)
      const res = m.finishMatch(mp, lookups)
      onFinish(mp, res, lookups)
      return res
    },
  }
}
