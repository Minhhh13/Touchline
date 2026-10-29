import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { runAfterPaint } from '../afterPaint'
import { Armchair, Ban, Calendar, Crosshair, Eye, EyeOff, FerrisWheel, Gift, Globe, Link, Map as MapIcon, Mountain, Package, PoundSterling, Scale, Shuffle, Skull, Smile, Snowflake, UserRound, Users } from 'lucide-react'
import { todaysDailySeed, slotOf } from '@game/store'
import { useStorePick } from '../useStorePick'
import { leagueGate } from '@game/logic/leagueLoad'
import { gateText, LeagueRetry } from '../components/LeagueRetry'
import type { GameSettings } from '@game/types'
import { DAILY_RULES, dailyLoaded, dailyPlan, defaultHostClub, setupRules, startFormation, summariseSetup } from '@game/logic/setup'
import { rememberTeamName, useTeamName } from '../teamName'
import { inLeague, leagueArticle, tidyLeagueArticles } from '@game/logic/leagueNames'
import { getFormation } from '@engine/formations'
import { wheelHasRoom } from '@game/logic/wheelCheck'
import { DIFFICULTY_RESPINS, QUICK_RULES, SEASON_RULES, modesOf, rulesTags, type DraftDifficulty, type DraftMode, type DraftRules, type QuickMode, type RatingsMode } from '@engine/draft'
import { MODE_CARDS, toggleModeCard, type ModeCard } from '@engine/modes'
import { POWER_UPS } from '@engine/powerups'
import { HoverTips, InfoTip } from '../components/PowerUpButton'
import { ruleChipNote } from '../ruleNotes'
import { ERA_PRESETS, eraCount, eraHandles, wheelSeasons, type EraPreset } from '@engine/era'
import { rulesFromPayload } from '@engine/challenge'
import { NATION_SLOT_COVER, NATION_SQUAD_MARGIN, nationCover, nationDepthFrom, nationDepthLabel } from '@engine/nations'
import { dailySeed, randomSeed } from '@engine/rng'
import { dailyRotation } from '@game/logic/onboarding'
import { poolClubSeasons } from '@engine/universe'
import { classicFromFor, classicFromIndex, eraFirstSeason, leagueSeasonChoices } from '@game/logic/era'
import { formationName, seasonLabel, tierName, formatLocale } from '../format'
import { ClubBadge, EstimatedChip, Segmented, Tip } from '../components/bits'
import { LeagueFlag, NationFlag, SuperLeagueMark } from '../components/Flag'
import { SUPER_LEAGUE_ID, SUPER_LEAGUE_NAME } from '@engine/superLeague'
import { SUPER_LEAGUE_LINE } from '@game/logic/superLeague'
import { Pitch } from '../components/Pitch'
import { FormationPicker } from '../components/FormationPicker'
import { ChoiceCards, type ChoiceOption, ModeCards, SeasonRange, SectionHead, TeamNameField } from '../components/SetupBits'
import { MODE_ICON, RULE_ICON } from '../components/icons'
import { clubName } from '../format'
import { dailyStartSettings } from '../../online/daily'
import { useOnline } from '../../online/state'
import { SignInPrompt } from '../online/SignInPrompt'
import { modeTitle } from '../i18n/modeText'
import { quickSetupLineFull } from '@game/logic/setupLine'
import { weeklyGameSettings, weeklyPlan, weeklySettings } from '@game/logic/weekly'
import { previousWeeklySeed, weeklySeed } from '@engine/rng'
import { weeklyRecord } from '@game/logic/weeklyRecord'
import { WeeklyRecordBox } from '../components/WeeklyRecordBox'
import { CapControl } from '../components/CapControl'
import { ChainToggle } from '../components/ChainControl'
import { CAP_NARROW_NOTE, CAP_PRESETS, DEFAULT_CAP_CHOICE, capBudget, capTotal, withCap, type CapChoice } from '@game/logic/cap'
import { askConfirm } from '../confirm'
import { translator } from '../i18n'
import { setup } from '../i18n/en/setup'
import { B, rich } from '../i18n/rich'
import { formationBlurb, modeCardInfo, modeCardLine, modeCardTitle, powerUpTitle, ruleChipsText } from '../i18n/engineText'
import { weeklyThemeLineText, weeklyThemeText } from '../i18n/weeklyThemeText'
import { logicLine, logicList } from '../i18n/logicText'

const t = translator(setup)

// The option cards are built at render time, so they read in the viewer's language
const respinWord = (n: number) => t('respins', { n })
const DIFFICULTY_OPTIONS = (): Array<ChoiceOption<DraftDifficulty>> => [
  { value: 'easy', icon: Smile, title: t('easy'), line: respinWord(DIFFICULTY_RESPINS.easy) },
  { value: 'normal', icon: Scale, title: t('normal'), line: respinWord(DIFFICULTY_RESPINS.normal) },
  { value: 'hard', icon: Skull, title: t('hard'), line: t('respinsBlind', { respins: respinWord(DIFFICULTY_RESPINS.hard) }) },
]
const RATINGS_SHOWN = (): Array<ChoiceOption<'on' | 'off'>> => [
  { value: 'on', icon: Eye, title: t('on'), line: t('seeRatings') },
  { value: 'off', icon: EyeOff, title: t('off'), line: t('namesOnly') },
]
const DRAFT_MODE_OPTIONS = (): Array<ChoiceOption<DraftMode>> => [
  { value: 'squad', icon: Users, title: t('squadFirst'), line: t('squadFirstLine') },
  { value: 'position', icon: Crosshair, title: t('positionFirst'), line: t('positionFirstLine') },
]
/** Quick Draft bench places: off, or up to five extra picks the season can bring on (three changes, plus injury cover). */
const BENCH_OPTIONS = (): Array<{ value: string; label: string }> => [{ value: '0', label: t('off') }, ...[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))]
/** Quick Draft managers: spin three and pick one, pick one of the real managers of the club-seasons drafted, or play without. */
const MANAGER_OPTIONS = (): Array<ChoiceOption<'spin' | 'pick' | 'off'>> => [
  { value: 'spin', icon: FerrisWheel, title: t('mgrSpin'), line: t('mgrSpinLine') },
  { value: 'pick', icon: UserRound, title: t('mgrPick'), line: t('mgrPickLine') },
  { value: 'off', icon: Ban, title: t('off'), line: t('mgrOffLine') },
]
const RATINGS_MODE_OPTIONS = (): Array<ChoiceOption<RatingsMode>> => [
  { value: 'season', icon: Calendar, title: t('season'), line: t('seasonLine') },
  { value: 'prime', icon: Mountain, title: t('prime'), line: t('primeLine') },
]

/** Whether this viewer last left More options open; a private window or blocked storage reads as closed. */
const ADVANCED_KEY = 'touchline-setup-advanced'
function readAdvanced(): boolean {
  try {
    return localStorage.getItem(ADVANCED_KEY) === '1'
  } catch {
    return false
  }
}
function writeAdvanced(open: boolean): void {
  try {
    localStorage.setItem(ADVANCED_KEY, open ? '1' : '0')
  } catch {
    // Storage blocked: the fold still works for this visit
  }
}

export function Setup() {
  const { universe: u, game, setupMode: mode, startGame, go, ensureLeagues, ensureClassic, classicLoaded, classicFailed, loadingLeagues, loadedLeagues, failedLeagues, pendingChallenge, profile } = useStorePick('universe', 'game', 'setupMode', 'startGame', 'go', 'ensureLeagues', 'ensureClassic', 'classicLoaded', 'classicFailed', 'loadingLeagues', 'loadedLeagues', 'failedLeagues', 'pendingChallenge', 'profile')
  const isDaily = mode === 'daily'
  const isManage = mode === 'season' || mode === 'dynasty'
  const modeBase: DraftRules = isManage ? SEASON_RULES : QUICK_RULES
  // Today's pinned ranked Daily, when the online layer has read it (the local mapping otherwise)
  const pin = useOnline((s) => (s.pins.day === new Date().toISOString().slice(0, 10) ? s.pins.daily : null))
  const [leagueId, setLeagueId] = useState('england')
  const [europe, setEurope] = useState(false)
  // An invented club name, or the one this viewer last typed (teamName.ts); the game logic's fallback stays Touchline XI
  const team = useTeamName()
  const [formationId, setFormationId] = useState('4-3-3')
  // The 38-0 options, each defaulting to the mode's base rules
  const [draftDifficulty, setDraftDifficulty] = useState<DraftDifficulty>(modeBase.difficulty ?? 'normal')
  const [showRatings, setShowRatings] = useState(true)
  const [draftMode, setDraftMode] = useState<DraftMode>('squad')
  const [ratingsMode, setRatingsMode] = useState<RatingsMode>('prime')
  const [eraPreset, setEraPreset] = useState<EraPreset>('all')
  const [customEra, setCustomEra] = useState<[number, number] | null>(null)
  // Classic seasons (1992-93 to 2007-08, estimated ratings): off unless asked for, never on the Daily
  const [classicOn, setClassicOn] = useState(false)
  // Quick Draft: the Super League (the 19 greatest club-seasons) in place of a real league season; its wheel spans every league
  const [superOn, setSuperOn] = useState(false)
  const [onlyClub, setOnlyClub] = useState('')
  const [onlyNation, setOnlyNation] = useState('')
  // Quick Draft: up to five bench places, optional (the draft may still stop at eleven)
  const [benchPicks, setBenchPicks] = useState(1)
  // Quick Draft modes (Crazy, Underdog, Legends, Speedrun); the Hard card is the difficulty above
  const [modes, setModes] = useState<Array<QuickMode | 'upgrader'>>([])
  // Quick Draft power-ups: the tray of six one-use power-ups on the draft screen
  const [powerUps, setPowerUps] = useState(false)
  // Quick Draft: a manager after the draft, spun from three reels unless switched to a pick or off
  const [managerChoice, setManagerChoice] = useState<'spin' | 'pick' | 'off'>('spin')
  const managers = managerChoice !== 'off'
  // Quick Draft: the end-of-draft case (a power-up for the locker, or a rare Icon), on unless switched off
  const [endCase, setEndCase] = useState(true)
  // Twists default on for a quick draft and off for a managed season; null means the default for the mode
  const [twistsChoice, setTwistsChoice] = useState<boolean | null>(null)
  // The casual rules: Moneyball's salary cap and the Teammate Chain (Quick Draft, Season and Dynasty)
  const [cap, setCap] = useState<CapChoice>(DEFAULT_CAP_CHOICE)
  const [chain, setChain] = useState(false)
  const [leagueSeason, setLeagueSeason] = useState(() => {
    if (!u) return 2025
    const complete = u.clubSeasons.filter((cs) => cs.complete).map((cs) => cs.season)
    return Math.max(...complete)
  })
  const [hostClubId, setHostClubId] = useState('')
  const [jobSecurity, setJobSecurity] = useState(true)
  const [playerPower, setPlayerPower] = useState(false)
  const [continental, setContinental] = useState(false)
  // Quick Draft: the season stops at the halfway mark for a January window unless switched off
  const [january, setJanuary] = useState(true)
  const [opposition, setOpposition] = useState<'calibrated' | 'realistic'>('calibrated')
  const [seed, setSeed] = useState(() => randomSeed())
  const [squadSize, setSquadSize] = useState(18)
  const [advanced, setAdvanced] = useState(readAdvanced)
  const moreRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLSelectElement>(null)
  // On a phone the start bar is fixed over the page, so the page's bottom padding follows the bar's measured height
  const barRef = useRef<HTMLDivElement>(null)
  const [barHeight, setBarHeight] = useState(0)
  useEffect(() => {
    const el = barRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setBarHeight(Math.ceil(el.getBoundingClientRect().height)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [u])
  // The week's challenge plays in the week's league (all seven on a European Nights week): load them on arrival
  useEffect(() => {
    if (u && mode === 'weekly') {
      const plan = weeklyPlan(u, weeklySeed())
      void ensureLeagues([plan.leagueId, ...plan.wheelLeagues])
    }
  }, [u, mode, ensureLeagues])
  // Today's Daily is drawn from the day's league (engine 7 rotates it, `dailyPlan`), and a ranked pin names its own: load them on arrival
  const pinLeague = isDaily ? pin?.settings.leagueId : undefined
  useEffect(() => {
    if (u && isDaily) {
      const plan = dailyPlan(todaysDailySeed())
      void ensureLeagues([...new Set([plan.leagueId, ...plan.wheelLeagues, ...(pinLeague ? [pinLeague] : [])])])
    }
  }, [u, isDaily, pinLeague, ensureLeagues])

  const superLeague = superOn && mode === 'quick'
  const wheelLeagues = useMemo(() => ((europe || superLeague) && u ? u.available.map((l) => l.id) : [leagueId]), [europe, superLeague, leagueId, u])
  // The toggle shows from the data index; the classic pack itself loads when it is switched on (packs.ts)
  const classicFrom = u ? classicFromFor(u, wheelLeagues) ?? classicFromIndex(u.available, wheelLeagues) : undefined
  const classic = !isDaily && classicOn && classicFrom !== undefined
  // The seasons to play in: every season the league has, the classic ones (tagged, their ratings estimated) when Classic is on
  const allSeasonChoices = useMemo(() => (u ? leagueSeasonChoices(u, leagueId) : []), [u, leagueId])
  const seasonChoices = useMemo(() => allSeasonChoices.filter((c) => classic || !c.classic), [allSeasonChoices, classic])
  const seasons = useMemo(() => seasonChoices.map((s) => s.season), [seasonChoices])
  const effectiveSeason = seasons.includes(leagueSeason) ? leagueSeason : seasons[seasons.length - 1] ?? leagueSeason
  const clubsInLeague = useMemo(() => (u ? u.clubSeasons.filter((cs) => cs.leagueId === leagueId && cs.season === effectiveSeason).map((cs) => cs.clubId).sort((a, b) => (u.clubById[a]?.name ?? a).localeCompare(u.clubById[b]?.name ?? b)) : []), [u, leagueId, effectiveSeason])
  // The era slider runs over the seasons the wheel leagues hold (classic ones only when the Classic toggle is on)
  const eraStops = useMemo(() => (u ? wheelSeasons(u, wheelLeagues, classic) : []), [u, wheelLeagues, classic])
  const first = eraStops[0] ?? u?.firstSeason ?? 2008
  const last = eraStops[eraStops.length - 1] ?? u?.lastSeason ?? 2026
  const [eraFrom, eraTo] = eraPreset === 'custom' && customEra ? customEra : eraHandles(eraPreset === 'custom' ? 'all' : eraPreset, first, last)
  const twists = twistsChoice ?? !!modeBase.twists
  const base: DraftRules = isManage ? { ...SEASON_RULES, squadSize } : QUICK_RULES
  // Everything the cards, the slider and the toggles say, as the rules Start will send (before the club and nation checks)
  const chosen = setupRules(base, { difficulty: draftDifficulty, showRatings, draftMode, ratings: isManage ? 'season' : ratingsMode, eraFrom, eraTo, first, last, twists, leagues: wheelLeagues, benchPicks: isManage ? 0 : benchPicks, modes: isManage ? [] : modes, powerUps: !isManage && powerUps, classic, superLeague, ...(isManage ? {} : { managers, managerSpin: managerChoice === 'spin', endCase: !isDaily && endCase }) })
  const eraRange = isDaily ? {} : { fromSeason: chosen.fromSeason, toSeason: chosen.toSeason, classic: chosen.classic }
  const eraLine = useMemo(() => (u ? eraCount(u, wheelLeagues, eraRange) : null), [u, wheelLeagues, eraRange.fromSeason, eraRange.toSeason, eraRange.classic])
  // Only clubs the wheel could actually land on: in a wheel league, with a squad inside the chosen era
  const allClubs = useMemo(() => {
    if (!u) return []
    const lo = eraRange.fromSeason ?? first
    const hi = eraRange.toSeason ?? last
    const inEra = new Set(poolClubSeasons(u, eraRange.classic).filter((cs) => cs.season >= lo && cs.season <= hi).map((cs) => cs.clubId))
    return [...u.clubs].filter((c) => wheelLeagues.includes(c.leagueId) && inEra.has(c.id)).sort((a, b) => a.name.localeCompare(b.name))
  }, [u, wheelLeagues, eraRange.fromSeason, eraRange.toSeason, eraRange.classic, first, last])
  // Nations deep enough for a one-nation draft of this shape: twice the cover for every position, inside the wheel leagues and era.
  // The scan over every player-season runs once per shape; the squad-size slider only re-filters it. The first scan
  // waits for the screen's first paint (about 190 ms on a 4x-throttled phone): the one-nation list is the only thing
  // that reads it, and a nation can be chosen only from that list
  const [scanOn, setScanOn] = useState(false)
  useEffect(() => {
    let live = true
    runAfterPaint(() => live && setScanOn(true))
    return () => {
      live = false
    }
  }, [])
  const nationScan = useMemo(() => (u && !isDaily && scanOn ? nationCover(u, wheelLeagues, eraRange, getFormation(formationId)) : []), [u, isDaily, scanOn, wheelLeagues, eraRange.fromSeason, eraRange.toSeason, eraRange.classic, formationId])
  const nations = useMemo(() => nationDepthFrom(nationScan, isManage ? squadSize : 11), [nationScan, isManage, squadSize])
  const leagueReady = loadedLeagues.includes(leagueId) && wheelLeagues.every((l) => loadedLeagues.includes(l)) && (!(isManage && continental) || !u || u.available.every((l) => loadedLeagues.includes(l.id)))
  // The club handed over by default sits nearest tenth in that season's real table, so the board's ask is reachable
  const defaultHost = useMemo(() => (u ? defaultHostClub(u, leagueId, effectiveSeason, clubsInLeague) : ''), [u, leagueId, effectiveSeason, clubsInLeague])
  const host = hostClubId && clubsInLeague.includes(hostClubId) ? hostClubId : defaultHost
  const hostRow = u?.tables[leagueId]?.[effectiveSeason]?.find((r) => r.clubId === host)

  if (!u) return <div className="page">{t('loading')}</div>
  const pickLeague = (id: string) => {
    // The Super League keeps the league chosen before it as the save's league; its field needs every league loaded
    if (id === SUPER_LEAGUE_ID) {
      setSuperOn(true)
      void ensureLeagues(u.available.map((l) => l.id))
      return
    }
    setSuperOn(false)
    setLeagueId(id)
    setHostClubId('')
    void ensureLeagues(europe ? u.available.map((l) => l.id) : [id])
  }
  const pickEurope = (on: boolean) => {
    setEurope(on)
    void ensureLeagues(on ? u.available.map((l) => l.id) : [leagueId])
  }
  const toggleAdvanced = (open: boolean) => {
    setAdvanced(open)
    writeAdvanced(open)
  }
  // Season and Dynasty's "You replace: <club> · Change": open the fold and put the club select in view
  const openHost = () => {
    toggleAdvanced(true)
    requestAnimationFrame(() => {
      hostRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      hostRef.current?.focus({ preventScroll: true })
    })
  }
  const leagueNameOf = (id: string) => u.available.find((l) => l.id === id)?.name ?? u.leagues.find((l) => l.id === id)?.name ?? id
  const openMore = () => {
    toggleAdvanced(true)
    moreRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // The daily puzzle, the Weekly and a challenge link fix everything but the team name and the picks: formation, league,
  // host club, season, difficulty and the draft rules are not the player's to choose.
  const weekPlan = mode === 'weekly' ? weeklyPlan(u, weeklySeed()) : null
  const dailyHere = isDaily && dailyLoaded(loadedLeagues, todaysDailySeed())
  const week = weekPlan ? weeklySettings(u, weekPlan.seed) : null
  const fixed = ((): { kind: 'daily' | 'challenge' | 'weekly'; season: number; host: string; formationId: string; leagueId: string; wheelLeagues: string[]; difficulty: 'calibrated' | 'realistic'; rules: DraftRules | null; seed: string } | null => {
    if (pendingChallenge) {
      const c = pendingChallenge.payload
      return { kind: 'challenge', season: c.s.ls, host: c.s.h, formationId: c.s.f, leagueId: c.s.l, wheelLeagues: c.s.wl, difficulty: c.s.d, rules: rulesFromPayload(c), seed: c.s.seed }
    }
    // The week's challenge is fixed before its packs load; it starts once they are in
    if (weekPlan) return { kind: 'weekly', season: week?.season ?? 0, host: week?.host ?? '', formationId: weekPlan.formationId, leagueId: weekPlan.leagueId, wheelLeagues: weekPlan.wheelLeagues, difficulty: week?.difficulty ?? 'calibrated', rules: null, seed: weekPlan.seed }
    if (!isDaily) return null
    // Every rule of the Daily comes from `dailySettings` (or today's ranked pin, when it differs), so it is the same wheel for everyone.
    // Until the day's league is in, the plan names the league and shape and Start waits (offline, the gate says so)
    if (!dailyHere) {
      const plan = dailyPlan(todaysDailySeed())
      return { kind: 'daily', season: 0, host: '', formationId: plan.formationId, leagueId: plan.leagueId, wheelLeagues: plan.wheelLeagues, difficulty: 'calibrated', rules: { ...DAILY_RULES, leagues: plan.wheelLeagues }, seed: plan.seed }
    }
    const d = dailyStartSettings(u, todaysDailySeed(), team.name, pin).settings
    return { kind: 'daily', season: d.leagueSeason, host: d.hostClubId, formationId: d.formationId, leagueId: d.leagueId, wheelLeagues: d.wheelLeagues, difficulty: d.difficulty ?? 'calibrated', rules: d.rules, seed: d.seed }
  })()
  const challenge = pendingChallenge?.challenge ?? null
  const rotation = isDaily ? dailyRotation(todaysDailySeed(), dailySeed(new Date(Date.now() + 86400000))) : null
  // A fixed puzzle in an 18-club league (a rotated Daily in the Bundesliga, a Weekly) is 34 games, so its perfect season is 34-0
  const fixedClubs = fixed && fixed.season && !fixed.rules?.superLeague ? u.clubSeasons.filter((cs) => cs.leagueId === fixed.leagueId && cs.season === fixed.season).length : 0
  const fixedGames = fixedClubs > 1 ? 2 * (fixedClubs - 1) : 0
  const fixedReady = !fixed || (fixed.wheelLeagues.every((l) => loadedLeagues.includes(l)) && loadedLeagues.includes(fixed.leagueId))

  /** The settings the Start button would send; a blank seed is drawn at that moment, so a preview names it as such. */
  const buildSettings = (preview: boolean): GameSettings => {
    const name = team.name
    if (fixed?.kind === 'daily' && dailyHere) return dailyStartSettings(u, fixed.seed, name, pin).settings
    const weekly = fixed?.kind === 'weekly' ? weeklyGameSettings(u, fixed.seed, name) : null
    if (weekly) return weekly
    const club = onlyClub && allClubs.some((c) => c.id === onlyClub) ? onlyClub : undefined
    const nation = onlyNation && nations.some((n) => n.nation === onlyNation) ? onlyNation : undefined
    const rules: DraftRules = fixed?.rules ?? withCap({ ...chosen, onlyClub: club, onlyNation: nation, ...(chain ? { chain: true } : {}) }, cap)
    const seedText = fixed ? fixed.seed : seed.trim() || (preview ? t('drawnAtStart') : randomSeed())
    // Crazy draws the formation from the seed (a blank seed draws it at Start); a challenge carries the one its challenger had
    const crazy = !fixed && modesOf(rules).includes('crazy')
    return {
      // A challenge always plays as a quick draft, whatever seed it carries, so the Daily streak is never touched
      mode: challenge ? 'quick' : mode,
      seed: seedText,
      formationId: fixed ? fixed.formationId : crazy && preview && !seed.trim() ? formationId : startFormation(rules, seedText, formationId),
      teamName: name,
      shortName: team.shortName,
      leagueId: fixed ? fixed.leagueId : leagueId,
      wheelLeagues: fixed ? fixed.wheelLeagues : wheelLeagues,
      hostClubId: fixed ? fixed.host : host,
      leagueSeason: fixed ? fixed.season : effectiveSeason,
      rules,
      jobSecurity: isManage ? jobSecurity : false,
      ...(isManage && playerPower && !challenge ? { playerPower: true } : {}),
      difficulty: fixed ? fixed.difficulty : opposition,
      // A Continental Cup in a managed season; a Quick Draft offers its cups after the league instead, so it never sets one
      continental: isManage && !challenge && continental && u.available.length >= 2,
      // A challenge keeps the window: the friend may trade in January as the challenger could
      ...(isManage ? {} : { january: challenge ? true : january }),
      ...(challenge ? { challenge } : {}),
    }
  }
  const start = async () => {
    // Today's puzzle shares the Quick Draft's save slot: ask before an unfinished quick draft or Daily is dropped (as Home's Daily button used to)
    const puzzle = fixed?.kind === 'daily' ? t('puzzleToday') : fixed?.kind === 'weekly' ? t('puzzleWeek') : null
    if (puzzle && game && slotOf(game) === 'quick' && game.phase !== 'summary' && !(await askConfirm(t('confirmStart', { puzzle, mode: modeTitle(game.settings.mode), team: game.settings.teamName }), { ok: t('startOk'), danger: true }))) return
    const settings = buildSettings(false)
    rememberTeamName(settings.teamName)
    startGame(settings)
  }
  const preview = buildSettings(true)
  // Until the week's league is in, the week has no season or host to state
  const summary = (fixed?.kind === 'weekly' && !week) || (fixed?.kind === 'daily' && !dailyHere) ? t('loadingLeague', { article: leagueArticle(leagueNameOf(fixed.leagueId)), league: leagueNameOf(fixed.leagueId) }) : logicList(tidyLeagueArticles(summariseSetup(u, preview)), ', ')
  // A Quick Draft's line names the team, the shape and the rules only: the season simulated is chosen in step 3
  const isQuickLine = !fixed && mode === 'quick'
  const ready = fixed ? fixedReady && (fixed.kind !== 'weekly' || !!week) : leagueReady && (!classic || classicLoaded)
  // Some mixes of modes, era and leagues admit no side at all: say so here rather than open a draft on an empty wheel
  const emptyWheel = ready && !fixed && !challenge && !wheelHasRoom(u, preview.rules, preview.formationId)
  // Offline with a league that never loaded: the button says so and Retry sits above it (leagueLoad.ts)
  const needs = fixed ? [fixed.leagueId, ...fixed.wheelLeagues] : [leagueId, ...wheelLeagues, ...(isManage && continental ? u.available.map((l) => l.id) : [])]
  const gate = leagueGate(needs, { loadedLeagues, failedLeagues, loadingLeagues, classicLoaded, classicFailed }, !fixed && classic)
  const capOn = cap.preset !== 'off'
  const capCard = capBudget(cap, isManage ? squadSize : QUICK_RULES.squadSize)
  const setCapChoice = (c: CapChoice) => {
    setCap(c)
    // The cap goes with neither one club nor one nation (`capFits`)
    if (c.preset !== 'off') {
      setOnlyClub('')
      setOnlyNation('')
    }
  }
  const hard = draftDifficulty === 'hard'
  const crazyOn = !fixed && !isManage && modes.includes('crazy')
  // Crazy with a seed typed in shows the shape that seed draws; with a blank seed the shape is drawn at Start
  const crazyKnown = crazyOn && !!seed.trim()
  const shownFormation = getFormation(fixed ? fixed.formationId : crazyKnown ? preview.formationId : formationId)
  const cardsOn: ModeCard[] = [...(hard ? (['hard'] as const) : []), ...modes]
  const toggleMode = (card: ModeCard) => {
    const next = toggleModeCard(cardsOn, card)
    // The Hard card and the Difficulty cards are one setting: leaving Hard goes back to Normal
    setDraftDifficulty(next.includes('hard') ? 'hard' : hard ? 'normal' : draftDifficulty)
    setModes(next.filter((c): c is QuickMode | 'upgrader' => c !== 'hard'))
  }
  const teamField = <TeamNameField value={team.value} onChange={team.setValue} fallback={team.fallback} />
  return (
    <div className="page setup-page has-bottom-bar" style={barHeight ? ({ '--bottom-bar-h': `${barHeight}px` } as CSSProperties) : undefined}>
      <div className="setup-flow setup-wide">
        <div className="row between wrap setup-top" style={{ alignItems: 'flex-start' }}>
          <div className="setup-title">
            <h1 data-testid={challenge ? 'challenge-title' : undefined}>{challenge ? t('playingDraft', { name: challenge.name }) : modeTitle(mode)}</h1>
            <p className="muted setup-sub">
              {challenge ? t('beatScore', { name: challenge.name }) : t(`modeLine_${mode}`)}
              {!isManage && (
                <span className="setup-goal" data-testid="setup-goal">
                  {' '}
                  {rich(fixedGames && fixedGames !== 38 ? t('goalGames', { w: fixedGames }) : t('goal'), B)}
                </span>
              )}
            </p>
          </div>
          {/* The online build's sign-in line sits in the head's row on a desktop (between the title and Back), so the two boxes keep their height; under 1000 px it takes a line of its own */}
          {isManage && !challenge && <SignInPrompt id={mode} text={t('backUp', { mode })} />}
          <button className="btn ghost setup-back" onClick={() => go('home')}>
            {t('back')}
          </button>
        </div>

        {/* The Daily's league rotates (engine 7's `DAILY_EPOCHS`): said once, on a day whose league tomorrow differs, above the steps so a phone sees it before Start */}
        {fixed?.kind === 'daily' && rotation && <Tip id="daily-rotation">{t('dailyRotationTip', { today: `${leagueArticle(leagueNameOf(rotation.today))}${leagueNameOf(rotation.today)}`, tomorrow: `${leagueArticle(leagueNameOf(rotation.tomorrow))}${leagueNameOf(rotation.tomorrow)}` })}</Tip>}
        {/* Numbered steps in two boxes, as 38-0 reads: formation, name and league on the left; the rules and Spin on the right */}
        <div className="setup-grid">
          <div className="panel setup-box">
            <section className="setup-step setup-formation">
              <StepHead n={1} title={t(fixed || crazyOn ? 'yourFormation' : 'pickFormation')} />
              {crazyOn && (
                <div className="notice small" data-testid="crazy-formation">
                  {crazyKnown ? t('crazySeed', { seed: seed.trim(), formation: shownFormation.name }) : t('crazyDrawn')}
                </div>
              )}
              <div className="setup-formation-body">
                {!fixed && !crazyOn && <FormationPicker value={formationId} onChange={setFormationId} />}
                <div className="setup-preview">
                  {/* A picture of the shape, not a control: inert keeps its slot discs out of the tab order and the accessibility tree */}
                  <div className="pitch-mini" data-testid="formation-preview" inert>
                    <Pitch formation={shownFormation} lineup={{}} getPlayer={() => undefined} />
                  </div>
                  <p className="help setup-line">
                    <b>{shownFormation.name}</b>: {formationBlurb(shownFormation)}
                  </p>
                </div>
              </div>
            </section>

            <section className="setup-step setup-team">
              <StepHead n={2} title={t('nameTeam')} />
              <div className="setup-name">{teamField}</div>
            </section>

            {!fixed && (
              <section className="setup-step">
                <div className="step-head-row">
                  <StepHead n={3} title={t('leagueSeason')} />
                  {superLeague ? (
                    <span className="chip super season-pick" data-testid="super-season" title={logicLine(SUPER_LEAGUE_LINE)}>
                      <SuperLeagueMark /> {t('superSeason')}
                    </span>
                  ) : (
                  <select className="input season-pick" value={effectiveSeason} onChange={(e) => setLeagueSeason(Number(e.target.value))} aria-label={t('seasonToPlay')} title={t('rivals', { n: Math.max(0, clubsInLeague.length - 1) })} data-testid="season-select">
                    {[...seasonChoices].reverse().map(({ season: s, classic: est }) => (
                      <option key={s} value={s}>
                        {seasonLabel(s)}{s === u.currentSeason ? t('inProgress') : ''}{est ? t('estSuffix') : ''}
                      </option>
                    ))}
                  </select>
                  )}
                </div>
                <div className="field setup-league">
                  {/* The Super League is one more league card for a Quick Draft: the nineteen greatest club-seasons, its wheel every league */}
                  <Segmented label={t('leagueChoice')} value={superLeague ? SUPER_LEAGUE_ID : leagueId} onChange={pickLeague} options={[...u.available.map((l) => ({ value: l.id, label: <><LeagueFlag leagueId={l.id} /> {l.name}</>, hint: t('playerSeasons', { n: l.playerSeasons.toLocaleString(formatLocale()) }) })), ...(mode === 'quick' && u.available.length >= 2 ? [{ value: SUPER_LEAGUE_ID, label: <span className="chip super"><SuperLeagueMark /> {SUPER_LEAGUE_NAME}</span>, hint: logicLine(SUPER_LEAGUE_LINE), testId: 'league-super' }] : [])]} />
                  {(loadingLeagues || europe || superLeague) && <span className="help" data-testid="league-help">{loadingLeagues ? t('loadingLeagues') : superLeague ? t('superWheel', { line: logicLine(SUPER_LEAGUE_LINE) }) : t('europeWheel')}</span>}
                </div>
                {isManage && (
                  <div className="setup-replace" data-testid="you-replace">
                    <ClubBadge clubId={host} size={22} />
                    <span>{rich(t('youReplace', { club: clubName(u, host) }), B)}</span>
                    <button type="button" className="linklike" onClick={openHost} data-testid="you-replace-change">
                      {t('change')}
                    </button>
                  </div>
                )}
              </section>
            )}
          </div>

          <div className="panel setup-box">
            {fixed && (
              <section className="setup-step">
                <StepHead n={3} title={t(fixed.kind === 'daily' ? 'todaysRules' : fixed.kind === 'weekly' ? 'weeksRules' : 'theRules')} />
                {fixed?.kind === 'weekly' && weekPlan && (
                  <div className="notice" data-testid="weekly-notice">
                    {week
                      ? rich(t('weeklyNotice', { week: weekPlan.week, theme: weeklyThemeLineText(u, week), formation: formationName(weekPlan.formationId), article: leagueArticle(leagueNameOf(week.leagueId)), league: leagueNameOf(week.leagueId), season: seasonLabel(week.season), difficulty: t(`diff_${week.difficulty}`) }), B)
                      : rich(t('weeklyNoticeLoading', { week: weekPlan.week, theme: weeklyThemeText(weekPlan.theme), formation: formationName(weekPlan.formationId) }), B)}
                  </div>
                )}
                {fixed?.kind === 'weekly' && weekPlan && <WeeklyRecordBox theme={weekPlan.theme} record={weeklyRecord(profile, weekPlan.seed, previousWeeklySeed)} />}
                {fixed?.kind === 'daily' && (
                  <div className="notice" data-testid="daily-notice">
                    {dailyHere
                      ? rich(t('dailyNotice', { formation: formationName(fixed.formationId), article: leagueArticle(leagueNameOf(fixed.leagueId)), league: leagueNameOf(fixed.leagueId), season: seasonLabel(fixed.season), seed: fixed.seed }), B)
                      : rich(t('dailyNoticeLoading', { formation: formationName(fixed.formationId), article: leagueArticle(leagueNameOf(fixed.leagueId)), league: leagueNameOf(fixed.leagueId), seed: fixed.seed }), B)}
                  </div>
                )}
                {fixed?.kind === 'challenge' && challenge && (
                  <div className={`notice ${challenge.verified === 'yes' ? '' : 'warn'}`} data-testid="challenge-banner">
                    {rich(t('challengeHead', { name: challenge.name, pts: challenge.claim.pts, inLeague: inLeague(leagueNameOf(fixed.leagueId)), season: seasonLabel(fixed.season), formation: formationName(fixed.formationId), tier: tierName(challenge.claim.t), record: `${challenge.claim.w}-${challenge.claim.d}-${challenge.claim.l}` }), B)}{' '}
                    {t('challengeRules', {
                      difficulty: t(`diff_${fixed.difficulty}`),
                      seed: fixed.seed,
                      extras: [
                        ...(fixed.rules ? rulesTags(fixed.rules).map((tag) => t('extraTag', { tag: tag.toLowerCase() })) : []),
                        t(fixed.rules?.twists ? 'twistsOn' : 'noTwists'),
                        fixed.rules?.budget !== undefined ? t('capExtra', { cap: capTotal(fixed.rules.budget) }) : '',
                        fixed.rules?.chain ? t('chainExtra') : '',
                        fixed.rules?.onlyClub ? t('onlyExtra', { name: clubName(u, fixed.rules.onlyClub) }) : '',
                        fixed.rules?.classic ? t('classicExtra') : '',
                        fixed.rules?.onlyNation ? t('onlyExtra', { name: u.nations[fixed.rules.onlyNation]?.name ?? fixed.rules.onlyNation }) : '',
                        fixed.rules?.fromSeason || fixed.rules?.toSeason ? t('rangeExtra', { from: seasonLabel(eraFirstSeason(u, fixed.rules)), to: seasonLabel(fixed.rules.toSeason ?? u.lastSeason) }) : '',
                      ].join(''),
                    })}
                    <div className="small" style={{ marginTop: 6 }}>
                      {challenge.verified === 'yes' && t('verified', { name: challenge.name, pts: challenge.claim.pts })}
                      {challenge.verified === 'unverified' && t('unverified', { reason: challenge.reason ?? t('differentDataReason') })}
                      {challenge.verified === 'no' && t('notVerified', { reason: challenge.reason ?? t('noReplayReason') })}
                    </div>
                  </div>
                )}
                {fixed?.rules && (
                  <HoverTips className="pill-list" data-testid="fixed-rules" testId="rule-tip">
                    {ruleChipsText(u, fixed.rules).map(({ chip: c, text }) => {
                      const Icon = c.icon ? RULE_ICON[c.icon] : null
                      // Each chip's plain-words note, on hover, a tap or the keyboard (ruleNotes.ts)
                      const note = ruleChipNote(c)
                      return (
                        <span key={c.text} className={`chip${note ? ' has-tip' : ''}`} data-tip={note} tabIndex={note ? 0 : undefined}>
                          {Icon && <Icon size={12} aria-hidden="true" />}
                          {Icon ? ` ${text}` : text}
                          {note && <span className="sr-only">: {note}</span>}
                        </span>
                      )
                    })}
                  </HoverTips>
                )}
              </section>
            )}
            {!fixed && (
              <section className="setup-step">
                <StepHead n={4} title={t('setRules')} />
                {!isManage && (
                  <div className="setup-modes" data-testid="modes-panel">
                    <SectionHead title={t('modes')} info={t('modesInfo', { list: MODE_CARDS.map((c) => t('modeInfoItem', { title: modeCardTitle(c), line: modeCardLine(c) })).join(' ') })} testId="modes" right={<span className="small muted">{t('modesOn', { n: cardsOn.length })}</span>} />
                    <HoverTips className="setup-modes-row" testId="mode-tip">
                      <ModeCards cards={MODE_CARDS} on={cardsOn} info={modeCardInfo()} icons={MODE_ICON} onToggle={toggleMode} />
                      <div className="pu-setup">
                        <label className={`qmode pu-card${powerUps ? ' active' : ''}`} data-testid="power-ups-toggle" data-tip={t('powerUpsTip', { list: POWER_UPS.map((k) => powerUpTitle(k)).join(', ') })}>
                          <input type="checkbox" className="sr-only" checked={powerUps} onChange={(e) => setPowerUps(e.target.checked)} />
                          <span className="micon" aria-hidden="true">
                            <Package size="1em" />
                          </span>
                          <span className="ctitle">{t('powerUps')}</span>
                          <span className="cline">{t(powerUps ? 'powerUpsOn' : 'powerUpsLine')}</span>
                        </label>
                        <InfoTip label={t('powerUps')} text={t('powerUpsInfo')} testId="power-ups-info" />
                      </div>
                      <div className="pu-setup">
                        <label className={`qmode pu-card${endCase ? ' active' : ''}`} data-testid="end-case-toggle" data-tip={t('endCaseTip')}>
                          <input type="checkbox" className="sr-only" checked={endCase} onChange={(e) => setEndCase(e.target.checked)} />
                          <span className="micon" aria-hidden="true">
                            <Gift size="1em" />
                          </span>
                          <span className="ctitle">{t('endCase')}</span>
                          <span className="cline">{t(endCase ? 'endCaseOn' : 'endCaseLine')}</span>
                        </label>
                        <InfoTip label={t('endCase')} text={t('endCaseInfo')} testId="end-case-info" />
                      </div>
                      {/* The casual rules as two more cards: Moneyball's salary cap (its presets under Advanced) and the Teammate Chain */}
                      <div className="pu-setup">
                        <label className={`qmode pu-card${capOn ? ' active' : ''}`} data-testid="moneyball-toggle" data-tip={t('moneyballTip')}>
                          <input type="checkbox" className="sr-only" checked={capOn} onChange={(e) => setCapChoice({ ...cap, preset: e.target.checked ? 'moneyball' : 'off' })} />
                          <span className="micon" aria-hidden="true"><PoundSterling size="1em" /></span>
                          <span className="ctitle">{t('moneyball')}</span>
                          <span className="cline">{capOn && capCard !== undefined ? t('moneyballCap', { cap: capTotal(capCard), preset: CAP_PRESETS.find((p) => p.value === cap.preset)?.label ?? '' }) : t('moneyballLine')}</span>
                        </label>
                        <label className={`qmode pu-card${chain ? ' active' : ''}`} data-testid="chain-toggle" data-tip={t('chainCardTip')}>
                          <input type="checkbox" className="sr-only" checked={chain} onChange={(e) => setChain(e.target.checked)} />
                          <span className="micon" aria-hidden="true"><Link size="1em" /></span>
                          <span className="ctitle"><span className="lbl-long">{t('chainLong')}</span><span className="lbl-short">{t('chainShort')}</span></span>
                          <span className="cline">{t(chain ? 'chainOn' : 'chainLine')}</span>
                        </label>
                      </div>
                    </HoverTips>
                  </div>
                )}
                <div className="setup-rules">
                  <div className="setup-opt">
                    <h3>{t('difficulty')}</h3>
                    <ChoiceCards label={t('difficulty')} testId="difficulty" options={DIFFICULTY_OPTIONS()} value={draftDifficulty} onChange={setDraftDifficulty} />
                  </div>
                  <div className="setup-opt">
                    <h3>{t('showRatings')}</h3>
                    <ChoiceCards label={t('showRatings')} testId="show-ratings" options={RATINGS_SHOWN()} value={hard || !showRatings ? 'off' : 'on'} onChange={(v) => setShowRatings(v === 'on')} disabled={hard} />
                    {hard && <span className="help setup-line">{t('hardHides')}</span>}
                  </div>
                  <div className="setup-opt">
                    <h3>{t('draftMode')}</h3>
                    <ChoiceCards label={t('draftMode')} testId="draft-mode" options={DRAFT_MODE_OPTIONS()} value={draftMode} onChange={setDraftMode} />
                  </div>
                  {!isManage && (
                    <div className="setup-opt">
                      <h3>{t('playerRatings')}</h3>
                      <ChoiceCards label={t('playerRatings')} testId="ratings-mode" options={RATINGS_MODE_OPTIONS()} value={ratingsMode} onChange={setRatingsMode} />
                    </div>
                  )}
                  {isManage && (
                    <div className="setup-opt setup-squad">
                      <h3>{t('squadSize', { n: squadSize })}</h3>
                      <input type="range" min={16} max={22} value={squadSize} onChange={(e) => setSquadSize(Number(e.target.value))} aria-label={t('squadSizeLabel')} />
                    </div>
                  )}
                  {!isManage && (
                    <div className="setup-opt" data-testid="manager-option">
                      <h3>{t('manager')}</h3>
                      <ChoiceCards label={t('manager')} testId="managers" options={MANAGER_OPTIONS()} value={managerChoice} onChange={setManagerChoice} />
                    </div>
                  )}
                  {!isManage && (
                    <div className="setup-opt setup-bench" data-testid="bench-option" title={t('benchTip')}>
                      <h3>{t('bench')}</h3>
                      <Segmented label={t('bench')} value={String(benchPicks)} onChange={(v) => setBenchPicks(Number(v))} options={BENCH_OPTIONS()} />
                      <span className="help setup-line">{t(benchPicks ? 'benchOn' : 'benchOff')}</span>
                    </div>
                  )}
                  <div className="setup-opt setup-wide-opt" data-testid="era">
                    <div className="setup-era-head">
                      <h3>{t('era')}</h3>
                      <Segmented label={t('era')} value={eraPreset} onChange={setEraPreset} options={[...ERA_PRESETS.map((p) => ({ value: p.id as EraPreset, label: logicLine(p.label) })), ...(eraPreset === 'custom' ? [{ value: 'custom' as EraPreset, label: t('custom') }] : [])]} />
                      {classicFrom !== undefined && (
                        <label className="toggle era-classic" title={t('classicTip')}>
                          <input
                            type="checkbox"
                            checked={classic}
                            data-testid="era-classic"
                            onChange={(e) => {
                              const on = e.target.checked
                              setClassicOn(on)
                              setEraPreset(on ? 'custom' : 'all')
                              setCustomEra(on ? [classicFrom, u.firstSeason - 1] : null)
                              // Its pack loads now (Start waits for it); one that cannot load switches the toggle back off
                              if (on)
                                void ensureClassic().then((ok) => {
                                  if (ok) return
                                  setClassicOn(false)
                                  setEraPreset('all')
                                  setCustomEra(null)
                                })
                            }}
                          />
                          {t('classicRange', { from: seasonLabel(classicFrom), to: seasonLabel(u.firstSeason - 1) })} <EstimatedChip compact />
                        </label>
                      )}
                      <span className="chip" data-testid="era-count" title={eraLine && eraLine.n > 0 ? logicLine(eraLine.caption) : undefined}>
                        {logicLine(eraLine?.label)}
                      </span>
                    </div>
                    <SeasonRange
                      seasons={eraStops}
                      from={eraFrom}
                      to={eraTo}
                      onChange={(a, b) => {
                        setCustomEra([a, b])
                        setEraPreset('custom')
                      }}
                    />
                    <span className="help setup-line" data-testid="era-caption">
                      {eraLine && eraLine.n > 0 ? t('wheelLands', { caption: eraLine.caption }) : t('noSeasons')}
                    </span>
                  </div>
                  <div className="setup-opt setup-wide-opt setup-more" ref={moreRef} data-testid="more-options">
                    <button type="button" className="fold-head" onClick={() => toggleAdvanced(!advanced)} aria-expanded={advanced} data-testid="more-options-toggle">
                      <h3>{t(isManage ? 'moreOptions' : 'advanced')}</h3>
                      <span className="small muted">{t(advanced ? 'hide' : 'show')}</span>
                    </button>
                    {!advanced && (
                      <span className="help setup-more-help">{t(isManage ? 'moreHelpManage' : 'moreHelp')}</span>
                    )}
                    {advanced && (
                      <>
                        <div className="toggle-grid">
                          {isManage && (
                            <div className="toggle-row">
                              <label className="toggle">
                                <input type="checkbox" checked={jobSecurity} onChange={(e) => setJobSecurity(e.target.checked)} />
                                <Armchair size={14} aria-hidden="true" /> {t('jobSecurity')}
                              </label>
                              <InfoTip label={t('jobSecurity')} text={t('jobSecurityInfo')} />
                            </div>
                          )}
                          {isManage && (
                            <div className="toggle-row">
                              <label className="toggle">
                                <input type="checkbox" checked={playerPower} onChange={(e) => setPlayerPower(e.target.checked)} data-testid="player-power-toggle" />
                                <Users size={14} aria-hidden="true" /> {t('playerPower')}
                              </label>
                              <InfoTip label={t('playerPower')} text={t('playerPowerInfo')} />
                            </div>
                          )}
                          {u.available.length >= 2 && (
                            <div className="toggle-row">
                              <label className="toggle" data-testid="europe-toggle">
                                <input type="checkbox" checked={europe} onChange={(e) => pickEurope(e.target.checked)} />
                                <MapIcon size={14} aria-hidden="true" /> {t('europeanNights')}
                              </label>
                              <InfoTip label={t('europeanNights')} text={t('europeInfo', { n: u.available.length })} />
                            </div>
                          )}
                          <div className="toggle-row">
                            <label className="toggle">
                              <input type="checkbox" checked={twists || crazyOn} disabled={crazyOn} onChange={(e) => setTwistsChoice(e.target.checked)} data-testid="twists-toggle" />
                              <Shuffle size={14} aria-hidden="true" /> {t(crazyOn ? 'twistsEvery' : 'twists')}
                            </label>
                            <InfoTip label={t('twists')} text={t('twistsInfo', { crazy: crazyOn ? 'yes' : 'no' })} />
                          </div>
                          {!isManage && (
                            <div className="toggle-row">
                              <label className="toggle" data-testid="january-toggle">
                                <input type="checkbox" checked={january} onChange={(e) => setJanuary(e.target.checked)} />
                                <Snowflake size={14} aria-hidden="true" /> {t('january')}
                              </label>
                              <InfoTip label={t('january')} text={t('januaryInfo')} />
                            </div>
                          )}
                          {isManage && u.available.length >= 2 && (
                            <div className="toggle-row">
                              <label className="toggle" data-testid="continental-toggle">
                                <input
                                  type="checkbox"
                                  checked={continental}
                                  onChange={(e) => {
                                    setContinental(e.target.checked)
                                    if (e.target.checked) void ensureLeagues(u.available.map((l) => l.id))
                                  }}
                                />
                                <Globe size={14} aria-hidden="true" /> {t('continental')}
                              </label>
                              <InfoTip label={t('continental')} text={t('continentalManage')} />
                            </div>
                          )}
                        </div>
                        <label className="field">
                          {t('seed')}
                          <div className="row">
                            <input className="input mono" value={seed} onChange={(e) => setSeed(e.target.value)} />
                            <button className="btn sm" onClick={() => setSeed(randomSeed())}>
                              {t('newSeed')}
                            </button>
                          </div>
                          <span className="help">{t('sameSeed')}</span>
                        </label>
                        {isManage && (
                          <label className="field">
                            {t('replaceLabel')}
                            <select className="input" value={host} onChange={(e) => setHostClubId(e.target.value)} data-testid="host-select" ref={hostRef}>
                              {clubsInLeague.map((c) => (
                                <option key={c} value={c}>
                                  {u.clubById[c]?.name ?? c}
                                </option>
                              ))}
                            </select>
                            <span className="help row" style={{ gap: 8 }} data-testid="host-help">
                              <ClubBadge clubId={host} size={22} />
                              {host === defaultHost && hostRow ? t('midTable', { pos: hostRow.position, season: seasonLabel(effectiveSeason) }) : t('theirColours')}
                            </span>
                          </label>
                        )}
                        {!superLeague && (
                        <div className="field">
                          {t('opposition')}
                          <Segmented
                            label={t('opposition')}
                            value={opposition}
                            onChange={setOpposition}
                            options={[
                              { value: 'calibrated', label: t('calibrated'), hint: t('calibratedHint') },
                              { value: 'realistic', label: t('realistic'), hint: t('realisticHint') },
                            ]}
                          />
                          <span className="help">{t(opposition === 'calibrated' ? 'calibratedHelp' : 'realisticHelp')}</span>
                        </div>
                        )}
                        <CapControl value={cap} onChange={setCapChoice} squadSize={isManage ? squadSize : QUICK_RULES.squadSize} note={CAP_NARROW_NOTE} />
                        {isManage && <ChainToggle value={chain} onChange={setChain} />}
                        <label className="field">
                          {t('oneClub')}
                          <select
                            className="input"
                            value={onlyClub}
                            onChange={(e) => {
                              setOnlyClub(e.target.value)
                              if (e.target.value) setOnlyNation('')
                              if (e.target.value) setCap((c) => ({ ...c, preset: 'off' }))
                            }}
                          >
                            <option value="">{t('everyClub')}</option>
                            {allClubs.map((c) => (
                              <option key={c.id} value={c.id}>
                                {t('clubOnly', { name: c.name })}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="field">
                          {t('oneNation')}
                          <select
                            className="input"
                            value={nations.some((n) => n.nation === onlyNation) ? onlyNation : ''}
                            onChange={(e) => {
                              setOnlyNation(e.target.value)
                              if (e.target.value) setOnlyClub('')
                              if (e.target.value) setCap((c) => ({ ...c, preset: 'off' }))
                            }}
                          >
                            <option value="">{t('everyNation')}</option>
                            {nations.map((n) => (
                              <option key={n.nation} value={n.nation}>
                                {nationDepthLabel(n)}
                              </option>
                            ))}
                          </select>
                          <span className="help">
                            {onlyNation && nations.some((n) => n.nation === onlyNation)
                              ? <><NationFlag nation={onlyNation} named /> {t('everyPickFrom', { name: nations.find((n) => n.nation === onlyNation)?.name })}</>
                              : t('nationsDeep', { n: nations.length, cover: NATION_SLOT_COVER, extra: isManage ? t('nationsInAll', { n: squadSize + NATION_SQUAD_MARGIN }) : '' })}
                          </span>
                        </label>
                      </>
                    )}
                  </div>
                </div>
              </section>
            )}

            <section className="setup-step setup-start bottom-bar" ref={barRef}>
              <StepHead n={fixed ? 4 : 5} title={t('spin')} />
              <div className="small muted" data-testid="setup-summary" title={isQuickLine ? summary : undefined}>
                {isQuickLine ? logicList(quickSetupLineFull(u, preview), ' · ') : summary}
                {!fixed && (
                  <>
                    {' · '}
                    <button type="button" className="linklike" onClick={openMore} data-testid="setup-change">
                      {t('changeLink')}
                    </button>
                  </>
                )}
              </div>
              <LeagueRetry needs={needs} classic={!fixed && classic} />
              <button className="btn primary big block" onClick={start} disabled={!ready || loadingLeagues || emptyWheel} data-testid="setup-start">
                {!ready ? gateText(gate) : emptyWheel ? t('emptyWheel') : isManage ? t('startSquad') : challenge ? t('takeOn', { name: challenge.name }) : t('startDraft')}
              </button>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}

/** A step's numbered badge and short title. */
function StepHead({ n, title }: { n: number; title: string }) {
  return (
    <h3 className="step-head">
      <span className="step-num" aria-hidden="true">
        {n}
      </span>
      <span className="sr-only">{t('stepN', { n })}</span>
      {title}
    </h3>
  )
}
