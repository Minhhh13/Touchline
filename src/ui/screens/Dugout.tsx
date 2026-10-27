import { Fragment, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useAfterPaint } from '../afterPaint'
import { Check, ChevronDown, GraduationCap, Globe, Landmark, Medal, MessageSquare, Star, TrendingDown, TrendingUp, UserMinus, X } from 'lucide-react'
import { useStore } from '@game/store'
import { computeTable, positionOf, roundsFor, USER_TEAM, type Competition } from '@engine/season'
import { getFormation } from '@engine/formations'
import { getRole, DEFAULT_ROLE } from '@engine/roles'
import { LINE_HELP, MENTALITY_HELP, PASSING_HELP, PRESSING_HELP, TEMPO_HELP, WIDTH_HELP, STYLE_LABEL } from '@engine/tactics'
import { TRAINING, TRAINING_LABEL, type TrainingFocus } from '@engine/training'
import { nextOpponent, upcomingCupTie } from '@game/logic/week'
import { MATCH_PLAY_MODES, matchPlayOf } from '@game/logic/assistant'
import { isAvailable, playerLookup, squadPlayers } from '@game/logic/players'
import { canCover, ratingAt } from '@engine/positions'
import { teamStrength } from '@game/logic/squad'
import { SELL_ON_OPTIONS, SQUAD_CAP, closedWindowLine, sellOnValue, suggestedStatus } from '@game/logic/marketOps'
import { canFullScout, focusActive, maskedView } from '@game/logic/scouting'
import { recentShare, statusOf } from '@game/logic/week'
import { EXPECTED_SHARE, RECENT_WEEKS, STATUS_LABEL, STATUSES, WAGE_MULT, type SquadStatus } from '@engine/status'
import { TALK_LABEL, type TalkKind } from '@game/logic/talks'
import { STAFF, STAFF_ROLES, staffTier, staffWages, traitTags } from '@engine/staff'
import { evaluateObjective, OBJECTIVE_REWARD } from '@engine/objectives'
import { briefingHeadline, weeklyBriefing, type BriefingAction, type BriefingItem, type DugoutTab } from '@game/logic/briefing'
import { nextStop, simToLabel, stopLine } from '@game/logic/seasonHighlights'
import { newsTotal, unseenNews } from '@game/logic/news'
import { slotSheet, surname, whereaboutsLabel, type SlotOption } from '@game/logic/slotSheet'
import { slotRating, slotRatingLine } from '@game/logic/slotRating'
import { Pitch, PitchLegend } from '../components/Pitch'
import { FormationPicker } from '../components/FormationPicker'
import { PlayerRow } from '../components/PlayerRow'
import { TableView } from '../components/TableView'
import { Bar, ClubBadge, Info, Modal, Rating, Segmented, Stat, Tabs, Pos, TeamBadge, Tip, useViewerFlag } from '../components/bits'
import { Bracket } from '../components/Bracket'
import { seasonCupBracket } from '@game/logic/bracket'
import { BriefingIcon, NewsIcon } from '../components/icons'
import { SQUAD_COLUMNS } from '../components/AttributePanel'
import { PlayerCardModal } from '../components/PlayerCard'
import { careerSeasons } from '@game/logic/playerCard'
import { LeagueFlag } from '../components/Flag'
import { roleCode } from '../match/shirts'
import { chemistryLinkLabel, clubName, clubShort, signedValue, meterValue, money, moraleWord, ordinal, outcomeClass, outcomeOf, seasonLabel, wage } from '../format'
import type { PlayerSeason, Position, TableRow } from '@engine/types'
import type { TeamTalk } from '@engine/match'
import { isClassic } from '@engine/universe'
import { StatsTab } from './StatsTab'
import { OppositionReport } from './OppositionReport'
import { RunInBanner } from '../components/RunInBanner'
import { DressingRoomTab } from './DressingRoomTab'
import { PlannerTab } from './PlannerTab'
import { InboxActions } from '../components/InboxActions'
import { HappinessCard } from '../components/Happiness'
import { personalityOf } from '@game/logic/personality'
import { RecruitmentPanel, ScoutModal, ScoutReportsPanel } from './Recruitment'
import { nextRequestAt, REQUEST_CONFIDENCE, REQUEST_GAP, requestOptions, SHIFT_BUDGET, SHIFT_LIMIT, SHIFT_WAGE, wageRoom } from '@game/logic/board'
import { ContractCard, ContractTalks } from '../components/ContractTalks'
import { dugoutKey, isControlTarget } from '../dugoutKeys'
import { PositionChart } from '../components/LiveLeague'
import { PlayerPeek } from '../components/PlayerPeek'
import { BoxesMenu, useBoxes, type Boxes } from '../components/Boxes'
import { DUGOUT_ALL, DUGOUT_HEAD, DUGOUT_TABS } from '../boxSets'
import type { BoxSet } from '../boxes'
import type { Game } from '@game/types'
import { doneDeals, EVEN_BAND, filterNews, seasonStrip, tickerLines, INBOX_FILTERS, matchUp, positionStory, windowCountdown, minutesLast3, ratingBand, type InboxFilter, ROLE_FIT_LABEL, roleFit, roleOptions, SQUAD_VIEWS, teamFamiliarity, type SquadView } from '@game/logic/squadDisplay'
import { countPhrase } from '../screenText'
import { newsBody } from '@game/logic/newsFlavour'
import { watchSeasonSounds } from '../sound/seasonWatch'

type Tab = DugoutTab

// The season's sounds after Play matchweek on Sim result, Sim 5 and Sim to end (presentation only; it reads the store)
watchSeasonSounds()

/** Between playing the week and showing it, the match day's ball path is built in its own tasks (presentation only). */
const prepareWeek = (next: Game): Promise<void> => import('../match/prepare').then((m) => m.prepareMatchDay(next))

/** A tab with one box (the Cup, the Continental Cup, the Inbox) lists nothing in the Boxes checklist. */
const NO_BOXES: BoxSet = { screen: 'dugout-none', title: '', boxes: [] }
/** The Table tab's columns as its CSS writes them (`.grid.table-grid`). */
const TABLE_COLS = [
  { track: 'minmax(0, 1.5fr)', ids: ['league-table'] },
  { track: 'minmax(300px, 1fr)', ids: ['season-so-far'] },
]

/** The tab's boxes that exist today (a box some weeks do not have is left out of the checklist). */
function tabPresent(tab: string, game: Game): string[] | undefined {
  if (tab === 'next') return nextOpponent(game) ? ['opposition', 'match-up', 'team-talk'] : ['team-talk']
  if (tab === 'window' && game.window) return ['recruitment', ...((game.scoutReports ?? []).length > 0 ? ['scout-reports'] : []), 'approach', 'shortlist', ...(doneDeals(game.window).length > 0 ? ['done-deals'] : []), 'log']
  if (tab === 'club') return ['board', 'requests', 'finances', 'staff', 'contracts', ...(game.careerStats && Object.keys(game.careerStats).length > 0 ? ['legends'] : []), 'achievements']
  return undefined
}

/** Whether this viewer keeps the Key on (bar labels and the pitch legend). */
const KEY_FLAG = 'touchline-squad-key'

export function Dugout() {
  const store = useStore()
  const { universe: u, game } = store
  const [tab, setTab] = useState<Tab>('squad')
  // The slot whose picker sheet is open: tapping a slot opens it, on every screen size
  const [sheetSlot, setSheetSlot] = useState<string | null>(null)
  const [playerModal, setPlayerModal] = useState<string | null>(null)
  const [showKey, toggleKey] = useViewerFlag(KEY_FLAG)
  // On a phone the action bar is fixed over the page, so the page's bottom padding follows the bar's measured height
  const barRef = useRef<HTMLDivElement>(null)
  const [barHeight, setBarHeight] = useState(0)
  useEffect(() => {
    const el = barRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setBarHeight(Math.ceil(el.getBoundingClientRect().height)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [game?.phase, game?.season?.matchweek, game?.season?.sacked])
  const [view, setView] = useState<SquadView>(() => readSquadView())
  // Opening the Inbox marks everything read, but the divider keeps the unread count as it stood when the tab
  // opened (or when items arrived while it was open), so the reader can see where the new items end
  const unseen = game ? unseenNews(game) : 0
  const posted = game ? newsTotal(game) : 0
  const [dividerAt, setDividerAt] = useState(0)
  const [inboxFilter, setInboxFilter] = useState<InboxFilter>('all')
  useEffect(() => {
    if (tab !== 'inbox') return
    setDividerAt(unseen)
    store.markNewsSeen()
    // `posted` is the trigger: a batch arriving while the tab is open moves the divider to the new batch
  }, [tab, posted])
  // The keyboard (Space plays the week, 1 to 0 open the tabs): one listener reading the latest render through a ref
  const keys = useRef<{ play: (() => void) | null; tabs: Tab[] }>({ play: null, tabs: [] })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = keys.current
      const out = dugoutKey(e.key, { onControl: isControlTarget(e.target as HTMLElement | null), modalOpen: !!document.querySelector('.modal-back, .md-drawer, [aria-modal="true"]'), modifier: e.ctrlKey || e.metaKey || e.altKey, canPlay: !!k.play, tabs: k.tabs.length })
      if (!out) return
      e.preventDefault()
      if (out.kind === 'play') k.play?.()
      else setTab(k.tabs[out.index])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  // Above the early return, so the hooks run in the same order on every render
  const fixtures = game?.season?.fixtures
  const ai = game?.season?.ai
  // A run-in's table carries the points the clubs had when the manager took over
  const carryIn = game?.season?.carryIn
  const table = useMemo(() => (fixtures && ai ? computeTable(fixtures, [USER_TEAM, ...Object.keys(ai)], carryIn) : []), [fixtures, ai, carryIn])
  // The Boxes control: the head's boxes and the open tab's (display only, per viewer)
  const seasonOver = !!game?.season && (game.season.matchweek >= game.season.matchweeks || !!game.season.sacked)
  const headBoxes = useBoxes(DUGOUT_HEAD, seasonOver ? ['club-header'] : undefined)
  const tabKey = tab === 'market' && game?.window ? 'window' : tab
  const tabBoxes = useBoxes(DUGOUT_TABS[tabKey] ?? NO_BOXES, game ? tabPresent(tabKey, game) : undefined)
  // Simulating weeks runs long on a phone: the button says so in the frame it is tapped, then the weeks play
  const [simming, afterPaint] = useAfterPaint()
  if (!u || !game || !game.season) return null
  const season = game.season
  const get = playerLookup(game, u)
  const formation = getFormation(game.tactics.formationId)

  const pos = positionOf(table, USER_TEAM)
  const row = table.find((r) => r.teamId === USER_TEAM)!
  const next = nextOpponent(game)
  const cupTie = upcomingCupTie(game)
  const strength = teamStrength(game, u)
  const squad = squadPlayers(game, u)
  const preseason = game.phase === 'preseason'
  const playMode = matchPlayOf(game)
  const done = season.matchweek >= season.matchweeks || season.sacked
  const openOffers = game.window?.offers.filter((o) => o.status === 'open').length ?? 0
  const briefing = weeklyBriefing(game, u)
  const headline = briefingHeadline(briefing)
  // Highlights: the stop the last run made (only while the game still stands where it stopped) and whether the next week is itself one
  const stopped = store.simStop && store.simStop.gameId === game.id && store.simStop.year === game.year && store.simStop.matchweek === season.matchweek ? store.simStop.stop : null
  const bigNext = done ? null : nextStop(game, u)
  const act = (a: BriefingAction) => {
    if (a.op === 'autoPick') store.autoPick()
    else if (a.op === 'friendly') store.playFriendly()
    else if (a.op === 'player' && a.playerId) setPlayerModal(a.playerId)
    else if (a.op === 'event') document.querySelector('[data-testid="event-card"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    if (a.tab) setTab(a.tab)
  }

  const tabList: Array<{ id: Tab; label: string; alert?: boolean; badge?: number }> = [
    { id: 'squad', label: 'Squad' },
    ...(done ? [] : [{ id: 'next' as const, label: 'Next match' }]),
    { id: 'tactics', label: 'Tactics' },
    { id: 'dressing', label: 'Dressing room' },
    { id: 'planner', label: 'Planner' },
    { id: 'fixtures', label: 'Fixtures' },
    { id: 'table', label: 'Table' },
    ...(season.cup.length ? [{ id: 'cup' as const, label: 'Cup' }] : []),
    ...(season.continental ? [{ id: 'europe' as const, label: 'Europe' }] : []),
    { id: 'stats', label: 'Stats' },
    { id: 'market', label: 'Market', alert: !!game.window && (openOffers > 0 || game.window.day === 0) },
    { id: 'inbox', label: 'Inbox', alert: !!game.pendingEvent, badge: unseen },
    { id: 'club', label: 'Club' },
  ]
  keys.current = { play: done || game.pendingEvent ? null : () => void store.playWeekSoon(prepareWeek), tabs: tabList.map((t) => t.id) }

  const onSlotClick = (slotId: string) => setSheetSlot(slotId)
  const onPlayerClick = (id: string) => setPlayerModal(id)

  const inXI = new Set(Object.values(game.lineup))
  const sortedSquad = [...squad].sort((a, b) => {
    const ai = inXI.has(a.p.id) ? 0 : 1
    const bi = inXI.has(b.p.id) ? 0 : 1
    if (ai !== bi) return ai - bi
    const order: Position[] = ['GK', 'CB', 'LB', 'RB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST']
    return order.indexOf(a.p.positions[0]) - order.indexOf(b.p.positions[0]) || b.p.overall - a.p.overall
  })

  const squadGrid = tabBoxes.grid([{ track: 'minmax(0, 1fr)', ids: ['squad-list'] }, { track: '380px', ids: ['pitch', 'depth'] }])
  const tableGrid = tabBoxes.grid(TABLE_COLS)

  return (
    <div className={`page dugout-page ${done ? '' : 'has-bottom-bar'} ${headBoxes.on('club-header') ? '' : 'no-club-header'}`} style={!done && barHeight ? ({ '--bottom-bar-h': `${barHeight}px` } as CSSProperties) : undefined}>
      {/* Header */}
      {headBoxes.on('club-header') && (
      <div className="panel club-header">
        <div className="club-head">
          <TeamBadge code={game.settings.shortName} size={48} />
          <div>
            <h2>{game.settings.teamName}</h2>
            <div className="club-sub">
              <span className="chip">
                <LeagueFlag leagueId={season.leagueId} label={u.leagues.find((l) => l.id === season.leagueId)?.name} /> {seasonLabel(season.leagueSeason)}
              </span>
              {game.settings.mode === 'dynasty' && <span>Year {game.year}</span>}
              <span className="chip">{preseason ? 'Pre-season' : `MW ${season.matchweek} of ${season.matchweeks}`}</span>
            </div>
          </div>
        </div>
        <div className="stat-strip">
          <Stat label="Position" value={season.matchweek ? ordinal(pos) : '–'} sub={`${row.points} pts · ${row.won}-${row.drawn}-${row.lost}`} />
          <Stat label="Team rating" value={strength.overall.toFixed(1)} sub={<span title="How evenly the keeper, defence, midfield and attack are rated: an uneven side loses up to 4% of its rating">{Math.round(strength.balance * 100)}% balanced</span>} />
          <Stat label="Budget" value={money(game.finances.budget)} sub={<span title="The weekly wage bill, players and staff, against the wage cap">wages {wage(squad.reduce((s, x) => s + x.p.wage, 0) + staffWages(game.staff))} of {wage(game.finances.wageCap)}</span>} />
          <div className="stat">
            <span className="label">Board</span>
            <span className="value">{Math.round(season.confidence)}</span>
            <Bar value={season.confidence} colour={season.confidence > 60 ? 'var(--good)' : season.confidence > 30 ? 'var(--meter-mid)' : 'var(--danger)'} />
            <span className="small muted">target {ordinal(season.boardTarget)}</span>
          </div>
        </div>
      </div>
      )}

      <RunInBanner />
      {/* Next match CTA: the fixture, the assistant's briefing and the buttons (a fixed bottom bar on phones) */}
      {!done && (
        <div className="panel cta" data-testid="cta">
          <div className="cta-main">
            {preseason ? (
              <div className="cta-fixture">
                <div className="cta-title">
                  Pre-season <Info label="About pre-season">Tick off the checklist, then kick off the league. Friendlies build sharpness and tactical familiarity, with a small injury risk.</Info>
                </div>
              </div>
            ) : next ? (
              <div className="cta-fixture">
                <ClubBadge clubId={next.clubId} size={40} />
                <div>
                  <div className="eyebrow">Matchweek {season.matchweek + 1} · {next.home ? 'Home' : 'Away'}</div>
                  <div className="cta-title">
                    {next.home ? 'v' : 'at'} {clubName(u, next.clubId)}
                  </div>
                  <div className="club-sub">
                    <span>{STYLE_LABEL[u.clubById[next.clubId]?.style ?? 'balanced']} side</span>
                    <span>{ordinal(positionOf(table, next.clubId))}</span>
                    {u.clubById[season.hostClubId]?.rivals.includes(next.clubId) && <span className="chip warn">Derby</span>}
                    {game.window && <WindowChip w={game.window} />}
                    {/* Season Highlights: why the last Sim to the next big match stopped here (a chip, so the box keeps its height) */}
                    {stopped && (
                      <span className="chip info" data-testid="sim-stop" title={stopLine(stopped, u)}>
                        ⏸ {stopped.label}
                      </span>
                    )}
                    {cupTie && <span>then {cupTie.label} {cupTie.tie.homeTeamId === USER_TEAM ? 'v' : 'at'} {clubShort(u, cupTie.tie.homeTeamId === USER_TEAM ? cupTie.tie.awayTeamId : cupTie.tie.homeTeamId)} midweek</span>}
                  </div>
                </div>
              </div>
            ) : (
              <div className="cta-fixture">
                <div>
                  <div className="eyebrow">
                    Matchweek {season.matchweek + 1}
                    {stopped && (
                      <span className="chip info" data-testid="sim-stop" title={stopLine(stopped, u)} style={{ marginLeft: 8 }}>
                        ⏸ {stopped.label}
                      </span>
                    )}
                  </div>
                  <div className="cta-title">
                    Free weekend <Info label="Why a free weekend">An odd number of clubs means everyone sits one round out.</Info>
                  </div>
                  {cupTie && (
                    <div className="club-sub">
                      <span>
                        then {cupTie.label} {cupTie.tie.homeTeamId === USER_TEAM ? 'v' : 'at'} {clubShort(u, cupTie.tie.homeTeamId === USER_TEAM ? cupTie.tie.awayTeamId : cupTie.tie.homeTeamId)} midweek
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}
            {headBoxes.on('briefing') && <BriefingList items={briefing} onAction={act} checklist={preseason} />}
          </div>
          <div className="cta-bar" ref={barRef} data-testid="cta-bar">
            {headline && (
              <div className={`bar-brief ${headline.level}`} data-testid="bar-brief">
                <span className="icon" aria-hidden="true">
                  <BriefingIcon item={headline} size={15} />
                </span>
                <span className="text">{headline.text}</span>
                {headline.action && headline.action.op !== 'friendly' && (
                  <button className="btn sm" onClick={() => act(headline.action!)}>
                    {headline.action.label}
                  </button>
                )}
              </div>
            )}
            <div className="match-play" data-testid="match-play" role="radiogroup" aria-label="How to play the match">
              <span className="small muted">Match:</span>
              {MATCH_PLAY_MODES.map((m) => (
                <button key={m.id} type="button" role="radio" aria-checked={playMode === m.id} className={`chip-btn ${playMode === m.id ? 'active' : ''}`} title={m.hint} onClick={() => store.setMatchPlay(m.id)} data-testid={`match-play-${m.id}`}>
                  {m.label}
                </button>
              ))}
            </div>
            {/* On a narrow phone the labels shorten (`.lbl-short`) and the buttons wrap rather than clip */}
            <div className="btns">
              {preseason && game.friendliesPlayed < 3 && (
                <button className="btn" onClick={() => store.playFriendly()}>
                  <span className="lbl-long">Play friendly</span>
                  <span className="lbl-short">Friendly</span>
                </button>
              )}
              <button className="btn primary big" onClick={() => void store.playWeekSoon(prepareWeek)} disabled={!!game.pendingEvent || store.playingWeek} aria-busy={store.playingWeek || undefined} data-testid="play-week" title="Space plays the matchweek; 1 to 0 open the tabs">
                <span className="lbl-long">{store.playingWeek ? (preseason ? 'Kicking off…' : 'Playing…') : preseason ? 'Kick off the season' : next ? `Play matchweek ${season.matchweek + 1}` : `Sit out matchweek ${season.matchweek + 1}`}</span>
                <span className="lbl-short">{store.playingWeek ? (preseason ? 'Kicking off…' : 'Playing…') : preseason ? 'Kick off' : next ? `Play MW ${season.matchweek + 1}` : `Sit out MW ${season.matchweek + 1}`}</span>
                {next && playMode !== 'watch' && <span className="mode-tag">{playMode === 'auto' ? 'Auto-play' : 'Sim result'}</span>}
              </button>
              <button className="btn" data-testid="sim-big" onClick={() => afterPaint(() => store.simToNextBigMatch())} disabled={!!game.pendingEvent || !!bigNext || simming} aria-busy={simming || undefined} title={bigNext ? `The next match is one to manage: ${bigNext.label}` : 'The assistant plays the routine weeks and stops before the next derby, title decider, cup semi-final or final, open run-in or the January window'}>
                <span className="lbl-long">{bigNext ? `${bigNext.label} next` : simToLabel(game, u)}</span>
                <span className="lbl-short">{bigNext ? 'Big match next' : 'To big match'}</span>
              </button>
              <button className="btn" onClick={() => afterPaint(() => store.simWeeks(5))} disabled={!!game.pendingEvent || simming} aria-busy={simming || undefined} title="Assistant picks the team and resolves decisions" data-testid="sim-5">
                {simming ? 'Simulating…' : 'Sim 5'}
              </button>
              <button className="btn ghost" onClick={() => confirm('Simulate the rest of the season with the assistant managing?') && afterPaint(() => store.simToEnd())} disabled={!!game.pendingEvent || simming} data-testid="sim-end">
                Sim to end
              </button>
            </div>
          </div>
        </div>
      )}
      {game.pendingEvent && <EventCard />}

      <div className="tabs-row">
        <Tabs<Tab> value={tab} onChange={setTab} tabs={tabList} />
        <BoxesMenu groups={[headBoxes, tabBoxes]} resets={DUGOUT_ALL} />
      </div>

      {/* The tab's content: on a desktop it scrolls inside itself under the fixed header, briefing and tab bar */}
      <div className="tab-body fill" data-testid="tab-body">
      {tab === 'squad' && <Tip id="dugout-first">Kick off plays the next match your way: Watch it live, Auto-play lets the assistant make the calls, Sim result goes straight to the score. Below, the bars are condition and sharpness, the face his morale, the arrow his form; the disc is his rating in that slot (acc. a small out-of-position cost, awk. a big one).</Tip>}
      {tab === 'squad' && game.youthIntake && game.youthIntake.chosen === undefined && preseason && (
        <div className="panel emphasis youth-intake" style={{ marginBottom: 'var(--space-4)' }} data-testid="youth-intake">
          <div className="panel-head">
            <h3 className="icon-title">
              <GraduationCap size={20} aria-hidden="true" /> Youth intake
            </h3>
            {/* A short desktop window: the candidates as one line of chips in the head (CSS shows this or the cards below) */}
            <span className="youth-line" data-testid="youth-line">
              {game.youthIntake.candidates.map((id) => {
                const p = u.index[id]
                if (!p) return null
                const home = p.clubId === game.settings.hostClubId
                return (
                  <button key={id} type="button" className={`youth-chip${home ? ' home' : ''}`} onClick={() => store.showToast(store.signYouth(id).message)} title={`${p.name}, ${p.age}, ${clubName(u, p.clubId)}${home ? ' · Homegrown' : ''}: sign him free on a three-year deal`} data-testid="youth-chip">
                    <Pos p={p.positions[0]} />
                    <span className="youth-chip-name">{p.name}</span>
                    <span className="small muted">{p.age}</span>
                    <Rating value={p.overall} />
                    <span className="btn sm primary">Sign</span>
                  </button>
                )
              })}
            </span>
            <span className="row youth-side" style={{ gap: 'var(--space-3)' }}>
              <span className="small muted youth-terms">Sign one free on a three-year deal</span>
              <button className="btn ghost sm" onClick={() => store.showToast(store.signYouth(null).message)} data-testid="youth-pass">
                Pass this year
              </button>
            </span>
          </div>
          <div className="plist lined youth-list">
            {game.youthIntake.candidates.map((id) => {
              const p = u.index[id]
              if (!p) return null
              return <PlayerRow key={id} p={p} showClub onClick={() => store.showToast(store.signYouth(id).message)} right={<span className="btn sm primary">Sign</span>} extra={p.clubId === game.settings.hostClubId ? <span className="chip gold">Homegrown</span> : undefined} />
            })}
          </div>
        </div>
      )}
      {tab === 'squad' && (
        <div className={`grid dugout ${squadGrid.className}`} style={squadGrid.style}>
          {tabBoxes.on('squad-list') && (
          <div className="panel">
            <div className="panel-head">
              <span className="head-title">
                <h3>Squad · {squad.length}/{SQUAD_CAP}</h3>
                <Info label="About the squad list">Tap a player for his details. Tap a pitch slot to choose who plays there.</Info>
              </span>
              <div className="toolbar">
                <button type="button" className={`chip key-chip ${showKey ? 'info' : ''}`} aria-pressed={showKey} onClick={toggleKey} data-testid="key-toggle" title="Label the bars and the pitch markers">
                  Key
                </button>
                <span className="segmented squad-views-seg" role="radiogroup" aria-label="Squad list view" data-testid="squad-view">
                  {SQUAD_VIEWS.map((v) => (
                    <button key={v.id} type="button" role="radio" aria-checked={view === v.id} className={view === v.id ? 'active' : ''} title={v.hint} onClick={() => setView(writeSquadView(v.id))} data-testid={v.id === 'fitness' ? 'toggle-stamina' : `squad-view-${v.id}`}>
                      {v.label}
                    </button>
                  ))}
                </span>
                <button className="btn sm" onClick={() => store.autoPick()}>
                  Auto-pick
                </button>
              </div>
            </div>
            <div className="plist lined">
              {sortedSquad.map(({ p, s }) => {
                const starting = inXI.has(p.id)
                const slot = formation.slots.find((sl) => game.lineup[sl.id] === p.id)
                const avg = s.seasonStats.apps ? (s.seasonStats.ratingSum / s.seasonStats.apps).toFixed(2) : '–'
                const last = s.recentRatings[s.recentRatings.length - 1]
                const mins = minutesLast3(s)
                const contract = game.contracts[p.id]
                return (
                  <PlayerRow
                    key={p.id}
                    p={p}
                    state={s}
                    showLabels={showKey}
                    onClick={() => onPlayerClick(p.id)}
                    showClub
                    extra={
                      <>
                        {game.captainId === p.id && (
                          <span className="chip gold" title="Captain">
                            C
                          </span>
                        )}
                        {view === 'fitness' && (
                          <>
                            <span className="season-line" title="Condition now">
                              Cond {meterValue(s.condition)}
                            </span>
                            <span className={`chip ${p.positions[0] === 'GK' ? '' : p.attributes.stamina >= 75 ? 'good' : p.attributes.stamina < 55 ? 'warn' : ''}`} data-testid="stamina-col" title={p.positions[0] === 'GK' ? `Stamina ${p.attributes.stamina}: a keeper's reads low and costs him nothing` : `Stamina ${p.attributes.stamina}: how long his legs last`}>
                              {SQUAD_COLUMNS[0].short} {p.attributes.stamina}
                            </span>
                            {mins !== null && (
                              <span className="season-line" title="Minutes over the last three matchweeks, league and cup">
                                {mins} min in 3 weeks
                              </span>
                            )}
                          </>
                        )}
                        {view === 'overview' && s.seasonStats.apps > 0 && (
                          <span className="season-line">
                            {countPhrase(s.seasonStats.apps, 'apps')} · {s.seasonStats.goals}g {s.seasonStats.assists}a · {avg}
                          </span>
                        )}
                        {view === 'form' && (
                          <span className="season-line" data-testid="form-line">
                            {last === undefined ? 'No rating yet' : <>Last <b className={`rating-word ${ratingBand(last)}`}>{last.toFixed(1)}</b> · avg {avg} · {s.seasonStats.motm} MOTM</>}
                          </span>
                        )}
                        {view === 'contract' && (
                          <span className="season-line" data-testid="contract-line">
                            {contract?.loan ? 'Loan' : `${contract?.years ?? 1}y`} · {wage(p.wage)} · {STATUS_LABEL[statusOf(game, p.id)]} · {money(p.value)}
                          </span>
                        )}
                      </>
                    }
                    right={starting ? <span className="chip info">{slot?.position}</span> : game.bench.includes(p.id) ? <span className="chip">Bench</span> : <span className="chip muted">Unused</span>}
                  />
                )
              })}
            </div>
          </div>
          )}
          {(tabBoxes.on('pitch') || tabBoxes.on('depth')) && (
          <div className="col">
            {tabBoxes.on('pitch') && (
            <div className="panel">
              <div className="panel-head">
                <h3>{formation.name}</h3>
                <span className="unit-strip" role="group" aria-label="Unit ratings">
                  {(
                    [
                      ['GK', strength.goalkeeping],
                      ['DEF', strength.defence],
                      ['MID', strength.midfield],
                      ['ATT', strength.attack],
                    ] as const
                  ).map(([k, v]) => (
                    <span key={k}>
                      <i>{k}</i> {v.toFixed(0)}
                    </span>
                  ))}
                </span>
              </div>
              <Pitch formation={formation} lineup={game.lineup} getPlayer={get} getState={(id) => game.squad[id]} onSlotClick={onSlotClick} selectedSlot={sheetSlot} showRoles={Object.fromEntries(formation.slots.map((s) => [s.id, getRole(game.tactics.roles[s.id] ?? DEFAULT_ROLE[s.position]).name]))} roleCodes={Object.fromEntries(formation.slots.map((s) => [s.id, roleCode(game.tactics, s.id, s.position)]))} />
              {showKey && <PitchLegend />}
              {strength.chemistryBreakdown.length > 0 && <div className="small muted" style={{ marginTop: 'var(--space-2)' }}>Chemistry {signedValue(strength.chemistry)}: {strength.chemistryBreakdown.map((l) => chemistryLinkLabel(u, l)).join(', ')}</div>}
            </div>
            )}
            {tabBoxes.on('depth') && (
            <div className="panel">
              <div className="panel-head">
                <span className="head-title">
                  <h3>Depth chart</h3>
                  <Info label="About the depth chart">Who can cover each position, rated there. Blue is in the XI; struck through is unavailable.</Info>
                </span>
              </div>
              <div className="depth">
                {[...new Set(formation.slots.map((sl) => sl.position))].map((pos) => {
                  const cover = squad
                    .filter((x) => canCover(x.p, pos, 'accomplished'))
                    .map((x) => ({ ...x, r: Math.round(ratingAt(x.p, pos)) }))
                    .sort((a, b) => b.r - a.r)
                    .slice(0, 4)
                  return (
                    <div key={pos} className="depth-row">
                      <Pos p={pos} />
                      <span className="depth-names">
                        {cover.length === 0 && <span className="chip bad">Nobody</span>}
                        {cover.map((x) => (
                          <PlayerPeek key={x.p.id} p={x.p} s={x.s}>
                            <button type="button" className={`chip ${inXI.has(x.p.id) ? 'info' : ''} ${!isAvailable(x.s) ? 'dim' : ''}`} onClick={() => onPlayerClick(x.p.id)} title={!isAvailable(x.s) ? 'Unavailable' : inXI.has(x.p.id) ? 'Starting' : 'Available'}>
                              {surname(x.p.name)} {x.r}
                            </button>
                          </PlayerPeek>
                        ))}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
            )}
          </div>
          )}
        </div>
      )}

      {tab === 'next' && <NextMatchTab boxes={tabBoxes} />}
      {tab === 'tactics' && <TacticsTab boxes={tabBoxes} />}
      {tab === 'dressing' && <DressingRoomTab onPlayer={onPlayerClick} boxes={tabBoxes} />}
      {tab === 'planner' && <PlannerTab onPlayer={onPlayerClick} boxes={tabBoxes} />}

      {tab === 'fixtures' && (
        <div className="panel">
          <div className="panel-head">
            <span className="head-title">
              <h3>Fixtures and results</h3>
              <Info label="About the calendar">One cell a matchweek: the opponent, home or away and the result; a cup tie after the matchweek sits in the same cell. Upcoming cells are tinted by the opponent's place today: red for the top four, green for the bottom four.</Info>
            </span>
          </div>
          {tabBoxes.on('calendar') && <SeasonStrip table={table} />}
          {tabBoxes.on('fixture-list') && (
          <div className="fixture-list">
            {season.takeoverAt ? (
              <div className="fixture me" data-testid="before-you-arrived">
                <span className="mw">MW 1-{season.takeoverAt}</span>
                <span className="muted small" style={{ gridColumn: '2 / -1' }}>
                  Before you arrived: the table you took over is projected from the real final one.
                </span>
              </div>
            ) : null}
            {season.fixtures
              .filter((f) => (f.homeTeamId === USER_TEAM || f.awayTeamId === USER_TEAM) && f.matchweek > (season.takeoverAt ?? 0))
              .sort((a, b) => a.matchweek - b.matchweek)
              .map((f) => {
                const home = f.homeTeamId === USER_TEAM
                const opp = home ? f.awayTeamId : f.homeTeamId
                const r = f.result
                const gf = r ? (home ? r.homeGoals : r.awayGoals) : null
                const ga = r ? (home ? r.awayGoals : r.homeGoals) : null
                const cls = gf === null || ga === null ? '' : outcomeClass(outcomeOf(gf, ga))
                // The opponent's place in the table today, muted beside his name
                const oppPos = season.matchweek > 0 ? <span className="fx-pos" data-testid="fixture-pos" title={`${clubName(u, opp)} are ${ordinal(positionOf(table, opp))} now`}>{ordinal(positionOf(table, opp))}</span> : null
                return (
                  <div key={f.matchweek} className="fixture me">
                    <span className="mw">MW {f.matchweek}</span>
                    <span className="h row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                      {home ? null : oppPos} {home ? <span className="fx-name">{game.settings.teamName}</span> : <FxName full={clubName(u, opp)} short={clubShort(u, opp)} />} {home ? null : <ClubBadge clubId={opp} size={18} />}
                    </span>
                    <span className={`sc chip ${cls}`} style={{ fontFamily: 'var(--font-display)', fontSize: 'calc(var(--fs-base) + 2px)' }}>
                      {r ? `${r.homeGoals} - ${r.awayGoals}` : 'v'}
                      {gf !== null && ga !== null && <span className="res-letter">{outcomeOf(gf, ga)}</span>}
                    </span>
                    <span className="row" style={{ gap: 6 }}>
                      {home ? <ClubBadge clubId={opp} size={18} /> : null} {home ? <FxName full={clubName(u, opp)} short={clubShort(u, opp)} /> : <span className="fx-name">{game.settings.teamName}</span>} {home ? oppPos : null}
                    </span>
                  </div>
                )
              })}
          </div>
          )}
        </div>
      )}

      {tab === 'table' && (
        <div className={`grid fill table-grid ${tableGrid.className}`} style={tableGrid.style}>
          {tabBoxes.on('league-table') && (
          <div className="panel">
            <div className="panel-head">
              <span className="head-title">
                <h3><LeagueFlag leagueId={season.leagueId} label={u.leagues.find((l) => l.id === season.leagueId)?.name} /> League table · {seasonLabel(season.leagueSeason)}{season.carryIn ? ` · from MW ${season.takeoverAt}, projected` : ''}</h3>
                <Info label="About the table">The other clubs field their real squads from that season, with their own injuries and form.</Info>
              </span>
            </div>
            <div className="tbl-wrap">
              <TableView rows={table} teamName={game.settings.teamName} />
            </div>
          </div>
          )}
          {tabBoxes.on('season-so-far') && <SeasonSoFar table={table} />}
        </div>
      )}

      {tab === 'cup' && <CupTab comp="cup" />}
      {tab === 'europe' && <CupTab comp="continental" />}
      {tab === 'stats' && <StatsTab boxes={tabBoxes} />}
      {tab === 'market' && <MarketTab boxes={tabBoxes} />}
      {tab === 'inbox' && (
        <div className="panel">
          <div className="panel-head">
            <h3>Inbox</h3>
            {dividerAt > 0 && (
              <span className="small muted" data-testid="inbox-new-count">
                {Math.min(dividerAt, season.news.length)} new since your last visit
              </span>
            )}
          </div>
          <div className="inbox-filters row wrap" role="radiogroup" aria-label="Show" data-testid="inbox-filter">
            {INBOX_FILTERS.map((f) => (
              <button key={f.id} type="button" role="radio" aria-checked={inboxFilter === f.id} className={`chip-btn ${inboxFilter === f.id ? 'active' : ''}`} onClick={() => setInboxFilter(f.id)}>
                {f.label}
                {f.id !== 'all' && <span className="muted"> {filterNews(season.news, f.id).length}</span>}
              </button>
            ))}
          </div>
          {/* Pinned while something waits on the manager: the week's decision, or offers for his players */}
          {(game.pendingEvent || openOffers > 0) && (
            <div className="needs-you" data-testid="needs-you">
              <span className="needs-you-label">Needs you</span>
              {game.pendingEvent && (
                <button type="button" className="btn sm" onClick={() => act({ op: 'event', label: 'Decide' })}>
                  Decide: {game.pendingEvent.title}
                </button>
              )}
              {openOffers > 0 && (
                <button type="button" className="btn sm" onClick={() => setTab('market')}>
                  {openOffers} offer{openOffers === 1 ? '' : 's'} for your players
                </button>
              )}
            </div>
          )}
          <div className="news">
            {filterNews(season.news, inboxFilter).map(({ n, i }, k, shown) => (
              <Fragment key={i}>
                <div className={`item ${i < dividerAt ? 'new' : ''}`}>
                  <span className={`news-icon ${n.kind}`}>
                    <NewsIcon kind={n.kind} size={15} />
                  </span>
                  <span>
                    <div className="t">{n.title}</div>
                    <div className="b">{newsBody(n)}</div>
                    <InboxActions item={n} game={game} onAction={act} />
                  </span>
                  <span className="news-mw">{n.matchweek ? `MW ${n.matchweek}` : 'Pre'}</span>
                </div>
                {/* The divider sits under the last unread item, when anything older is still in the feed */}
                {i < dividerAt && (shown[k + 1]?.i ?? Infinity) >= dividerAt && k < shown.length - 1 && (
                  <div className="divider" data-testid="inbox-divider">
                    <span>New above · seen before below</span>
                  </div>
                )}
              </Fragment>
            ))}
            {inboxFilter !== 'all' && filterNews(season.news, inboxFilter).length === 0 && <div className="muted small">Nothing here yet.</div>}
          </div>
        </div>
      )}
      {tab === 'club' && <ClubTab table={table} onPlayer={onPlayerClick} boxes={tabBoxes} />}
      </div>

      <PlayerModal key={playerModal ?? 'none'} id={playerModal} onClose={() => setPlayerModal(null)} />
      <SlotSheet slotId={sheetSlot} onClose={() => setSheetSlot(null)} />
    </div>
  )
}

/** One row of the slot picker: the player rated in the slot, his fit, the disc number and where he is now. */
function SlotOptionRow({ o, at, onPick }: { o: SlotOption; at: Position; onPick?: () => void }) {
  const rated = slotRating(o.p, at)
  const fitChip = o.fit === 'natural' ? <span className="chip good">fits</span> : o.fit === 'accomplished' ? <span className="chip warn">acc.</span> : <span className="chip bad">awk.</span>
  return (
    <PlayerRow
      p={o.p}
      state={o.s}
      dim={!!o.unavailable}
      onClick={o.unavailable ? undefined : onPick}
      extra={
        <>
          {fitChip}
          <span className={`chip ${o.where.kind === 'starting' ? 'info' : 'muted'}`}>{whereaboutsLabel(o.where)}</span>
          {o.unavailable && <span className="chip bad">{o.unavailable === 'injured' ? 'Injured' : 'Suspended'}</span>}
        </>
      }
      right={
        <span className="slot-disc" title={slotRatingLine(rated, at, { attributes: true })} role="img" aria-label={slotRatingLine(rated, at)} data-testid="slot-disc">
          {o.disc}
          {rated.cost > 0 && <span className="slot-disc-cost">−{rated.cost}</span>}
        </span>
      }
    />
  )
}

/** The slot picker: a bottom sheet on a phone, a modal elsewhere. Tapping a row puts him in the slot (swapping with whoever is there). */
function SlotSheet({ slotId, onClose }: { slotId: string | null; onClose: () => void }) {
  const store = useStore()
  const { universe: u, game } = store
  if (!u || !game || !slotId) return null
  const sheet = slotSheet(game, u, slotId)
  if (!sheet) return null
  const pick = (id: string, to: string | 'bench' = slotId) => {
    store.playInSlot(id, to)
    onClose()
  }
  const role = getRole(game.tactics.roles[slotId] ?? DEFAULT_ROLE[sheet.slot.position]).name
  return (
    <Modal open sheet onClose={onClose} title={`Pick your ${sheet.label}`} testId="slot-sheet">
      <div className="sheet-meta">
        <span className="chip">{role}</span>
        <span className="small muted">Best first</span>
        <Info label="About the numbers">The badge on the left is his overall. The number on the right is his rating in this slot, the one his pitch disc would show: his overall less any out-of-position cost (the −N under it). Sorted best first by how his attributes suit the position.</Info>
      </div>
      {sheet.occupant ? (
        <div className="sheet-occupant">
          <SlotOptionRow o={sheet.occupant} at={sheet.slot.position} />
          <button className="btn sm" data-testid="sheet-to-bench" onClick={() => pick(sheet.occupant!.p.id, 'bench')}>
            To bench
          </button>
        </div>
      ) : (
        <div className="notice" style={{ marginBottom: 'var(--space-2)' }}>
          Nobody is in this slot.
        </div>
      )}
      <h3 className="sheet-group">Can play {sheet.slot.position} · {sheet.cover.length}</h3>
      <div className="plist lined" data-testid="sheet-cover">
        {sheet.cover.length === 0 && <div className="muted small">No other natural or accomplished {sheet.slot.position}. Try out of position below.</div>}
        {sheet.cover.map((o) => (
          <SlotOptionRow key={o.p.id} o={o} at={sheet.slot.position} onPick={() => pick(o.p.id)} />
        ))}
      </div>
      {sheet.outOfPosition.length > 0 && (
        <details className="sheet-out" data-testid="sheet-out">
          <summary>Out of position · {sheet.outOfPosition.length}</summary>
          <div className="plist lined">
            {sheet.outOfPosition.map((o) => (
              <SlotOptionRow key={o.p.id} o={o} at={sheet.slot.position} onPick={() => pick(o.p.id)} />
            ))}
          </div>
        </details>
      )}
    </Modal>
  )
}

/**
 * The Next match tab: the opposition report open across the top, then our XI against theirs unit by unit and the
 * team talk with its hint, so the Squad tab keeps the list, the pitch and the depth chart at full height.
 */
function NextMatchTab({ boxes }: { boxes: Boxes }) {
  const store = useStore()
  const { universe: u, game } = store
  if (!u || !game?.season) return null
  const next = nextOpponent(game)
  const rows = next ? matchUp(game, u, next.clubId) : null
  const talk = TALKS.find((t) => t.value === game.teamTalk)
  const upGrid = boxes.grid(rows && next ? [{ track: '1fr', ids: ['match-up'] }, { track: '1fr', ids: ['team-talk'] }] : [{ track: '1fr', ids: ['team-talk'] }])
  return (
    <div className="next-match" data-testid="next-match">
      {next ? boxes.on('opposition') && <OppositionReport clubId={next.clubId} home={next.home} open /> : <div className="notice">A free weekend: no opponent this matchweek. The talk carries to the next match.</div>}
      <div className={`grid two ${upGrid.className}`} style={upGrid.style}>
        {rows && next && boxes.on('match-up') && (
          <div className="panel" data-testid="match-up">
            <div className="panel-head">
              <span className="head-title">
                <h3>Unit against unit</h3>
                <Info label="About the match-up">Your XI's unit ratings now (condition, morale and form included) against theirs. An edge of more than {EVEN_BAND} points either way is marked.</Info>
              </span>
              <span className="small muted">You v {clubShort(u, next.clubId)}</span>
            </div>
            <div className="matchup">
              {rows.map((r) => (
                <div key={r.label} className="matchup-row">
                  <span className="matchup-label">{r.label}</span>
                  <b className="mono">{r.ours.toFixed(1)}</b>
                  <span className="matchup-bar" aria-hidden="true">
                    <span style={{ width: `${Math.max(4, Math.min(96, 50 + (r.ours - r.theirs) * 5))}%` }} />
                  </span>
                  <b className="mono">{r.theirs.toFixed(1)}</b>
                  <span className={`chip ${r.edge === 'ahead' ? 'good' : r.edge === 'behind' ? 'bad' : ''}`}>{r.edge === 'ahead' ? 'Edge' : r.edge === 'behind' ? 'Behind' : 'Even'}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {boxes.on('team-talk') && (
        <div className="panel" data-testid="team-talk">
          <div className="panel-head">
            <span className="head-title">
              <h3>Team talk</h3>
              <Info label="About team talks">Calm settles nerves when the odds are against you. Encourage is a safe, small lift. Demand keeps favourites honest and pressures underdogs. Fire up is high variance.</Info>
            </span>
          </div>
          <Segmented<TeamTalk> value={game.teamTalk} onChange={store.setTeamTalk} options={TALKS} />
          {talk && <p className="help">{talk.hint}</p>}
        </div>
        )}
      </div>
    </div>
  )
}

const TALKS: Array<{ value: TeamTalk; label: string; hint: string }> = [
  { value: 'calm', label: 'Calm', hint: 'Settles nerves when the odds are against you' },
  { value: 'encourage', label: 'Encourage', hint: 'Safe, small lift' },
  { value: 'demand', label: 'Demand', hint: 'Keeps favourites honest, pressures underdogs' },
  { value: 'fire-up', label: 'Fire up', hint: 'High variance' },
]

/** The Table tab's right box: league position after each matchweek, the clubs around us faint, the board's target dashed. */
function SeasonSoFar({ table }: { table: TableRow[] }) {
  const { universe: u, game } = useStore()
  const fixtures = game?.season?.fixtures
  const ai = game?.season?.ai
  const carryIn = game?.season?.carryIn
  const story = useMemo(() => (fixtures && ai ? positionStory(fixtures, [USER_TEAM, ...Object.keys(ai)], carryIn) : null), [fixtures, ai, carryIn])
  if (!u || !game?.season || !story) return null
  const season = game.season
  const first = (season.takeoverAt ?? 0) + 1
  return (
    <div className="panel" data-testid="season-so-far">
      <div className="panel-head">
        <span className="head-title">
          <h3>Season so far</h3>
          <Info label="About the chart">Your place in the table after each matchweek, 1st at the top. The faint lines are the clubs placed nearest to you now; the dashed line is the board's target.</Info>
        </span>
        {story.series.length > 0 && <span className="small muted">{ordinal(story.series[story.series.length - 1])} after MW {story.matchweeks[story.matchweeks.length - 1]}</span>}
      </div>
      {story.series.length === 0 ? (
        <div className="muted small">The chart starts after the first matchweek.</div>
      ) : (
        <PositionChart series={story.series} rivals={story.rivals.map((r) => ({ ...r, name: clubShort(u, r.teamId) }))} teams={table.length} games={season.matchweeks - first + 1} unit="MW" first={first} target={season.boardTarget} title="League position by matchweek" />
      )}
    </div>
  )
}

/** The Fixtures tab's calendar: one cell a matchweek, ten to a row on a desktop. */
function SeasonStrip({ table }: { table: TableRow[] }) {
  const { universe: u, game } = useStore()
  if (!u || !game?.season) return null
  const cells = seasonStrip(game, table)
  const nextMw = game.season.matchweek + 1
  return (
    <div className="season-strip" data-testid="season-strip">
      {cells.map((c) => {
        const opp = c.opp ? clubName(u, c.opp) : null
        const tieLine = c.ties.map((t) => `${t.comp === 'cup' ? 'Cup' : 'Continental Cup'} ${t.round} ${t.home ? 'v' : 'at'} ${clubName(u, t.opp)}${t.score ? ` ${t.score}` : ''}`).join('; ')
        const title = `MW ${c.matchweek}: ${opp ? `${c.home ? 'v' : 'at'} ${opp}${c.score ? ` ${c.score}` : ''}` : 'free weekend'}${tieLine ? `; then ${tieLine}` : ''}`
        return (
          <div key={c.matchweek} className={`ss-cell ${c.outcome ? 'played' : c.band ? `band-${c.band}` : 'free'} ${c.matchweek === nextMw ? 'next' : ''}`} title={title} data-testid="strip-cell">
            <span className="ss-mw">{c.matchweek}</span>
            <span className="ss-opp">
              {c.opp ? <ClubBadge clubId={c.opp} size={18} /> : <span className="muted">–</span>}
              {c.opp && <span className="ss-ha">{c.home ? 'H' : 'A'}</span>}
            </span>
            <span className="ss-chips">
              {c.outcome && <span className={`chip ${outcomeClass(c.outcome)}`}>{c.outcome}</span>}
              {c.ties.map((t) => (
                <span key={t.comp + t.round} className={`chip ss-tie ${t.outcome ? outcomeClass(t.outcome) : ''}`}>
                  {t.comp === 'cup' ? 'Cup' : 'CC'}
                  {t.outcome && <span className="res-letter">{t.outcome}</span>}
                </span>
              ))}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/** "Window shuts in N days" while a transfer window is open; red on its last day. */
function WindowChip({ w }: { w: { day: number; days: number } }) {
  const c = windowCountdown(w)
  return (
    <span className={`chip ${c.last ? 'bad' : 'warn'}`} data-testid="window-countdown" title={`Market day ${w.day + 1} of ${w.days}; three market days pass each matchweek`}>
      {c.label}
    </span>
  )
}

/** A club's name in a fixture or cup row: the full name, or on a phone the short one, with the full name in the tooltip. */
function FxName({ full, short }: { full: string; short: string }) {
  return (
    <span className={`fx-name ${short && short !== full ? 'has-short' : ''}`} title={full}>
      <span className="fx-full">{full}</span>
      <span className="fx-short">{short}</span>
    </span>
  )
}

/**
 * The assistant's briefing: one line per thing to do, with the button that does it. On a short desktop window
 * (styles.css) only the first line shows, with a "+n more" button that opens the rest over the tab rather than
 * pushing the tab's box down; elsewhere the toggle is hidden and every line shows.
 */
function BriefingList({ items, onAction, checklist }: { items: BriefingItem[]; onAction: (a: BriefingAction) => void; checklist?: boolean }) {
  const [open, setOpen] = useState(false)
  if (items.length === 0) return null
  const line = (item: BriefingItem, toggle?: ReactNode) => (
    <li key={item.id} className={`brief ${item.level} ${item.done ? 'done' : ''}`} data-brief={item.id}>
      <span className="icon" aria-hidden="true">
        <BriefingIcon item={item} size={15} />
      </span>
      <span className="text">
        {item.text}
        {item.hint && <Info label={`About: ${item.text}`}>{item.hint}</Info>}
      </span>
      {/* Play friendly is the panel's own button, so the checklist line does not repeat it */}
      {item.action && item.action.op !== 'friendly' ? (
        <button className="btn sm" onClick={() => onAction(item.action!)}>
          {item.action.label}
        </button>
      ) : (
        <span />
      )}
      {toggle}
    </li>
  )
  if (checklist || items.length === 1) {
    return (
      <div className="briefing-wrap" data-testid="briefing">
        <ul className={`briefing ${checklist ? 'checklist' : ''}`}>{items.map((item) => line(item))}</ul>
      </div>
    )
  }
  const [first, ...rest] = items
  const toggle = (
    <button type="button" className="chip-btn brief-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-testid="briefing-more">
      {open ? 'Less' : `+${rest.length} more`}
    </button>
  )
  return (
    <div className={`briefing-wrap collapsible ${open ? 'open' : ''}`} data-testid="briefing">
      <ul className="briefing">{line(first, toggle)}</ul>
      <ul className="briefing brief-rest">{rest.map((item) => line(item))}</ul>
    </div>
  )
}

/** The tactics boxes; `boxes` is the Dugout's Boxes control (the arena hub shows every box). */
export function TacticsTab({ boxes }: { boxes?: Boxes }) {
  const store = useStore()
  const { universe: u, game } = store
  if (!u || !game) return null
  const on = (id: string) => boxes?.on(id) ?? true
  const left = ['formation', 'instructions', 'training', 'set-pieces'].some(on)
  const grid = boxes?.grid([{ track: 'minmax(0, 1fr)', ids: ['formation', 'instructions', 'training', 'set-pieces'] }, { track: '380px', ids: ['roles'] }]) ?? { className: '', style: undefined }
  const get = playerLookup(game, u)
  const formation = getFormation(game.tactics.formationId)
  const t = game.tactics
  const strength = teamStrength(game, u)
  const familiarity = teamFamiliarity(game)
  return (
    <>
      <Tip id="tactics-first">A role moves a player's quality between units; rating in role is what the engine uses, and the team rating updates as you change it.</Tip>
      <div className={`grid dugout ${grid.className}`} style={grid.style}>
        {left && (
        <div className="col">
          {on('formation') && (
          <div className="panel">
            <h3>Formation</h3>
            <FormationPicker value={t.formationId} onChange={(id) => store.setFormation(id)} blurbs />
            <p className="help">Changing shape mid-season knocks tactical familiarity back a little.</p>
          </div>
          )}
          {on('instructions') && (
          <div className="panel">
            <h3>Team instructions</h3>
            <div className="instructions">
            <Instruction label="Mentality" help={MENTALITY_HELP[t.mentality]}>
              <Segmented value={t.mentality} onChange={(v) => store.setTactics({ mentality: v })} options={[{ value: 'defensive', label: 'Defensive' }, { value: 'balanced', label: 'Balanced' }, { value: 'attacking', label: 'Attacking' }]} />
            </Instruction>
            <Instruction label="Pressing" help={PRESSING_HELP[t.pressing]}>
              <Segmented value={t.pressing} onChange={(v) => store.setTactics({ pressing: v })} options={[{ value: 'low', label: 'Low block' }, { value: 'mid', label: 'Mid' }, { value: 'high', label: 'High press' }]} />
            </Instruction>
            <Instruction label="Tempo" help={TEMPO_HELP[t.tempo]}>
              <Segmented value={t.tempo} onChange={(v) => store.setTactics({ tempo: v })} options={[{ value: 'slow', label: 'Slow' }, { value: 'standard', label: 'Standard' }, { value: 'fast', label: 'Fast' }]} />
            </Instruction>
            <Instruction label="Width" help={WIDTH_HELP[t.width]}>
              <Segmented value={t.width} onChange={(v) => store.setTactics({ width: v })} options={[{ value: 'narrow', label: 'Narrow' }, { value: 'standard', label: 'Standard' }, { value: 'wide', label: 'Wide' }]} />
            </Instruction>
            <Instruction label="Defensive line" help={LINE_HELP[t.defensiveLine]}>
              <Segmented value={t.defensiveLine} onChange={(v) => store.setTactics({ defensiveLine: v })} options={[{ value: 'deep', label: 'Deep' }, { value: 'standard', label: 'Standard' }, { value: 'high', label: 'High' }]} />
            </Instruction>
            <Instruction label="Passing" help={PASSING_HELP[t.passing]}>
              <Segmented value={t.passing} onChange={(v) => store.setTactics({ passing: v })} options={[{ value: 'short', label: 'Short' }, { value: 'mixed', label: 'Mixed' }, { value: 'direct', label: 'Direct' }]} />
            </Instruction>
            </div>
          </div>
          )}
          {on('training') && (
          <div className="panel">
            <h3>Training this week</h3>
            <Segmented<TrainingFocus> value={game.training} onChange={store.setTraining} options={(Object.keys(TRAINING) as TrainingFocus[]).map((k) => ({ value: k, label: TRAINING_LABEL[k] }))} />
            <p className="help">{TRAINING[game.training].blurb}</p>
          </div>
          )}
          {on('set-pieces') && (
          <div className="panel">
            <h3>Set pieces</h3>
            <div className="instructions">
            {(
              [
                { key: 'penalties', label: 'Penalties', attr: (p: { attributes: { shooting: number; mentality: number } }) => Math.round((p.attributes.shooting + p.attributes.mentality) / 2), hint: 'Takes every penalty while he is on the pitch.' },
                { key: 'freeKicks', label: 'Free kicks', attr: (p: { attributes: { shooting: number } }) => p.attributes.shooting, hint: 'A specialist adds chances from dead balls.' },
                { key: 'corners', label: 'Corners', attr: (p: { attributes: { passing: number } }) => p.attributes.passing, hint: 'A good delivery adds chances; a poor one costs them.' },
              ] as const
            ).map((sp) => {
              const xi = Object.values(game.lineup)
                .map((id) => get(id))
                .filter((p): p is NonNullable<typeof p> => !!p && p.positions[0] !== 'GK')
                .sort((a, b) => sp.attr(b) - sp.attr(a))
              const current = t.setPieces?.[sp.key] ?? ''
              return (
                <Instruction key={sp.key} label={sp.label} help={sp.hint}>
                  <select className="input" aria-label={`${sp.label} taker`} value={current} onChange={(e) => store.setTactics({ setPieces: { ...t.setPieces, [sp.key]: e.target.value || undefined } })}>
                    <option value="">Auto: best on the pitch</option>
                    {xi.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({sp.attr(p)})
                      </option>
                    ))}
                  </select>
                </Instruction>
              )
            })}
            </div>
          </div>
          )}
        </div>
        )}
        {on('roles') && (
        <div className="col">
          <div className="panel">
            <div className="panel-head">
              <span className="head-title">
                <h3>Roles</h3>
                <Info label="About role fit">Each option shows his rating in that role. The chip compares his rating in the role now (condition and form included) with his overall: Suits within 1, Fair up to 4 below, Poor further. The bar under his name is his familiarity with the system.</Info>
              </span>
              <span className="role-head-meta">
                {familiarity !== null && (
                  <span className="role-fam" data-testid="team-familiarity" title="The XI's average familiarity with the system: it rises with starts and drops when the shape changes">
                    <span className="small muted">Familiarity {Math.round(familiarity)}</span>
                    <Bar value={familiarity} colour="var(--meter-mid)" />
                  </span>
                )}
                <span className="small muted">Team {strength.overall.toFixed(1)}</span>
              </span>
            </div>
            <div className="role-list">
              {formation.slots.map((slot) => {
                const id = game.lineup[slot.id]
                const p = id ? get(id) : undefined
                const roleId = t.roles[slot.id] ?? DEFAULT_ROLE[slot.position]
                const role = getRole(roleId)
                const ev = strength.slots.find((s) => s.slotId === slot.id)
                const st = id ? game.squad[id] : undefined
                const fit = ev && p ? roleFit(ev.effective, p.overall) : null
                return (
                  <div key={slot.id} className="role-row">
                    <Pos p={slot.position} />
                    <span className="role-who">
                      <span className="role-name">
                        {p ? p.name : <span className="muted">Empty</span>}
                        {fit && (
                          <span className={`chip ${fit === 'suits' ? 'good' : fit === 'fair' ? 'warn' : 'bad'}`} data-testid="role-fit" title={`${Math.round(ev!.effective)} in this role now against ${p!.overall} overall`}>
                            {ROLE_FIT_LABEL[fit]}
                          </span>
                        )}
                      </span>
                      {st && (
                        <span className="role-fam-bar" title={`Familiarity with the system ${meterValue(st.familiarity)}`}>
                          <Bar value={st.familiarity} colour="var(--meter-mid)" />
                        </span>
                      )}
                      <span className="role-pick">
                        <select className="input" aria-label={`Role for ${slot.position}`} title={role.blurb} value={roleId} onChange={(e) => store.setRole(slot.id, e.target.value)}>
                          {roleOptions(p, slot.position).map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.rating === null ? r.name : `${r.name} · ${r.rating}`}
                            </option>
                          ))}
                        </select>
                        <Info label={`About ${role.name}`}>{role.blurb}</Info>
                      </span>
                    </span>
                    {ev ? (
                      <span className="role-rating" title="Rating in role">
                        <Rating value={ev.effective} />
                      </span>
                    ) : (
                      <span />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
        )}
      </div>
    </>
  )
}

/** One instruction: its label and an Info holding what the current choice does, then the control. */
function Instruction({ label, help, children }: { label: string; help: string; children: React.ReactNode }) {
  // A named group, so a screen reader hears "Mentality" before the radio buttons or the select inside it
  const id = useId()
  return (
    <div className="instruction" role="group" aria-labelledby={id}>
      <span className="instruction-label">
        <span id={id}>{label}</span> <Info label={`About ${label.toLowerCase()}`}>{help}</Info>
      </span>
      {children}
    </div>
  )
}

function CupTab({ comp }: { comp: Competition }) {
  const { universe: u, game } = useStore()
  if (!u || !game?.season) return null
  const season = game.season
  const rounds = roundsFor(comp, season.matchweeks)
  const allTies = comp === 'cup' ? season.cup : season.continental?.ties ?? []
  const eliminated = comp === 'cup' ? season.cupEliminated : !!season.continental?.eliminated
  const won = comp === 'cup' ? season.cupWon : !!season.continental?.won
  const field = comp === 'continental' ? Object.values(season.continental?.clubs ?? {}) : []
  return (
    <div className="panel">
      <div className="panel-head">
        <span className="head-title">
          <h3>{comp === 'cup' ? 'The Cup' : 'Continental Cup'}</h3>
          <Info label="About the competition">
            {comp === 'cup' ? 'Sixteen clubs, four rounds' : 'You and the fifteen strongest clubs from the other leagues that season, four rounds'} played midweek after matchweeks {rounds.map((r) => r.afterMatchweek).join(', ')}. Drawn ties go to penalties; the final is at a neutral venue.
            {comp === 'continental' ? ' Finish in the top four to qualify again next season.' : ''}
          </Info>
        </span>
        <span className="small muted">16 clubs · 4 rounds</span>
      </div>
      {field.length > 0 && (
        <div className="row wrap" style={{ gap: 6, marginBottom: 12 }}>
          {field.map((c) => (
            <span key={c.id} className="chip row" style={{ gap: 4 }} title={u.leagues.find((l) => l.id === u.clubById[c.id]?.leagueId)?.name}>
              <LeagueFlag leagueId={u.clubById[c.id]?.leagueId ?? ''} size={16} /> <ClubBadge clubId={c.id} size={16} /> {c.shortName}
            </span>
          ))}
        </div>
      )}
      <Bracket
        view={seasonCupBracket(allTies, rounds)}
        nameOf={(id) => (id === USER_TEAM ? game.settings.teamName : clubName(u, id))}
        badge={(id) => (id === USER_TEAM ? <TeamBadge code={game.settings.shortName} size={18} /> : <ClubBadge clubId={id} size={18} />)}
        userId={USER_TEAM}
        trophy={comp}
        testId={`season-bracket-${comp}`}
        tieTestId="cup-tie"
        meTestId="cup-tie"
      />
      {eliminated && <div className="notice warn">Knocked out. The remaining rounds are free midweeks for recovery.</div>}
      {won && (
        <div className="notice icon-notice gold">
          {comp === 'cup' ? <Medal size={18} aria-hidden="true" /> : <Globe size={18} aria-hidden="true" />} {comp === 'cup' ? 'Cup winners!' : 'Champions of the continent!'}
        </div>
      )}
    </div>
  )
}

/** Listings a phone shows before "Show all" (styles.css hides the rest under 720 px; a desktop's box scrolls them all). */
export const PHONE_LISTINGS = 8

function MarketTab({ boxes }: { boxes: Boxes }) {
  const store = useStore()
  const { universe: u, game } = store
  const [bids, setBids] = useState<Record<string, number>>({})
  const [years, setYears] = useState<Record<string, number>>({})
  const [statuses, setStatuses] = useState<Record<string, SquadStatus>>({})
  const [exchange, setExchange] = useState<Record<string, string>>({})
  const [sellOn, setSellOn] = useState<Record<string, number>>({})
  const [filter, setFilterState] = useState<'all' | Position>('all')
  // On a phone the window lists its first few men until "Show all" (40 stacked listings ran to 18,000 px in January)
  const [allListed, setAllListed] = useState(false)
  const setFilter = (f: 'all' | Position) => {
    setFilterState(f)
    setAllListed(false)
  }
  const [msg, setMsg] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [scoutId, setScoutId] = useState<string | null>(null)
  const [approach, setApproach] = useState(false)
  const results = useMemo(() => {
    if (!u || !game) return []
    const q = query.trim().toLowerCase()
    if (q.length < 2) return []
    const owned = new Set(Object.keys(game.squad).map((id) => (game.customPlayers[id] ?? u.index[id])?.playerId))
    const { fromSeason, toSeason } = game.settings.rules
    return Object.values(u.index)
      .filter((p) => p.name.toLowerCase().includes(q) && !owned.has(p.playerId) && game.settings.wheelLeagues.includes(u.clubById[p.clubId]?.leagueId ?? '') && (fromSeason === undefined || p.season >= fromSeason) && (toSeason === undefined || p.season <= toSeason) && (!!game.settings.rules.classic || !isClassic(u, p)))
      .sort((a, b) => b.overall - a.overall)
      .slice(0, 14)
  }, [u, game, query])
  if (!u || !game) return null
  const get = playerLookup(game, u)
  const w = game.window
  const squad = squadPlayers(game, u)
  const scout = staffTier(game.staff, 'scout')
  // What the club can see of a player outside the squad: a range until he is scouted (none for anyone known exactly)
  const rangeOf = (p: PlayerSeason) => {
    const v = maskedView(game, u, p)
    return v.exact ? undefined : v.overall
  }
  const shortlisted = store.shortlist.map((id) => u.index[id]).filter((p): p is NonNullable<typeof p> => !!p)
  const shortlistPanel = shortlisted.length > 0 && boxes.on('shortlist') && (
    <div className="panel">
      <div className="panel-head">
        <span className="head-title">
          <h3>Shortlist</h3>
          <Info label="About the shortlist">Players you starred in Explore or from a scout report. Tap one for his report: scout him, enquire when a window is open, or take him off the list.</Info>
        </span>
        <span className="chip">{shortlisted.length}</span>
      </div>
      <div className="plist lined scroll-list">
        {shortlisted.map((p) => {
          const listed = w?.listings.find((l) => l.playerSeasonId === p.id)
          return (
            <PlayerRow
              key={p.id}
              p={p}
              showClub
              range={rangeOf(p)}
              onClick={() => setScoutId(p.id)}
              right={
                <span className="btn sm">
                  {w && listed ? (listed.status === 'signed' ? 'Signed' : listed.status === 'gone' ? 'Gone' : money(listed.asking)) : (
                    <>
                      <Star size={14} aria-hidden="true" /> Report
                    </>
                  )}
                </span>
              }
            />
          )
        })}
      </div>
    </div>
  )
  const scoutModal = <ScoutModal id={scoutId} onClose={() => setScoutId(null)} />
  if (!w) {
    const closed = boxes.grid([
      { track: 'minmax(0, 1fr)', ids: ['recruitment'] },
      { track: 'minmax(0, 1.1fr)', ids: ['scout-reports'] },
      { track: 'minmax(0, 1fr)', ids: [] },
    ])
    return (
      <div className={`grid three fill squad-views market-closed ${closed.className}`} style={closed.style} data-testid="market-closed">
        {boxes.on('recruitment') && (
        <div className="col">
          <RecruitmentPanel onMessage={setMsg} />
          {msg && <div className="notice">{msg}</div>}
        </div>
        )}
        {boxes.on('scout-reports') && <ScoutReportsPanel onOpen={setScoutId} />}
        <div className="col">
          <div className="notice">
            {closedWindowLine(game)}{' '}
            <Info label="About transfer windows">The January window runs for seven market days, three per matchweek. In Dynasty mode a longer summer window opens between seasons.</Info>
          </div>
          {shortlistPanel}
          {boxes.on('values') && (
          <div className="panel">
            <h3>Squad values</h3>
            <div className="tbl-wrap"><table className="tbl contracts">
              <thead>
                <tr>
                  <th>Player</th>
                  <th className="num">Value</th>
                  <th className="num">Wage</th>
                  <th className="num" title="Contract years left">Yrs</th>
                </tr>
              </thead>
              <tbody>
                {squad
                  .sort((a, b) => b.p.value - a.p.value)
                  .map((x) => (
                    <tr key={x.p.id}>
                      <td>
                        <span className="row" style={{ gap: 6 }}>
                          <Rating value={x.p.overall} /> <span className="name one-line" title={x.p.name}>{x.p.name}</span>
                        </span>
                      </td>
                      <td className="num">{money(x.p.value)}</td>
                      <td className="num">{wage(x.p.wage)}</td>
                      <td className="num">{game.contracts[x.p.id]?.loan ? 'Loan' : `${game.contracts[x.p.id]?.years ?? 1}y`}</td>
                    </tr>
                  ))}
              </tbody>
            </table></div>
          </div>
          )}
        </div>
        {scoutModal}
      </div>
    )
  }
  const listings = w.listings.filter((l) => l.status === 'available' || l.status === 'bidding').filter((l) => filter === 'all' || get(l.playerSeasonId)?.positions.includes(filter)).sort((a, b) => (get(b.playerSeasonId)?.overall ?? 0) - (get(a.playerSeasonId)?.overall ?? 0))
  const offers = w.offers.map((o, i) => ({ o, i })).filter(({ o }) => o.status === 'open')
  return (
    <div className="grid dugout">
      <div className="panel">
        <div className="panel-head">
          <h3>
            {w.kind === 'summer' ? 'Summer' : 'January'} window · day {w.day + 1}/{w.days}
            {w.day >= w.days - 1 ? ' · deadline day' : ''}
          </h3>
          <div className="toolbar">
            <WindowChip w={w} />
            <span className="chip info">Budget {money(game.finances.budget)}</span>
            <span className="chip">Wage room {wage(Math.max(0, game.finances.wageCap - squad.reduce((s, x) => s + x.p.wage, 0) - staffWages(game.staff)))}</span>
            <button className="btn sm" onClick={() => store.advanceDay()}>
              Next market day →
            </button>
          </div>
        </div>
        {windowCountdown(w).last && tickerLines(w).length > 0 && (
          <div className="deadline-ticker" data-testid="deadline-ticker" role="group" aria-label="Deadline day: the latest market news">
            <span className="deadline-tag">Deadline day</span>
            <span className="deadline-track">
              <span className="deadline-run">{tickerLines(w).join('  ·  ')}</span>
            </span>
          </div>
        )}
        {msg && <div className="notice" style={{ marginBottom: 'var(--space-2)' }}>{msg}</div>}
        <Tip id="market-first">A bid at the asking price is accepted, one a little under may be accepted after talks, and one well under annoys the club and raises the price; “was” shows where the price opened.</Tip>
        <div className="segmented scroll" style={{ marginBottom: 'var(--space-3)' }}>
          {(['all', 'GK', 'CB', 'LB', 'RB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST'] as const).map((p) => (
            <button key={p} className={filter === p ? 'active' : ''} onClick={() => setFilter(p)}>
              {p === 'all' ? 'All' : p}
            </button>
          ))}
        </div>
        <div className={`col listings ${!allListed && listings.length > PHONE_LISTINGS ? 'capped' : ''}`} style={{ gap: 'var(--space-2)' }} data-testid="listings">
          {listings.map((l) => {
            const p = get(l.playerSeasonId)
            if (!p) return null
            const bid = bids[l.playerSeasonId] ?? l.asking
            // The status shown is the one the bid carries, measured against the squad without the part-exchange player
            const offered = statuses[l.playerSeasonId] ?? suggestedStatus(game, u, p, exchange[l.playerSeasonId] || undefined)
            return (
              <div key={l.playerSeasonId} className="listing">
                <div>
                  <PlayerRow p={p} showClub range={rangeOf(p)} onClick={() => setScoutId(p.id)} right={<span className="small muted">{wage(p.wage)}</span>} />
                  <div className="tags">
                    {l.tags.map((t) => (
                      <span key={t} className={`chip ${t === 'Bidding war' || t === 'Annoyed' || t === 'Unsolicited approach' ? 'warn' : t === 'Deadline discount' || t === 'Loan available' || t === 'Scouted' ? 'good' : ''}`}>
                        {t}
                      </span>
                    ))}
                    {rangeOf(p) && (
                      <button type="button" className="chip-btn" data-testid="listing-scout" disabled={!canFullScout(game)} title={canFullScout(game) ? 'Full scout: reveal him exactly (one a market day)' : 'Your scout has watched someone today'} onClick={() => setMsg(store.scoutPlayer(p.id).message)}>
                        Scout
                      </button>
                    )}
                    {scout > 0 &&
                      traitTags(p.traits).map((t) => (
                        <span key={t} className="chip" style={{ borderStyle: 'dashed' }} title="Scouting report">
                          {t}
                        </span>
                      ))}
                    {l.suitors > 0 && <span className="chip">{l.suitors} rival{l.suitors > 1 ? 's' : ''} interested</span>}
                    {l.response && <span className="chip">{l.response}</span>}
                  </div>
                  <div className="bidrow">
                    <input className="input" type="number" min={0.1} step={0.5} value={bid} onChange={(e) => setBids({ ...bids, [l.playerSeasonId]: Number(e.target.value) })} aria-label={`Your bid for ${p.name}, in £ millions`} />
                    <span className="small muted">£M</span>
                    <button
                      className="btn sm primary"
                      onClick={() => {
                        const out = store.bid(l.playerSeasonId, bid, { years: years[l.playerSeasonId], status: offered, exchangeId: exchange[l.playerSeasonId] || undefined, sellOn: sellOn[l.playerSeasonId] || undefined })
                        setMsg(out.message)
                      }}
                    >
                      Bid
                    </button>
                    <button className="btn sm" onClick={() => setBids({ ...bids, [l.playerSeasonId]: Math.round(l.asking * 0.9 * 10) / 10 })}>
                      −10%
                    </button>
                    <select className="input" value={years[l.playerSeasonId] ?? (p.age >= 32 ? 1 : 3)} onChange={(e) => setYears({ ...years, [l.playerSeasonId]: Number(e.target.value) })} title="Contract length">
                      {[1, 2, 3, 4].filter((y) => y <= (p.age >= 33 ? 2 : 4)).map((y) => (
                        <option key={y} value={y}>
                          {y}-year deal
                        </option>
                      ))}
                    </select>
                    <select className="input" data-testid="bid-status" value={offered} onChange={(e) => setStatuses({ ...statuses, [l.playerSeasonId]: e.target.value as SquadStatus })} title="Squad status offered: his wage demand follows it, and he refuses a role beneath his standing in your squad">
                      {STATUSES.map((st) => (
                        <option key={st} value={st}>
                          {STATUS_LABEL[st]} · {wage(Math.round(p.wage * WAGE_MULT[st]))}
                        </option>
                      ))}
                    </select>
                    <select className="input" value={exchange[l.playerSeasonId] ?? ''} onChange={(e) => setExchange({ ...exchange, [l.playerSeasonId]: e.target.value })} title="Offer a player in part-exchange">
                      <option value="">Cash only</option>
                      {squad
                        .filter((x) => !game.contracts[x.p.id]?.loan)
                        .sort((a, b) => b.p.overall - a.p.overall)
                        .map((x) => (
                          <option key={x.p.id} value={x.p.id}>
                            + {x.p.name} ({x.p.overall})
                          </option>
                        ))}
                    </select>
                    <select className="input" value={sellOn[l.playerSeasonId] ?? 0} onChange={(e) => setSellOn({ ...sellOn, [l.playerSeasonId]: Number(e.target.value) })} title="Offer the selling club a share of his next sale: worth something to them now, paid when you sell him on" data-testid="bid-sell-on">
                      {SELL_ON_OPTIONS.map((pct) => (
                        <option key={pct} value={pct}>
                          {pct ? `${Math.round(pct * 100)}% sell-on (+${money(sellOnValue(p, pct))})` : 'No sell-on'}
                        </option>
                      ))}
                    </select>
                    {l.loanFee !== undefined && (
                      <button className="btn sm" onClick={() => setMsg(store.loan(l.playerSeasonId).message)} title="Season-long loan: small fee, full wages, back to his club in the summer">
                        Loan for {money(l.loanFee)}
                      </button>
                    )}
                  </div>
                </div>
                <div>
                  <div className="price">{money(l.asking)}</div>
                  <div className="small muted" style={{ textAlign: 'right' }}>
                    asking{l.asking !== l.opening ? ` (was ${money(l.opening)})` : ''}
                  </div>
                </div>
              </div>
            )
          })}
          {listings.length === 0 && <div className="muted">Nothing listed for that position right now. Advance a day for new listings.</div>}
        </div>
        {!allListed && listings.length > PHONE_LISTINGS && (
          <button type="button" className="btn block listings-more" onClick={() => setAllListed(true)} data-testid="listings-more">
            Show all {listings.length} listed{filter === 'all' ? '' : ` at ${filter}`}
          </button>
        )}
      </div>
      <div className="col">
        {boxes.on('recruitment') && <RecruitmentPanel onMessage={setMsg} />}
        {(game.scoutReports ?? []).length > 0 && boxes.on('scout-reports') && <ScoutReportsPanel onOpen={setScoutId} />}
        {boxes.on('approach') && (
        <div className="panel">
          <div className="panel-head">
            <span className="head-title">
              <h3>Approach any player</h3>
              <Info label="About approaches">Not on the market? Ask anyway. Clubs quote a premium for players they wanted to keep and refuse outright for their stars.</Info>
            </span>
            {focusActive(game.recruitFocus) && (
              <button type="button" className="btn sm" aria-expanded={approach} onClick={() => setApproach((v) => !v)} data-testid="approach-toggle">
                {approach ? 'Hide' : 'Search'}
              </button>
            )}
          </div>
          {(approach || !focusActive(game.recruitFocus)) && (
            <>
              <input className="input" aria-label="Search players" placeholder="Search every player…" value={query} onChange={(e) => setQuery(e.target.value)} />
              {results.length > 0 && (
                <div className="plist lined scroll-list" style={{ marginTop: 'var(--space-2)' }}>
                  {results.map((p) => (
                    <PlayerRow
                      key={p.id}
                      p={p}
                      showClub
                      range={rangeOf(p)}
                      onClick={() => {
                        const out = store.enquire(p.id)
                        setMsg(out.message)
                        if (out.ok) setQuery('')
                      }}
                      right={<span className="btn sm">Enquire</span>}
                    />
                  ))}
                </div>
              )}
              {query.trim().length >= 2 && results.length === 0 && <div className="small muted" style={{ marginTop: 'var(--space-2)' }}>No one by that name in this game's leagues and eras.</div>}
            </>
          )}
        </div>
        )}
        {shortlistPanel}
        <div className="panel">
          <h3>Offers for your players</h3>
          {offers.length === 0 && <div className="muted small">No offers on the table.</div>}
          <div className="col" style={{ gap: 'var(--space-2)' }}>
            {offers.map(({ o, i }) => {
              const p = get(o.playerSeasonId)
              if (!p) return null
              return (
                <div key={i} className="card">
                  <div className="row between wrap">
                    <span>
                      <b>{clubName(u, o.fromClubId)}</b> offer <b>{money(o.amount)}</b> for {p.name} <Rating value={p.overall} />
                    </span>
                    <span className="row">
                      <button className="btn sm primary" onClick={() => store.acceptOffer(i)}>
                        Accept
                      </button>
                      <button className="btn sm" onClick={() => store.rejectOffer(i)}>
                        Reject
                      </button>
                    </span>
                  </div>
                  <div className="small muted">Value {money(p.value)} · day {o.day}</div>
                </div>
              )
            })}
          </div>
        </div>
        {doneDeals(w).length > 0 && boxes.on('done-deals') && (
          <div className="panel" data-testid="done-deals">
            <div className="panel-head">
              <h3>Done deals</h3>
              <span className="small muted">{w.kind === 'summer' ? 'Summer' : 'January'} window</span>
            </div>
            <div className="col small" style={{ gap: 4 }}>
              {doneDeals(w).map((d) => {
                const p = get(d.playerSeasonId)
                return (
                  <div key={d.dir + d.playerSeasonId} className="row between" style={{ gap: 'var(--space-2)' }}>
                    <span className="row" style={{ gap: 6, minWidth: 0 }}>
                      <span className={`chip ${d.dir === 'in' ? 'good' : 'info'}`}>{d.dir === 'in' ? 'In' : 'Out'}</span>
                      <span className="one-line">{p?.name ?? 'A player'}{d.clubId ? ` to ${clubShort(u, d.clubId)}` : ''}</span>
                    </span>
                    <span className="mono">{d.loan ? `Loan ${money(d.fee)}` : money(d.fee)}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
        {boxes.on('log') && (
        <div className="panel">
          <h3>Market log</h3>
          <div className="col small market-log">
            {w.log.map((l, i) => (
              <div key={i} className="muted">
                {l}
              </div>
            ))}
          </div>
        </div>
        )}
      </div>
      {scoutModal}
    </div>
  )
}

function ClubTab({ table, onPlayer, boxes }: { table: TableRow[]; onPlayer: (id: string) => void; boxes: Boxes }) {
  const store = useStore()
  const { universe: u, game } = store
  const [clubMsg, setClubMsg] = useState<string | null>(null)
  if (!u || !game?.season) return null
  const season = game.season
  const squad = squadPlayers(game, u)
  const playerWages = squad.reduce((s, x) => s + x.p.wage, 0)
  const wages = playerWages + staffWages(game.staff)
  const host = u.clubById[season.hostClubId]
  const on = boxes.on
  const grid = boxes.grid([
    { track: 'minmax(0, 0.85fr)', ids: ['board', 'requests'] },
    { track: 'minmax(0, 0.85fr)', ids: ['finances', 'staff'] },
    { track: 'minmax(0, 1.5fr)', ids: ['contracts', 'legends', 'achievements'] },
  ])
  const col1 = on('board') || on('requests')
  const col2 = on('finances') || on('staff')
  const col3 = on('contracts') || (on('legends') && !!game.careerStats && Object.keys(game.careerStats).length > 0) || on('achievements')
  return (
    <div className={`grid three fill squad-views club-grid3 ${grid.className}`} style={grid.style} data-testid="club-tab">
      {col1 && (
      <div className="col">
      {on('board') && (
      <div className="panel">
        <h3>Board</h3>
        <dl className="kv tight">
          <dt>You replace</dt>
          <dd data-testid="you-replace">
            <span className="row" style={{ gap: 6 }}>
              <ClubBadge clubId={season.hostClubId} size={20} /> {clubName(u, season.hostClubId)}
            </span>
          </dd>
          <dt>Expectation</dt>
          <dd>Finish {ordinal(season.boardTarget)} or better</dd>
          <dt>Current</dt>
          <dd>{season.matchweek ? ordinal(positionOf(table, USER_TEAM)) : 'Pre-season'}</dd>
          <dt>Confidence</dt>
          <dd>{Math.round(season.confidence)} / 100</dd>
          <dt>Job security</dt>
          <dd>{game.settings.jobSecurity ? 'On: below 12 after matchweek 10 and you are gone' : 'Off'}</dd>
          <dt>League</dt>
          <dd><LeagueFlag leagueId={season.leagueId} /> {u.leagues.find((l) => l.id === season.leagueId)?.name ?? season.leagueId} · {season.matchweeks} matchweeks</dd>
          <dt>Rivals</dt>
          <dd>{host?.rivals.map((r) => clubName(u, r)).join(', ') || 'None'}</dd>
          <dt>Difficulty</dt>
          <dd title={season.aiOffset > 0 ? `Rivals play ${season.aiOffset} rating points below their real strength` : 'Real squads at full strength'}>{season.aiOffset > 0 ? `Calibrated (−${season.aiOffset})` : 'Realistic'}</dd>
        </dl>
        {season.objectives && season.objectives.length > 0 && (
          <>
            <h4 className="head-title" style={{ marginTop: 'var(--space-4)' }}>
              Board objectives <Info label="About objectives">Each objective met adds £{OBJECTIVE_REWARD.budget}M to the budget and lifts board confidence; each one missed costs confidence.</Info>
            </h4>
            <div className="col" style={{ gap: 'var(--space-2)' }}>
              {season.objectives.map((o) => {
                const ev = evaluateObjective(o, { season, squad, rivals: host?.rivals ?? [] })
                const decided = o.met !== undefined
                const ok = decided ? o.met : ev.met
                return (
                  <div key={o.id} className="row between wrap">
                    <span>
                      <span className={`chip icon-chip ${ok ? 'good' : decided ? 'bad' : ''}`}>
                        {decided && (ok ? <Check size={12} aria-hidden="true" /> : <X size={12} aria-hidden="true" />)}
                        {decided ? (ok ? 'Met' : 'Missed') : ok ? 'On track' : 'Not yet'}
                      </span>{' '}
                      {o.label}
                    </span>
                    <span className="small muted">{ev.progress}</span>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
      )}
      {on('requests') && <BoardRequests onMessage={setClubMsg} />}
      {clubMsg && <div className="notice">{clubMsg}</div>}
      </div>
      )}
      {col2 && (
      <div className="col">
      {on('finances') && (
      <div className="panel">
        <div className="panel-head">
          <span className="head-title">
            <h3>Finances</h3>
            <Info label="About finances">Match-day and broadcast income covers the wage cap: spend under it and a tenth of the surplus drips into the budget each week, go over and the whole overspend drains it. The league money lands at the end of the season, after running costs: +£20M for the title down to −£20M for last place, plus £10M for the cup.</Info>
          </span>
        </div>
        <dl className="kv tight">
          <dt>Transfer budget</dt>
          <dd>{money(game.finances.budget)}</dd>
          <dt>Wage bill</dt>
          <dd>
            {wage(wages)} of {wage(game.finances.wageCap)} cap{staffWages(game.staff) ? ` (staff ${wage(staffWages(game.staff))})` : ''}
          </dd>
          <dt>Income this season</dt>
          <dd>{money(game.finances.income)}</dd>
          <dt>Spent on fees</dt>
          <dd>{money(game.finances.spent)}</dd>
          <dt>Wages paid</dt>
          <dd>{money(game.finances.wagesPaid)}{game.finances.bonusesPaid ? ` (bonuses ${money(game.finances.bonusesPaid)})` : ''}</dd>
        </dl>
        <WageSlider onMessage={setClubMsg} />
      </div>
      )}
      {on('staff') && (
      <div className="panel">
        <div className="panel-head">
          <span className="head-title">
            <h3>Backroom staff</h3>
            <Info label="About staff">Staff wages count against the wage cap. Hire and release at any time; hover a level for what it does.</Info>
          </span>
          <span className="small muted">{wage(staffWages(game.staff))}</span>
        </div>
        <div className="staff-list">
          {STAFF_ROLES.map((role) => {
            const info = STAFF[role]
            const tier = staffTier(game.staff, role)
            return (
              <div key={role} className="staff-row">
                <div className="row between wrap" style={{ gap: 'var(--space-2)' }}>
                  <b>{info.label}</b>
                  <span className="small muted">{info.tiers[tier].title}</span>
                </div>
                <div className="segmented" style={{ marginTop: 'var(--space-2)' }}>
                  {info.tiers.map((t) => (
                    <button key={t.tier} className={t.tier === tier ? 'active' : ''} onClick={() => store.hireStaff(role, t.tier)} title={t.blurb}>
                      {t.tier === 0 ? 'None' : t.tier === 1 ? `Good · ${wage(t.wage)}` : `Elite · ${wage(t.wage)}`}
                    </button>
                  ))}
                </div>
                <div className="small muted one-line" style={{ marginTop: 'var(--space-1)' }} title={info.tiers[tier].blurb}>{info.tiers[tier].blurb}</div>
              </div>
            )
          })}
        </div>
      </div>
      )}
      </div>
      )}
      {col3 && (
      <div className="col">
      {on('contracts') && (
      <div className="panel">
        <div className="panel-head">
          <span className="head-title">
            <h3>Contracts</h3>
            <Info label="About playing time">Key players expect 85% of the minutes, first team 65%, rotation 35%, backup 15%, prospects 10%. Fall more than 15 points short over the last six matchweeks and morale drifts down each week, up to 5; play someone more than he expects and it drifts up a little.</Info>
          </span>
        </div>
        <div className="tbl-wrap"><table className="tbl contracts">
          <thead>
            <tr>
              <th>Player</th>
              <th className="num">Age</th>
              <th className="num">Years</th>
              <th>Status</th>
              <th className="num" title="Share of the minutes over the last six matchweeks">Mins</th>
              <th>Morale</th>
              <th className="end" aria-label="Release" title="Release" />
            </tr>
          </thead>
          <tbody>
            {squad.map((x) => {
              const share = recentShare(x.s)
              const status = statusOf(game, x.p.id)
              return (
              <tr key={x.p.id}>
                <td>
                  <span className="row" style={{ gap: 6 }}>
                    <Rating value={x.p.overall} />{' '}
                    <PlayerPeek p={x.p} s={x.s}>
                      <button type="button" className="link-btn name" title={`${x.p.name}: details and contract talks`} onClick={() => onPlayer(x.p.id)} data-testid="contract-name">
                        {x.p.name}
                      </button>
                    </PlayerPeek>
                    {game.contracts[x.p.id]?.shopped && <span className="chip warn" title="His agent is finding a buyer">Shopped</span>}
                  </span>
                </td>
                <td className="num">{x.p.age}</td>
                <td className="num" title={game.contracts[x.p.id]?.clauses?.release ? `Release clause £${game.contracts[x.p.id]!.clauses!.release}M` : undefined}>{game.contracts[x.p.id]?.years ?? 1}{game.contracts[x.p.id]?.clauses?.release ? '*' : ''}</td>
                <td>
                  <select className="input sm" data-testid="status-select" value={status} onChange={(e) => store.setStatus(x.p.id, e.target.value as SquadStatus)} title="Squad status: a promotion lifts morale 6 and his wage with it; a demotion costs 6 morale">
                    {STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {STATUS_LABEL[st]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="num" title={`Share of the available minutes over the last six matchweeks; ${STATUS_LABEL[status].toLowerCase()} expects ${Math.round(EXPECTED_SHARE[status] * 100)}%`}>
                  {share === null ? '–' : <span style={share < EXPECTED_SHARE[status] - 0.15 ? { color: 'var(--danger)' } : undefined}>{Math.round(share * 100)}%</span>}
                </td>
                <td>{moraleWord(x.s.morale)}</td>
                <td className="end">
                  <button className="btn sm ghost danger icon-only" aria-label={`Release ${x.p.name}`} title="Release: no fee is received" onClick={() => confirm(`Release ${x.p.name}? No fee is received.`) && store.release(x.p.id)}>
                    <UserMinus size={14} aria-hidden="true" />
                  </button>
                </td>
              </tr>
              )
            })}
          </tbody>
        </table></div>
      </div>
      )}
      {on('legends') && game.careerStats && Object.keys(game.careerStats).length > 0 && (
        <div className="panel">
          <div className="panel-head">
            <h3>Club legends</h3>
            <span className="small muted">All seasons of this game</span>
          </div>
          <div className="tbl-wrap"><table className="tbl">
            <thead>
              <tr>
                <th>Player</th>
                <th className="num">Seasons</th>
                <th className="num">Apps</th>
                <th className="num">Goals</th>
                <th className="num">Assists</th>
                <th className="num">MOTM</th>
                <th className="num">Titles</th>
              </tr>
            </thead>
            <tbody>
              {Object.values(game.careerStats)
                .sort((a, b) => b.apps - a.apps || b.goals - a.goals)
                .slice(0, 12)
                .map((r) => (
                  <tr key={r.name + r.lastYear}>
                    <td>{r.name}</td>
                    <td className="num">{r.seasons}</td>
                    <td className="num">{r.apps}</td>
                    <td className="num">{r.goals}</td>
                    <td className="num">{r.assists}</td>
                    <td className="num">{r.motm}</td>
                    <td className="num">{r.titles}</td>
                  </tr>
                ))}
            </tbody>
          </table></div>
        </div>
      )}
      {on('achievements') && (
      <div className="panel">
        <h3>Achievements this game</h3>
        {game.unlocked.filter((x) => x !== 'survivor-pending').length === 0 && <div className="muted small">None yet this game: win the league or a cup to earn one.</div>}
        <div className="pill-list">
          {game.unlocked
            .filter((x) => x !== 'survivor-pending')
            .map((a) => (
              <span key={a} className="chip gold">
                {a}
              </span>
            ))}
        </div>
      </div>
      )}
      </div>
      )}
    </div>
  )
}

/** The board requests box: what can be asked, the condition the board checks, and when the next ask is possible. */
function BoardRequests({ onMessage }: { onMessage: (m: string) => void }) {
  const store = useStore()
  const { universe: u, game } = store
  if (!u || !game?.season) return null
  const season = game.season
  const wait = nextRequestAt(game)
  const confident = season.confidence >= REQUEST_CONFIDENCE
  return (
    <div className="panel" data-testid="board-requests">
      <div className="panel-head">
        <span className="head-title">
          <h3 className="icon-title">
            <Landmark size={18} aria-hidden="true" /> Requests
          </h3>
          <Info label="About board requests">The board grants a request when its confidence is {REQUEST_CONFIDENCE} or more and the condition holds; no dice. A refusal costs 2 confidence. One request every {REQUEST_GAP} matchweeks.</Info>
        </span>
        <span className={`chip ${confident ? 'good' : 'warn'}`}>Confidence {Math.round(season.confidence)}</span>
      </div>
      <div className="col" style={{ gap: 'var(--space-2)' }}>
        {requestOptions(game, u).map((o) => (
          <div key={o.kind} className="request-row" data-testid={`request-${o.kind}`}>
            <span className="col" style={{ gap: 0, minWidth: 0 }}>
              <b>{o.label}</b>
              <span className="small muted">{o.ask}</span>
              <span className={`small ${o.conditionMet ? 'good-text' : 'muted'}`}>
                {o.conditionMet ? '✓' : '✗'} {o.condition}
              </span>
            </span>
            <button className="btn sm" disabled={wait !== null} onClick={() => onMessage(store.boardRequest(o.kind).message)} title={wait !== null ? `Next request after matchweek ${wait - 1}` : confident && o.conditionMet ? 'The board will grant this' : 'The board will refuse this: −2 confidence'}>
              Ask
            </button>
          </div>
        ))}
      </div>
      {wait !== null && <div className="small muted" style={{ marginTop: 'var(--space-2)' }}>Next request after matchweek {wait - 1}.</div>}
      {(season.requests ?? []).length > 0 && (
        <div className="small muted" style={{ marginTop: 'var(--space-2)' }}>
          This season: {season.requests!.map((r) => `${r.kind} ${r.accepted ? 'granted' : 'refused'} (MW ${r.mw})`).join(', ')}
        </div>
      )}
    </div>
  )
}

/** The wage-to-transfer slider: each step moves £10k a week of wage cap against £2M of budget. */
function WageSlider({ onMessage }: { onMessage: (m: string) => void }) {
  const store = useStore()
  const { universe: u, game } = store
  if (!u || !game) return null
  const net = game.finances.wageShift ?? 0
  const move = (target: number) => {
    let cur = net
    while (cur !== target) {
      const dir = target > cur ? 1 : -1
      const out = store.shiftWages(dir)
      if (!out.ok) {
        onMessage(out.message)
        return
      }
      cur += dir
    }
  }
  return (
    <div className="wage-slider" data-testid="wage-slider">
      <div className="row between" style={{ gap: 'var(--space-2)' }}>
        <span className="head-title">
          <b className="small">Wages ⇄ transfers</b>
          <Info label="About the slider">Slide right to turn £{SHIFT_WAGE}k a week of wage room into £{SHIFT_BUDGET}M of transfer budget; slide left to turn budget back into wage room. Up to {SHIFT_LIMIT} steps either way a season, within the room under the cap.</Info>
        </span>
        <span className="small mono">{net === 0 ? 'Level' : net > 0 ? `+${money(net * SHIFT_BUDGET)} budget` : `+${wage(-net * SHIFT_WAGE)} wages`}</span>
      </div>
      <div className="row" style={{ gap: 'var(--space-2)' }}>
        <button type="button" className="btn sm ghost" aria-label="Budget into wages" onClick={() => move(net - 1)}>
          −
        </button>
        <input type="range" min={-SHIFT_LIMIT} max={SHIFT_LIMIT} step={1} value={net} aria-label="Wage to transfer balance" onChange={(e) => move(Number(e.target.value))} data-testid="wage-range" />
        <button type="button" className="btn sm ghost" aria-label="Wages into budget" onClick={() => move(net + 1)} data-testid="wage-to-budget">
          +
        </button>
      </div>
      <div className="small muted">Wage room {wage(Math.max(0, wageRoom(game, u)))}</div>
    </div>
  )
}

/**
 * A dressing-room decision waiting on the manager, inline above the tabs. On a desktop it is one compact strip (the
 * title, the story cut to fit, the choices with their hints as tooltips, on one line when they fit) so the squad list
 * keeps its rows; "More" opens the whole story and each choice's hint. A phone shows it whole, as the page scrolls.
 */
function EventCard() {
  const store = useStore()
  const { universe: u, game } = store
  const [open, setOpen] = useState(false)
  if (!u || !game?.pendingEvent) return null
  const ev = game.pendingEvent
  const get = playerLookup(game, u)
  const p = ev.playerSeasonId ? get(ev.playerSeasonId) : undefined
  const who = p ? `${p.name} · ${p.positions.join('/')} · morale ${moraleWord(game.squad[p.id]?.morale ?? 70).toLowerCase()}` : null
  return (
    <div className={`panel event-card${open ? ' open' : ''}`} data-testid="event-card" data-dialog-return="">
      <div className="event-row">
        <h3 className="icon-title event-title">
          <MessageSquare size={18} aria-hidden="true" /> {ev.title}
        </h3>
        <p className="event-body" title={open ? undefined : ev.body}>
          {ev.body}
          {who && <span className="small muted event-who">{who}</span>}
        </p>
        <div className="event-choices">
        {ev.choices.map((c) => (
          <button key={c.id} className="btn event-choice" title={c.hint} onClick={() => store.resolveEvent(c.id)}>
            <span className="col" style={{ gap: 0, alignItems: 'flex-start' }}>
              <span>{c.label}</span>
              <span className="small muted event-hint" style={{ fontWeight: 400 }}>
                {c.hint}
              </span>
            </span>
          </button>
        ))}
        </div>
        <button type="button" className="btn sm ghost event-more" onClick={() => setOpen(!open)} aria-expanded={open} data-testid="event-more">
          {open ? 'Less' : 'More'} <ChevronDown size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

function PlayerModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  const store = useStore()
  const { universe: u, game } = store
  const [talkMsg, setTalkMsg] = useState<string | null>(null)
  const [talks, setTalks] = useState(false)
  if (!u || !game || !id) return null
  const get = playerLookup(game, u)
  const p = get(id)
  const s = game.squad[id]
  if (!p) return null
  const formation = getFormation(game.tactics.formationId)
  const dev = game.development?.[p.id]
  const share = s ? recentShare(s) : null
  if (talks && s) {
    return (
      <Modal open onClose={onClose} title={`Contract talks: ${p.name}`} wide testId="talks-modal">
        <ContractTalks id={id} onBack={() => setTalks(false)} />
      </Modal>
    )
  }
  return (
    <PlayerCardModal
      title={p.name}
      onClose={onClose}
      p={p}
      seasons={careerSeasons(u, p.playerId)}
      state={s}
      headChips={
        <>
          <span className="chip">{money(p.value)}</span>
          <span className="chip">{wage(p.wage)}</span>
          {dev && dev.base !== p.overall && (
            <span className={`chip icon-chip ${p.overall > dev.base ? 'good' : 'warn'}`} title="Rating change since the start of the season">
              {p.overall > dev.base ? <TrendingUp size={12} aria-hidden="true" /> : <TrendingDown size={12} aria-hidden="true" />} {Math.abs(p.overall - dev.base)} this season
            </span>
          )}
          {s && (
            <span className="chip info" data-testid="player-status" title={share === null ? 'No minutes recorded yet' : `${Math.round(share * 100)}% of the minutes over the last ${RECENT_WEEKS} matchweeks; his status expects ${Math.round(EXPECTED_SHARE[statusOf(game, p.id)] * 100)}%`}>
              {STATUS_LABEL[statusOf(game, p.id)]}
              {share === null ? '' : ` · ${Math.round(share * 100)}% of minutes lately, expects ${Math.round(EXPECTED_SHARE[statusOf(game, p.id)] * 100)}%`}
            </span>
          )}
          {s?.injury && <span className="chip bad">{s.injury.description}, {s.injury.weeksOut} wk</span>}
          {s && (s.yellowCards > 0 || s.suspension > 0) && (
            <span className={`chip ${s.suspension ? 'bad' : 'warn'}`}>
              {s.yellowCards} yellow{s.yellowCards === 1 ? '' : 's'}
              {s.suspension ? ` · suspended ${s.suspension}` : ''}
            </span>
          )}
        </>
      }
      headExtra={<span className="chip" title={personalityOf(p).blurb} data-testid="personality">{personalityOf(p).label}</span>}
      actions={
        s && (
          <>
            <span className="pc-actions-group">
              {formation.slots
                .filter((sl) => p.positions.some((pp) => pp === sl.position))
                .map((sl) => (
                  <button key={sl.id} className="btn sm" onClick={() => { store.assign(p.id, sl.id); onClose() }}>
                    Start at {sl.position}
                  </button>
                ))}
              <button className="btn sm" onClick={() => { store.assign(p.id, 'bench'); onClose() }}>
                To bench
              </button>
              <button className="btn sm" onClick={() => { store.setCaptain(p.id); onClose() }}>
                Make captain
              </button>
            </span>
            {game.season && (
              <span className="pc-actions-group pc-talk">
                <span className="head-title">
                  <b>Have a word</b>
                  <Info label="About conversations">One conversation a week. Hover a choice for how he is likely to take it.</Info>
                </span>
                {talkMsg ? (
                  <span className="small pc-talk-msg" role="status">{talkMsg}</span>
                ) : game.talks?.[p.id] === game.season.matchweek ? (
                  <span className="small muted">You spoke to him this week.</span>
                ) : (
                  (Object.keys(TALK_LABEL) as TalkKind[]).map((k) => (
                    <button key={k} className="btn sm" title={TALK_LABEL[k].hint} onClick={() => setTalkMsg(store.talk(p.id, k).message)}>
                      {TALK_LABEL[k].label}
                    </button>
                  ))
                )}
              </span>
            )}
          </>
        )
      }
      panels={
        s
          ? [
              { id: 'happiness', label: 'Happiness', content: <HappinessCard s={s} /> },
              { id: 'contract', label: 'Contract', content: <ContractCard id={p.id} onTalks={() => setTalks(true)} /> },
            ]
          : undefined
      }
    />
  )
}

/** Per-browser convenience: the squad list's view. The old stamina toggle (on) opens on the Fitness view, which shows it. */
const SQUAD_VIEW_KEY = 'touchline-squad-view'
const SQUAD_COLUMN_KEY = 'touchline.squad.stamina'
function readSquadView(): SquadView {
  try {
    const v = localStorage.getItem(SQUAD_VIEW_KEY)
    if (v && SQUAD_VIEWS.some((x) => x.id === v)) return v as SquadView
    return localStorage.getItem(SQUAD_COLUMN_KEY) === '1' ? 'fitness' : 'overview'
  } catch {
    return 'overview'
  }
}
function writeSquadView(v: SquadView): SquadView {
  try {
    localStorage.setItem(SQUAD_VIEW_KEY, v)
  } catch {
    // Private windows and blocked storage: the switch still works for this visit
  }
  return v
}
