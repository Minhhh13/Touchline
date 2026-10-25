import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useStore, todaysDailySeed } from '@game/store'
import type { GameSettings, Mode } from '@game/types'
import { dailyGameSettings, dailySettings, defaultHostClub, describeRules, setupRules, shortNameFor, summariseSetup } from '@game/logic/setup'
import { getFormation } from '@engine/formations'
import { DIFFICULTY_RESPINS, QUICK_RULES, SEASON_RULES, rulesTags, type DraftDifficulty, type DraftMode, type DraftRules, type RatingsMode } from '@engine/draft'
import { ERA_PRESETS, eraCount, eraHandles, wheelSeasons, type EraPreset } from '@engine/era'
import { rulesFromPayload } from '@engine/challenge'
import { TIER_LABEL } from '@engine/season'
import { NATION_SLOT_COVER, NATION_SQUAD_MARGIN, nationCover, nationDepthFrom, nationDepthLabel } from '@engine/nations'
import { randomSeed } from '@engine/rng'
import { poolClubSeasons } from '@engine/universe'
import { classicFromFor, eraFirstSeason, leagueSeasonChoices } from '@game/logic/era'
import { ordinal, seasonLabel } from '../format'
import { ClubBadge, EstimatedChip, Segmented } from '../components/bits'
import { LeagueFlag, NationFlag } from '../components/Flag'
import { Pitch } from '../components/Pitch'
import { FormationPicker } from '../components/FormationPicker'
import { ChoiceCards, SeasonRange } from '../components/SetupBits'
import { clubName } from '../format'

const MODE_TITLE: Record<Mode, string> = { quick: 'Quick Draft', daily: 'Daily Challenge', season: 'Season', dynasty: 'Dynasty' }
const MODE_LINE: Record<Mode, string> = {
  quick: 'Spin real club-seasons, draft an XI, then watch its season play out.',
  daily: 'One wheel for everyone today: same spins, same rules.',
  season: 'Draft a squad, then manage it through every matchweek.',
  dynasty: 'Draft a squad and build a club over many seasons.',
}

const respinWord = (n: number) => (n === 0 ? 'No re-spins' : `${n} re-spin${n === 1 ? '' : 's'}`)
const DIFFICULTY_OPTIONS: Array<{ value: DraftDifficulty; title: string; line: string }> = [
  { value: 'easy', title: 'Easy', line: respinWord(DIFFICULTY_RESPINS.easy) },
  { value: 'normal', title: 'Normal', line: respinWord(DIFFICULTY_RESPINS.normal) },
  { value: 'hard', title: 'Hard', line: `${respinWord(DIFFICULTY_RESPINS.hard)}, ratings hidden` },
]
const RATINGS_SHOWN: Array<{ value: 'on' | 'off'; title: string; line: string }> = [
  { value: 'on', title: 'On', line: 'See every rating as you draft' },
  { value: 'off', title: 'Off', line: 'Blind: go on names and positions' },
]
const DRAFT_MODE_OPTIONS: Array<{ value: DraftMode; title: string; line: string }> = [
  { value: 'squad', title: 'Squad First', line: 'Spin a club, draft anyone, then place him' },
  { value: 'position', title: 'Position First', line: 'Choose a slot, then spin for a club to fill it' },
]
/** Quick Draft bench places: off, or up to five extra picks the season can bring on (three changes, plus injury cover). */
const BENCH_OPTIONS: Array<{ value: string; label: string }> = [{ value: '0', label: 'Off' }, ...[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))]
/** Quick Draft managers: pick one of the real managers of the club-seasons drafted, or play without. */
const MANAGER_OPTIONS: Array<{ value: 'on' | 'off'; title: string; line: string }> = [
  { value: 'on', title: 'On', line: 'Pick a real manager from the clubs you drafted' },
  { value: 'off', title: 'Off', line: 'No manager: the XI on its own' },
]
const RATINGS_MODE_OPTIONS: Array<{ value: RatingsMode; title: string; line: string }> = [
  { value: 'season', title: 'Season', line: 'Rated as he was in that very season' },
  { value: 'prime', title: 'Prime', line: 'Every player at his career best' },
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
  const { universe: u, setupMode: mode, startGame, go, ensureLeagues, loadingLeagues, loadedLeagues, pendingChallenge } = useStore()
  const isDaily = mode === 'daily'
  const isManage = mode === 'season' || mode === 'dynasty'
  const modeBase: DraftRules = isManage ? SEASON_RULES : QUICK_RULES
  const [leagueId, setLeagueId] = useState('england')
  const [europe, setEurope] = useState(false)
  const [teamName, setTeamName] = useState('Touchline XI')
  const [formationId, setFormationId] = useState('4-3-3')
  // The 38-0 options, each defaulting to the mode's base rules
  const [draftDifficulty, setDraftDifficulty] = useState<DraftDifficulty>(modeBase.difficulty ?? 'normal')
  const [showRatings, setShowRatings] = useState(true)
  const [draftMode, setDraftMode] = useState<DraftMode>('squad')
  const [ratingsMode, setRatingsMode] = useState<RatingsMode>('season')
  const [eraPreset, setEraPreset] = useState<EraPreset>('all')
  const [customEra, setCustomEra] = useState<[number, number] | null>(null)
  // Classic seasons (1992-93 to 2007-08, estimated ratings): off unless asked for, never on the Daily
  const [classicOn, setClassicOn] = useState(false)
  const [onlyClub, setOnlyClub] = useState('')
  const [onlyNation, setOnlyNation] = useState('')
  // Quick Draft: up to five bench places, optional (the draft may still stop at eleven)
  const [benchPicks, setBenchPicks] = useState(5)
  // Quick Draft: a manager picked after the draft, on unless switched off
  const [managers, setManagers] = useState(true)
  // Twists default on for a quick draft and off for a managed season; null means the default for the mode
  const [twistsChoice, setTwistsChoice] = useState<boolean | null>(null)
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

  // Classic league seasons are listed too, tagged: their rivals' ratings are estimated
  const seasonChoices = useMemo(() => (u ? leagueSeasonChoices(u, leagueId) : []), [u, leagueId])
  const seasons = useMemo(() => seasonChoices.map((s) => s.season), [seasonChoices])
  const effectiveSeason = seasons.includes(leagueSeason) ? leagueSeason : seasons[seasons.length - 1] ?? leagueSeason
  const clubsInLeague = useMemo(() => (u ? u.clubSeasons.filter((cs) => cs.leagueId === leagueId && cs.season === effectiveSeason).map((cs) => cs.clubId).sort((a, b) => (u.clubById[a]?.name ?? a).localeCompare(u.clubById[b]?.name ?? b)) : []), [u, leagueId, effectiveSeason])
  const wheelLeagues = useMemo(() => (europe && u ? u.available.map((l) => l.id) : [leagueId]), [europe, leagueId, u])
  const classicFrom = u ? classicFromFor(u, wheelLeagues) : undefined
  const classic = !isDaily && classicOn && classicFrom !== undefined
  // The era slider runs over the seasons the wheel leagues hold (classic ones only when the Classic toggle is on)
  const eraStops = useMemo(() => (u ? wheelSeasons(u, wheelLeagues, classic) : []), [u, wheelLeagues, classic])
  const first = eraStops[0] ?? u?.firstSeason ?? 2008
  const last = eraStops[eraStops.length - 1] ?? u?.lastSeason ?? 2026
  const [eraFrom, eraTo] = eraPreset === 'custom' && customEra ? customEra : eraHandles(eraPreset === 'custom' ? 'all' : eraPreset, first, last)
  const twists = twistsChoice ?? !!modeBase.twists
  const base: DraftRules = isManage ? { ...SEASON_RULES, squadSize } : QUICK_RULES
  // Everything the cards, the slider and the toggles say, as the rules Start will send (before the club and nation checks)
  const chosen = setupRules(base, { difficulty: draftDifficulty, showRatings, draftMode, ratings: isManage ? 'season' : ratingsMode, eraFrom, eraTo, first, last, twists, leagues: wheelLeagues, benchPicks: isManage ? 0 : benchPicks, classic, ...(isManage ? {} : { managers }) })
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
  const openMore = () => {
    toggleAdvanced(true)
    moreRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // The daily puzzle and a challenge link fix everything but the team name and the picks: formation, league, host club,
  // season, difficulty and the draft rules are not the player's to choose.
  const fixed = ((): { kind: 'daily' | 'challenge'; season: number; host: string; formationId: string; leagueId: string; wheelLeagues: string[]; difficulty: 'calibrated' | 'realistic'; rules: DraftRules | null; seed: string } | null => {
    if (pendingChallenge) {
      const c = pendingChallenge.payload
      return { kind: 'challenge', season: c.s.ls, host: c.s.h, formationId: c.s.f, leagueId: c.s.l, wheelLeagues: c.s.wl, difficulty: c.s.d, rules: rulesFromPayload(c), seed: c.s.seed }
    }
    if (!isDaily) return null
    // Every rule of the Daily comes from `dailySettings`, so it is the same wheel for everyone
    const d = dailySettings(u, todaysDailySeed())
    return { kind: 'daily', season: d.season, host: d.host, formationId: d.formationId, leagueId: d.leagueId, wheelLeagues: d.wheelLeagues, difficulty: d.difficulty, rules: d.rules, seed: d.seed }
  })()
  const challenge = pendingChallenge?.challenge ?? null
  const fixedReady = !fixed || (fixed.wheelLeagues.every((l) => loadedLeagues.includes(l)) && loadedLeagues.includes(fixed.leagueId))

  /** The settings the Start button would send; a blank seed is drawn at that moment, so a preview names it as such. */
  const buildSettings = (preview: boolean): GameSettings => {
    const name = teamName.trim() || 'Touchline XI'
    if (fixed?.kind === 'daily') return dailyGameSettings(u, fixed.seed, name)
    const club = onlyClub && allClubs.some((c) => c.id === onlyClub) ? onlyClub : undefined
    const nation = onlyNation && nations.some((n) => n.nation === onlyNation) ? onlyNation : undefined
    const rules: DraftRules = fixed?.rules ?? { ...chosen, onlyClub: club, onlyNation: nation }
    return {
      // A challenge always plays as a quick draft, whatever seed it carries, so the Daily streak is never touched
      mode: challenge ? 'quick' : mode,
      seed: fixed ? fixed.seed : seed.trim() || (preview ? 'drawn when you start' : randomSeed()),
      formationId: fixed ? fixed.formationId : formationId,
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
  const start = () => startGame(buildSettings(false))
  const summary = summariseSetup(u, buildSettings(true))
  const ready = fixed ? fixedReady : leagueReady
  const shownFormation = getFormation(fixed ? fixed.formationId : formationId)
  const hard = draftDifficulty === 'hard'
  const teamField = (
    <label className="field">
      Team name
      <input className="input" value={teamName} onChange={(e) => setTeamName(e.target.value)} maxLength={28} />
    </label>
  )

  return (
    <div className="page has-bottom-bar" style={barHeight ? ({ '--bottom-bar-h': `${barHeight}px` } as CSSProperties) : undefined}>
      <div className="setup-flow">
        <div className="row between wrap" style={{ alignItems: 'flex-start' }}>
          <div>
            <h1>{challenge ? 'Challenge' : MODE_TITLE[mode]}</h1>
            <p className="muted setup-sub">{challenge ? `Same seed, same wheel: beat ${challenge.name}'s score.` : MODE_LINE[mode]}</p>
          </div>
          <button className="btn ghost" onClick={() => go('home')}>
            ← Back
          </button>
        </div>

        {fixed && (
          <div className="panel col">
            {teamField}
            {fixed.kind === 'daily' && (
              <div className="notice" data-testid="daily-notice">
                Today's puzzle: everyone drafts a <b>{fixed.formationId}</b> from the same wheel, as <b>{u.clubById[fixed.host]?.name}</b> in the <b>{seasonLabel(fixed.season)}</b> league, calibrated difficulty. Seed {fixed.seed}.
              </div>
            )}
            {fixed.kind === 'challenge' && challenge && (
              <div className={`notice ${challenge.verified === 'yes' ? '' : 'warn'}`} data-testid="challenge-banner">
                <b>Challenge from {challenge.name}</b>: {challenge.claim.pts} pts as {clubName(u, fixed.host)} {seasonLabel(fixed.season)}, {fixed.formationId} ({TIER_LABEL[challenge.claim.t]}, {challenge.claim.w}-{challenge.claim.d}-{challenge.claim.l}).{' '}
                Same seed, same wheel, {fixed.difficulty} difficulty
                {fixed.rules ? rulesTags(fixed.rules).map((t) => `, ${t.toLowerCase()}`).join('') : ''}
                {fixed.rules?.twists ? ', twists on' : ', no twists'}
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
            {fixed.rules && (
              <div className="pill-list" data-testid="fixed-rules">
                {describeRules(u, fixed.rules).map((t) => (
                  <span key={t} className="chip">
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {!fixed && isManage && (
          <div className="panel col">
            <h3>Your squad</h3>
            {teamField}
            <label className="field">
              Squad size to draft: {squadSize}
              <input type="range" min={16} max={22} value={squadSize} onChange={(e) => setSquadSize(Number(e.target.value))} />
            </label>
            <label className="toggle">
              <input type="checkbox" checked={jobSecurity} onChange={(e) => setJobSecurity(e.target.checked)} />
              Job security: the board can sack you
            </label>
          </div>
        )}

        <div className="panel col">
          <h3>Formation</h3>
          {!fixed && (
            <FormationPicker value={formationId} onChange={setFormationId} />
          )}
          {/* A picture of the shape, not a control: inert keeps its slot discs out of the tab order and the accessibility tree */}
          <div className="pitch-mini" data-testid="formation-preview" inert>
            <Pitch formation={shownFormation} lineup={{}} getPlayer={() => undefined} />
          </div>
          <p className="help setup-line">
            <b>{shownFormation.name}</b>: {shownFormation.blurb}
          </p>
        </div>

        {!fixed && (
          <div className="panel col">
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
              <div className="setup-opt" data-testid="bench-option">
                <h3>Bench</h3>
                <Segmented value={String(benchPicks)} onChange={(v) => setBenchPicks(Number(v))} options={BENCH_OPTIONS} />
                <span className="help setup-line">{benchPicks ? `Up to ${benchPicks} extra pick${benchPicks === 1 ? '' : 's'}, optional. Any pick can go to the bench; in the season make 3 changes between games, and injured starters are covered from it.` : 'No bench: the XI plays every game.'}</span>
              </div>
            )}
            {!isManage && (
              <div className="setup-opt" data-testid="manager-option">
                <h3>Manager</h3>
                <ChoiceCards label="Manager" testId="managers" options={MANAGER_OPTIONS} value={managers ? 'on' : 'off'} onChange={(v) => setManagers(v === 'on')} />
                <span className="help setup-line">{managers ? 'After the draft, choose who picks the team: each style gives a small edge.' : 'No manager: the season plays on the XI and the tactics alone.'}</span>
              </div>
            )}
            {!isManage && (
              <div className="setup-opt">
                <h3>Player ratings</h3>
                <ChoiceCards label="Player ratings" testId="ratings-mode" options={RATINGS_MODE_OPTIONS} value={ratingsMode} onChange={setRatingsMode} />
              </div>
            )}
          </div>
        )}

        {!fixed && (
          <div className="panel col" data-testid="era">
            <div className="row between wrap">
              <h3>Era</h3>
              <span className="row wrap" style={{ gap: 'var(--space-2)' }}>
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
                <span className="chip" data-testid="era-count">
                  {eraLine?.label}
                </span>
              </span>
            </div>
            <Segmented value={eraPreset} onChange={setEraPreset} options={[...ERA_PRESETS.map((p) => ({ value: p.id as EraPreset, label: p.label })), ...(eraPreset === 'custom' ? [{ value: 'custom' as EraPreset, label: 'Custom' }] : [])]} />
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
        )}

        {!fixed && (
          <div className="panel col" ref={moreRef} data-testid="more-options">
            <button type="button" className="fold-head" onClick={() => toggleAdvanced(!advanced)} aria-expanded={advanced} data-testid="more-options-toggle">
              <h3>{isManage ? 'More options' : 'Advanced'}</h3>
              <span className="small muted">{advanced ? 'Hide ▴' : 'Show ▾'}</span>
            </button>
            {!advanced && (
              <span className="help">
                {isManage ? '' : 'Team name, '}European Nights, twists, {isManage ? '' : 'the January window, '}seed, league and season, your club, the opposition, one-club and one-nation{u.available.length >= 2 ? ', the Continental Cup' : ''}. The line above Start states them.
              </span>
            )}
            {advanced && (
              <>
                {u.available.length >= 2 && (
                  <label className="toggle" data-testid="europe-toggle">
                    <input type="checkbox" checked={europe} onChange={(e) => pickEurope(e.target.checked)} />
                    <LeagueFlag leagueId="europe" /> European Nights: draft from all {u.available.length} leagues
                  </label>
                )}
                <label className="toggle" title="Golden: champions only. Basement: the bottom three. Blind: ratings hidden for that pick. Decade: the decade of your last pick.">
                  <input type="checkbox" checked={twists} onChange={(e) => setTwistsChoice(e.target.checked)} />
                  Twists: every third spin is golden, basement, blind or decade
                </label>
                {!isManage && (
                  <label className="toggle" data-testid="january-toggle" title="After the halfway matchweek the season pauses: one signing or swap from three to five offers, or pass, and the tactics can change.">
                    <input type="checkbox" checked={january} onChange={(e) => setJanuary(e.target.checked)} />
                    January window: one deal at the halfway mark
                  </label>
                )}
                {isManage && u.available.length >= 2 && (
                  <label className="toggle" data-testid="continental-toggle" title="A midweek knockout against the fifteen strongest clubs from the other leagues that season. In Dynasty mode a top-four finish qualifies you again.">
                    <input
                      type="checkbox"
                      checked={continental}
                      onChange={(e) => {
                        setContinental(e.target.checked)
                        if (e.target.checked) void ensureLeagues(u.available.map((l) => l.id))
                      }}
                    />
                    Continental Cup: a midweek knockout against the best of the other leagues
                  </label>
                )}
                {!isManage && teamField}
                <label className="field">
                  Seed
                  <div className="row">
                    <input className="input mono" value={seed} onChange={(e) => setSeed(e.target.value)} />
                    <button className="btn sm" onClick={() => setSeed(randomSeed())}>
                      New
                    </button>
                  </div>
                  <span className="help">Share a seed and a friend gets the same wheel.</span>
                </label>
                <div className="field">
                  League
                  <Segmented value={leagueId} onChange={pickLeague} options={u.available.map((l) => ({ value: l.id, label: <><LeagueFlag leagueId={l.id} /> {l.name}</>, hint: `${l.playerSeasons.toLocaleString()} player-seasons` }))} />
                  <span className="help">{loadingLeagues ? 'Loading league data…' : europe ? 'Where your side plays; the wheel draws from every league.' : 'Where your side plays, and where the wheel draws from.'}</span>
                </div>
                <label className="field">
                  League season to play in
                  <select className="input" value={effectiveSeason} onChange={(e) => setLeagueSeason(Number(e.target.value))}>
                    {seasonChoices.map(({ season: s, classic: est }) => (
                      <option key={s} value={s}>
                        {seasonLabel(s)} {s === u.currentSeason ? '(in progress)' : ''}{est ? '(estimated ratings)' : ''}
                      </option>
                    ))}
                  </select>
                  <span className="help">You replace one real club and play its {Math.max(0, clubsInLeague.length - 1)} rivals with their real squads.</span>
                </label>
                <label className="field">
                  Club whose place you take
                  <select className="input" value={host} onChange={(e) => setHostClubId(e.target.value)} data-testid="host-select">
                    {clubsInLeague.map((c) => (
                      <option key={c} value={c}>
                        {u.clubById[c]?.name ?? c}
                      </option>
                    ))}
                  </select>
                  <span className="help row" style={{ gap: 8 }} data-testid="host-help">
                    <ClubBadge clubId={host} size={22} />
                    {host === defaultHost && hostRow ? `A mid-table club (${ordinal(hostRow.position)} in ${seasonLabel(effectiveSeason)}), so the board's target is reachable.` : 'You take their colours, rivals and fixtures.'}
                  </span>
                </label>
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
                  <span className="help">{opposition === 'calibrated' ? 'Scaled so an average draft finishes mid-table.' : 'Real squads at full strength: only a great draft survives.'}</span>
                </div>
                <label className="field">
                  One-club mode
                  <select
                    className="input"
                    value={onlyClub}
                    onChange={(e) => {
                      setOnlyClub(e.target.value)
                      if (e.target.value) setOnlyNation('')
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
                      ? <><NationFlag nation={onlyNation} named /> Every pick, signing and academy prospect comes from {nations.find((n) => n.nation === onlyNation)?.name}. One club or one nation, not both.</>
                      : `${nations.length} nations have ${NATION_SLOT_COVER}× the players for every position in a ${formationId}${isManage ? ` and ${squadSize + NATION_SQUAD_MARGIN} in all` : ''}.`}
                  </span>
                </label>
              </>
            )}
          </div>
        )}

        <div className="bottom-bar" ref={barRef}>
          {!isManage && <div className="setup-goal" data-testid="setup-goal"><b>Win every game.</b> The goal of a Quick Draft is the perfect season: every league game won, 38-0.</div>}
          <div className="small muted" data-testid="setup-summary">
            {summary}
            {!fixed && (
              <>
                {' · '}
                <button type="button" className="linklike" onClick={openMore}>
                  change
                </button>
              </>
            )}
          </div>
          <button className="btn primary big block" onClick={start} disabled={!ready || loadingLeagues}>
            {!ready ? 'Loading league data…' : isManage ? 'Start drafting your squad' : challenge ? `Take on ${challenge.name}` : 'Start Draft'}
          </button>
        </div>
      </div>
    </div>
  )
}
