import { Fragment, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { FOCUSABLE } from '../focusRescue'
import { useAfterPaint } from '../afterPaint'
import { Check, ChevronDown, GraduationCap, Globe, Landmark, Medal, MessageSquare, Star, TrendingDown, TrendingUp, UserMinus, X } from 'lucide-react'
import { useStorePick } from '../useStorePick'
import { computeTable, positionOf, roundsFor, USER_TEAM, type Competition } from '@engine/season'
import { getFormation } from '@engine/formations'
import { getRole, DEFAULT_ROLE } from '@engine/roles'
import { LINE_HELP, MENTALITY_HELP, PASSING_HELP, PRESSING_HELP, TEMPO_HELP, WIDTH_HELP, STYLE_LABEL } from '@engine/tactics'
import { TRAINING, type TrainingFocus } from '@engine/training'
import { nextOpponent, upcomingCupTie } from '@game/logic/week'
import { MATCH_PLAY_MODES, matchPlayOf } from '@game/logic/assistant'
import { isAvailable, playerLookup, squadPlayers } from '@game/logic/players'
import { canCover, ratingAt } from '@engine/positions'
import { teamStrength } from '@game/logic/squad'
import { bidYearChoices, defaultBidYears } from '@game/logic/bidTerms'
import { SELL_ON_OPTIONS, SQUAD_CAP, closedWindowLine, sellOnValue, suggestedStatus } from '@game/logic/marketOps'
import { canFullScout, focusActive, maskedView } from '@game/logic/scouting'
import { recentShare, statusOf } from '@game/logic/week'
import { EXPECTED_SHARE, RECENT_WEEKS, STATUS_LABEL, STATUSES, WAGE_MULT, type SquadStatus } from '@engine/status'
import { TALK_LABEL, type TalkKind } from '@game/logic/talks'
import { STAFF, STAFF_ROLES, staffTier, staffWages, traitTags } from '@engine/staff'
import { evaluateObjective, OBJECTIVE_REWARD } from '@engine/objectives'
import { unlockedNames } from '../i18n/trophyText'
import { briefingHeadline, weeklyBriefing, type BriefingAction, type BriefingItem, type DugoutTab } from '@game/logic/briefing'
import { foreseeStop, nextStop, stopLine } from '@game/logic/seasonHighlights'
import { newsTotal, unseenNews } from '@game/logic/news'
import { slotSheet, surname, whereaboutsLabel, type SlotOption } from '@game/logic/slotSheet'
import { slotRating } from '@game/logic/slotRating'
import { slotRatingText } from '../slotRatingText'
import { Pitch, PitchLegend } from '../components/Pitch'
import { FormationPicker } from '../components/FormationPicker'
import { PlayerRow } from '../components/PlayerRow'
import { TableView } from '../components/TableView'
import { Bar, ClubBadge, Info, Modal, Rating, Segmented, Stat, Tabs, Pos, TeamBadge, Tip, useViewerFlag } from '../components/bits'
import { Bracket } from '../components/Bracket'
import { seasonCupBracket, seasonGroupViews } from '@game/logic/bracket'
import { continentalPlan } from '@engine/continental'
import { GroupTables } from '../components/GroupTables'
import { BriefingIcon, NewsIcon } from '../components/icons'
import { SQUAD_COLUMNS } from '../components/AttributePanel'
import { PlayerCardModal } from '../components/PlayerCard'
import { careerSeasons } from '@game/logic/playerCard'
import { LeagueFlag } from '../components/Flag'
import { boardLastLabel, boardLastLine, ClubHistory, LegendsTable } from '../components/ClubHistory'
import { lastVerdict } from '@game/logic/dynastyHistory'
import { roleCode } from '../match/shirts'
import { chemistryLinkLabel, clubName, clubShort, signedValue, meterValue, money, moraleWord, ordinal, outcomeClass, outcomeOf, seasonLabel, wage } from '../format'
import type { PlayerSeason, Position, TableRow } from '@engine/types'
import type { TeamTalk } from '@engine/match'
import { isClassic } from '@engine/universe'
import { StatsTab } from './StatsTab'
import { OppositionReport } from './OppositionReport'
import { RunInBanner } from '../components/RunInBanner'
import { DressingRoomTab } from './DressingRoomTab'
import { CounterBidControl, NegotiateButton, OfficeInbox, OfficeTab, officeAlertCount, PromisesToHim } from './OfficeTab'
import { isOfficeNews, promisesTo } from '@game/logic/officeView'
import { office as officeText } from '../i18n/en/office'
import { PlannerTab } from './PlannerTab'
import { InboxActions } from '../components/InboxActions'
import { HappinessCard } from '../components/Happiness'
import { personalityOf } from '@game/logic/personality'
import { RecruitmentPanel, ScoutModal, ScoutReportsPanel } from './Recruitment'
import { listingFit, sortListings, type ListingSort } from '@game/logic/marketFit'
import { nextRequestAt, REQUEST_CONFIDENCE, REQUEST_GAP, requestOptions, SHIFT_BUDGET, SHIFT_LIMIT, SHIFT_WAGE, wageRoom } from '@game/logic/board'
import { ContractCard, ContractTalks } from '../components/ContractTalks'
import { clickedTabAfter, DUGOUT_TAB_ORDER, dugoutKey, isControlTarget, tabShortcuts } from '../dugoutKeys'
import { PositionChart } from '../components/LiveLeague'
import { PlayerPeek } from '../components/PlayerPeek'
import { BoxesMenu, useBoxes, type Boxes } from '../components/Boxes'
import { DUGOUT_ALL, DUGOUT_HEAD, DUGOUT_TABS } from '../boxSets'
import type { BoxSet } from '../boxes'
import type { Game } from '@game/types'
import type { LoadedUniverse } from '@engine/universe'
import type { Listing } from '@engine/market'
import { doneDeals, EVEN_BAND, filterNews, seasonStrip, tickerLines, INBOX_FILTERS, matchUp, positionStory, windowCountdown, minutesLast3, ratingBand, type InboxFilter, ROLE_FIT_LABEL, roleFit, roleOptions, SQUAD_VIEWS, teamFamiliarity, type SquadView } from '@game/logic/squadDisplay'
import { newsBody } from '@game/logic/newsFlavour'
import { watchSeasonSounds } from '../sound/seasonWatch'
import { askConfirm } from '../confirm'
import { InboxStorylines, MatchPreviewPanel, StoryChip, SummerHeadline } from '../components/Storylines'
import { translator } from '../i18n'
import { dugout } from '../i18n/en/dugout'
import { WeekStrip } from '../components/WeekStrip'
import '../motionSeason.css'
import { rich } from '../i18n/rich'
import { roleBlurb, roleName, staffLabel, staffTierBlurb, staffTierTitle, trainingBlurb, trainingLabel } from '../i18n/engineText'
import { briefingActionText, briefingHintText, briefingLineText } from '../briefingText'
import { onRadioGroupKey, radioTabIndex } from '../a11y'

const t = translator(dugout)
const tOffice = translator(officeText)

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
  if (tab === 'next') return nextOpponent(game) ? ['preview', 'opposition', 'match-up', 'team-talk'] : [...(upcomingCupTie(game) ? ['preview'] : []), 'team-talk']
  if (tab === 'window' && game.window) return ['recruitment', ...((game.scoutReports ?? []).length > 0 ? ['scout-reports'] : []), 'approach', 'shortlist', ...(doneDeals(game.window).length > 0 ? ['done-deals'] : []), 'log']
  if (tab === 'club') return ['board', 'requests', 'finances', 'staff', 'contracts', ...(game.careerStats && Object.keys(game.careerStats).length > 0 ? ['legends'] : []), ...(game.history.length > 0 ? ['history'] : []), 'achievements']
  return undefined
}

/** Each tab with its shortcuts: `aria-keyshortcuts` and a tooltip naming the digit and the letter (r10). */
function withShortcuts<T extends { id: Tab }>(tabs: T[]): Array<T & { keys: string; title: string }> {
  const keys = tabShortcuts(tabs.map((x) => x.id))
  return tabs.map((x, i) => ({ ...x, keys: [keys[i].digit, keys[i].letter].filter(Boolean).join(' '), title: keys[i].digit ? t('tabKeysTip', { digit: keys[i].digit, letter: keys[i].letter }) : t('tabKeyTip', { letter: keys[i].letter }) }))
}

/** Whether this viewer keeps the Key on (bar labels and the pitch legend). */
const KEY_FLAG = 'touchline-squad-key'

export function Dugout() {
  const store = useStorePick('universe', 'game', 'autoPick', 'markNewsSeen', 'playFriendly', 'playWeekSoon', 'playingWeek', 'restTired', 'setMatchPlay', 'showToast', 'signYouth', 'simStop', 'simToNextBigMatchSoon', 'simWeeksSoon', 'startPromised')
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
  const keys = useRef<{ play: (() => void) | null; tabs: Tab[]; manage: { autoPick: () => void; rest: () => void } | null }>({ play: null, tabs: [], manage: null })
  useEffect(() => {
    // The strip's tab a click last focused (r10): Space there plays the week; a key that moves the focus forgets it
    let clicked: Element | null = null
    const onPointer = (e: PointerEvent) => {
      clicked = clickedTabAfter(clicked, { pointer: (e.target as HTMLElement | null)?.closest?.('.tabs-row [role="tab"]') ?? null })
    }
    const onKey = (e: KeyboardEvent) => {
      const k = keys.current
      const target = e.target as HTMLElement | null
      const stripTab = target?.closest?.('.tabs-row [role="tab"]') ?? null
      const out = dugoutKey(e.key, { onControl: isControlTarget(target), modalOpen: !!document.querySelector('.modal-back, .md-drawer, [aria-modal="true"]'), modifier: e.ctrlKey || e.metaKey || e.altKey, canPlay: !!k.play, tabs: k.tabs.length, canManage: !!k.manage, onTab: !!stripTab, tabByPointer: !!stripTab && stripTab === clicked, tabIds: k.tabs })
      clicked = clickedTabAfter(clicked, { key: e.key })
      if (!out) return
      e.preventDefault()
      if (out.kind === 'play') k.play?.()
      else if (out.kind === 'autoPick') k.manage?.autoPick()
      else if (out.kind === 'rest') k.manage?.rest()
      else setTab(out.kind === 'tabId' ? out.id : k.tabs[out.index])
    }
    window.addEventListener('pointerdown', onPointer, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointer, true)
      window.removeEventListener('keydown', onKey)
    }
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
  // Rest the tired starters (one, or all the plan finds a fresher man for), with a toast saying what changed
  const rest = (id?: string) => {
    const n = store.restTired(id)
    store.showToast(n ? t('rested', { count: n }) : t('restNone'))
  }
  const act = (a: BriefingAction) => {
    if (a.op === 'autoPick') store.autoPick()
    else if (a.op === 'friendly') store.playFriendly()
    else if (a.op === 'player' && a.playerId) setPlayerModal(a.playerId)
    else if (a.op === 'rest') rest(a.playerId)
    else if (a.op === 'startPromised') store.startPromised()
    else if (a.op === 'event') document.querySelector('[data-testid="event-card"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    if (a.tab) setTab(a.tab)
  }

  // The tabs in the order a manager works through the week (`DUGOUT_TAB_ORDER`, r10); keys 1 to 0 follow it
  const tabSpec: Partial<Record<Tab, { label: string; alert?: boolean; badge?: number }>> = {
    squad: { label: t('tabSquad') },
    ...(done ? {} : { next: { label: t('tabNext') } }),
    tactics: { label: t('tabTactics') },
    inbox: { label: t('tabInbox'), alert: !!game.pendingEvent, badge: unseen },
    office: { label: tOffice('tabOffice'), badge: officeAlertCount(game, u) || undefined },
    dressing: { label: t('tabDressing') },
    planner: { label: t('tabPlanner') },
    market: { label: t('tabMarket'), alert: !!game.window && (openOffers > 0 || game.window.day === 0) },
    fixtures: { label: t('tabFixtures') },
    table: { label: t('tabTable') },
    ...(season.cup.length ? { cup: { label: t('tabCup') } } : {}),
    ...(season.continental ? { europe: { label: t('tabEurope') } } : {}),
    stats: { label: t('tabStats') },
    club: { label: t('tabClub') },
  }
  const tabList = withShortcuts(DUGOUT_TAB_ORDER.flatMap((id) => (tabSpec[id] ? [{ id, ...tabSpec[id] }] : [])))
  keys.current = { play: done || game.pendingEvent || simming ? null : () => void store.playWeekSoon(prepareWeek), tabs: tabList.map((t) => t.id), manage: done ? null : { autoPick: () => { store.autoPick(); store.showToast(t('autoPicked')) }, rest: () => rest() } }

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
              {game.settings.mode === 'dynasty' && <span>{t('year', { year: game.year })}</span>}
              <span className="chip">{preseason ? t('preseason') : t('mwOf', { week: season.matchweek, weeks: season.matchweeks })}</span>
            </div>
          </div>
        </div>
        <div className="stat-strip">
          <Stat label={t('position')} value={season.matchweek ? ordinal(pos) : '–'} sub={t('ptsRecord', { points: row.points, record: `${row.won}-${row.drawn}-${row.lost}` })} />
          <Stat label={t('teamRating')} value={strength.overall.toFixed(1)} sub={<span title={t('balanceTip')}>{t('balanced', { pct: Math.round(strength.balance * 100) })}</span>} />
          <Stat label={t('budget')} value={money(game.finances.budget)} sub={<span title={t('wagesTip')}>{t('wagesOf', { bill: wage(squad.reduce((s, x) => s + x.p.wage, 0) + staffWages(game.staff)), cap: wage(game.finances.wageCap) })}</span>} />
          <div className="stat">
            <span className="label">{t('board')}</span>
            <span className="value">{Math.round(season.confidence)}</span>
            <Bar value={season.confidence} colour={season.confidence > 60 ? 'var(--good)' : season.confidence > 30 ? 'var(--meter-mid)' : 'var(--danger)'} />
            <span className="small muted">{t('target', { pos: season.boardTarget })}</span>
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
                  {t('preseason')} <Info label={t('aboutPreseason')}>{t('preseasonInfo')}</Info>
                </div>
                <SummerHeadline game={game} u={u} />
              </div>
            ) : next ? (
              <div className="cta-fixture" key={`mw${season.matchweek}`}>
                <ClubBadge clubId={next.clubId} size={40} />
                <div>
                  <div className="eyebrow">{t('mwVenue', { week: season.matchweek + 1, home: next.home ? 'home' : 'away' })}</div>
                  <div className="cta-title">
                    {t('vsClub', { home: next.home ? 'home' : 'away', club: clubName(u, next.clubId) })}
                  </div>
                  <div className="club-sub">
                    <span>{t('styleSide', { style: STYLE_LABEL[u.clubById[next.clubId]?.style ?? 'balanced'] })}</span>
                    <span>{ordinal(positionOf(table, next.clubId))}</span>
                    {u.clubById[season.hostClubId]?.rivals.includes(next.clubId) && <span className="chip warn">{t('derby')}</span>}
                    <StoryChip game={game} u={u} />
                    {game.window && <WindowChip w={game.window} />}
                    {/* Season Highlights: why the last Sim to the next big match stopped here (a chip, so the box keeps its height) */}
                    {stopped && (
                      <span className="chip info" data-testid="sim-stop" title={stopLine(stopped, u)}>
                        ⏸ {stopped.label}
                      </span>
                    )}
                  </div>
                  {/* The midweek tie on its own line, so a wrapped row never starts with a separator dot */}
                  {cupTie && <div className="cta-then">{t('thenCup', { round: cupTie.label, home: cupTie.homeTeamId === USER_TEAM ? 'home' : 'away', club: clubShort(u, cupTie.homeTeamId === USER_TEAM ? cupTie.awayTeamId : cupTie.homeTeamId) })}</div>}
                </div>
              </div>
            ) : (
              <div className="cta-fixture" key={`mw${season.matchweek}`}>
                <div>
                  <div className="eyebrow">
                    {t('matchweek', { week: season.matchweek + 1 })}
                    {stopped && (
                      <span className="chip info" data-testid="sim-stop" title={stopLine(stopped, u)} style={{ marginLeft: 8 }}>
                        ⏸ {stopped.label}
                      </span>
                    )}
                  </div>
                  <div className="cta-title">
                    {t('freeWeekend')} <Info label={t('whyFree')}>{t('freeInfo')}</Info>
                  </div>
                  {cupTie && (
                    <div className="club-sub">
                      <span>
                        {t('thenCup', { round: cupTie.label, home: cupTie.homeTeamId === USER_TEAM ? 'home' : 'away', club: clubShort(u, cupTie.homeTeamId === USER_TEAM ? cupTie.awayTeamId : cupTie.homeTeamId) })}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}
            {headBoxes.on('briefing') && <WeekStrip game={game} u={u} onInbox={() => setTab('inbox')} />}
            {headBoxes.on('briefing') && <BriefingList items={briefing} onAction={act} checklist={preseason} />}
          </div>
          <div className="cta-bar" ref={barRef} data-testid="cta-bar">
            {headline && (
              <div className={`bar-brief ${headline.level}`} data-testid="bar-brief">
                <span className="icon" aria-hidden="true">
                  <BriefingIcon item={headline} size={15} />
                </span>
                <span className="text">{briefingLineText(headline)}</span>
                {headline.action && headline.action.op !== 'friendly' && (
                  <button className="btn sm" onClick={() => act(headline.action!)}>
                    {briefingActionText(headline.action.label)}
                  </button>
                )}
              </div>
            )}
            <div className="match-play" data-testid="match-play" role="radiogroup" aria-label={t('howToPlay')} onKeyDown={onRadioGroupKey}>
              <span className="small muted">{t('matchLabel')}</span>
              {MATCH_PLAY_MODES.map((m, i) => (
                <button key={m.id} type="button" role="radio" aria-checked={playMode === m.id} tabIndex={radioTabIndex(i, MATCH_PLAY_MODES.findIndex((x) => x.id === playMode))} className={`chip-btn ${playMode === m.id ? 'active' : ''}`} title={t(`playHint_${m.id}`)} onClick={() => store.setMatchPlay(m.id)} data-testid={`match-play-${m.id}`}>
                  {t(`play_${m.id}`)}
                </button>
              ))}
            </div>
            {/* On a narrow phone the labels shorten (`.lbl-short`) and the buttons wrap rather than clip */}
            <div className="btns">
              {preseason && game.friendliesPlayed < 3 && (
                <button className="btn" onClick={() => store.playFriendly()}>
                  <span className="lbl-long">{t('playFriendly')}</span>
                  <span className="lbl-short">{t('friendly')}</span>
                </button>
              )}
              <button className="btn primary big" onClick={() => void store.playWeekSoon(prepareWeek)} disabled={!!game.pendingEvent || store.playingWeek || simming} aria-busy={store.playingWeek || undefined} data-testid="play-week" title={t('playTip')}>
                <span className="lbl-long">{store.playingWeek ? t(preseason ? 'kickingOff' : 'playing') : preseason ? t('kickOffSeason') : t(next ? 'playMw' : 'sitOutMw', { week: season.matchweek + 1 })}</span>
                <span className="lbl-short">{store.playingWeek ? t(preseason ? 'kickingOff' : 'playing') : preseason ? t('kickOff') : t(next ? 'playMwShort' : 'sitOutMwShort', { week: season.matchweek + 1 })}</span>
                {next && playMode !== 'watch' && <span className="mode-tag">{t(playMode === 'auto' ? 'autoPlay' : 'simResult')}</span>}
              </button>
              <button className="btn" data-testid="sim-big" onClick={() => afterPaint(() => store.simToNextBigMatchSoon())} disabled={!!game.pendingEvent || !!bigNext || simming} aria-busy={simming || undefined} title={bigNext ? t('bigTip', { label: bigNext.label }) : t('bigTipNone')}>
                <span className="lbl-long">{bigNext ? t('bigNext', { label: bigNext.label }) : simToText(foreseeStop(game, u))}</span>
                <span className="lbl-short">{t(bigNext ? 'bigNextShort' : 'toBigShort')}</span>
              </button>
              <button className="btn" onClick={() => afterPaint(() => store.simWeeksSoon(5))} disabled={!!game.pendingEvent || simming} aria-busy={simming || undefined} title={t('sim5Tip')} data-testid="sim-5">
                {simming ? t('simulating') : <><span className="lbl-long">{t('sim5Weeks')}</span><span className="lbl-short">{t('sim5')}</span></>}
              </button>
              <button className="btn ghost" onClick={() => void askConfirm(t('simEndConfirm'), { ok: t('simEnd') }).then((ok) => { if (ok) afterPaint(() => store.simWeeksSoon(40)) })} disabled={!!game.pendingEvent || simming} data-testid="sim-end">
                {t('simEnd')}
              </button>
            </div>
          </div>
        </div>
      )}
      {game.pendingEvent && <EventCard />}

      <div className="tabs-row">
        <Tabs<Tab> value={tab} onChange={setTab} tabs={tabList} />
        {/* The keyboard on a desktop: what Space, the digits, the tabs' letters, A and R do (r10) */}
        <span className="dugout-keys" data-testid="dugout-keys">
          <Info label={t('keysLabel')}>{t('playTip')}</Info>
        </span>
        <BoxesMenu groups={[headBoxes, tabBoxes]} resets={DUGOUT_ALL} />
      </div>

      {/* The tab's content: on a desktop it scrolls inside itself under the fixed header, briefing and tab bar */}
      <div className="tab-body fill" data-testid="tab-body">
      {tab === 'squad' && <Tip id="dugout-first">{t('firstTip')}</Tip>}
      {tab === 'office' && <Tip id="office-first">{tOffice('officeTip')}</Tip>}
      {tab === 'squad' && game.youthIntake && game.youthIntake.chosen === undefined && preseason && (
        <div className="panel emphasis youth-intake" style={{ marginBottom: 'var(--space-4)' }} data-testid="youth-intake">
          <div className="panel-head">
            <h3 className="icon-title">
              <GraduationCap size={20} aria-hidden="true" /> {t('youthIntake')}
            </h3>
            {/* A short desktop window: the candidates as one line of chips in the head (CSS shows this or the cards below) */}
            <span className="youth-line" data-testid="youth-line">
              {game.youthIntake.candidates.map((id) => {
                const p = u.index[id]
                if (!p) return null
                const home = p.clubId === game.settings.hostClubId
                return (
                  <button key={id} type="button" className={`youth-chip${home ? ' home' : ''}`} onClick={() => store.showToast(store.signYouth(id).message)} title={t('youthChipTip', { name: p.name, age: p.age, club: clubName(u, p.clubId), homegrown: home ? t('homegrownSuffix') : '' })} data-testid="youth-chip">
                    <Pos p={p.positions[0]} />
                    <span className="youth-chip-name">{p.name}</span>
                    <span className="small muted">{p.age}</span>
                    <Rating value={p.overall} />
                    <span className="btn sm primary">{t('sign')}</span>
                  </button>
                )
              })}
            </span>
            <span className="row youth-side" style={{ gap: 'var(--space-3)' }}>
              <span className="small muted youth-terms">{t('youthTerms')}</span>
              <button className="btn ghost sm" onClick={() => store.showToast(store.signYouth(null).message)} data-testid="youth-pass">
                {t('passYear')}
              </button>
            </span>
          </div>
          <div className="plist lined youth-list">
            {game.youthIntake.candidates.map((id) => {
              const p = u.index[id]
              if (!p) return null
              return <PlayerRow key={id} p={p} showClub onClick={() => store.showToast(store.signYouth(id).message)} right={<span className="btn sm primary">{t('sign')}</span>} extra={p.clubId === game.settings.hostClubId ? <span className="chip gold">{t('homegrown')}</span> : undefined} />
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
                <h3>{t('squadCount', { n: squad.length, cap: SQUAD_CAP })}</h3>
                <Info label={t('aboutSquad')}>{t('squadInfo')}</Info>
              </span>
              <div className="toolbar">
                <button type="button" className={`chip key-chip ${showKey ? 'info' : ''}`} aria-pressed={showKey} onClick={toggleKey} data-testid="key-toggle" title={t('keyTip')}>
                  {t('key')}
                </button>
                <span className="segmented squad-views-seg" role="radiogroup" aria-label={t('squadView')} data-testid="squad-view" onKeyDown={onRadioGroupKey}>
                  {SQUAD_VIEWS.map((v, i) => (
                    <button key={v.id} type="button" role="radio" aria-checked={view === v.id} tabIndex={radioTabIndex(i, SQUAD_VIEWS.findIndex((x) => x.id === view))} className={view === v.id ? 'active' : ''} title={t(`viewHint_${v.id}`)} onClick={() => setView(writeSquadView(v.id))} data-testid={v.id === 'fitness' ? 'toggle-stamina' : `squad-view-${v.id}`}>
                      {t(`view_${v.id}`)}
                    </button>
                  ))}
                </span>
                <button className="btn sm" onClick={() => store.autoPick()}>
                  {t('autoPick')}
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
                          <span className="chip gold" title={t('captain')}>
                            {t('captainC')}
                          </span>
                        )}
                        {contract?.expired && (
                          <span className="chip warn" data-testid="out-of-contract" title={t('outOfContractTip')}>
                            {t('outOfContract')}
                          </span>
                        )}
                        {view === 'fitness' && (
                          <>
                            <span className="season-line" title={t('condNow')}>
                              {t('cond', { v: meterValue(s.condition) })}
                            </span>
                            <span className={`chip ${p.positions[0] === 'GK' ? '' : p.attributes.stamina >= 75 ? 'good' : p.attributes.stamina < 55 ? 'warn' : ''}`} data-testid="stamina-col" title={t(p.positions[0] === 'GK' ? 'staminaGk' : 'staminaTip', { v: p.attributes.stamina })}>
                              {SQUAD_COLUMNS[0].short} {p.attributes.stamina}
                            </span>
                            {mins !== null && (
                              <span className="season-line" title={t('minsTip')}>
                                {t('mins3', { n: mins })}
                              </span>
                            )}
                          </>
                        )}
                        {view === 'overview' && s.seasonStats.apps > 0 && (
                          <span className="season-line">
                            {t('appsLine', { apps: t('apps', { n: s.seasonStats.apps }), goals: s.seasonStats.goals, assists: s.seasonStats.assists, avg })}
                          </span>
                        )}
                        {view === 'form' && (
                          <span className="season-line" data-testid="form-line">
                            {last === undefined ? t('noRating') : rich(t('lastForm', { last: last.toFixed(1), avg, motm: s.seasonStats.motm }), { b: (c) => <b className={`rating-word ${ratingBand(last)}`}>{c}</b> })}
                          </span>
                        )}
                        {view === 'contract' && (
                          <span className="season-line" data-testid="contract-line">
                            {contract?.loan ? t('loan') : t('years', { n: contract?.years ?? 1 })} · {wage(p.wage)} · {STATUS_LABEL[statusOf(game, p.id)]} · {money(p.value)}
                          </span>
                        )}
                      </>
                    }
                    right={starting ? <span className="chip info">{slot?.position}</span> : game.bench.includes(p.id) ? <span className="chip">{t('bench')}</span> : <span className="chip muted">{t('unused')}</span>}
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
                <span className="unit-strip" role="group" aria-label={t('unitRatings')}>
                  {(
                    [
                      ['GK', strength.goalkeeping],
                      ['DEF', strength.defence],
                      ['MID', strength.midfield],
                      ['ATT', strength.attack],
                    ] as const
                  ).map(([k, v]) => (
                    <span key={k}>
                      <i>{t(`unit${k}`)}</i> {v.toFixed(0)}
                    </span>
                  ))}
                </span>
              </div>
              <Pitch formation={formation} lineup={game.lineup} getPlayer={get} getState={(id) => game.squad[id]} onSlotClick={onSlotClick} selectedSlot={sheetSlot} showRoles={Object.fromEntries(formation.slots.map((s) => [s.id, getRole(game.tactics.roles[s.id] ?? DEFAULT_ROLE[s.position]).name]))} roleCodes={Object.fromEntries(formation.slots.map((s) => [s.id, roleCode(game.tactics, s.id, s.position)]))} />
              {showKey && <PitchLegend />}
              {strength.chemistryBreakdown.length > 0 && <div className="small muted" style={{ marginTop: 'var(--space-2)' }}>{t('chemistry', { value: signedValue(strength.chemistry), links: strength.chemistryBreakdown.map((l) => chemistryLinkLabel(u, l)).join(', ') })}</div>}
            </div>
            )}
            {tabBoxes.on('depth') && (
            <div className="panel">
              <div className="panel-head">
                <span className="head-title">
                  <h3>{t('depthChart')}</h3>
                  <Info label={t('aboutDepth')}>{t('depthInfo')}</Info>
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
                        {cover.length === 0 && <span className="chip bad">{t('nobody')}</span>}
                        {cover.map((x) => (
                          <PlayerPeek key={x.p.id} p={x.p} s={x.s}>
                            <button type="button" className={`chip ${inXI.has(x.p.id) ? 'info' : ''} ${!isAvailable(x.s) ? 'dim' : ''}`} onClick={() => onPlayerClick(x.p.id)} title={t(!isAvailable(x.s) ? 'unavailable' : inXI.has(x.p.id) ? 'starting' : 'available')}>
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
      {tab === 'office' && <OfficeTab onPlayer={onPlayerClick} boxes={tabBoxes} />}
      {tab === 'planner' && <PlannerTab onPlayer={onPlayerClick} boxes={tabBoxes} />}

      {tab === 'fixtures' && (
        <div className="panel">
          <div className="panel-head">
            <span className="head-title">
              <h3>{t('fixturesTitle')}</h3>
              <Info label={t('aboutCalendar')}>{t('calendarInfo')}</Info>
            </span>
          </div>
          {tabBoxes.on('calendar') && <SeasonStrip table={table} />}
          {tabBoxes.on('fixture-list') && (
          <div className="fixture-list">
            {season.takeoverAt ? (
              <div className="fixture me" data-testid="before-you-arrived">
                <span className="mw">{t('mwRange', { n: season.takeoverAt })}</span>
                <span className="muted small" style={{ gridColumn: '2 / -1' }}>
                  {t('beforeArrived')}
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
                const oppPos = season.matchweek > 0 ? <span className="fx-pos" data-testid="fixture-pos" title={t('placeNow', { club: clubName(u, opp), pos: positionOf(table, opp) })}>{ordinal(positionOf(table, opp))}</span> : null
                return (
                  <div key={f.matchweek} className="fixture me">
                    <span className="mw">{t('mwShort', { week: f.matchweek })}</span>
                    <span className="h row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                      {home ? null : oppPos} {home ? <span className="fx-name">{game.settings.teamName}</span> : <FxName full={clubName(u, opp)} short={clubShort(u, opp)} />} {home ? null : <ClubBadge clubId={opp} size={18} />}
                    </span>
                    <span className={`sc chip ${cls}`} style={{ fontFamily: 'var(--font-display)', fontSize: 'calc(var(--fs-base) + 2px)' }}>
                      {r ? `${r.homeGoals} - ${r.awayGoals}` : t('vs')}
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
                <h3><LeagueFlag leagueId={season.leagueId} label={u.leagues.find((l) => l.id === season.leagueId)?.name} /> {t('leagueTable', { season: seasonLabel(season.leagueSeason), projected: season.carryIn ? t('fromMwProjected', { week: season.takeoverAt }) : '' })}</h3>
                <Info label={t('aboutTable')}>{t('tableInfo')}</Info>
              </span>
            </div>
            <div className="tbl-wrap">
              <TableView rows={table} teamName={game.settings.teamName} zones />
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
            <h3>{t('inbox')}</h3>
            {dividerAt > 0 && (
              <span className="small muted" data-testid="inbox-new-count">
                {t('newSince', { n: Math.min(dividerAt, season.news.length) })}
              </span>
            )}
          </div>
          <div className="inbox-filters row wrap" role="radiogroup" aria-label={t('show')} data-testid="inbox-filter" onKeyDown={onRadioGroupKey}>
            {INBOX_FILTERS.filter((f) => f.id !== 'office' || !!game.office).map((f, i, shown) => (
              <button key={f.id} type="button" role="radio" aria-checked={inboxFilter === f.id} tabIndex={radioTabIndex(i, shown.findIndex((x) => x.id === inboxFilter))} className={`chip-btn ${inboxFilter === f.id ? 'active' : ''}`} onClick={() => setInboxFilter(f.id)}>
                {f.label}
                {f.id !== 'all' && <span className="muted"> {filterNews(season.news, f.id).length}</span>}
              </button>
            ))}
          </div>
          {/* Pinned while something waits on the manager: the week's decision, or offers for his players */}
          {(game.pendingEvent || openOffers > 0) && (
            <div className="needs-you" data-testid="needs-you">
              <span className="needs-you-label">{t('needsYou')}</span>
              {game.pendingEvent && (
                <button type="button" className="btn sm" onClick={() => act({ op: 'event', label: t('decide') })}>
                  {t('decideOn', { title: game.pendingEvent.title })}
                </button>
              )}
              {openOffers > 0 && (
                <button type="button" className="btn sm" onClick={() => setTab('market')}>
                  {t('offersFor', { n: openOffers })}
                </button>
              )}
            </div>
          )}
          <OfficeInbox onOpen={() => setTab('office')} />
          {inboxFilter === 'all' && <InboxStorylines game={game} u={u} />}
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
                    {isOfficeNews(n) && (
                      <button type="button" className="chip-btn" onClick={() => setTab('office')} data-testid="news-office">
                        {tOffice('openOffice')}
                      </button>
                    )}
                  </span>
                  <span className="news-mw">{n.matchweek ? t('mwShort', { week: n.matchweek }) : t('pre')}</span>
                </div>
                {/* The divider sits under the last unread item, when anything older is still in the feed */}
                {i < dividerAt && (shown[k + 1]?.i ?? Infinity) >= dividerAt && k < shown.length - 1 && (
                  <div className="divider" data-testid="inbox-divider">
                    <span>{t('newAbove')}</span>
                  </div>
                )}
              </Fragment>
            ))}
            {inboxFilter !== 'all' && filterNews(season.news, inboxFilter).length === 0 && <div className="muted small">{t('nothingHere')}</div>}
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
  const fitChip = o.fit === 'natural' ? <span className="chip good">{t('fits')}</span> : o.fit === 'accomplished' ? <span className="chip warn">{t('acc')}</span> : <span className="chip bad">{t('awk')}</span>
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
          {o.unavailable && <span className="chip bad">{t(o.unavailable === 'injured' ? 'injured' : 'suspended')}</span>}
        </>
      }
      right={
        <span className="slot-disc" title={slotRatingText(rated, at, { attributes: true })} role="img" aria-label={slotRatingText(rated, at)} data-testid="slot-disc">
          {o.disc}
          {rated.cost > 0 && <span className="slot-disc-cost">−{rated.cost}</span>}
        </span>
      }
    />
  )
}

/** The slot picker: a bottom sheet on a phone, a modal elsewhere. Tapping a row puts him in the slot (swapping with whoever is there). */
function SlotSheet({ slotId, onClose }: { slotId: string | null; onClose: () => void }) {
  const store = useStorePick('universe', 'game', 'playInSlot')
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
    <Modal open sheet onClose={onClose} title={t('pickYour', { label: sheet.label })} testId="slot-sheet">
      <div className="sheet-meta">
        <span className="chip">{role}</span>
        <span className="small muted">{t('bestFirst')}</span>
        <Info label={t('aboutNumbers')}>{t('numbersInfo')}</Info>
      </div>
      {sheet.occupant ? (
        <div className="sheet-occupant">
          <SlotOptionRow o={sheet.occupant} at={sheet.slot.position} />
          <button className="btn sm" data-testid="sheet-to-bench" onClick={() => pick(sheet.occupant!.p.id, 'bench')}>
            {t('toBench')}
          </button>
        </div>
      ) : (
        <div className="notice" style={{ marginBottom: 'var(--space-2)' }}>
          {t('nobodyInSlot')}
        </div>
      )}
      <h3 className="sheet-group">{t('canPlay', { pos: sheet.slot.position, n: sheet.cover.length })}</h3>
      <div className="plist lined" data-testid="sheet-cover">
        {sheet.cover.length === 0 && <div className="muted small">{t('noCover', { pos: sheet.slot.position })}</div>}
        {sheet.cover.map((o) => (
          <SlotOptionRow key={o.p.id} o={o} at={sheet.slot.position} onPick={() => pick(o.p.id)} />
        ))}
      </div>
      {sheet.outOfPosition.length > 0 && (
        <details className="sheet-out" data-testid="sheet-out">
          <summary>{t('outOfPosition', { n: sheet.outOfPosition.length })}</summary>
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
  const store = useStorePick('universe', 'game', 'setTeamTalk')
  const { universe: u, game } = store
  if (!u || !game?.season) return null
  const next = nextOpponent(game)
  const rows = next ? matchUp(game, u, next.clubId) : null
  const talkOptions = talks()
  const talk = talkOptions.find((x) => x.value === game.teamTalk)
  const upGrid = boxes.grid(rows && next ? [{ track: '1fr', ids: ['match-up'] }, { track: '1fr', ids: ['team-talk'] }] : [{ track: '1fr', ids: ['team-talk'] }])
  return (
    <div className="next-match" data-testid="next-match">
      {boxes.on('preview') && <MatchPreviewPanel game={game} u={u} />}
      {next ? boxes.on('opposition') && <OppositionReport clubId={next.clubId} home={next.home} open /> : <div className="notice">{t('freeWeekendTalk')}</div>}
      <div className={`grid two ${upGrid.className}`} style={upGrid.style}>
        {rows && next && boxes.on('match-up') && (
          <div className="panel" data-testid="match-up">
            <div className="panel-head">
              <span className="head-title">
                <h3>{t('unitVsUnit')}</h3>
                <Info label={t('aboutMatchUp')}>{t('matchUpInfo', { band: EVEN_BAND })}</Info>
              </span>
              <span className="small muted">{t('youV', { club: clubShort(u, next.clubId) })}</span>
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
                  <span className={`chip ${r.edge === 'ahead' ? 'good' : r.edge === 'behind' ? 'bad' : ''}`}>{t(r.edge === 'ahead' ? 'edge' : r.edge === 'behind' ? 'behind' : 'even')}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {boxes.on('team-talk') && (
        <div className="panel" data-testid="team-talk">
          <div className="panel-head">
            <span className="head-title">
              <h3>{t('teamTalk')}</h3>
              <Info label={t('aboutTalks')}>{t('talksInfo')}</Info>
            </span>
          </div>
          <Segmented<TeamTalk> label={t('teamTalk')} value={game.teamTalk} onChange={store.setTeamTalk} options={talkOptions} />
          {talk && <p className="help">{talk.hint}</p>}
        </div>
        )}
      </div>
    </div>
  )
}

/** The team talks, read in the viewer's language when the tab renders. */
const talks = (): Array<{ value: TeamTalk; label: string; hint: string }> => [
  { value: 'calm', label: t('talk_calm'), hint: t('talkHint_calm') },
  { value: 'encourage', label: t('talk_encourage'), hint: t('talkHint_encourage') },
  { value: 'demand', label: t('talk_demand'), hint: t('talkHint_demand') },
  { value: 'fire-up', label: t('talkFireUp'), hint: t('talkHintFireUp') },
]

/** The Table tab's right box: league position after each matchweek, the clubs around us faint, the board's target dashed. */
function SeasonSoFar({ table }: { table: TableRow[] }) {
  const { universe: u, game } = useStorePick('universe', 'game')
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
          <h3>{t('seasonSoFar')}</h3>
          <Info label={t('aboutChart')}>{t('chartInfo')}</Info>
        </span>
        {story.series.length > 0 && <span className="small muted">{t('afterMw', { pos: story.series[story.series.length - 1], week: story.matchweeks[story.matchweeks.length - 1] })}</span>}
      </div>
      {story.series.length === 0 ? (
        <div className="muted small">{t('chartStarts')}</div>
      ) : (
        <PositionChart series={story.series} rivals={story.rivals.map((r) => ({ ...r, name: clubShort(u, r.teamId) }))} teams={table.length} games={season.matchweeks - first + 1} unit={t('chartUnit')} first={first} target={season.boardTarget} title={t('chartTitle')} />
      )}
    </div>
  )
}

/** The Fixtures tab's calendar: one cell a matchweek, ten to a row on a desktop. */
function SeasonStrip({ table }: { table: TableRow[] }) {
  const { universe: u, game } = useStorePick('universe', 'game')
  if (!u || !game?.season) return null
  const cells = seasonStrip(game, table)
  const nextMw = game.season.matchweek + 1
  return (
    <div className="season-strip" data-testid="season-strip">
      {cells.map((c) => {
        const opp = c.opp ? clubName(u, c.opp) : null
        const tieLine = c.ties.map((x) => t('stripTie', { label: x.label ?? t('stripTieRound', { comp: x.comp === 'cup' ? 'cup' : 'continental', round: x.round }), home: x.home ? 'home' : 'away', club: clubName(u, x.opp), score: x.score ? ` ${x.score}` : '' })).join('; ')
        const title = t('stripTitle', { week: c.matchweek, fixture: opp ? t('stripFixture', { home: c.home ? 'home' : 'away', club: opp, score: c.score ? ` ${c.score}` : '' }) : t('stripFree'), ties: tieLine ? t('stripThen', { ties: tieLine }) : '' })
        return (
          <div key={c.matchweek} className={`ss-cell ${c.outcome ? 'played' : c.band ? `band-${c.band}` : 'free'} ${c.matchweek === nextMw ? 'next' : ''} ${c.outcome && c.matchweek === nextMw - 1 ? 'just' : ''}`} title={title} data-testid="strip-cell">
            <span className="ss-mw">{c.matchweek}</span>
            <span className="ss-opp">
              {c.opp ? <ClubBadge clubId={c.opp} size={18} /> : <span className="muted">–</span>}
              {c.opp && <span className="ss-ha">{t(c.home ? 'home' : 'away')}</span>}
            </span>
            <span className="ss-chips">
              {c.outcome && (
                <span className={`chip ss-score ${outcomeClass(c.outcome)}`}>
                  {c.ours}
                  <span className="res-letter">{c.outcome}</span>
                </span>
              )}
              {c.ties.map((x) => (
                <span key={x.comp + x.round} className={`chip ss-tie ${x.outcome ? outcomeClass(x.outcome) : ''}`}>
                  {t(x.comp === 'cup' ? 'cupShort' : 'ccShort')}
                  {x.outcome && <span className="res-letter">{x.outcome}</span>}
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
    <span className={`chip ${c.last ? 'bad' : 'warn'}`} data-testid="window-countdown" title={t('marketDayTip', { day: w.day + 1, days: w.days })}>
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
/** The sim button's label (`simToLabel` in seasonHighlights.ts): names the target when one is in sight. */
function simToText(seen: { label: string; matchweek: number } | null): string {
  return seen ? t('simToStop', { label: seen.label, n: seen.matchweek }) : t('simToNextBig')
}

function BriefingList({ items, onAction, checklist }: { items: BriefingItem[]; onAction: (a: BriefingAction) => void; checklist?: boolean }) {
  const [open, setOpen] = useState(false)
  if (items.length === 0) return null
  const line = (item: BriefingItem, toggle?: ReactNode) => (
    <li key={item.id} className={`brief ${item.level} ${item.done ? 'done' : ''}`} data-brief={item.id}>
      <span className="icon" aria-hidden="true">
        <BriefingIcon item={item} size={15} />
      </span>
      <span className="text">
        {briefingLineText(item)}
        {item.hint && <Info label={t('aboutItem', { text: briefingLineText(item) })}>{briefingHintText(item)}</Info>}
      </span>
      {/* Play friendly is the panel's own button, so the checklist line does not repeat it */}
      {item.action && item.action.op !== 'friendly' ? (
        <button className="btn sm" onClick={() => onAction(item.action!)}>
          {briefingActionText(item.action.label)}
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
      {open ? t('less') : t('moreN', { n: rest.length })}
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
  const store = useStorePick('universe', 'game', 'setFormation', 'setRole', 'setTactics', 'setTraining')
  const { universe: u, game } = store
  if (!u || !game) return null
  const on = (id: string) => boxes?.on(id) ?? true
  const left = ['formation', 'instructions', 'training', 'set-pieces'].some(on)
  const grid = boxes?.grid([{ track: 'minmax(0, 1fr)', ids: ['formation', 'instructions', 'training', 'set-pieces'] }, { track: '380px', ids: ['roles'] }]) ?? { className: '', style: undefined }
  const get = playerLookup(game, u)
  const formation = getFormation(game.tactics.formationId)
  const tac = game.tactics
  const strength = teamStrength(game, u)
  const familiarity = teamFamiliarity(game)
  return (
    <>
      <Tip id="tactics-first">{t('tacticsTip')}</Tip>
      <div className={`grid dugout ${grid.className}`} style={grid.style}>
        {left && (
        <div className="col">
          {on('formation') && (
          <div className="panel">
            <h3>{t('formation')}</h3>
            <FormationPicker value={tac.formationId} onChange={(id) => store.setFormation(id)} blurbs />
            <p className="help">{t('formationHelp')}</p>
          </div>
          )}
          {on('instructions') && (
          <div className="panel">
            <h3>{t('teamInstructions')}</h3>
            <div className="instructions">
            <Instruction label={t('mentality')} help={MENTALITY_HELP[tac.mentality]}>
              <Segmented label={t('mentality')} value={tac.mentality} onChange={(v) => store.setTactics({ mentality: v })} options={[{ value: 'defensive', label: t('defensive') }, { value: 'balanced', label: t('balancedOpt') }, { value: 'attacking', label: t('attacking') }]} />
            </Instruction>
            <Instruction label={t('pressing')} help={PRESSING_HELP[tac.pressing]}>
              <Segmented label={t('pressing')} value={tac.pressing} onChange={(v) => store.setTactics({ pressing: v })} options={[{ value: 'low', label: t('lowBlock') }, { value: 'mid', label: t('mid') }, { value: 'high', label: t('highPress') }]} />
            </Instruction>
            <Instruction label={t('tempo')} help={TEMPO_HELP[tac.tempo]}>
              <Segmented label={t('tempo')} value={tac.tempo} onChange={(v) => store.setTactics({ tempo: v })} options={[{ value: 'slow', label: t('slow') }, { value: 'standard', label: t('standard') }, { value: 'fast', label: t('fast') }]} />
            </Instruction>
            <Instruction label={t('width')} help={WIDTH_HELP[tac.width]}>
              <Segmented label={t('width')} value={tac.width} onChange={(v) => store.setTactics({ width: v })} options={[{ value: 'narrow', label: t('narrow') }, { value: 'standard', label: t('standard') }, { value: 'wide', label: t('wide') }]} />
            </Instruction>
            <Instruction label={t('defLine')} help={LINE_HELP[tac.defensiveLine]}>
              <Segmented label={t('defLine')} value={tac.defensiveLine} onChange={(v) => store.setTactics({ defensiveLine: v })} options={[{ value: 'deep', label: t('deep') }, { value: 'standard', label: t('standard') }, { value: 'high', label: t('high') }]} />
            </Instruction>
            <Instruction label={t('passing')} help={PASSING_HELP[tac.passing]}>
              <Segmented label={t('passing')} value={tac.passing} onChange={(v) => store.setTactics({ passing: v })} options={[{ value: 'short', label: t('short') }, { value: 'mixed', label: t('mixed') }, { value: 'direct', label: t('direct') }]} />
            </Instruction>
            </div>
          </div>
          )}
          {on('training') && (
          <div className="panel">
            <h3>{t('trainingWeek')}</h3>
            <Segmented<TrainingFocus> label={t('trainingWeek')} value={game.training} onChange={store.setTraining} options={(Object.keys(TRAINING) as TrainingFocus[]).map((k) => ({ value: k, label: trainingLabel(k) }))} />
            <p className="help">{trainingBlurb(game.training)}</p>
          </div>
          )}
          {on('set-pieces') && (
          <div className="panel">
            <h3>{t('setPieces')}</h3>
            <div className="instructions">
            {(
              [
                { key: 'penalties', label: t('penalties'), attr: (p: { attributes: { shooting: number; mentality: number } }) => Math.round((p.attributes.shooting + p.attributes.mentality) / 2), hint: t('penaltiesHint') },
                { key: 'freeKicks', label: t('freeKicks'), attr: (p: { attributes: { shooting: number } }) => p.attributes.shooting, hint: t('freeKicksHint') },
                { key: 'corners', label: t('corners'), attr: (p: { attributes: { passing: number } }) => p.attributes.passing, hint: t('cornersHint') },
              ] as const
            ).map((sp) => {
              const xi = Object.values(game.lineup)
                .map((id) => get(id))
                .filter((p): p is NonNullable<typeof p> => !!p && p.positions[0] !== 'GK')
                .sort((a, b) => sp.attr(b) - sp.attr(a))
              const current = tac.setPieces?.[sp.key] ?? ''
              return (
                <Instruction key={sp.key} label={sp.label} help={sp.hint}>
                  <select className="input" aria-label={t('takerLabel', { label: sp.label })} value={current} onChange={(e) => store.setTactics({ setPieces: { ...tac.setPieces, [sp.key]: e.target.value || undefined } })}>
                    <option value="">{t('autoBest')}</option>
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
                <h3>{t('roles')}</h3>
                <Info label={t('aboutRoleFit')}>{t('roleFitInfo')}</Info>
              </span>
              <span className="role-head-meta">
                {familiarity !== null && (
                  <span className="role-fam" data-testid="team-familiarity" title={t('famTip')}>
                    <span className="small muted">{t('familiarity', { v: Math.round(familiarity) })}</span>
                    <Bar value={familiarity} colour="var(--meter-mid)" />
                  </span>
                )}
                <span className="small muted">{t('teamValue', { v: strength.overall.toFixed(1) })}</span>
              </span>
            </div>
            <div className="role-list">
              {formation.slots.map((slot) => {
                const id = game.lineup[slot.id]
                const p = id ? get(id) : undefined
                const roleId = tac.roles[slot.id] ?? DEFAULT_ROLE[slot.position]
                const role = getRole(roleId)
                const ev = strength.slots.find((s) => s.slotId === slot.id)
                const st = id ? game.squad[id] : undefined
                const fit = ev && p ? roleFit(ev.effective, p.overall) : null
                return (
                  <div key={slot.id} className="role-row">
                    <Pos p={slot.position} />
                    <span className="role-who">
                      <span className="role-name">
                        {p ? p.name : <span className="muted">{t('empty')}</span>}
                        {fit && (
                          <span className={`chip ${fit === 'suits' ? 'good' : fit === 'fair' ? 'warn' : 'bad'}`} data-testid="role-fit" title={t('fitTip', { now: Math.round(ev!.effective), overall: p!.overall })}>
                            {ROLE_FIT_LABEL[fit]}
                          </span>
                        )}
                      </span>
                      {st && (
                        <span className="role-fam-bar" title={t('famBarTip', { v: meterValue(st.familiarity) })}>
                          <Bar value={st.familiarity} colour="var(--meter-mid)" />
                        </span>
                      )}
                      <span className="role-pick">
                        <select className="input" aria-label={t('roleFor', { pos: slot.position })} title={roleBlurb(role)} value={roleId} onChange={(e) => store.setRole(slot.id, e.target.value)}>
                          {roleOptions(p, slot.position).map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.rating === null ? roleName(r) : `${roleName(r)} · ${r.rating}`}
                            </option>
                          ))}
                        </select>
                        <Info label={t('aboutName', { name: roleName(role) })}>{roleBlurb(role)}</Info>
                      </span>
                    </span>
                    {ev ? (
                      <span className="role-rating" title={t('ratingInRole')}>
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
        <span id={id}>{label}</span> <Info label={t('aboutLower', { label: label.toLowerCase() })}>{help}</Info>
      </span>
      {children}
    </div>
  )
}

export function CupTab({ comp }: { comp: Competition }) {
  const { universe: u, game } = useStorePick('universe', 'game')
  if (!u || !game?.season) return null
  const season = game.season
  // Engine 7's Continental Cup: groups, then two-legged knockouts from the quarter-finals; an engine 6 one plays on as drawn
  const groups = comp === 'continental' ? season.continental?.groups : undefined
  const plan = groups ? continentalPlan(season.matchweeks) : null
  const rounds = plan ? plan.rounds : roundsFor(comp, season.matchweeks)
  const allTies = comp === 'cup' ? season.cup : season.continental?.ties ?? []
  const eliminated = comp === 'cup' ? season.cupEliminated : !!season.continental?.eliminated
  const won = comp === 'cup' ? season.cupWon : !!season.continental?.won
  const field = comp === 'continental' ? Object.values(season.continental?.clubs ?? {}) : []
  return (
    <div className="panel">
      <div className="panel-head">
        <span className="head-title">
          <h3>{t(comp === 'cup' ? 'theCup' : 'continentalCup')}</h3>
          <Info label={t('aboutComp')}>
            {plan
              ? t('compInfoGroups', { groupWeeks: plan.groupWeeks.join(', '), qf1: plan.rounds[0].firstLeg, qf2: plan.rounds[0].afterMatchweek, sf1: plan.rounds[1].firstLeg, sf2: plan.rounds[1].afterMatchweek, final: plan.rounds[2].afterMatchweek })
              : t('compInfo', { comp: comp === 'cup' ? 'cup' : 'continental', weeks: rounds.map((r) => r.afterMatchweek).join(', ') })}
            {comp === 'continental' ? t('compAgain') : ''}
          </Info>
        </span>
        <span className="small muted">{t(plan ? 'clubsGroups' : 'clubsRounds')}</span>
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
      {groups && (
        <div style={{ marginBottom: 12 }}>
          <GroupTables groups={seasonGroupViews(groups)} nameOf={(id) => (id === USER_TEAM ? game.settings.teamName : clubName(u, id))} badge={(id) => (id === USER_TEAM ? <TeamBadge code={game.settings.shortName} size={16} /> : <ClubBadge clubId={id} size={16} />)} userId={USER_TEAM} testId="season-groups" />
        </div>
      )}
      <Bracket
        view={seasonCupBracket(allTies, rounds, plan?.groupWeeks.at(-1))}
        nameOf={(id) => (id === USER_TEAM ? game.settings.teamName : clubName(u, id))}
        badge={(id) => (id === USER_TEAM ? <TeamBadge code={game.settings.shortName} size={18} /> : <ClubBadge clubId={id} size={18} />)}
        userId={USER_TEAM}
        trophy={comp}
        testId={`season-bracket-${comp}`}
        tieTestId="cup-tie"
        meTestId="cup-tie"
      />
      {eliminated && <div className="notice warn">{t('knockedOut')}</div>}
      {won && (
        <div className="notice icon-notice gold">
          {comp === 'cup' ? <Medal size={18} aria-hidden="true" /> : <Globe size={18} aria-hidden="true" />} {t(comp === 'cup' ? 'cupWinners' : 'contChampions')}
        </div>
      )}
    </div>
  )
}

/** Listings a phone shows before "Show all" (styles.css hides the rest under 720 px; a desktop's box scrolls them all). */
export const PHONE_LISTINGS = 8

/** A listing against the club: the fee and wage it cannot pay, and what he would be at his position (r8). */
function FitChips({ game, u, listing }: { game: Game; u: LoadedUniverse; listing: Listing }) {
  const fit = listingFit(game, u, listing)
  if (!fit) return null
  return (
    <>
      {!fit.fee && <span className="chip warn" data-testid="fit-fee">{t('overBudget')}</span>}
      {!fit.wages && <span className="chip warn" data-testid="fit-wage">{t('noWageRoom')}</span>}
      {fit.upgrade !== null && fit.upgrade > 0 && (
        <span className="chip good" data-testid="fit-upgrade" title={t(fit.estimate ? 'marketEstimateTip' : 'marketFitTip')}>
          {t('fitUpgrade', { n: fit.upgrade, pos: fit.position, est: fit.estimate ? 'yes' : 'no' })}
        </span>
      )}
      {fit.upgrade !== null && fit.upgrade <= 0 && fit.rank !== null && (
        <span className="chip" data-testid="fit-rank" title={t(fit.estimate ? 'marketEstimateTip' : 'marketFitTip')}>
          {t('fitRank', { rank: fit.rank, pos: fit.position })}
        </span>
      )}
    </>
  )
}

function MarketTab({ boxes }: { boxes: Boxes }) {
  const store = useStorePick('universe', 'game', 'acceptOffer', 'advanceDay', 'bid', 'enquire', 'loan', 'rejectOffer', 'scoutPlayer', 'shortlist')
  const { universe: u, game } = store
  const [bids, setBids] = useState<Record<string, number>>({})
  const [years, setYears] = useState<Record<string, number>>({})
  const [statuses, setStatuses] = useState<Record<string, SquadStatus>>({})
  const [exchange, setExchange] = useState<Record<string, string>>({})
  const [sellOn, setSellOn] = useState<Record<string, number>>({})
  const [filter, setFilterState] = useState<'all' | Position>('all')
  // r8: only the men the club can pay for, and the order (by overall, or by how much each improves his position)
  const [affordOnly, setAffordOnly] = useState(false)
  const [sortBy, setSortBy] = useState<ListingSort>('overall')
  // On a phone the window lists its first few men until "Show all" (40 stacked listings ran to 18,000 px in January)
  const [allListed, setAllListed] = useState(false)
  // "Show all" goes once pressed: the focus moves on to the first listing it brought into view
  const listingsRef = useRef<HTMLDivElement>(null)
  const showAllListed = () => {
    setAllListed(true)
    window.setTimeout(() => listingsRef.current?.children[PHONE_LISTINGS]?.querySelector<HTMLElement>(FOCUSABLE)?.focus(), 0)
  }
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
          <h3>{t('shortlist')}</h3>
          <Info label={t('aboutShortlist')}>{t('shortlistInfo')}</Info>
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
                  {w && listed ? (listed.status === 'signed' ? t('signed') : listed.status === 'gone' ? t('gone') : money(listed.asking)) : (
                    <>
                      <Star size={14} aria-hidden="true" /> {t('report')}
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
            <Info label={t('aboutWindows')}>{t('windowsInfo')}</Info>
          </div>
          {shortlistPanel}
          {boxes.on('values') && (
          <div className="panel">
            <h3>{t('squadValues')}</h3>
            <div className="tbl-wrap"><table className="tbl contracts">
              <thead>
                <tr>
                  <th>{t('player')}</th>
                  <th className="num">{t('value')}</th>
                  <th className="num">{t('wageCol')}</th>
                  <th className="num" title={t('yrsTip')}>{t('yrs')}</th>
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
                      <td className="num">{game.contracts[x.p.id]?.loan ? t('loan') : t('years', { n: game.contracts[x.p.id]?.years ?? 1 })}</td>
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
  const listings = sortListings(game, u, w.listings.filter((l) => l.status === 'available' || l.status === 'bidding').filter((l) => filter === 'all' || get(l.playerSeasonId)?.positions.includes(filter)).sort((a, b) => (get(b.playerSeasonId)?.overall ?? 0) - (get(a.playerSeasonId)?.overall ?? 0)), { affordable: affordOnly, sort: sortBy })
  const offers = w.offers.map((o, i) => ({ o, i })).filter(({ o }) => o.status === 'open')
  return (
    <div className="grid dugout">
      <div className="panel">
        <div className="panel-head">
          <h3>
            {t('windowHead', { kind: w.kind === 'summer' ? 'summer' : 'january', day: w.day + 1, days: w.days })}
            {w.day >= w.days - 1 ? t('deadlineSuffix') : ''}
          </h3>
          <div className="toolbar">
            <WindowChip w={w} />
            <span className="chip info">{t('budgetChip', { m: money(game.finances.budget) })}</span>
            <span className="chip">{t('wageRoom', { w: wage(Math.max(0, game.finances.wageCap - squad.reduce((s, x) => s + x.p.wage, 0) - staffWages(game.staff))) })}</span>
            <button className="btn sm" onClick={() => store.advanceDay()}>
              {t('nextDay')}
            </button>
          </div>
        </div>
        {windowCountdown(w).last && tickerLines(w).length > 0 && (
          <div className="deadline-ticker" data-testid="deadline-ticker" role="group" aria-label={t('deadlineLabel')}>
            <span className="deadline-tag">{t('deadlineDay')}</span>
            <span className="deadline-track">
              <span className="deadline-run">{tickerLines(w).join('  ·  ')}</span>
            </span>
          </div>
        )}
        {msg && <div className="notice" style={{ marginBottom: 'var(--space-2)' }}>{msg}</div>}
        <Tip id="market-first">{t('marketTip')}</Tip>
        <div className="segmented scroll" style={{ marginBottom: 'var(--space-3)' }}>
          {(['all', 'GK', 'CB', 'LB', 'RB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST'] as const).map((p) => (
            <button key={p} className={filter === p ? 'active' : ''} onClick={() => setFilter(p)}>
              {p === 'all' ? t('all') : p}
            </button>
          ))}
        </div>
        <div className="toolbar" style={{ marginBottom: 'var(--space-3)' }} data-testid="market-sort">
          <button type="button" className={`chip-btn ${affordOnly ? 'active' : ''}`} aria-pressed={affordOnly} onClick={() => setAffordOnly((v) => !v)} data-testid="market-affordable">
            {t('affordableOnly')}
          </button>
          <button type="button" className={`chip-btn ${sortBy === 'upgrade' ? 'active' : ''}`} aria-pressed={sortBy === 'upgrade'} onClick={() => setSortBy((v) => (v === 'upgrade' ? 'overall' : 'upgrade'))} title={t('byUpgradeTip')} data-testid="market-upgrade">
            {t('byUpgrade')}
          </button>
          {affordOnly && !listings.length && <span className="small muted">{t('nothingAffordable')}</span>}
        </div>
        <div ref={listingsRef} className={`col listings ${!allListed && listings.length > PHONE_LISTINGS ? 'capped' : ''}`} style={{ gap: 'var(--space-2)' }} data-testid="listings">
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
                    <FitChips game={game} u={u} listing={l} />
                    {l.tags.map((t) => (
                      <span key={t} className={`chip ${t === 'Bidding war' || t === 'Annoyed' || t === 'Unsolicited approach' ? 'warn' : t === 'Deadline discount' || t === 'Loan available' || t === 'Scouted' ? 'good' : ''}`}>
                        {t}
                      </span>
                    ))}
                    {rangeOf(p) && (
                      <button type="button" className="chip-btn" data-testid="listing-scout" disabled={!canFullScout(game)} title={t(canFullScout(game) ? 'fullScoutTip' : 'scoutBusy')} onClick={() => setMsg(store.scoutPlayer(p.id).message)}>
                        {t('scout')}
                      </button>
                    )}
                    {scout > 0 &&
                      traitTags(p.traits).map((tag) => (
                        <span key={tag} className="chip" style={{ borderStyle: 'dashed' }} title={t('scoutingReport')}>
                          {tag}
                        </span>
                      ))}
                    {l.suitors > 0 && <span className="chip">{t('rivals', { n: l.suitors })}</span>}
                    {l.response && <span className="chip">{l.response}</span>}
                  </div>
                  <div className="bidrow">
                    <input className="input" type="number" min={0.1} step={0.5} value={bid} onChange={(e) => setBids({ ...bids, [l.playerSeasonId]: Number(e.target.value) })} aria-label={t('bidLabel', { name: p.name })} />
                    <span className="small muted">{t('millions')}</span>
                    <button
                      className="btn sm primary"
                      onClick={() => {
                        const out = store.bid(l.playerSeasonId, bid, { years: years[l.playerSeasonId], status: offered, exchangeId: exchange[l.playerSeasonId] || undefined, sellOn: sellOn[l.playerSeasonId] || undefined })
                        setMsg(out.message)
                      }}
                    >
                      {t('bid')}
                    </button>
                    <button className="btn sm" onClick={() => setBids({ ...bids, [l.playerSeasonId]: Math.round(l.asking * 0.9 * 10) / 10 })}>
                      −10%
                    </button>
                    <NegotiateButton listingId={l.playerSeasonId} name={p.name} />
                    <select className="input" value={years[l.playerSeasonId] ?? defaultBidYears(p.age)} onChange={(e) => setYears({ ...years, [l.playerSeasonId]: Number(e.target.value) })} title={t('contractLength')}>
                      {bidYearChoices(p.age).map((y) => (
                        <option key={y} value={y}>
                          {t('yearDeal', { n: y })}
                        </option>
                      ))}
                    </select>
                    <select className="input" data-testid="bid-status" value={offered} onChange={(e) => setStatuses({ ...statuses, [l.playerSeasonId]: e.target.value as SquadStatus })} title={t('statusTip')}>
                      {STATUSES.map((st) => (
                        <option key={st} value={st}>
                          {STATUS_LABEL[st]} · {wage(Math.round(p.wage * WAGE_MULT[st]))}
                        </option>
                      ))}
                    </select>
                    <select className="input" value={exchange[l.playerSeasonId] ?? ''} onChange={(e) => setExchange({ ...exchange, [l.playerSeasonId]: e.target.value })} title={t('exchangeTip')}>
                      <option value="">{t('cashOnly')}</option>
                      {squad
                        .filter((x) => !game.contracts[x.p.id]?.loan)
                        .sort((a, b) => b.p.overall - a.p.overall)
                        .map((x) => (
                          <option key={x.p.id} value={x.p.id}>
                            + {x.p.name} ({x.p.overall})
                          </option>
                        ))}
                    </select>
                    <select className="input" value={sellOn[l.playerSeasonId] ?? 0} onChange={(e) => setSellOn({ ...sellOn, [l.playerSeasonId]: Number(e.target.value) })} title={t('sellOnTip')} data-testid="bid-sell-on">
                      {SELL_ON_OPTIONS.map((pct) => (
                        <option key={pct} value={pct}>
                          {pct ? t('sellOnPct', { pct: Math.round(pct * 100), m: money(sellOnValue(p, pct)) }) : t('noSellOn')}
                        </option>
                      ))}
                    </select>
                    {l.loanFee !== undefined && (
                      <button className="btn sm" onClick={() => setMsg(store.loan(l.playerSeasonId).message)} title={t('loanTip')}>
                        {t('loanFor', { m: money(l.loanFee) })}
                      </button>
                    )}
                  </div>
                </div>
                <div>
                  <div className="price">{money(l.asking)}</div>
                  <div className="small muted" style={{ textAlign: 'right' }}>
                    {t('asking', { was: l.asking !== l.opening ? t('was', { m: money(l.opening) }) : '' })}
                  </div>
                </div>
              </div>
            )
          })}
          {listings.length === 0 && <div className="muted">{t('nothingListed')}</div>}
        </div>
        {!allListed && listings.length > PHONE_LISTINGS && (
          <button type="button" className="btn block listings-more" onClick={showAllListed} data-testid="listings-more">
            {t('showAll', { n: listings.length, pos: filter === 'all' ? '' : t('atPos', { pos: filter }) })}
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
              <h3>{t('approachAny')}</h3>
              <Info label={t('aboutApproaches')}>{t('approachInfo')}</Info>
            </span>
            {focusActive(game.recruitFocus) && (
              <button type="button" className="btn sm" aria-expanded={approach} onClick={() => setApproach((v) => !v)} data-testid="approach-toggle">
                {t(approach ? 'hide' : 'search')}
              </button>
            )}
          </div>
          {(approach || !focusActive(game.recruitFocus)) && (
            <>
              <input className="input" aria-label={t('searchPlayers')} placeholder={t('searchPlaceholder')} value={query} onChange={(e) => setQuery(e.target.value)} />
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
                      right={<span className="btn sm">{t('enquire')}</span>}
                    />
                  ))}
                </div>
              )}
              {query.trim().length >= 2 && results.length === 0 && <div className="small muted" style={{ marginTop: 'var(--space-2)' }}>{t('noOne')}</div>}
            </>
          )}
        </div>
        )}
        {shortlistPanel}
        <div className="panel">
          <h3>{t('offersTitle')}</h3>
          {offers.length === 0 && <div className="muted small">{t('noOffers')}</div>}
          <div className="col" style={{ gap: 'var(--space-2)' }}>
            {offers.map(({ o, i }) => {
              const p = get(o.playerSeasonId)
              if (!p) return null
              return (
                <div key={i} className="card">
                  <div className="row between wrap">
                    <span>
                      {rich(t('offerLine', { club: clubName(u, o.fromClubId), m: money(o.amount), name: p.name }), { b: (c) => <b>{c}</b> })} <Rating value={p.overall} />
                    </span>
                    <span className="row">
                      <button className="btn sm primary" onClick={() => store.acceptOffer(i)}>
                        {t('accept')}
                      </button>
                      <button className="btn sm" onClick={() => store.rejectOffer(i)}>
                        {t('reject')}
                      </button>
                      <CounterBidControl index={i} name={p.name} />
                    </span>
                  </div>
                  <div className="small muted">{t('valueDay', { m: money(p.value), day: o.day })}</div>
                </div>
              )
            })}
          </div>
        </div>
        {doneDeals(w).length > 0 && boxes.on('done-deals') && (
          <div className="panel" data-testid="done-deals">
            <div className="panel-head">
              <h3>{t('doneDeals')}</h3>
              <span className="small muted">{t('windowKind', { kind: w.kind === 'summer' ? 'summer' : 'january' })}</span>
            </div>
            <div className="col small" style={{ gap: 4 }}>
              {doneDeals(w).map((d) => {
                const p = get(d.playerSeasonId)
                return (
                  <div key={d.dir + d.playerSeasonId} className="row between" style={{ gap: 'var(--space-2)' }}>
                    <span className="row" style={{ gap: 6, minWidth: 0 }}>
                      <span className={`chip ${d.dir === 'in' ? 'good' : 'info'}`}>{t(d.dir === 'in' ? 'dealIn' : 'dealOut')}</span>
                      <span className="one-line">{p?.name ?? t('aPlayer')}{d.clubId ? t('toClub', { club: clubShort(u, d.clubId) }) : ''}</span>
                    </span>
                    <span className="mono">{d.loan ? t('loanFee', { m: money(d.fee) }) : money(d.fee)}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
        {boxes.on('log') && (
        <div className="panel">
          <h3>{t('marketLog')}</h3>
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
  const store = useStorePick('universe', 'game', 'hireStaff', 'release', 'setStatus')
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
    { track: 'minmax(0, 1.5fr)', ids: ['contracts', 'legends', 'history', 'achievements'] },
  ])
  const col1 = on('board') || on('requests')
  const col2 = on('finances') || on('staff')
  const col3 = on('contracts') || (on('legends') && !!game.careerStats && Object.keys(game.careerStats).length > 0) || (on('history') && game.history.length > 0) || on('achievements')
  const verdict = lastVerdict(game.history)
  return (
    <div className={`grid three fill squad-views club-grid3 ${grid.className}`} style={grid.style} data-testid="club-tab">
      {col1 && (
      <div className="col">
      {on('board') && (
      <div className="panel">
        <h3>{t('board')}</h3>
        <dl className="kv tight">
          <dt>{t('youReplace')}</dt>
          <dd data-testid="you-replace">
            <span className="row" style={{ gap: 6 }}>
              <ClubBadge clubId={season.hostClubId} size={20} /> {clubName(u, season.hostClubId)}
            </span>
          </dd>
          <dt>{t('expectation')}</dt>
          <dd>{t('finishOrBetter', { pos: season.boardTarget })}</dd>
          {verdict && (
            <>
              <dt>{boardLastLabel()}</dt>
              <dd data-testid="board-last" className={verdict.met ? 'res-w' : 'res-l'}>{boardLastLine(verdict.target, verdict.position, verdict.met)}</dd>
            </>
          )}
          <dt>{t('current')}</dt>
          <dd>{season.matchweek ? ordinal(positionOf(table, USER_TEAM)) : t('preseason')}</dd>
          <dt>{t('confidence')}</dt>
          <dd>{t('outOf100', { n: Math.round(season.confidence) })}</dd>
          <dt>{t('jobSecurity')}</dt>
          <dd>{t(game.settings.jobSecurity ? 'jobOn' : 'off')}</dd>
          <dt>{t('league')}</dt>
          <dd><LeagueFlag leagueId={season.leagueId} /> {t('leagueWeeks', { league: u.leagues.find((l) => l.id === season.leagueId)?.name ?? season.leagueId, n: season.matchweeks })}</dd>
          <dt>{t('rivalsLabel')}</dt>
          <dd>{host?.rivals.map((r) => clubName(u, r)).join(', ') || t('none')}</dd>
          <dt>{t('difficulty')}</dt>
          <dd title={season.aiOffset > 0 ? t('diffTip', { n: season.aiOffset }) : t('diffReal')}>{season.aiOffset > 0 ? t('calibrated', { n: season.aiOffset }) : t('realistic')}</dd>
        </dl>
        {season.objectives && season.objectives.length > 0 && (
          <>
            <h4 className="head-title" style={{ marginTop: 'var(--space-4)' }}>
              {t('boardObjectives')} <Info label={t('aboutObjectives')}>{t('objectivesInfo', { m: OBJECTIVE_REWARD.budget })}</Info>
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
                        {t(decided ? (ok ? 'met' : 'missed') : ok ? 'onTrack' : 'notYet')}
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
            <h3>{t('finances')}</h3>
            <Info label={t('aboutFinances')}>{t('financesInfo')}</Info>
          </span>
        </div>
        <dl className="kv tight ledger">
          <dt>{t('transferBudget')}</dt>
          <dd>{money(game.finances.budget)}</dd>
          <dt>{t('wageBill')}</dt>
          <dd>
            {t('wageBillOf', { bill: wage(wages), cap: wage(game.finances.wageCap), staff: staffWages(game.staff) ? t('staffPart', { w: wage(staffWages(game.staff)) }) : '' })}
          </dd>
          <dt>{t('incomeSeason')}</dt>
          <dd>{money(game.finances.income)}</dd>
          <dt>{t('spentFees')}</dt>
          <dd>{money(game.finances.spent)}</dd>
          <dt>{t('wagesPaid')}</dt>
          <dd>{money(game.finances.wagesPaid)}{game.finances.bonusesPaid ? t('bonusesPart', { m: money(game.finances.bonusesPaid) }) : ''}</dd>
        </dl>
        <WageSlider onMessage={setClubMsg} />
      </div>
      )}
      {on('staff') && (
      <div className="panel">
        <div className="panel-head">
          <span className="head-title">
            <h3>{t('backroomStaff')}</h3>
            <Info label={t('aboutStaff')}>{t('staffInfo')}</Info>
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
                  <b>{staffLabel(role)}</b>
                  <span className="small muted">{staffTierTitle(role, tier)}</span>
                </div>
                <div className="segmented" style={{ marginTop: 'var(--space-2)' }}>
                  {info.tiers.map((x) => (
                    <button key={x.tier} className={x.tier === tier ? 'active' : ''} onClick={() => store.hireStaff(role, x.tier)} title={staffTierBlurb(role, x.tier)}>
                      {x.tier === 0 ? t('tierNone') : t(x.tier === 1 ? 'tierGood' : 'tierElite', { w: wage(x.wage) })}
                    </button>
                  ))}
                </div>
                <div className="small muted one-line" style={{ marginTop: 'var(--space-1)' }} title={staffTierBlurb(role, tier)}>{staffTierBlurb(role, tier)}</div>
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
            <h3>{t('contracts')}</h3>
            <Info label={t('aboutPlayingTime')}>{t('playingTimeInfo')}</Info>
          </span>
        </div>
        <div className="tbl-wrap"><table className="tbl contracts">
          <thead>
            <tr>
              <th>{t('player')}</th>
              <th className="num">{t('age')}</th>
              <th className="num">{t('yearsCol')}</th>
              <th>{t('status')}</th>
              <th className="num" title={t('minsShareTip')}>{t('minsCol')}</th>
              <th>{t('morale')}</th>
              <th className="end" aria-label={t('release')} title={t('release')} />
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
                      <button type="button" className="link-btn name" title={t('detailsTalks', { name: x.p.name })} onClick={() => onPlayer(x.p.id)} data-testid="contract-name">
                        {x.p.name}
                      </button>
                    </PlayerPeek>
                    {game.contracts[x.p.id]?.shopped && <span className="chip warn" title={t('shoppedTip')}>{t('shopped')}</span>}
                    {game.contracts[x.p.id]?.expired && <span className="chip warn" title={t('talksTip')}>{t('talks')}</span>}
                  </span>
                </td>
                <td className="num">{x.p.age}</td>
                <td className="num" title={game.contracts[x.p.id]?.clauses?.release ? t('releaseClause', { m: game.contracts[x.p.id]!.clauses!.release }) : undefined}>{game.contracts[x.p.id]?.years ?? 1}{game.contracts[x.p.id]?.clauses?.release ? '*' : ''}</td>
                <td>
                  <select className="input sm" data-testid="status-select" value={status} onChange={(e) => store.setStatus(x.p.id, e.target.value as SquadStatus)} title={t('statusSelectTip')}>
                    {STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {STATUS_LABEL[st]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="num" title={t('shareTip', { status: STATUS_LABEL[status].toLowerCase(), pct: Math.round(EXPECTED_SHARE[status] * 100) })}>
                  {share === null ? '–' : <span style={share < EXPECTED_SHARE[status] - 0.15 ? { color: 'var(--danger)' } : undefined}>{Math.round(share * 100)}%</span>}
                </td>
                <td>{moraleWord(x.s.morale)}</td>
                <td className="end">
                  <button className="btn sm ghost danger icon-only" aria-label={t('releaseName', { name: x.p.name })} title={t('releaseTip')} onClick={() => void askConfirm(t('releaseConfirm', { name: x.p.name }), { ok: t('releaseOk'), danger: true }).then((ok) => { if (ok) store.release(x.p.id) })}>
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
            <h3>{t('clubLegends')}</h3>
            <span className="small muted">{t('allSeasons')}</span>
          </div>
          <LegendsTable game={game} u={u} labels={{ player: t('player'), seasons: t('seasonsCol'), apps: t('appsCol'), goals: t('goalsCol'), assists: t('assistsCol'), motm: t('motmCol'), titles: t('titlesCol') }} />
        </div>
      )}
      {on('history') && game.history.length > 0 && <ClubHistory game={game} u={u} />}
      {on('achievements') && (
      <div className="panel">
        <h3>{t('achievementsGame')}</h3>
        {unlockedNames(game.unlocked).length === 0 && <div className="muted small">{t('noneYet')}</div>}
        <div className="pill-list">
          {unlockedNames(game.unlocked).map((a) => (
            <span key={a.id} className="chip gold" title={a.text}>
              {a.title}
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
  const store = useStorePick('universe', 'game', 'boardRequest')
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
            <Landmark size={18} aria-hidden="true" /> {t('requests')}
          </h3>
          <Info label={t('aboutRequests')}>{t('requestsInfo', { conf: REQUEST_CONFIDENCE, gap: REQUEST_GAP })}</Info>
        </span>
        <span className={`chip ${confident ? 'good' : 'warn'}`}>{t('confidenceN', { n: Math.round(season.confidence) })}</span>
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
            <button className="btn sm" disabled={wait !== null} onClick={() => onMessage(store.boardRequest(o.kind).message)} title={wait !== null ? t('nextRequest', { week: wait - 1 }) : t(confident && o.conditionMet ? 'willGrant' : 'willRefuse')}>
              {t('ask')}
            </button>
          </div>
        ))}
      </div>
      {wait !== null && <div className="small muted" style={{ marginTop: 'var(--space-2)' }}>{t('nextRequestDot', { week: wait - 1 })}</div>}
      {(season.requests ?? []).length > 0 && (
        <div className="small muted" style={{ marginTop: 'var(--space-2)' }}>
          {t('thisSeason', { list: season.requests!.map((r) => t('requestLine', { kind: r.kind, ok: r.accepted ? 'yes' : 'no', week: r.mw })).join(', ') })}
        </div>
      )}
    </div>
  )
}

/** The wage-to-transfer slider: each step moves £10k a week of wage cap against £2M of budget. */
function WageSlider({ onMessage }: { onMessage: (m: string) => void }) {
  const store = useStorePick('universe', 'game', 'shiftWages')
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
          <b className="small">{t('wagesTransfers')}</b>
          <Info label={t('aboutSlider')}>{t('sliderInfo', { wage: SHIFT_WAGE, budget: SHIFT_BUDGET, limit: SHIFT_LIMIT })}</Info>
        </span>
        <span className="small mono">{net === 0 ? t('level') : net > 0 ? t('plusBudget', { m: money(net * SHIFT_BUDGET) }) : t('plusWages', { w: wage(-net * SHIFT_WAGE) })}</span>
      </div>
      <div className="row" style={{ gap: 'var(--space-2)' }}>
        <button type="button" className="btn sm ghost" aria-label={t('budgetIntoWages')} onClick={() => move(net - 1)}>
          −
        </button>
        <input type="range" min={-SHIFT_LIMIT} max={SHIFT_LIMIT} step={1} value={net} aria-label={t('balance')} onChange={(e) => move(Number(e.target.value))} data-testid="wage-range" />
        <button type="button" className="btn sm ghost" aria-label={t('wagesIntoBudget')} onClick={() => move(net + 1)} data-testid="wage-to-budget">
          +
        </button>
      </div>
      <div className="small muted">{t('wageRoomLine', { w: wage(Math.max(0, wageRoom(game, u))) })}</div>
    </div>
  )
}

/**
 * A dressing-room decision waiting on the manager, inline above the tabs. On a desktop it is one compact strip (the
 * title, the story cut to fit, the choices with their hints as tooltips, on one line when they fit) so the squad list
 * keeps its rows; "More" opens the whole story and each choice's hint. A phone shows it whole, as the page scrolls.
 */
function EventCard() {
  const store = useStorePick('universe', 'game', 'resolveEvent')
  const { universe: u, game } = store
  const [open, setOpen] = useState(false)
  if (!u || !game?.pendingEvent) return null
  const ev = game.pendingEvent
  const get = playerLookup(game, u)
  const p = ev.playerSeasonId ? get(ev.playerSeasonId) : undefined
  const who = p ? t('eventWho', { name: p.name, positions: p.positions.join('/'), morale: moraleWord(game.squad[p.id]?.morale ?? 70).toLowerCase() }) : null
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
          {t(open ? 'less' : 'more')} <ChevronDown size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

function PlayerModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  const store = useStorePick('universe', 'game', 'assign', 'setCaptain', 'talk')
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
      <Modal open onClose={onClose} title={t('talksTitle', { name: p.name })} wide testId="talks-modal">
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
            <span className={`chip icon-chip ${p.overall > dev.base ? 'good' : 'warn'}`} title={t('ratingChangeTip')}>
              {p.overall > dev.base ? <TrendingUp size={12} aria-hidden="true" /> : <TrendingDown size={12} aria-hidden="true" />} {t('thisSeasonChange', { n: Math.abs(p.overall - dev.base) })}
            </span>
          )}
          {s && (
            <span className="chip info" data-testid="player-status" title={share === null ? t('noMinutes') : t('statusTipLong', { pct: Math.round(share * 100), weeks: RECENT_WEEKS, exp: Math.round(EXPECTED_SHARE[statusOf(game, p.id)] * 100) })}>
              {STATUS_LABEL[statusOf(game, p.id)]}
              {share === null ? '' : t('statusLately', { pct: Math.round(share * 100), exp: Math.round(EXPECTED_SHARE[statusOf(game, p.id)] * 100) })}
            </span>
          )}
          {s?.injury && <span className="chip bad">{t('injuryWk', { desc: s.injury.description, n: s.injury.weeksOut })}</span>}
          {s && (s.yellowCards > 0 || s.suspension > 0) && (
            <span className={`chip ${s.suspension ? 'bad' : 'warn'}`}>
              {t('yellows', { n: s.yellowCards })}
              {s.suspension ? t('suspendedN', { n: s.suspension }) : ''}
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
                    {t('startAt', { pos: sl.position })}
                  </button>
                ))}
              <button className="btn sm" onClick={() => { store.assign(p.id, 'bench'); onClose() }}>
                {t('toBench')}
              </button>
              <button className="btn sm" onClick={() => { store.setCaptain(p.id); onClose() }}>
                {t('makeCaptain')}
              </button>
            </span>
            {game.season && (
              <span className="pc-actions-group pc-talk">
                <span className="head-title">
                  <b>{t('haveWord')}</b>
                  <Info label={t('aboutConversations')}>{t('conversationsInfo')}</Info>
                </span>
                {talkMsg ? (
                  <span className="small pc-talk-msg" role="status">{talkMsg}</span>
                ) : game.talks?.[p.id] === game.season.matchweek ? (
                  <span className="small muted">{t('spokeThisWeek')}</span>
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
              { id: 'happiness', label: t('happiness'), content: <HappinessCard s={s} promises={promisesTo(game, u, p.id)} extra={<PromisesToHim id={p.id} />} /> },
              { id: 'contract', label: t('contract'), content: <ContractCard id={p.id} onTalks={() => setTalks(true)} /> },
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
