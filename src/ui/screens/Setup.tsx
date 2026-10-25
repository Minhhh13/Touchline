import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useStore, todaysDailySeed } from '@game/store'
import type { GameSettings, Mode } from '@game/types'
import { dailyGameSettings, dailySettings, defaultHostClub, shortNameFor, summariseSetup } from '@game/logic/setup'
import { FORMATIONS, getFormation } from '@engine/formations'
import { QUICK_RULES, SEASON_RULES, type DraftRules } from '@engine/draft'
import { rulesFromPayload } from '@engine/challenge'
import { TIER_LABEL } from '@engine/season'
import { NATION_SLOT_COVER, NATION_SQUAD_MARGIN, nationCover, nationDepthFrom, nationDepthLabel } from '@engine/nations'
import { randomSeed } from '@engine/rng'
import { poolClubSeasons } from '@engine/universe'
import { classicFromFor, eraRules, eraSeasons, leagueSeasonChoices, type Era } from '@game/logic/era'
import { ordinal, seasonLabel } from '../format'
import { ClubBadge, Segmented } from '../components/bits'
import { clubName } from '../format'

const MODE_TITLE: Record<Mode, string> = { quick: 'Quick Draft', daily: 'Daily Challenge', season: 'Season', dynasty: 'Dynasty' }

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

function listNames(names: string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

export function Setup() {
  const { universe: u, setupMode: mode, startGame, go, ensureLeagues, loadingLeagues, loadedLeagues, pendingChallenge } = useStore()
  const [leagueId, setLeagueId] = useState('england')
  const [wheelScope, setWheelScope] = useState<'league' | 'europe'>('league')
  const [teamName, setTeamName] = useState('Touchline XI')
  const [formationId, setFormationId] = useState('4-3-3')
  const [era, setEra] = useState<Era>('all')
  const [includeClassic, setIncludeClassic] = useState(false)
  const [from, setFrom] = useState(u?.firstSeason ?? 2008)
  const [to, setTo] = useState(u?.lastSeason ?? 2026)
  const [onlyClub, setOnlyClub] = useState('')
  const [onlyNation, setOnlyNation] = useState('')
  const [hardMode, setHardMode] = useState(false)
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
  const [difficulty, setDifficulty] = useState<'calibrated' | 'realistic'>('calibrated')
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
  const wheelLeagues = useMemo(() => (wheelScope === 'europe' && u ? u.available.map((l) => l.id) : [leagueId]), [wheelScope, leagueId, u])
  const isDaily = mode === 'daily'
  const isManage = mode === 'season' || mode === 'dynasty'
  const twists = twistsChoice ?? (isManage ? SEASON_RULES.twists ?? false : QUICK_RULES.twists ?? false)
  // Classic seasons (estimated ratings) are offered only when a wheel league has them; the Daily never sees them
  const classicFrom = u ? classicFromFor(u, wheelLeagues) : undefined
  const eraRange = u ? eraRules(u, { era, from, to, includeClassic, isDaily, leagues: wheelLeagues }) : {}
  const rangeSeasons = useMemo(() => (u ? eraSeasons(u, wheelLeagues) : []), [u, wheelLeagues])
  // Only clubs the wheel could actually land on: in a wheel league, with a squad inside the chosen era
  const allClubs = useMemo(() => {
    if (!u) return []
    const lo = eraRange.fromSeason ?? -Infinity
    const hi = eraRange.toSeason ?? Infinity
    const inEra = new Set(poolClubSeasons(u, eraRange.classic).filter((cs) => cs.season >= lo && cs.season <= hi).map((cs) => cs.clubId))
    return [...u.clubs].filter((c) => wheelLeagues.includes(c.leagueId) && inEra.has(c.id)).sort((a, b) => a.name.localeCompare(b.name))
  }, [u, wheelLeagues, eraRange.fromSeason, eraRange.toSeason, eraRange.classic])
  // Nations deep enough for a one-nation draft of this shape: twice the cover for every position, inside the wheel leagues and era.
  // The scan over every player-season runs once per shape; the squad-size slider only re-filters it.
  const nationScan = useMemo(() => (u && !isDaily ? nationCover(u, wheelLeagues, eraRange, getFormation(formationId)) : []), [u, isDaily, wheelLeagues, eraRange.fromSeason, eraRange.toSeason, eraRange.classic, formationId])
  const nations = useMemo(() => nationDepthFrom(nationScan, isManage ? squadSize : 11), [nationScan, isManage, squadSize])
  const leagueReady = loadedLeagues.includes(leagueId) && wheelLeagues.every((l) => loadedLeagues.includes(l)) && (!continental || !u || u.available.every((l) => loadedLeagues.includes(l.id)))
  // The club handed over by default sits nearest tenth in that season's real table, so the board's ask is reachable
  const defaultHost = useMemo(() => (u ? defaultHostClub(u, leagueId, effectiveSeason, clubsInLeague) : ''), [u, leagueId, effectiveSeason, clubsInLeague])
  const host = hostClubId && clubsInLeague.includes(hostClubId) ? hostClubId : defaultHost
  const hostRow = u?.tables[leagueId]?.[effectiveSeason]?.find((r) => r.clubId === host)

  if (!u) return <div className="page">Loading…</div>
  const pickLeague = (id: string) => {
    setLeagueId(id)
    setHostClubId('')
    void ensureLeagues(wheelScope === 'europe' ? u.available.map((l) => l.id) : [id])
  }
  const pickScope = (scope: 'league' | 'europe') => {
    setWheelScope(scope)
    void ensureLeagues(scope === 'europe' ? u.available.map((l) => l.id) : [leagueId])
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
  // season, difficulty and (for a challenge) the wheel rules and the seed are not the player's to choose.
  const fixed = ((): { kind: 'daily' | 'challenge'; season: number; host: string; formationId: string; leagueId: string; wheelLeagues: string[]; difficulty: 'calibrated' | 'realistic'; rules: DraftRules | null; seed: string } | null => {
    if (pendingChallenge) {
      const c = pendingChallenge.payload
      return { kind: 'challenge', season: c.s.ls, host: c.s.h, formationId: c.s.f, leagueId: c.s.l, wheelLeagues: c.s.wl, difficulty: c.s.d, rules: rulesFromPayload(c), seed: c.s.seed }
    }
    if (!isDaily) return null
    const d = dailySettings(u, todaysDailySeed())
    return { kind: 'daily', season: d.season, host: d.host, formationId: d.formationId, leagueId: d.leagueId, wheelLeagues: d.wheelLeagues, difficulty: d.difficulty, rules: null, seed: d.seed }
  })()
  const challenge = pendingChallenge?.challenge ?? null
  const fixedReady = !fixed || (fixed.wheelLeagues.every((l) => loadedLeagues.includes(l)) && loadedLeagues.includes(fixed.leagueId))

  /** The settings the Start button would send; a blank seed is drawn at that moment, so a preview names it as such. */
  const buildSettings = (preview: boolean): GameSettings => {
    const name = teamName.trim() || 'Touchline XI'
    if (fixed?.kind === 'daily') return dailyGameSettings(u, fixed.seed, name)
    const base: DraftRules = isManage ? { ...SEASON_RULES, squadSize } : QUICK_RULES
    const club = onlyClub && allClubs.some((c) => c.id === onlyClub) ? onlyClub : undefined
    const nation = onlyNation && nations.some((n) => n.nation === onlyNation) ? onlyNation : undefined
    const rules: DraftRules = fixed?.rules ?? { ...base, ...eraRange, onlyClub: club, onlyNation: nation, hardMode, twists, leagues: wheelLeagues }
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
      difficulty: fixed ? fixed.difficulty : difficulty,
      continental: isManage && continental && u.available.length >= 2,
      ...(challenge ? { challenge } : {}),
    }
  }
  const start = () => startGame(buildSettings(false))
  const summary = summariseSetup(u, buildSettings(true))
  const ready = fixed ? fixedReady : leagueReady

  return (
    <div className="page has-bottom-bar" style={barHeight ? ({ '--bottom-bar-h': `${barHeight}px` } as CSSProperties) : undefined}>
      <div className="row between wrap" style={{ marginBottom: 12 }}>
        <h1>{challenge ? 'Challenge' : MODE_TITLE[mode]}</h1>
        <button className="btn ghost" onClick={() => go('home')}>
          ← Back
        </button>
      </div>
      <div className="grid two">
        <div className="col">
          <div className="panel col">
            <h3>Your team</h3>
            <label className="field">
              Team name
              <input className="input" value={teamName} onChange={(e) => setTeamName(e.target.value)} maxLength={28} />
            </label>
            {fixed?.kind === 'daily' && (
              <div className="notice" data-testid="daily-notice">
                Today's puzzle: everyone drafts a <b>{fixed.formationId}</b> from the same wheel, as <b>{u.clubById[fixed.host]?.name}</b> in the <b>{seasonLabel(fixed.season)}</b> league, calibrated difficulty. Seed {fixed.seed}.
              </div>
            )}
            {fixed?.kind === 'challenge' && challenge && (
              <div className={`notice ${challenge.verified === 'yes' ? '' : 'warn'}`} data-testid="challenge-banner">
                <b>Challenge from {challenge.name}</b>: {challenge.claim.pts} pts as {clubName(u, fixed.host)} {seasonLabel(fixed.season)}, {fixed.formationId} ({TIER_LABEL[challenge.claim.t]}, {challenge.claim.w}-{challenge.claim.d}-{challenge.claim.l}).{' '}
                Same seed, same wheel, {fixed.difficulty} difficulty
                {fixed.rules?.hardMode ? ', hard mode' : ''}
                {fixed.rules?.twists ? ', twists on' : ', no twists'}
                {fixed.rules?.onlyClub ? `, ${clubName(u, fixed.rules.onlyClub)} only` : ''}
                {fixed.rules?.classic ? ', classic seasons (estimated ratings)' : ''}
                {fixed.rules?.onlyNation ? `, ${u.nations[fixed.rules.onlyNation]?.name ?? fixed.rules.onlyNation} only` : ''}
                {fixed.rules?.fromSeason || fixed.rules?.toSeason ? `, ${seasonLabel(fixed.rules.fromSeason ?? u.firstSeason)} to ${seasonLabel(fixed.rules.toSeason ?? u.lastSeason)}` : ''}. Seed {fixed.seed}.
                <div className="small" style={{ marginTop: 6 }}>
                  {challenge.verified === 'yes' && `Verified: ${challenge.name}'s picks replay to ${challenge.claim.pts} points on this data.`}
                  {challenge.verified === 'unverified' && `Unverified: built on different data (${challenge.reason}). You can still play the same wheel.`}
                  {challenge.verified === 'no' && `Could not verify the claim (${challenge.reason}). You can still play the same wheel.`}
                </div>
              </div>
            )}
            {!fixed && (
              <div className="field">
                League
                <Segmented value={leagueId} onChange={pickLeague} options={u.available.map((l) => ({ value: l.id, label: l.name, hint: `${l.playerSeasons.toLocaleString()} player-seasons` }))} />
                <span className="help">{loadingLeagues ? 'Loading league data…' : 'Where your side plays. Each league has its own real clubs and seasons.'}</span>
              </div>
            )}
            {!fixed && isManage && (
              <>
                <label className="field">
                  Squad size to draft: {squadSize}
                  <input type="range" min={16} max={22} value={squadSize} onChange={(e) => setSquadSize(Number(e.target.value))} />
                </label>
                <label className="toggle">
                  <input type="checkbox" checked={jobSecurity} onChange={(e) => setJobSecurity(e.target.checked)} />
                  Job security: the board can sack you
                </label>
              </>
            )}
          </div>

          {!fixed && (
            <div className="panel col" ref={moreRef} data-testid="more-options">
              <button type="button" className="fold-head" onClick={() => toggleAdvanced(!advanced)} aria-expanded={advanced} data-testid="more-options-toggle">
                <h3>More options</h3>
                <span className="small muted">{advanced ? 'Hide ▴' : 'Show ▾'}</span>
              </button>
              {!advanced && (
                <span className="help">
                  League season, the club whose place you take, difficulty, seed, where the wheel draws from, era, one-club and one-nation modes, hard mode and twists{isManage && u.available.length >= 2 ? ', the Continental Cup' : ''}. The line above Start states what they are set to.
                </span>
              )}
              {advanced && (
                <>
                  <label className="field">
                    League season to play in
                    <select className="input" value={effectiveSeason} onChange={(e) => setLeagueSeason(Number(e.target.value))}>
                      {seasonChoices.map(({ season: s, classic }) => (
                        <option key={s} value={s}>
                          {seasonLabel(s)} {s === u.currentSeason ? '(in progress)' : ''}{classic ? '(estimated ratings)' : ''}
                        </option>
                      ))}
                    </select>
                    <span className="help">
                      Your drafted side replaces one real club and plays its {Math.max(0, clubsInLeague.length - 1)} rivals with their real squads of that season.
                      {seasonChoices.find((c) => c.season === effectiveSeason)?.classic ? ' A classic season: the squads and the table are real, the ratings are our estimate.' : ''}
                    </span>
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
                      {host === defaultHost && hostRow
                        ? `A mid-table club (${ordinal(hostRow.position)} in ${seasonLabel(effectiveSeason)}), so the board's target is reachable. Change it if you want another club's colours and rivals.`
                        : 'You inherit their colours, rivals and fixture list. Their real players sit the season out.'}
                    </span>
                  </label>
                  <div className="field">
                    Difficulty
                    <Segmented
                      value={difficulty}
                      onChange={setDifficulty}
                      options={[
                        { value: 'calibrated', label: 'Calibrated', hint: 'Real clubs are handicapped so a decent draft competes' },
                        { value: 'realistic', label: 'Realistic', hint: 'The real squads at full strength. Brutal.' },
                      ]}
                    />
                    <span className="help">{difficulty === 'calibrated' ? 'The league is scaled so an average draft finishes mid-table and a great one wins it.' : 'Modern top clubs field eleven 85+ players. Only a legendary draft survives.'}</span>
                  </div>
                  <label className="field">
                    Seed
                    <div className="row">
                      <input className="input mono" value={seed} onChange={(e) => setSeed(e.target.value)} />
                      <button className="btn sm" onClick={() => setSeed(randomSeed())}>
                        New
                      </button>
                    </div>
                    <span className="help">Share a seed with a friend and you both get the same wheel.</span>
                  </label>

                  <h3 style={{ marginTop: 6 }}>Wheel rules</h3>
                  <div className="field">
                    Draft from
                    <Segmented value={wheelScope} onChange={pickScope} options={[{ value: 'league', label: `${u.available.find((l) => l.id === leagueId)?.name ?? 'This league'} only` }, { value: 'europe', label: `European Nights: all ${u.available.length} leagues` }]} />
                    <span className="help">{wheelScope === 'europe' ? `The wheel and the market draw from ${listNames(u.available.map((l) => l.country))}.` : 'The wheel and the market stay inside one league.'}</span>
                  </div>
                  <div className="field">
                    Era
                    <Segmented
                      value={era === 'classic' && classicFrom === undefined ? 'all' : era}
                      onChange={setEra}
                      options={[
                        { value: 'all', label: 'All eras' },
                        ...(classicFrom !== undefined ? [{ value: 'classic' as const, label: `Classic: ${seasonLabel(classicFrom)} to ${seasonLabel(u.firstSeason - 1)}`, hint: 'Real squads and tables with estimated ratings', testId: 'era-classic' }] : []),
                        { value: 'early', label: `${seasonLabel(u.firstSeason)} to 2013-14` },
                        { value: 'mid', label: '2014-15 to 2019-20' },
                        { value: 'modern', label: '2020-21 onwards' },
                        { value: 'custom', label: 'Custom' },
                      ]}
                    />
                    {classicFrom !== undefined && era === 'all' && (
                      <label className="toggle">
                        <input type="checkbox" checked={includeClassic} onChange={(e) => setIncludeClassic(e.target.checked)} data-testid="include-classic" />
                        Include classic seasons ({seasonLabel(classicFrom)} to {seasonLabel(u.firstSeason - 1)})
                      </label>
                    )}
                    {classicFrom !== undefined && (
                      <span className="help" data-testid="classic-help">
                        {seasonLabel(classicFrom)} to {seasonLabel(u.firstSeason - 1)} use TouchLine's estimated ratings (no official ratings exist); squads and tables are real.{eraRange.classic ? ' Classic seasons are on.' : ''}
                      </span>
                    )}
                  </div>
                  {era === 'custom' && (
                    <div className="row">
                      <select className="input" value={Math.max(from, rangeSeasons[0] ?? from)} onChange={(e) => setFrom(Number(e.target.value))}>
                        {rangeSeasons.map((s) => (
                          <option key={s} value={s}>
                            {seasonLabel(s)}
                          </option>
                        ))}
                      </select>
                      <span>to</span>
                      <select className="input" value={Math.max(to, rangeSeasons[0] ?? to)} onChange={(e) => setTo(Number(e.target.value))}>
                        {rangeSeasons.map((s) => (
                          <option key={s} value={s}>
                            {seasonLabel(s)}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
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
                        ? `Every pick, signing and academy prospect must come from ${nations.find((n) => n.nation === onlyNation)?.name}. One club or one nation, not both.`
                        : `${nations.length} nations have at least ${NATION_SLOT_COVER}× the players for every position in a ${formationId}${isManage ? ` and ${squadSize + NATION_SQUAD_MARGIN} in all` : ''}, in the leagues and era chosen.`}
                    </span>
                  </label>
                  <label className="toggle">
                    <input type="checkbox" checked={hardMode} onChange={(e) => setHardMode(e.target.checked)} />
                    Hard mode: ratings hidden while drafting
                  </label>
                  <label className="toggle" title="Golden: champions only. Basement: the bottom three. Blind: ratings hidden for that pick. Decade: the decade of your last pick.">
                    <input type="checkbox" checked={twists} onChange={(e) => setTwistsChoice(e.target.checked)} />
                    Twists: every third spin is golden, basement, blind or decade
                  </label>
                  {isManage && u.available.length >= 2 && (
                    <label className="toggle" title="A midweek knockout against the fifteen strongest clubs from the other leagues that season. In Dynasty mode a top-four finish qualifies you again.">
                      <input
                        type="checkbox"
                        checked={continental}
                        onChange={(e) => {
                          setContinental(e.target.checked)
                          if (e.target.checked) void ensureLeagues(u.available.map((l) => l.id))
                        }}
                      />
                      Continental Cup: European nights against the best of the other leagues
                    </label>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <div className="col">
          {!fixed && (
            <div className="panel">
              <h3>Formation</h3>
              <div className="formations">
                {FORMATIONS.map((f) => (
                  <button key={f.id} className={f.id === formationId ? 'active' : ''} onClick={() => setFormationId(f.id)}>
                    <div className="fname">{f.name}</div>
                    <div className="fblurb">{f.blurb}</div>
                  </button>
                ))}
              </div>
              <p className="help">{isManage ? 'You can change shape later, at a small cost to familiarity.' : 'The wheel only offers players who can fill a slot you still need.'}</p>
            </div>
          )}
          <div className="bottom-bar" ref={barRef}>
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
              {!ready ? 'Loading league data…' : isManage ? 'Start drafting your squad' : challenge ? `Take on ${challenge.name}` : 'Spin the wheel'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
