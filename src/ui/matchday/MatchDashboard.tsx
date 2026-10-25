/**
 * The match-day dashboard, Football Manager style: a top bar with the
 * scoreboard and playback, both XIs in formation, three switchable widgets
 * over the live pitch flanked by both sides' stats, the momentum strip, the
 * commentary banner and our XI along the bottom, all moving with the clock.
 *
 * One shell for a match in play (through both stops and the held last twenty
 * minutes) and the replay of a finished one. It builds the feed and everything
 * derived from it once per decision, and the per-minute views once per tick.
 * Below 1200 px it hands the same pieces to the stacked layout.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { canChangeInPlay, managerWindowsUsed, MAX_SUBS, MAX_WINDOWS, subsMade, type FullMatchResult, type LiveChanges } from '@engine/match'
import { feedFromLive, feedFromResult, scoreAt, type MatchFeed } from '@engine/matchFeed'
import { statsSeries, xgStory } from '@engine/matchStats'
import { liveCondition, ratingsAt } from '@engine/liveRatings'
import { getFormation } from '@engine/formations'
import { ratingsHidden } from '@engine/draft'
import { USER_TEAM } from '@engine/season'
import { useStore } from '@game/store'
import { playerLookup } from '@game/logic/players'
import { latestScores, liveTable, roundRefOf } from '@game/logic/matchday'
import { LeagueFlag } from '../components/Flag'
import type { LiveMatch, MatchContext } from '@game/types'
import { LivePitch, useMediaQuery } from '../components/LivePitch'
import { MomentumBar } from '../components/MatchCharts'
import { commentaryUpTo } from '../match/commentary'
import { matchPath } from '../match/epochs'
import { useLiveClock } from '../match/clockStore'
import { goalHolds } from '../match/possession'
import { samplePlayers } from '../match/heat'
import { keeperKit, kitColours, shirtNumbers, teamCode } from '../match/shirts'
import { CompactLayout } from './CompactLayout'
import { emptyDraft, type StopDraft } from './controls'
import { ActiveDrawer } from './drawers/Drawers'
import { useManagerHand } from './useManagerHand'
import { elsewhereLines, resumeMinute, segmentStart, stopTarget } from './model'
import { CommentaryBanner } from './panels/feedPanels'
import { FormationPanel } from './panels/FormationPanel'
import { StatsFlank } from './panels/StatsFlank'
import { SquadStrip } from './SquadStrip'
import { StopPanel, type StopActions } from './StopPanel'
import { TopBar } from './TopBar'
import type { LiveControl, MatchdayData, SideView } from './types'
import { PITCH_PERIOD, useMatchClock } from './useMatchClock'
import { readChoices, resolveSlots, Slot, writeChoice, type SlotChoices, type SlotId, type WidgetId } from './widgets'
import './matchday.css'
import './matchday-controls.css'
import './matchday-phone.css'

export type DashboardSource = { mode: 'live'; live: LiveMatch } | { mode: 'replay'; res: FullMatchResult; ctx: MatchContext }

/**
 * `onAdvance` plays on from a stop with the manager's changes (held to the whistle from 70);
 * `onSimToEnd` plays the match straight to the whistle with the assistant taking every later call
 * (Full sim with the stop's changes, or Sim result in play without any).
 */
export function MatchDashboard({ source, onWhistle, onAdvance, onSimToEnd }: { source: DashboardSource; onWhistle: () => void; onAdvance?: (changes: LiveChanges) => void; onSimToEnd?: (changes?: LiveChanges) => void }) {
  const store = useStore()
  const game = store.game!
  const u = store.universe!
  const get = useMemo(() => playerLookup(game, u), [game, u])
  const getName = useCallback((id: string) => get(id)?.name, [get])
  const live = source.mode === 'live' ? source.live : null
  const res = source.mode === 'replay' ? source.res : null
  const ctx = live ? live.ctx : (source as { ctx: MatchContext }).ctx
  const homeId = live ? live.mp.home.teamId : res!.homeTeamId
  const awayId = live ? live.mp.away.teamId : res!.awayTeamId
  const codes = useMemo(() => ({ home: teamCode(u, homeId, live?.mp.home.shortName ?? res!.homeName, game.settings.shortName), away: teamCode(u, awayId, live?.mp.away.shortName ?? res!.awayName, game.settings.shortName) }), [u, homeId, awayId, live, res, game.settings.shortName])
  const feed: MatchFeed = useMemo(() => (live ? feedFromLive(live.mp, `${live.opponentId}-${live.ctx.matchweek}-${live.kind}`) : feedFromResult(res!, `${res!.homeTeamId}-${res!.awayTeamId}-${ctx.matchweek}`, codes)), [live, res, ctx.matchweek, codes])
  const userSide: 'home' | 'away' | null = live ? (live.userIsHome ? 'home' : 'away') : homeId === USER_TEAM ? 'home' : awayId === USER_TEAM ? 'away' : null

  // Kits, keepers and numbers
  const kit = useMemo(() => kitColours(u, game.settings.hostClubId, homeId, awayId), [u, game.settings.hostClubId, homeId, awayId])
  const keeper = useMemo(() => keeperKit(kit.home, kit.away), [kit])
  const numbers = useMemo(() => ({ home: shirtNumbers(getFormation(feed.home.tactics.formationId), feed.home.appearances, feed.home.bench), away: shirtNumbers(getFormation(feed.away.tactics.formationId), feed.away.appearances, feed.away.bench) }), [feed])
  const home: SideView = { code: codes.home, name: feed.home.name, colour: kit.home, keeper, numbers: numbers.home }
  const away: SideView = { code: codes.away, name: feed.away.name, colour: kit.away, keeper, numbers: numbers.away }

  // Everything derived from the decided match: once per decision, never per tick
  const mpath = useMemo(() => matchPath(feed), [feed])
  const series = useMemo(() => statsSeries(feed, get), [feed, get])
  const samples = useMemo(() => samplePlayers(mpath, feed.lastMinute), [mpath, feed.lastMinute])
  const story = useMemo(() => xgStory(feed), [feed])
  const ref = useMemo(() => roundRefOf(ctx, live?.cupTieIndex), [ctx, live?.cupTieIndex])
  const elsewhere = useMemo(() => elsewhereLines(latestScores(game, u, ref, feed.lastMinute, true)), [game, u, ref, feed.lastMinute])
  const commentary = useMemo(() => commentaryUpTo(feed, mpath, feed.lastMinute, codes, getName, elsewhere), [feed, mpath, codes, getName, elsewhere])

  // The clock: from the segment's start (or the last change in play) to the stop, or to the whistle
  const stopAt = stopTarget(feed)
  const final = feed.decidedTo >= 90
  const start = live ? resumeMinute(live.mp) : 0
  // Every goal holds the clock for its celebration: ours the full one, theirs a short one (from the same strike moments the ball path uses)
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)')
  const holds = useMemo(() => mpath.epochs.flatMap((e) => goalHolds(feed.events, e.from, e.to, { userSide: userSide ?? undefined, reduced })).sort((a, b) => a.t - b.t), [mpath, feed.events, userSide, reduced])
  const clock = useMatchClock({ start, stopAt, final, period: PITCH_PERIOD, holds, reduced, onFinish: final ? onWhistle : undefined })
  // The panels and the scoreboard see a goal once the ball is over the line, not at the start of its minute
  const revealed = useLiveClock((s) => s.revealed)
  const pending = holds.some((h, i) => i >= revealed && Math.floor(h.t) <= clock.clock && h.t >= start)
  const minute = pending ? Math.max(start, clock.clock - 1) : clock.clock
  const whistle = clock.finished && final

  const [selected, setSelected] = useState<string | null>(null)
  const friendly = !!ref.friendly
  const [slots, setSlots] = useState<SlotChoices>(() => resolveSlots(readChoices(), friendly))
  const show = useCallback((slot: SlotId, id: WidgetId) => {
    setSlots((s) => ({ ...s, [slot]: id }))
    writeChoice(slot, id)
  }, [])

  const ratings = useMemo(() => ratingsAt(feed, minute), [feed, minute])
  const scores = useMemo(() => latestScores(game, u, ref, minute, whistle), [game, u, ref, minute, whistle])
  const table = useMemo(() => liveTable(game, u, ref, minute, scoreAt(feed.events, minute), userSide !== 'away', whistle), [game, u, ref, minute, feed.events, userSide, whistle])

  const d: MatchdayData = { mode: live ? 'live' : 'replay', feed, mpath, series, samples, story, commentary, minute, final: whistle, home, away, ratings, userSide, selected, select: setSelected, show, scores, table, ref, ctx, live, game, u, getPlayer: get, getName }

  // The manager's hand on the match in play (the top bar's and the strip's controls use it)
  const control: LiveControl | null = live
    ? {
        minute: clock.clock,
        stop: clock.atStop ? (stopAt === 45 ? 45 : 70) : null,
        can: canChangeInPlay(live.mp, minute, userSide ?? 'home'),
        userSide: userSide ?? 'home',
        tactics: (live.userIsHome ? live.mp.home : live.mp.away).tactics,
        shout: (live.userIsHome ? live.mp.home : live.mp.away).shout,
        // Changes the engine has decided later in the segment (a routine change at 62 seen at 50) are not made yet: the strip and the drawer count the same ones
        subsLeft: MAX_SUBS - subsMade(live.mp, userSide ?? 'home', Math.max(0, clock.clock)),
        windowsLeft: MAX_WINDOWS - managerWindowsUsed(live.mp, userSide ?? 'home'),
        apply: (change) => store.interveneLive({ minute: clock.clock, ...change }),
      }
    : null

  // The stop's pending changes: the stop panel and the top bar's drawers edit the same ones (an old save queues into them too)
  const [draft, setDraft] = useState<StopDraft>(emptyDraft)
  const stripSide = userSide ?? 'home'
  // Condition moves only in play: a finished match has already taken it off
  const condition = (psId: string): number | null => {
    const start = game.squad[psId]?.condition
    return feed.source === 'live' && start !== undefined ? liveCondition(feed, stripSide, psId, Math.max(0, minute), start, get) : null
  }
  const hand = useManagerHand({ feed, live, control, clock, side: stripSide, draft, setDraft, squad: game.squad, name: getName, toast: (t) => store.showToast(t) })
  d.hand = hand

  const compact = useMediaQuery('(max-width: 1199px)')
  // On a desktop the whole board fits the window: its height is the viewport less what stands above and below it
  const root = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = root.current
    if (compact || !el) return
    const fit = () => {
      const doc = document.scrollingElement ?? document.documentElement
      const top = Math.ceil(el.getBoundingClientRect().top + window.scrollY)
      // Fill the window below the board's top, then give back whatever still makes the page scroll (its padding, anything under it)
      el.style.setProperty('--md-fit', `calc(100dvh - ${top}px)`)
      const over = Math.max(0, doc.scrollHeight - window.innerHeight)
      if (over > 0) el.style.setProperty('--md-fit', `calc(100dvh - ${top + over}px)`)
    }
    fit()
    window.addEventListener('resize', fit)
    // The app's top bar folds away and comes back (a class on .app): the board's top moves with it
    const app = el.closest('.app')
    const watch = app ? new MutationObserver(() => requestAnimationFrame(fit)) : null
    if (app && watch) watch.observe(app, { attributes: true, attributeFilter: ['class'] })
    return () => {
      window.removeEventListener('resize', fit)
      watch?.disconnect()
    }
  }, [compact])
  const label = `${ctx.roundLabel ?? (ctx.competition === 'cup' ? 'Cup' : ctx.competition === 'league' ? `Matchweek ${ctx.matchweek}` : 'Continental Cup')}${ctx.importanceLabel ? ` · ${ctx.importanceLabel}` : ''}`
  const crumb = (
    <div className="md-crumb">
      <b>
        {ctx.roundLabel !== 'Friendly' && game.season?.leagueId && (
          <>
            <LeagueFlag leagueId={ctx.competition === 'continental' ? 'europe' : game.season.leagueId} size={18} />{' '}
          </>
        )}
        {label}
      </b>
      <span className="muted">
        {feed.home.name} v {feed.away.name} · {live ? 'live' : 'replay'}
      </span>
    </div>
  )
  // Auto-play: the assistant answers the stops for the rest of this match ("Auto from here", "Finish the match", or the saved mode)
  const liveAuto = useStore((s) => s.liveAuto)
  const answered = useRef(false)
  const autoAtStop = !!live && clock.atStop && liveAuto && !!onAdvance
  useEffect(() => {
    if (!autoAtStop || answered.current) return
    const id = setTimeout(() => {
      answered.current = true
      useStore.getState().assistantAdvance(true)
    }, 700)
    return () => clearTimeout(id)
  }, [autoAtStop])
  const playback = live
    ? {
        auto: liveAuto,
        setAuto: (on: boolean) => store.setLiveAuto(on),
        // Straight to the result: only while a stop is still to come (in the last twenty minutes, Skip to full time does it)
        simResult: !final && onSimToEnd ? () => onSimToEnd() : undefined,
      }
    : undefined
  const top = <TopBar feed={feed} clock={clock} minute={minute} home={home} away={away} label={label} control={control} hand={hand} playback={playback} />
  const drawer = hand.drawer ? <ActiveDrawer id={hand.drawer} hand={hand} view={stripSide === 'home' ? home : away} get={get} squad={game.squad} condition={condition} selected={selected} hideRatings={ratingsHidden(game.settings.rules)} /> : null
  const pitch = (
    <LivePitch
      home={{ name: home.name, shortName: home.code, colour: home.colour, tactics: feed.home.tactics, appearances: feed.home.appearances }}
      away={{ name: away.name, shortName: away.code, colour: away.colour, tactics: feed.away.tactics, appearances: feed.away.appearances }}
      events={feed.events}
      momentum={feed.momentum}
      from={live ? segmentStart(live.mp.clock) : 0}
      to={stopAt}
      seed={feed.key}
      getPlayer={get}
      labels={{ ...numbers.home, ...numbers.away }}
      track={mpath}
      keepers={{ home: keeper, away: keeper }}
    />
  )
  const momentum = <MomentumBar strip momentum={feed.momentum} clock={minute} events={feed.events} home={{ name: home.name, shortName: home.code, colour: home.colour }} away={{ name: away.name, shortName: away.code, colour: away.colour }} />
  const stopActions: StopActions | null = onAdvance
    ? {
        onPlay: onAdvance,
        onAssistant: () => store.assistantAdvance(true),
        onFinish: (changes) => {
          store.setLiveAuto(true)
          onAdvance(changes)
        },
        onFullSim: (changes) => onSimToEnd?.(changes),
      }
    : null
  const stop =
    live && clock.atStop && stopActions ? (
      autoAtStop ? (
        <div className="panel assistant-note small" role="status" data-testid="assistant-note">
          The assistant is making the {stopAt === 45 ? 'half-time' : '70th-minute'} calls…
        </div>
      ) : (
        <StopPanel live={live} actions={stopActions} draft={draft} setDraft={setDraft} board={{ hand, view: stripSide === 'home' ? home : away, get, squad: game.squad, condition, hideRatings: ratingsHidden(game.settings.rules) }} />
      )
    ) : null
  const strip = <SquadStrip feed={feed} minute={minute} side={stripSide} view={stripSide === 'home' ? home : away} ratings={ratings} squad={game.squad} selected={selected} onSelect={setSelected} control={control} hand={hand} name={getName} condition={condition} />
  const banner = <CommentaryBanner d={d} />
  const slot = (id: SlotId) => <Slot key={id} slot={id} id={slots[id]} onChange={(w) => show(id, w)} d={d} compact={compact} />

  if (compact) return <CompactLayout d={d} crumb={crumb} top={top} pitch={pitch} stop={stop} banner={banner} momentum={momentum} strip={strip} drawer={drawer} friendly={friendly} />

  return (
    <div className="matchday fit" ref={root}>
      {crumb}
      {top}
      <div className="md-main">
        <div className="md-side">
          <div className="md-side-inner">
            <FormationPanel d={d} side="home" />
            {slot('L')}
          </div>
        </div>
        <div className="md-centre">
          <div className="md-widgets">{(['A', 'B', 'C'] as const).map(slot)}</div>
          <div className="md-pitch-row">
            <StatsFlank d={d} side="home" />
            <div className="md-pitch">{pitch}</div>
            <StatsFlank d={d} side="away" />
          </div>
          {momentum}
        </div>
        <div className="md-side">
          <div className="md-side-inner">
            <FormationPanel d={d} side="away" />
            {slot('R')}
          </div>
        </div>
      </div>
      {banner}
      {strip}
      {drawer}
      {stop}
    </div>
  )
}
