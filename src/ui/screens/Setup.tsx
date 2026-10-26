import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Ban, Calendar, Crosshair, Eye, EyeOff, FerrisWheel, Gift, Globe, Link, Map as MapIcon, Mountain, Package, PoundSterling, Scale, Skull, Smile, UserRound, Users } from 'lucide-react'
import { useStore, todaysDailySeed, slotOf } from '@game/store'
import type { GameSettings, Mode } from '@game/types'
import { defaultHostClub, describeRules, quickSetupLine, setupRules, shortNameFor, startFormation, summariseSetup } from '@game/logic/setup'
import { getFormation } from '@engine/formations'
import { DIFFICULTY_RESPINS, QUICK_RULES, SEASON_RULES, modesOf, rulesTags, type DraftDifficulty, type DraftMode, type DraftRules, type QuickMode, type RatingsMode } from '@engine/draft'
import { MODE_CARDS, MODE_INFO, toggleModeCard, type ModeCard } from '@engine/modes'
import { POWER_UPS, POWER_UP_INFO } from '@engine/powerups'
import { InfoTip } from '../components/PowerUpButton'
import { ERA_PRESETS, eraCount, eraHandles, wheelSeasons, type EraPreset } from '@engine/era'
import { rulesFromPayload } from '@engine/challenge'
import { NATION_SLOT_COVER, NATION_SQUAD_MARGIN, nationCover, nationDepthFrom, nationDepthLabel } from '@engine/nations'
import { randomSeed } from '@engine/rng'
import { poolClubSeasons } from '@engine/universe'
import { classicFromFor, eraFirstSeason, leagueSeasonChoices } from '@game/logic/era'
import { formationName, ordinal, seasonLabel, tierName } from '../format'
import { ClubBadge, EstimatedChip, Segmented } from '../components/bits'
import { LeagueFlag, NationFlag, SuperLeagueMark } from '../components/Flag'
import { SUPER_LEAGUE_ID, SUPER_LEAGUE_NAME } from '@engine/superLeague'
import { SUPER_LEAGUE_LINE } from '@game/logic/superLeague'
import { Pitch } from '../components/Pitch'
import { FormationPicker } from '../components/FormationPicker'
import { ChoiceCards, type ChoiceOption, ModeCards, SeasonRange, SectionHead, TeamNameField } from '../components/SetupBits'
import { MODE_ICON } from '../components/icons'
import { clubName } from '../format'
import { dailyStartSettings } from '../../online/daily'
import { useOnline } from '../../online/state'
import { SignInPrompt } from '../online/SignInPrompt'
import { MODE_TITLE } from '@game/logic/modes'
import { weeklyGameSettings, weeklyPlan, weeklySettings, weeklyThemeLine } from '@game/logic/weekly'
import { weeklySeed } from '@engine/rng'
import { CapControl } from '../components/CapControl'
import { ChainToggle } from '../components/ChainControl'
import { CAP_NARROW_NOTE, CAP_PRESETS, DEFAULT_CAP_CHOICE, capBudget, capTotal, withCap, type CapChoice } from '@game/logic/cap'

const MODE_LINE: Record<Mode, string> = {
  quick: 'Spin, draft an XI, watch its season.',
  daily: 'One wheel for everyone today.',
  season: 'Draft a squad, manage every matchweek.',
  dynasty: 'Draft a squad, build a club for years.',
  arena: 'Draft a squad, then one knockout sitting.',
  weekly: 'One themed wheel for everyone this week.',
  runin: 'Take over a real club for the last ten games.',
}
const DEFAULT_TEAM = 'Touchline XI'

const respinWord = (n: number) => (n === 0 ? 'No re-spins' : `${n} re-spin${n === 1 ? '' : 's'}`)
const DIFFICULTY_OPTIONS: Array<ChoiceOption<DraftDifficulty>> = [
  { value: 'easy', icon: Smile, title: 'Easy', line: respinWord(DIFFICULTY_RESPINS.easy) },
  { value: 'normal', icon: Scale, title: 'Normal', line: respinWord(DIFFICULTY_RESPINS.normal) },
  { value: 'hard', icon: Skull, title: 'Hard', line: `${respinWord(DIFFICULTY_RESPINS.hard)} · blind` },
]
const RATINGS_SHOWN: Array<ChoiceOption<'on' | 'off'>> = [
  { value: 'on', icon: Eye, title: 'On', line: 'See every rating' },
  { value: 'off', icon: EyeOff, title: 'Off', line: 'Names only' },
]
const DRAFT_MODE_OPTIONS: Array<ChoiceOption<DraftMode>> = [
  { value: 'squad', icon: Users, title: 'Squad First', line: 'Spin, pick, place' },
  { value: 'position', icon: Crosshair, title: 'Position First', line: 'Pick a slot, then spin' },
]
/** Quick Draft bench places: off, or up to five extra picks the season can bring on (three changes, plus injury cover). */
const BENCH_OPTIONS: Array<{ value: string; label: string }> = [{ value: '0', label: 'Off' }, ...[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))]
/** Quick Draft managers: spin three and pick one, pick one of the real managers of the club-seasons drafted, or play without. */
const MANAGER_OPTIONS: Array<ChoiceOption<'spin' | 'pick' | 'off'>> = [
  { value: 'spin', icon: FerrisWheel, title: 'Spin', line: 'Three reels of real managers: pick one' },
  { value: 'pick', icon: UserRound, title: 'Pick', line: 'Pick a real manager from the clubs you drafted' },
  { value: 'off', icon: Ban, title: 'Off', line: 'No manager: the XI on its own' },
]
const RATINGS_MODE_OPTIONS: Array<ChoiceOption<RatingsMode>> = [
  { value: 'season', icon: Calendar, title: 'Season', line: 'As he was that season' },
  { value: 'prime', icon: Mountain, title: 'Prime', line: 'At his career best' },
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
  const { universe: u, game, setupMode: mode, startGame, go, ensureLeagues, loadingLeagues, loadedLeagues, pendingChallenge } = useStore()
  const isDaily = mode === 'daily'
  const isManage = mode === 'season' || mode === 'dynasty'
  const modeBase: DraftRules = isManage ? SEASON_RULES : QUICK_RULES
  // Today's pinned ranked Daily, when the online layer has read it (the local mapping otherwise)
  const pin = useOnline((s) => (s.pins.day === new Date().toISOString().slice(0, 10) ? s.pins.daily : null))
  const [leagueId, setLeagueId] = useState('england')
  const [europe, setEurope] = useState(false)
  const [teamName, setTeamName] = useState(DEFAULT_TEAM)
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

  const superLeague = superOn && mode === 'quick'
  const wheelLeagues = useMemo(() => ((europe || superLeague) && u ? u.available.map((l) => l.id) : [leagueId]), [europe, superLeague, leagueId, u])
  const classicFrom = u ? classicFromFor(u, wheelLeagues) : undefined
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
  // The scan over every player-season runs once per shape; the squad-size slider only re-filters it.
  const nationScan = useMemo(() => (u && !isDaily ? nationCover(u, wheelLeagues, eraRange, getFormation(formationId)) : []), [u, isDaily, wheelLeagues, eraRange.fromSeason, eraRange.toSeason, eraRange.classic, formationId])
  const nations = useMemo(() => nationDepthFrom(nationScan, isManage ? squadSize : 11), [nationScan, isManage, squadSize])
  const leagueReady = loadedLeagues.includes(leagueId) && wheelLeagues.every((l) => loadedLeagues.includes(l)) && (!(isManage && continental) || !u || u.available.every((l) => loadedLeagues.includes(l.id)))
  // The club handed over by default sits nearest tenth in that season's real table, so the board's ask is reachable
  const defaultHost = useMemo(() => (u ? defaultHostClub(u, leagueId, effectiveSeason, clubsInLeague) : ''), [u, leagueId, effectiveSeason, clubsInLeague])
  const host = hostClubId && clubsInLeague.includes(hostClubId) ? hostClubId : defaultHost
  const hostRow = u?.tables[leagueId]?.[effectiveSeason]?.find((r) => r.clubId === host)

  if (!u) return <div className="page">Loading…</div>
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
  const week = weekPlan ? weeklySettings(u, weekPlan.seed) : null
  const fixed = ((): { kind: 'daily' | 'challenge' | 'weekly'; season: number; host: string; formationId: string; leagueId: string; wheelLeagues: string[]; difficulty: 'calibrated' | 'realistic'; rules: DraftRules | null; seed: string } | null => {
    if (pendingChallenge) {
      const c = pendingChallenge.payload
      return { kind: 'challenge', season: c.s.ls, host: c.s.h, formationId: c.s.f, leagueId: c.s.l, wheelLeagues: c.s.wl, difficulty: c.s.d, rules: rulesFromPayload(c), seed: c.s.seed }
    }
    // The week's challenge is fixed before its packs load; it starts once they are in
    if (weekPlan) return { kind: 'weekly', season: week?.season ?? 0, host: week?.host ?? '', formationId: weekPlan.formationId, leagueId: weekPlan.leagueId, wheelLeagues: weekPlan.wheelLeagues, difficulty: week?.difficulty ?? 'calibrated', rules: null, seed: weekPlan.seed }
    if (!isDaily) return null
    // Every rule of the Daily comes from `dailySettings` (or today's ranked pin, when it differs), so it is the same wheel for everyone
    const d = dailyStartSettings(u, todaysDailySeed(), teamName.trim() || 'Touchline XI', pin).settings
    return { kind: 'daily', season: d.leagueSeason, host: d.hostClubId, formationId: d.formationId, leagueId: d.leagueId, wheelLeagues: d.wheelLeagues, difficulty: d.difficulty ?? 'calibrated', rules: d.rules, seed: d.seed }
  })()
  const challenge = pendingChallenge?.challenge ?? null
  const fixedReady = !fixed || (fixed.wheelLeagues.every((l) => loadedLeagues.includes(l)) && loadedLeagues.includes(fixed.leagueId))

  /** The settings the Start button would send; a blank seed is drawn at that moment, so a preview names it as such. */
  const buildSettings = (preview: boolean): GameSettings => {
    const name = teamName.trim() || DEFAULT_TEAM
    if (fixed?.kind === 'daily') return dailyStartSettings(u, fixed.seed, name, pin).settings
    const weekly = fixed?.kind === 'weekly' ? weeklyGameSettings(u, fixed.seed, name) : null
    if (weekly) return weekly
    const club = onlyClub && allClubs.some((c) => c.id === onlyClub) ? onlyClub : undefined
    const nation = onlyNation && nations.some((n) => n.nation === onlyNation) ? onlyNation : undefined
    const rules: DraftRules = fixed?.rules ?? withCap({ ...chosen, onlyClub: club, onlyNation: nation, ...(chain ? { chain: true } : {}) }, cap)
    const seedText = fixed ? fixed.seed : seed.trim() || (preview ? 'drawn when you start' : randomSeed())
    // Crazy draws the formation from the seed (a blank seed draws it at Start); a challenge carries the one its challenger had
    const crazy = !fixed && modesOf(rules).includes('crazy')
    return {
      // A challenge always plays as a quick draft, whatever seed it carries, so the Daily streak is never touched
      mode: challenge ? 'quick' : mode,
      seed: seedText,
      formationId: fixed ? fixed.formationId : crazy && preview && !seed.trim() ? formationId : startFormation(rules, seedText, formationId),
      teamName: name,
      shortName: shortNameFor(name),
      leagueId: fixed ? fixed.leagueId : leagueId,
      wheelLeagues: fixed ? fixed.wheelLeagues : wheelLeagues,
      hostClubId: fixed ? fixed.host : host,
      leagueSeason: fixed ? fixed.season : effectiveSeason,
      rules,
      jobSecurity: isManage ? jobSecurity : false,
      difficulty: fixed ? fixed.difficulty : opposition,
      // A Continental Cup in a managed season; a Quick Draft offers its cups after the league instead, so it never sets one
      continental: isManage && !challenge && continental && u.available.length >= 2,
      // A challenge keeps the window: the friend may trade in January as the challenger could
      ...(isManage ? {} : { january: challenge ? true : january }),
      ...(challenge ? { challenge } : {}),
    }
  }
  const start = () => {
    // Today's puzzle shares the Quick Draft's save slot: ask before an unfinished quick draft or Daily is dropped (as Home's Daily button used to)
    const puzzle = fixed?.kind === 'daily' ? "today's puzzle" : fixed?.kind === 'weekly' ? "this week's challenge" : null
    if (puzzle && game && slotOf(game) === 'quick' && game.phase !== 'summary' && !confirm(`Start ${puzzle}? Your current ${MODE_TITLE[game.settings.mode]} (${game.settings.teamName}) will be abandoned.`)) return
    startGame(buildSettings(false))
  }
  const preview = buildSettings(true)
  // Until the week's league is in, the week has no season or host to state
  const summary = fixed?.kind === 'weekly' && !week ? `Loading the ${leagueNameOf(fixed.leagueId)}…` : summariseSetup(u, preview)
  // A Quick Draft's line names the team, the shape and the rules only: the season simulated is chosen in step 3
  const isQuickLine = !fixed && mode === 'quick'
  const ready = fixed ? fixedReady && (fixed.kind !== 'weekly' || !!week) : leagueReady
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
  const teamField = <TeamNameField value={teamName} onChange={setTeamName} fallback={DEFAULT_TEAM} />
  return (
    <div className="page setup-page has-bottom-bar" style={barHeight ? ({ '--bottom-bar-h': `${barHeight}px` } as CSSProperties) : undefined}>
      <div className="setup-flow setup-wide">
        <div className="row between wrap" style={{ alignItems: 'flex-start' }}>
          <div>
            <h1>{challenge ? 'Challenge' : MODE_TITLE[mode]}</h1>
            <p className="muted setup-sub">
              {challenge ? `Same seed, same wheel: beat ${challenge.name}'s score.` : MODE_LINE[mode]}
              {!isManage && (
                <span className="setup-goal" data-testid="setup-goal">
                  {' '}
                  <b>Win every game:</b> the perfect season is 38-0.
                </span>
              )}
            </p>
          </div>
          <button className="btn ghost" onClick={() => go('home')}>
            ← Back
          </button>
        </div>
        {isManage && !challenge && <SignInPrompt id={mode} text={`Back up your saves: sign in to save this ${mode === 'dynasty' ? 'Dynasty' : 'Season'}, your records and Dailies to your account.`} />}

        {/* Numbered steps in two boxes, as 38-0 reads: formation, name and league on the left; the rules and Spin on the right */}
        <div className="setup-grid">
          <div className="panel setup-box">
            <section className="setup-step setup-formation">
              <StepHead n={1} title={fixed || crazyOn ? 'Your formation' : 'Pick your formation'} />
              {crazyOn && (
                <div className="notice small" data-testid="crazy-formation">
                  {crazyKnown ? `Crazy: seed ${seed.trim()} draws a ${shownFormation.name}.` : 'Crazy: the formation is drawn when you start.'}
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
                    <b>{shownFormation.name}</b>: {shownFormation.blurb}
                  </p>
                </div>
              </div>
            </section>

            <section className="setup-step setup-team">
              <StepHead n={2} title="Name your team" />
              <div className="setup-name">{teamField}</div>
            </section>

            {!fixed && (
              <section className="setup-step">
                <div className="step-head-row">
                  <StepHead n={3} title="League and season" />
                  {superLeague ? (
                    <span className="chip super season-pick" data-testid="super-season" title={SUPER_LEAGUE_LINE}>
                      <SuperLeagueMark /> One season, full strength
                    </span>
                  ) : (
                  <select className="input season-pick" value={effectiveSeason} onChange={(e) => setLeagueSeason(Number(e.target.value))} aria-label="Season to play" title={`${Math.max(0, clubsInLeague.length - 1)} real rivals with their real squads`} data-testid="season-select">
                    {[...seasonChoices].reverse().map(({ season: s, classic: est }) => (
                      <option key={s} value={s}>
                        {seasonLabel(s)}{s === u.currentSeason ? ' (in progress)' : ''}{est ? ' (est.)' : ''}
                      </option>
                    ))}
                  </select>
                  )}
                </div>
                <div className="field setup-league">
                  {/* The Super League is one more league card for a Quick Draft: the nineteen greatest club-seasons, its wheel every league */}
                  <Segmented value={superLeague ? SUPER_LEAGUE_ID : leagueId} onChange={pickLeague} options={[...u.available.map((l) => ({ value: l.id, label: <><LeagueFlag leagueId={l.id} /> {l.name}</>, hint: `${l.playerSeasons.toLocaleString()} player-seasons` })), ...(mode === 'quick' && u.available.length >= 2 ? [{ value: SUPER_LEAGUE_ID, label: <span className="chip super"><SuperLeagueMark /> {SUPER_LEAGUE_NAME}</span>, hint: SUPER_LEAGUE_LINE, testId: 'league-super' }] : [])]} />
                  {(loadingLeagues || europe || superLeague) && <span className="help" data-testid="league-help">{loadingLeagues ? 'Loading league data…' : superLeague ? `${SUPER_LEAGUE_LINE}; the wheel draws from every league.` : 'Where your side plays; the wheel draws from every league.'}</span>}
                </div>
                {isManage && (
                  <div className="setup-replace" data-testid="you-replace">
                    <ClubBadge clubId={host} size={22} />
                    <span>
                      You replace: <b>{clubName(u, host)}</b>
                    </span>
                    <button type="button" className="linklike" onClick={openHost} data-testid="you-replace-change">
                      Change
                    </button>
                  </div>
                )}
              </section>
            )}
          </div>

          <div className="panel setup-box">
            {fixed && (
              <section className="setup-step">
                <StepHead n={3} title={fixed.kind === 'daily' ? "Today's rules" : fixed.kind === 'weekly' ? "This week's rules" : 'The rules'} />
                {fixed?.kind === 'weekly' && weekPlan && (
                  <div className="notice" data-testid="weekly-notice">
                    {weekPlan.week}: <b>{week ? weeklyThemeLine(u, week) : weekPlan.theme}</b>. Everyone drafts a <b>{formationName(weekPlan.formationId)}</b> from the same wheel{week ? <>, in the <b>{leagueNameOf(week.leagueId)} {seasonLabel(week.season)}</b>, {week.difficulty} difficulty</> : ' (loading the league…)'}. Ends Sunday (UTC).
                  </div>
                )}
                {fixed?.kind === 'daily' && (
                  <div className="notice" data-testid="daily-notice">
                    Today's puzzle: everyone drafts a <b>{formationName(fixed.formationId)}</b> from the same wheel, in the <b>{leagueNameOf(fixed.leagueId)} {seasonLabel(fixed.season)}</b>, calibrated difficulty. Seed {fixed.seed}.
                  </div>
                )}
                {fixed?.kind === 'challenge' && challenge && (
                  <div className={`notice ${challenge.verified === 'yes' ? '' : 'warn'}`} data-testid="challenge-banner">
                    <b>Challenge from {challenge.name}</b>: {challenge.claim.pts} pts in the {leagueNameOf(fixed.leagueId)} {seasonLabel(fixed.season)}, {formationName(fixed.formationId)} ({tierName(challenge.claim.t)}, {challenge.claim.w}-{challenge.claim.d}-{challenge.claim.l}).{' '}
                    Same seed, same wheel, {fixed.difficulty} difficulty
                    {fixed.rules ? rulesTags(fixed.rules).map((t) => `, ${t.toLowerCase()}`).join('') : ''}
                    {fixed.rules?.twists ? ', twists on' : ', no twists'}
                    {fixed.rules?.budget !== undefined ? `, ${capTotal(fixed.rules.budget)} cap` : ''}
                    {fixed.rules?.chain ? ', teammate chain' : ''}
                    {fixed.rules?.onlyClub ? `, ${clubName(u, fixed.rules.onlyClub)} only` : ''}
                  {fixed.rules?.classic ? ', classic seasons (estimated ratings)' : ''}
                    {fixed.rules?.onlyNation ? `, ${u.nations[fixed.rules.onlyNation]?.name ?? fixed.rules.onlyNation} only` : ''}
                    {fixed.rules?.fromSeason || fixed.rules?.toSeason ? `, ${seasonLabel(eraFirstSeason(u, fixed.rules))} to ${seasonLabel(fixed.rules.toSeason ?? u.lastSeason)}` : ''}. Seed {fixed.seed}.
                    <div className="small" style={{ marginTop: 6 }}>
                      {challenge.verified === 'yes' && `Verified: ${challenge.name}'s picks replay to ${challenge.claim.pts} points on this data.`}
                      {challenge.verified === 'unverified' && `Unverified: built on different data (${challenge.reason}). You can still play the same wheel.`}
                      {challenge.verified === 'no' && `Could not verify the claim (${challenge.reason}). You can still play the same wheel.`}
                    </div>
                  </div>
                )}
                {fixed?.rules && (
                  <div className="pill-list" data-testid="fixed-rules">
                    {describeRules(u, fixed.rules).map((t) => (
                      <span key={t} className="chip">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </section>
            )}
            {!fixed && (
              <section className="setup-step">
                <StepHead n={4} title="Set the rules" />
                {!isManage && (
                  <div className="setup-modes" data-testid="modes-panel">
                    <SectionHead title="Modes" info={`Mix and match, or none. ${MODE_CARDS.map((c) => `${MODE_INFO[c].title}: ${MODE_INFO[c].line}.`).join(' ')}`} testId="modes" right={<span className="small muted">{cardsOn.length ? `${cardsOn.length} on` : 'None on'}</span>} />
                    <div className="setup-modes-row">
                      <ModeCards cards={MODE_CARDS} on={cardsOn} info={MODE_INFO} icons={MODE_ICON} onToggle={toggleMode} />
                      <div className="pu-setup">
                        <label className={`qmode pu-card${powerUps ? ' active' : ''}`} data-testid="power-ups-toggle" title={POWER_UPS.map((k) => `${POWER_UP_INFO[k].icon} ${POWER_UP_INFO[k].title}`).join(' · ')}>
                          <input type="checkbox" className="sr-only" checked={powerUps} onChange={(e) => setPowerUps(e.target.checked)} />
                          <span className="micon" aria-hidden="true">
                            <Package size="1em" />
                          </span>
                          <span className="ctitle">Power-ups</span>
                          <span className="cline">{powerUps ? 'On: six one-use boosts' : 'Six one-use boosts'}</span>
                        </label>
                        <InfoTip label="Power-ups" text="Six one-use power-ups in a tray on the draft: Upgrader, Re-roll season, Peek, Swap, Captain's armband and Lock. Odds are always shown first; in-game only." testId="power-ups-info" />
                      </div>
                      <div className="pu-setup">
                        <label className={`qmode pu-card${endCase ? ' active' : ''}`} data-testid="end-case-toggle" title="A power-up for your locker, or a rare Icon for this XI">
                          <input type="checkbox" className="sr-only" checked={endCase} onChange={(e) => setEndCase(e.target.checked)} />
                          <span className="micon" aria-hidden="true">
                            <Gift size="1em" />
                          </span>
                          <span className="ctitle">End case</span>
                          <span className="cline">{endCase ? 'On: one case after the draft' : 'One case after the draft'}</span>
                        </label>
                        <InfoTip label="End case" text="One case when the draft is done: a power-up for your locker (unpack it in a later Quick Draft without the tray), or with a 5% chance an Icon, an all-time great who can take a drafted starter's place this season (a non-standard season). The odds are shown on the case." testId="end-case-info" />
                      </div>
                      {/* The casual rules as two more cards: Moneyball's salary cap (its presets under Advanced) and the Teammate Chain */}
                      <div className="pu-setup">
                        <label className={`qmode pu-card${capOn ? ' active' : ''}`} data-testid="moneyball-toggle" title="Moneyball: every player carries a price by rating and position, and the draft may not spend more than the cap">
                          <input type="checkbox" className="sr-only" checked={capOn} onChange={(e) => setCapChoice({ ...cap, preset: e.target.checked ? 'moneyball' : 'off' })} />
                          <span className="micon" aria-hidden="true"><PoundSterling size="1em" /></span>
                          <span className="ctitle">Moneyball</span>
                          <span className="cline">{capOn && capCard !== undefined ? `${capTotal(capCard)} cap · ${CAP_PRESETS.find((p) => p.value === cap.preset)?.label ?? ''}` : 'Draft under a salary cap'}</span>
                        </label>
                        <label className={`qmode pu-card${chain ? ' active' : ''}`} data-testid="chain-toggle" title="Every club-season the wheel lands on holds a former teammate of your last pick, and you draft one of them. When none is left, the next spin is free and the chain starts again.">
                          <input type="checkbox" className="sr-only" checked={chain} onChange={(e) => setChain(e.target.checked)} />
                          <span className="micon" aria-hidden="true"><Link size="1em" /></span>
                          <span className="ctitle"><span className="lbl-long">Teammate chain</span><span className="lbl-short">Chain</span></span>
                          <span className="cline">{chain ? 'On: each pick played beside the last' : 'Each pick played beside the last'}</span>
                        </label>
                      </div>
                    </div>
                  </div>
                )}
                <div className="setup-rules">
                  <div className="setup-opt">
                    <h3>Difficulty</h3>
                    <ChoiceCards label="Difficulty" testId="difficulty" options={DIFFICULTY_OPTIONS} value={draftDifficulty} onChange={setDraftDifficulty} />
                  </div>
                  <div className="setup-opt">
                    <h3>Show ratings</h3>
                    <ChoiceCards label="Show ratings" testId="show-ratings" options={RATINGS_SHOWN} value={hard || !showRatings ? 'off' : 'on'} onChange={(v) => setShowRatings(v === 'on')} disabled={hard} />
                    {hard && <span className="help setup-line">Hard always hides ratings.</span>}
                  </div>
                  <div className="setup-opt">
                    <h3>Draft mode</h3>
                    <ChoiceCards label="Draft mode" testId="draft-mode" options={DRAFT_MODE_OPTIONS} value={draftMode} onChange={setDraftMode} />
                  </div>
                  {!isManage && (
                    <div className="setup-opt">
                      <h3>Player ratings</h3>
                      <ChoiceCards label="Player ratings" testId="ratings-mode" options={RATINGS_MODE_OPTIONS} value={ratingsMode} onChange={setRatingsMode} />
                    </div>
                  )}
                  {isManage && (
                    <div className="setup-opt setup-squad">
                      <h3>Squad size: {squadSize}</h3>
                      <input type="range" min={16} max={22} value={squadSize} onChange={(e) => setSquadSize(Number(e.target.value))} aria-label="Squad size to draft" />
                    </div>
                  )}
                  {!isManage && (
                    <div className="setup-opt" data-testid="manager-option">
                      <h3>Manager</h3>
                      <ChoiceCards label="Manager" testId="managers" options={MANAGER_OPTIONS} value={managerChoice} onChange={setManagerChoice} />
                    </div>
                  )}
                  {!isManage && (
                    <div className="setup-opt setup-bench" data-testid="bench-option" title="Extra picks after the XI, optional: 3 changes between games and injury cover in the season">
                      <h3>Bench</h3>
                      <Segmented value={String(benchPicks)} onChange={(v) => setBenchPicks(Number(v))} options={BENCH_OPTIONS} />
                      <span className="help setup-line">{benchPicks ? `Optional: 3 changes and injury cover.` : 'The XI plays every game.'}</span>
                    </div>
                  )}
                  <div className="setup-opt setup-wide-opt" data-testid="era">
                    <div className="setup-era-head">
                      <h3>Era</h3>
                      <Segmented value={eraPreset} onChange={setEraPreset} options={[...ERA_PRESETS.map((p) => ({ value: p.id as EraPreset, label: p.label })), ...(eraPreset === 'custom' ? [{ value: 'custom' as EraPreset, label: 'Custom' }] : [])]} />
                      {classicFrom !== undefined && (
                        <label className="toggle era-classic" title="Real squads and tables; no official ratings exist, so these are TouchLine's estimates.">
                          <input
                            type="checkbox"
                            checked={classic}
                            data-testid="era-classic"
                            onChange={(e) => {
                              setClassicOn(e.target.checked)
                              setEraPreset(e.target.checked ? 'custom' : 'all')
                              setCustomEra(e.target.checked ? [classicFrom, u.firstSeason - 1] : null)
                            }}
                          />
                          Classic {seasonLabel(classicFrom)} to {seasonLabel(u.firstSeason - 1)} <EstimatedChip compact />
                        </label>
                      )}
                      <span className="chip" data-testid="era-count" title={eraLine && eraLine.n > 0 ? eraLine.caption : undefined}>
                        {eraLine?.label}
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
                      {eraLine && eraLine.n > 0 ? `The wheel lands on ${eraLine.caption}.` : 'No seasons in this range.'}
                    </span>
                  </div>
                  <div className="setup-opt setup-wide-opt setup-more" ref={moreRef} data-testid="more-options">
                    <button type="button" className="fold-head" onClick={() => toggleAdvanced(!advanced)} aria-expanded={advanced} data-testid="more-options-toggle">
                      <h3>{isManage ? 'More options' : 'Advanced'}</h3>
                      <span className="small muted">{advanced ? 'Hide ▴' : 'Show ▾'}</span>
                    </button>
                    {!advanced && (
                      <span className="help setup-more-help">{isManage ? 'Job security, club, seed, opposition, twists and more.' : 'Seed, opposition, twists and more.'}</span>
                    )}
                    {advanced && (
                      <>
                        <div className="toggle-grid">
                          {isManage && (
                            <div className="toggle-row">
                              <label className="toggle">
                                <input type="checkbox" checked={jobSecurity} onChange={(e) => setJobSecurity(e.target.checked)} />
                                🪑 Job security
                              </label>
                              <InfoTip label="Job security" text="On: miss the board's target badly and you are sacked." />
                            </div>
                          )}
                          {u.available.length >= 2 && (
                            <div className="toggle-row">
                              <label className="toggle" data-testid="europe-toggle">
                                <input type="checkbox" checked={europe} onChange={(e) => pickEurope(e.target.checked)} />
                                <MapIcon size={14} aria-hidden="true" /> European Nights
                              </label>
                              <InfoTip label="European Nights" text={`The wheel draws from all ${u.available.length} leagues, not just yours.`} />
                            </div>
                          )}
                          <div className="toggle-row">
                            <label className="toggle">
                              <input type="checkbox" checked={twists || crazyOn} disabled={crazyOn} onChange={(e) => setTwistsChoice(e.target.checked)} data-testid="twists-toggle" />
                              🃏 Twists{crazyOn ? ': every spin' : ''}
                            </label>
                            <InfoTip label="Twists" text={`${crazyOn ? 'Crazy puts a twist on every spin.' : 'Every third spin is golden, basement, blind or decade.'} Golden: champions only. Basement: the bottom three. Blind: ratings hidden for that pick. Decade: the decade of your last pick.`} />
                          </div>
                          {!isManage && (
                            <div className="toggle-row">
                              <label className="toggle" data-testid="january-toggle">
                                <input type="checkbox" checked={january} onChange={(e) => setJanuary(e.target.checked)} />
                                ❄️ January window
                              </label>
                              <InfoTip label="January window" text="After the halfway matchweek the season pauses: one signing or swap from three to five offers, or pass, and the tactics can change." />
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
                                <Globe size={14} aria-hidden="true" /> Continental Cup
                              </label>
                              <InfoTip label="Continental Cup" text={isManage ? 'A midweek knockout against the fifteen strongest clubs from the other leagues that season. In Dynasty mode a top-four finish qualifies you again.' : 'Finish in the top four and the season ends with up to four knockout ties against the fifteen strongest clubs from the other leagues.'} />
                            </div>
                          )}
                        </div>
                        <label className="field">
                          Seed
                          <div className="row">
                            <input className="input mono" value={seed} onChange={(e) => setSeed(e.target.value)} />
                            <button className="btn sm" onClick={() => setSeed(randomSeed())}>
                              New
                            </button>
                          </div>
                          <span className="help">Same seed, same wheel.</span>
                        </label>
                        {isManage && (
                          <label className="field">
                            You replace
                            <select className="input" value={host} onChange={(e) => setHostClubId(e.target.value)} data-testid="host-select" ref={hostRef}>
                              {clubsInLeague.map((c) => (
                                <option key={c} value={c}>
                                  {u.clubById[c]?.name ?? c}
                                </option>
                              ))}
                            </select>
                            <span className="help row" style={{ gap: 8 }} data-testid="host-help">
                              <ClubBadge clubId={host} size={22} />
                              {host === defaultHost && hostRow ? `Mid-table: ${ordinal(hostRow.position)} in ${seasonLabel(effectiveSeason)}.` : 'Their colours, rivals and fixtures.'}
                            </span>
                          </label>
                        )}
                        {!superLeague && (
                        <div className="field">
                          Opposition
                          <Segmented
                            value={opposition}
                            onChange={setOpposition}
                            options={[
                              { value: 'calibrated', label: 'Calibrated', hint: 'Real clubs are handicapped so a decent draft competes' },
                              { value: 'realistic', label: 'Realistic', hint: 'The real squads at full strength. Brutal.' },
                            ]}
                          />
                          <span className="help">{opposition === 'calibrated' ? 'An average draft finishes mid-table.' : 'Full strength. Brutal.'}</span>
                        </div>
                        )}
                        <CapControl value={cap} onChange={setCapChoice} squadSize={isManage ? squadSize : QUICK_RULES.squadSize} note={CAP_NARROW_NOTE} />
                        {isManage && <ChainToggle value={chain} onChange={setChain} />}
                        <label className="field">
                          One-club mode
                          <select
                            className="input"
                            value={onlyClub}
                            onChange={(e) => {
                              setOnlyClub(e.target.value)
                              if (e.target.value) setOnlyNation('')
                              if (e.target.value) setCap((c) => ({ ...c, preset: 'off' }))
                            }}
                          >
                            <option value="">Off: every club</option>
                            {allClubs.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name} only
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="field">
                          One-nation mode
                          <select
                            className="input"
                            value={nations.some((n) => n.nation === onlyNation) ? onlyNation : ''}
                            onChange={(e) => {
                              setOnlyNation(e.target.value)
                              if (e.target.value) setOnlyClub('')
                              if (e.target.value) setCap((c) => ({ ...c, preset: 'off' }))
                            }}
                          >
                            <option value="">Off: every nationality</option>
                            {nations.map((n) => (
                              <option key={n.nation} value={n.nation}>
                                {nationDepthLabel(n)}
                              </option>
                            ))}
                          </select>
                          <span className="help">
                            {onlyNation && nations.some((n) => n.nation === onlyNation)
                              ? <><NationFlag nation={onlyNation} named /> Every pick from {nations.find((n) => n.nation === onlyNation)?.name}. One club or one nation, not both.</>
                              : `${nations.length} nations deep enough (${NATION_SLOT_COVER}× per position${isManage ? `, ${squadSize + NATION_SQUAD_MARGIN} in all` : ''}).`}
                          </span>
                        </label>
                      </>
                    )}
                  </div>
                </div>
              </section>
            )}

            <section className="setup-step setup-start bottom-bar" ref={barRef}>
              <StepHead n={fixed ? 4 : 5} title="Spin" />
              <div className="small muted" data-testid="setup-summary" title={isQuickLine ? summary : undefined}>
                {isQuickLine ? quickSetupLine(u, preview) : summary}
                {!fixed && (
                  <>
                    {' · '}
                    <button type="button" className="linklike" onClick={openMore} data-testid="setup-change">
                      change
                    </button>
                  </>
                )}
              </div>
              <button className="btn primary big block" onClick={start} disabled={!ready || loadingLeagues}>
                {!ready ? 'Loading league data…' : isManage ? 'Start drafting your squad' : challenge ? `Take on ${challenge.name}` : 'Start Draft'}
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
      <span className="sr-only">Step {n}: </span>
      {title}
    </h3>
  )
}
