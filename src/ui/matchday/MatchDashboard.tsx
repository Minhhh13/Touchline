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
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { canChangeInPlay, managerWindowsUsed, MAX_SUBS, MAX_WINDOWS, subsMade, type FullMatchResult, type LiveChanges } from '@engine/match'
import { scoreAt, type MatchFeed } from '@engine/matchFeed'
import { statsSeries, xgStory } from '@engine/matchStats'
import { liveCondition, ratingsAt } from '@engine/liveRatings'
import { getFormation } from '@engine/formations'
import { ratingHidden } from '@game/logic/ratingVisibility'
import { USER_TEAM } from '@engine/season'
import { useStore } from '@game/store'
import { useStorePick } from '../useStorePick'
import { playerLookup } from '@game/logic/players'
import { latestScores, liveTable, roundRefOf } from '@game/logic/matchday'
import { LeagueFlag } from '../components/Flag'
import type { LiveMatch, MatchContext } from '@game/types'
import { LivePitch, useMediaQuery } from '../components/LivePitch'
import { MomentumBar } from '../components/MatchCharts'
import { commentaryUpTo } from '../match/commentary'
import { assistantSubsBetween, assistantSubToast } from '../match/assistantSubs'
import { commentaryContextFor } from '../match/commentaryColour'
import { liveFeed, liveFeedKey, pathOf, replayCodes, replayKey, resultFeed, samplesOf } from '../match/prepare'
import { cuePending, panelMinute, useLiveClock } from '../match/clockStore'
import { isControlTarget } from '../dugoutKeys'
import { boostAt, HIGHLIGHTS_KEY, levelAt, marginAt, parseLevel, type HighlightLevel } from '../match/highlights'
import { cueTimes, goalHolds } from '../match/possession'
import { matchPace } from '../match/timing'
import { keeperKit, kitColours, shirtNumbers, teamCode } from '../match/shirts'
import { CompactLayout } from './CompactLayout'
import { emptyDraft, highlightedMan, nextSelection, pauseKeyFires, type StopDraft } from './controls'
import { openLayers } from '../dialogLayers'
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
import { readMark, resumeFrom, resumeLine, segmentKey, writeMark } from './resume'
import { BoxesMenu, useBoxes } from '../components/Boxes'
import { MATCHDAY_COMPACT, matchdayBoxes, readChoices, resolveSlots, Slot, writeChoice, type SlotChoices, type SlotId, type WidgetId } from './widgets'
import { keyMomentsPref, usePref } from '../viewerPrefs'
import { useMatchSounds } from '../sound/useMatchSounds'
import './matchday.css'
import './matchday-controls.css'
import './matchday-phone.css'
import './matchday-motion.css'
import { PeriodCard } from './PeriodCard'
import { translator } from '../i18n'
import { match } from '../i18n/en/match'

const tx = translator(match)
/** The ball's sounds and the crowd's full bed on the match day (its goals come from the holds, useMatchSounds) */
const BALL_SOUNDS = { bed: 1 }
/** How long the full-time card holds the board before the report, ms. */
export const FULL_TIME_HOLD_MS = 1800

export type DashboardSource = { mode: 'live'; live: LiveMatch } | { mode: 'replay'; res: FullMatchResult; ctx: MatchContext }

/**
 * `onAdvance` plays on from a stop with the manager's changes (held to the whistle from 70);
 * `onSimToEnd` plays the match straight to the whistle with the assistant taking every later call
 * (Full sim with the stop's changes, or Sim result in play without any).
 */
export function MatchDashboard({ source, onWhistle, onAdvance, onSimToEnd, crumbEnd }: { source: DashboardSource; onWhistle: () => void; onAdvance?: (changes: LiveChanges) => void; onSimToEnd?: (changes?: LiveChanges) => void; /** The replay's Live and Report tabs and its buttons, at the end of the competition line. */ crumbEnd?: ReactNode }) {
  const store = useStorePick('assistantAdvance', 'game', 'interveneLive', 'setLiveAuto', 'showToast', 'universe')
  const game = store.game!
  const u = store.universe!
  const get = useMemo(() => playerLookup(game, u), [game, u])
  const getName = useCallback((id: string) => get(id)?.name, [get])
  const live = source.mode === 'live' ? source.live : null
  const res = source.mode === 'replay' ? source.res : null
  const ctx = live ? live.ctx : (source as { ctx: MatchContext }).ctx
  const homeId = live ? live.mp.home.teamId : res!.homeTeamId
  const awayId = live ? live.mp.away.teamId : res!.awayTeamId
  const codes = useMemo(() => (live ? { home: teamCode(u, homeId, live.mp.home.shortName, game.settings.shortName), away: teamCode(u, awayId, live.mp.away.shortName, game.settings.shortName) } : replayCodes(u, res!, game.settings.shortName)), [u, homeId, awayId, live, res, game.settings.shortName])
  // A segment's or a replay's feed, ball path and samples may already be built (prepare.ts, between playing the step and this render)
  const feed: MatchFeed = useMemo(() => (live ? liveFeed(live.mp, liveFeedKey(live)) : resultFeed(res!, replayKey(res!, ctx), codes)), [live, res, ctx, codes])
  const userSide: 'home' | 'away' | null = live ? (live.userIsHome ? 'home' : 'away') : homeId === USER_TEAM ? 'home' : awayId === USER_TEAM ? 'away' : null

  // Kits, keepers and numbers
  const kit = useMemo(() => kitColours(u, game.settings.hostClubId, homeId, awayId), [u, game.settings.hostClubId, homeId, awayId])
  const keeper = useMemo(() => keeperKit(kit.home, kit.away), [kit])
  const numbers = useMemo(() => ({ home: shirtNumbers(getFormation(feed.home.tactics.formationId), feed.home.appearances, feed.home.bench), away: shirtNumbers(getFormation(feed.away.tactics.formationId), feed.away.appearances, feed.away.bench) }), [feed])
  const home: SideView = { code: codes.home, name: feed.home.name, colour: kit.home, keeper, numbers: numbers.home }
  const away: SideView = { code: codes.away, name: feed.away.name, colour: kit.away, keeper, numbers: numbers.away }

  // Everything derived from the decided match: once per decision, never per tick
  const mpath = useMemo(() => pathOf(feed), [feed])
  const series = useMemo(() => statsSeries(feed, get), [feed, get])
  const samples = useMemo(() => samplesOf(mpath, feed.lastMinute), [mpath, feed.lastMinute])
  const story = useMemo(() => xgStory(feed), [feed])
  const ref = useMemo(() => roundRefOf(ctx, live?.cupTieIndex), [ctx, live?.cupTieIndex])
  const elsewhere = useMemo(() => elsewhereLines(latestScores(game, u, ref, feed.lastMinute, true)), [game, u, ref, feed.lastMinute])
  // The table and our men's season before kick-off, for the commentary's colour (a live league match only; display only)
  const liveLeague = live?.kind === 'league'
  const season = game.season
  const squad = game.squad
  const talk = useMemo(() => ({ ...commentaryContextFor({ season, squad }, homeId, awayId, liveLeague), ...(userSide ? { userSide } : {}) }), [season, squad, homeId, awayId, liveLeague, userSide])
  const commentary = useMemo(() => commentaryUpTo(feed, mpath, feed.lastMinute, codes, getName, elsewhere, talk), [feed, mpath, codes, getName, elsewhere, talk])

  // The clock: from the segment's start (or the last change in play) to the stop, or to the whistle
  const stopAt = stopTarget(feed)
  const final = feed.decidedTo >= 90
  const start = live ? resumeMinute(live.mp) : 0
  // Every goal holds the clock for its celebration: ours the full one, theirs a short one (from the same strike moments the ball path uses)
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)')
  // Key moments (a per-viewer setting, on by default): each goal's hold ends with its replay
  const [keyMoments, setKeyMoments] = usePref(keyMomentsPref)
  const holds = useMemo(() => mpath.epochs.flatMap((e) => goalHolds(feed.events, e.from, e.to, { userSide: userSide ?? undefined, reduced, replay: keyMoments })).sort((a, b) => a.t - b.t), [mpath, feed.events, userSide, reduced, keyMoments])
  // Every chance, save and foul behind a card is a cue: its minute's commentary and panels wait until the pitch has shown it
  const cues = useMemo(() => mpath.epochs.flatMap((e) => cueTimes(feed.events, e.from, e.to)).sort((a, b) => a - b), [mpath, feed.events])
  // A reload picks the clock up where this tab left the segment (resume.ts), not from its first minute again
  const resumeKey = live ? segmentKey(game.id, feed.key, feed.decidedTo, start, feed.events.length) : null
  const [resumeAt] = useState(() => (resumeKey ? resumeFrom(readMark(resumeKey), resumeKey, start, stopAt) : start))
  // A crowded minute plays longer on screen (the same pace the ball path is laid out in)
  const pace = useMemo(() => matchPace(feed.events), [feed.events])
  // The full-time whistle's card plays over the pitch before the report opens (PeriodCard; at once with reduced motion).
  // The store's whistle is only held back, never skipped: once started it runs even if the board closes meanwhile
  const whistleRef = useRef(onWhistle)
  whistleRef.current = onWhistle
  const blown = useRef(false)
  const atWhistle = useCallback(() => {
    if (blown.current) return
    blown.current = true
    if (reduced) whistleRef.current()
    else setTimeout(() => whistleRef.current(), FULL_TIME_HOLD_MS)
  }, [reduced])
  const clock = useMatchClock({ start: resumeAt, stopAt, final, period: PITCH_PERIOD, holds, cues, pace, reduced, onFinish: final ? atWhistle : undefined })
  useEffect(() => {
    if (!resumeKey) return
    return useLiveClock.subscribe((s, prev) => {
      if (s.clock !== prev.clock || s.done !== prev.done) writeMark({ key: resumeKey, at: s.done ? s.stopAt + 1 : s.clock })
    })
  }, [resumeKey])
  const showToast = store.showToast
  useEffect(() => {
    const line = resumeLine(resumeAt, start, stopAt)
    if (line) showToast(line)
    // Mount only: the line is about the reload
  }, [])
  // The whistle, the crowd and the net, on the same clock the pitch draws from (presentation only)
  useMatchSounds({ events: feed.events, ranges: mpath.epochs, holds, userSide, start: resumeAt, stopAt, final, reduced })
  // The panels and the scoreboard see a goal once the ball is over the line, not at the start of its minute
  const revealed = useLiveClock((s) => s.revealed)
  const cued = useLiveClock((s) => s.cued ?? 0)
  const minute = panelMinute(holds, revealed, clock.clock, start, !clock.finished && cuePending(cues, cued, clock.clock, start))
  const whistle = clock.finished && final
  // The whistle's card over the pitch: half time when the clock stops at the break, full time at the end (PeriodCard)
  const period: 'ht' | 'ft' | null = whistle ? 'ft' : clock.atStop && stopAt === 45 ? 'ht' : null
  // The assistant's routine and injury changes for our side come up as a toast when the clock reaches them (display only)
  const subsSeen = useRef(minute)
  useEffect(() => {
    if (!live || !userSide) return
    const from = subsSeen.current
    subsSeen.current = minute
    if (minute <= from) return
    const line = assistantSubToast(assistantSubsBetween(feed, userSide, from, minute))
    if (line) showToast(line)
  }, [minute, feed, live, userSide, showToast])

  // Highlights: the clock runs fast through the quiet minutes (a UI clock change only; the segment is already decided)
  const [level, setLevelState] = useState<HighlightLevel>(readLevel)
  const setLevel = useCallback((l: HighlightLevel) => {
    setLevelState(l)
    writeLevel(l)
  }, [])
  const levelNow = levelAt(feed.events, level, clock.clock)
  const boost = clock.running ? boostAt(feed.events, level, clock.clock) : 1
  const setBoost = clock.setBoost
  useEffect(() => {
    setBoost(boost)
  }, [boost, setBoost])
  // P pauses and resumes, except while typing, on a focused control or under an open drawer or dialog
  const toggleClock = clock.toggle
  const canToggle = !clock.finished
  useEffect(() => {
    if (!canToggle) return
    const onKey = (e: KeyboardEvent) => {
      if (!pauseKeyFires(e, isControlTarget(e.target as HTMLElement | null), openLayers() > 0)) return
      e.preventDefault()
      toggleClock()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canToggle, toggleClock])
  // Leaving the match (or a new segment) never carries a fast-forward over
  useEffect(() => () => useLiveClock.setState({ boost: 1 }), [])
  const score = levelNow.wound ? marginAt(feed.events, clock.clock) : null
  const highlights = { level, setLevel, wound: score ? `${Math.max(score.home, score.away)}-${Math.min(score.home, score.away)}` : null, fast: boost > 1, keyMoments, setKeyMoments }

  const [selected, setSelected] = useState<string | null>(null)
  // A tap on a man picks him out on the pitch and the formation panels; a second tap lets him go. Keyboard focus on a
  // strip card previews him the same way until the focus moves on (display only)
  const select = useCallback((psId: string) => setSelected((s) => nextSelection(s, psId)), [])
  const [focused, setFocused] = useState<string | null>(null)
  const highlight = highlightedMan(selected, focused)
  const friendly = !!ref.friendly
  const [slots, setSlots] = useState<SlotChoices>(() => resolveSlots(readChoices(), friendly))
  const show = useCallback((slot: SlotId, id: WidgetId) => {
    setSlots((s) => ({ ...s, [slot]: id }))
    writeChoice(slot, id)
  }, [])
  // The Boxes control (display only, per viewer): the desktop board's boxes, and the stacked board's
  const boxes = useBoxes(matchdayBoxes(slots))
  const compactBoxes = useBoxes(MATCHDAY_COMPACT)

  const ratings = useMemo(() => ratingsAt(feed, minute), [feed, minute])
  const scores = useMemo(() => latestScores(game, u, ref, minute, whistle), [game, u, ref, minute, whistle])
  const table = useMemo(() => liveTable(game, u, ref, minute, scoreAt(feed.events, minute), userSide !== 'away', whistle), [game, u, ref, minute, feed.events, userSide, whistle])

  const d: MatchdayData = { mode: live ? 'live' : 'replay', feed, mpath, series, samples, story, commentary, minute, final: whistle, home, away, ratings, userSide, selected, highlight, select, show, scores, table, ref, ctx, live, game, u, getPlayer: get, getName }

  // The manager's hand on the match in play (the top bar's and the strip's controls use it)
  const control: LiveControl | null = live
    ? {
        minute: clock.clock,
        stop: clock.atStop ? (stopAt === 45 ? 45 : 70) : null,
        can: canChangeInPlay(live.mp, Math.max(start, minute), userSide ?? 'home'),
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
  const on = boxes.on
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
  const label = `${ctx.roundLabel ?? (ctx.competition === 'cup' ? tx('cup') : ctx.competition === 'league' ? tx('matchweek', { n: ctx.matchweek }) : tx('continentalCup'))}${ctx.importanceLabel ? ` · ${ctx.importanceLabel}` : ''}`
  const crumb = (
    <div className={`md-crumb ${crumbEnd ? 'has-end' : ''}`}>
      <b>
        {ctx.roundLabel !== 'Friendly' && game.season?.leagueId && (
          <>
            <LeagueFlag leagueId={ctx.competition === 'continental' ? 'europe' : game.season.leagueId} size={18} />{' '}
          </>
        )}
        {label}
      </b>
      <span className="muted">
        {tx('matchTag', { home: feed.home.name, away: feed.away.name, mode: live ? 'live' : 'replay' })}
      </span>
      <BoxesMenu groups={[compact ? compactBoxes : boxes]} className="md-boxes" />
      {crumbEnd && <div className="md-crumb-end">{crumbEnd}</div>}
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
  const top = <TopBar feed={feed} clock={clock} minute={minute} home={home} away={away} label={label} control={control} hand={hand} playback={playback} highlights={highlights} />
  const drawer = hand.drawer ? <ActiveDrawer id={hand.drawer} hand={hand} view={stripSide === 'home' ? home : away} get={get} squad={game.squad} condition={condition} selected={selected} hideRatings={ratingHidden(game.settings.rules, 'squad')} /> : null
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
      keyMoments={keyMoments && !reduced}
      highlightId={highlight}
      sounds={BALL_SOUNDS}
      overlay={period && !reduced ? <PeriodCard key={period} kind={period} home={home} away={away} score={scoreAt(feed.events, minute)} /> : undefined}
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
          {tx(stopAt === 45 ? 'assistantMakingHt' : 'assistantMaking70')}
        </div>
      ) : (
        <StopPanel live={live} actions={stopActions} draft={draft} setDraft={setDraft} board={{ hand, view: stripSide === 'home' ? home : away, get, squad: game.squad, condition, hideRatings: ratingHidden(game.settings.rules, 'squad') }} />
      )
    ) : null
  const strip = <SquadStrip feed={feed} minute={minute} side={stripSide} view={stripSide === 'home' ? home : away} ratings={ratings} squad={game.squad} selected={selected} onSelect={select} onFocusMan={setFocused} control={control} hand={hand} name={getName} condition={condition} />
  const banner = <CommentaryBanner d={d} />
  const slot = (id: SlotId) => <Slot key={id} slot={id} id={slots[id]} onChange={(w) => show(id, w)} d={d} compact={compact} />

  // Stacked, the momentum chart sits in a half-width box: the full chart (its own proportions, scale and spells), not the wide strip squashed
  const momentumBox = <MomentumBar momentum={feed.momentum} clock={minute} events={feed.events} home={{ name: home.name, shortName: home.code, colour: home.colour }} away={{ name: away.name, shortName: away.code, colour: away.colour }} />
  if (compact) return <CompactLayout d={d} crumb={crumb} top={top} pitch={pitch} stop={stop} banner={compactBoxes.on('commentary') ? banner : null} momentum={momentumBox} strip={strip} drawer={drawer} friendly={friendly} pulse={compactBoxes.on('pulse')} panels={compactBoxes.on('panels')} />

  // Unticked boxes leave the board and the rest take the room: the side columns, the widget row and the stats flanks close up
  const top3 = (['A', 'B', 'C'] as const).filter((id) => on(`slot-${id}`))
  const left = on('home-xi') || on('slot-L')
  const right = on('away-xi') || on('slot-R')
  const mainGrid = boxes.grid([
    { track: 'minmax(240px, 0.9fr)', ids: ['home-xi', 'slot-L'] },
    { track: 'minmax(0, 2.6fr)', ids: [] },
    { track: 'minmax(240px, 0.9fr)', ids: ['away-xi', 'slot-R'] },
  ])
  const pitchGrid = boxes.grid([
    { track: '104px', ids: ['stats'] },
    { track: 'minmax(0, 1fr)', ids: [] },
    { track: '104px', ids: ['stats'] },
  ])
  return (
    <div className="matchday fit" ref={root}>
      {crumb}
      {top}
      <div className={`md-main ${mainGrid.className}`} style={mainGrid.style}>
        {left && (
          <div className="md-side">
            <div className="md-side-inner">
              {on('home-xi') && <FormationPanel d={d} side="home" />}
              {on('slot-L') && slot('L')}
            </div>
          </div>
        )}
        <div className="md-centre">
          {top3.length > 0 && (
            <div className="md-widgets" style={top3.length < 3 ? { gridTemplateColumns: `repeat(${top3.length}, minmax(0, 1fr))` } : undefined}>
              {top3.map(slot)}
            </div>
          )}
          <div className={`md-pitch-row ${pitchGrid.className}`} style={pitchGrid.style}>
            {on('stats') && <StatsFlank d={d} side="home" />}
            <div className="md-pitch">{pitch}</div>
            {on('stats') && <StatsFlank d={d} side="away" />}
          </div>
          {on('momentum') && momentum}
        </div>
        {right && (
          <div className="md-side">
            <div className="md-side-inner">
              {on('away-xi') && <FormationPanel d={d} side="away" />}
              {on('slot-R') && slot('R')}
            </div>
          </div>
        )}
      </div>
      {on('commentary') && banner}
      {strip}
      {drawer}
      {stop}
    </div>
  )
}

function readLevel(): HighlightLevel {
  try {
    return parseLevel(localStorage.getItem(HIGHLIGHTS_KEY))
  } catch {
    return 'full'
  }
}
function writeLevel(l: HighlightLevel): void {
  try {
    localStorage.setItem(HIGHLIGHTS_KEY, l)
  } catch {
    // Private window or blocked storage: the level is simply not remembered
  }
}
