import { useMemo, useState } from 'react'
import { useStore, todaysDailySeed } from '@game/store'
import type { GameSettings, Mode } from '@game/types'
import { FORMATIONS, getFormation } from '@engine/formations'
import { QUICK_RULES, SEASON_RULES, type DraftRules } from '@engine/draft'
import { NATION_SLOT_COVER, NATION_SQUAD_MARGIN, nationDepth, nationDepthLabel, type EraRange } from '@engine/nations'
import { randomSeed } from '@engine/rng'
import { seasonLabel } from '../format'
import { ClubBadge, Segmented } from '../components/bits'

const MODE_TITLE: Record<Mode, string> = { quick: 'Quick Draft', daily: 'Daily Challenge', season: 'Season', dynasty: 'Dynasty' }

type Era = 'all' | 'early' | 'mid' | 'modern' | 'custom'

/** The wheel's season bounds for an era choice; the Daily has none. */
function eraBounds(era: Era, from: number, to: number, firstSeason: number, isDaily: boolean): EraRange {
  if (isDaily) return {}
  switch (era) {
    case 'early':
      return { fromSeason: firstSeason, toSeason: 2013 }
    case 'mid':
      return { fromSeason: 2014, toSeason: 2019 }
    case 'modern':
      return { fromSeason: 2020 }
    case 'custom':
      return { fromSeason: Math.min(from, to), toSeason: Math.max(from, to) }
    default:
      return {}
  }
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

export function Setup() {
  const { universe: u, setupMode: mode, startGame, go, ensureLeagues, loadingLeagues, loadedLeagues } = useStore()
  const [leagueId, setLeagueId] = useState('england')
  const [wheelScope, setWheelScope] = useState<'league' | 'europe'>('league')
  const [teamName, setTeamName] = useState('Touchline XI')
  const [formationId, setFormationId] = useState('4-3-3')
  const [era, setEra] = useState<Era>('all')
  const [from, setFrom] = useState(u?.firstSeason ?? 2008)
  const [to, setTo] = useState(u?.lastSeason ?? 2026)
  const [onlyClub, setOnlyClub] = useState('')
  const [onlyNation, setOnlyNation] = useState('')
  const [hardMode, setHardMode] = useState(false)
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

  const seasons = useMemo(() => (u ? [...new Set(u.clubSeasons.filter((cs) => cs.leagueId === leagueId).map((cs) => cs.season))].sort() : []), [u, leagueId])
  const clubsInLeague = useMemo(() => (u ? u.clubSeasons.filter((cs) => cs.leagueId === leagueId && cs.season === leagueSeason).map((cs) => cs.clubId).sort((a, b) => (u.clubById[a]?.name ?? a).localeCompare(u.clubById[b]?.name ?? b)) : []), [u, leagueId, leagueSeason])
  const wheelLeagues = useMemo(() => (wheelScope === 'europe' && u ? u.available.map((l) => l.id) : [leagueId]), [wheelScope, leagueId, u])
  // Only clubs the wheel could actually land on: in a wheel league, with a squad inside the chosen era
  const allClubs = useMemo(() => {
    if (!u) return []
    const lo = Math.min(from, to)
    const hi = Math.max(from, to)
    const inEra = new Set(u.clubSeasons.filter((cs) => cs.season >= lo && cs.season <= hi).map((cs) => cs.clubId))
    return [...u.clubs].filter((c) => wheelLeagues.includes(c.leagueId) && inEra.has(c.id)).sort((a, b) => a.name.localeCompare(b.name))
  }, [u, wheelLeagues, from, to])
  const isDaily = mode === 'daily'
  const isManage = mode === 'season' || mode === 'dynasty'
  const eraRange = eraBounds(era, from, to, u?.firstSeason ?? 2008, isDaily)
  // Nations deep enough for a one-nation draft of this shape: twice the cover for every position, inside the wheel leagues and era
  const nations = useMemo(() => (u && !isDaily ? nationDepth(u, wheelLeagues, eraRange, getFormation(formationId), isManage ? squadSize : 11) : []), [u, isDaily, wheelLeagues, eraRange.fromSeason, eraRange.toSeason, formationId, isManage, squadSize])
  const leagueReady = loadedLeagues.includes(leagueId) && wheelLeagues.every((l) => loadedLeagues.includes(l)) && (!continental || !u || u.available.every((l) => loadedLeagues.includes(l.id)))
  const effectiveSeason = seasons.includes(leagueSeason) ? leagueSeason : seasons[seasons.length - 1] ?? leagueSeason
  const host = hostClubId && clubsInLeague.includes(hostClubId) ? hostClubId : clubsInLeague[Math.floor(clubsInLeague.length / 2)] ?? ''

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

  // The daily puzzle fixes everything but the picks: formation, league, host club and difficulty come from the date.
  const dailyFixed = (() => {
    if (!isDaily) return null
    const seedNum = todaysDailySeed().split('-').slice(1).join('')
    const n = Number(seedNum) || 0
    const complete = u.clubSeasons.filter((cs) => cs.complete && cs.leagueId === 'england')
    const seasonsComplete = [...new Set(complete.map((cs) => cs.season))].sort()
    const season = seasonsComplete[n % seasonsComplete.length]
    const clubs = complete.filter((cs) => cs.season === season).map((cs) => cs.clubId).sort()
    const host = clubs[(n * 7) % clubs.length]
    const formations = ['4-3-3', '4-4-2', '4-2-3-1', '3-5-2', '4-4-2-diamond']
    return { season, host, formationId: formations[(n * 3) % formations.length] }
  })()

  const start = () => {
    const base: DraftRules = isManage ? { ...SEASON_RULES, squadSize } : QUICK_RULES
    const club = !isDaily && onlyClub && allClubs.some((c) => c.id === onlyClub) ? onlyClub : undefined
    const nation = !isDaily && onlyNation && nations.some((n) => n.nation === onlyNation) ? onlyNation : undefined
    const rules: DraftRules = { ...base, ...eraRange, onlyClub: club, onlyNation: nation, hardMode: !isDaily && hardMode, leagues: dailyFixed ? ['england'] : wheelLeagues }
    const name = teamName.trim() || 'Touchline XI'
    const short = name
      .split(/\s+/)
      .map((w) => w[0])
      .join('')
      .slice(0, 3)
      .toUpperCase() || 'TXI'
    const settings: GameSettings = {
      mode,
      seed: isDaily ? todaysDailySeed() : seed.trim() || randomSeed(),
      formationId: dailyFixed ? dailyFixed.formationId : formationId,
      teamName: name,
      shortName: short.length >= 2 ? short : name.slice(0, 3).toUpperCase(),
      leagueId: dailyFixed ? 'england' : leagueId,
      wheelLeagues: dailyFixed ? ['england'] : wheelLeagues,
      hostClubId: dailyFixed ? dailyFixed.host : host,
      leagueSeason: dailyFixed ? dailyFixed.season : effectiveSeason,
      rules,
      jobSecurity: isManage ? jobSecurity : false,
      difficulty: dailyFixed ? 'calibrated' : difficulty,
      continental: isManage && continental && u.available.length >= 2,
    }
    startGame(settings)
  }

  return (
    <div className="page">
      <div className="row between wrap" style={{ marginBottom: 12 }}>
        <h1>{MODE_TITLE[mode]}</h1>
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
            {dailyFixed && (
              <div className="notice">
                Today's puzzle: everyone drafts a <b>{dailyFixed.formationId}</b> from the same wheel, as <b>{u.clubById[dailyFixed.host]?.name}</b> in the <b>{seasonLabel(dailyFixed.season)}</b> league, calibrated difficulty. Seed {todaysDailySeed()}.
              </div>
            )}
            {!dailyFixed && (
              <div className="field">
                League
                <Segmented value={leagueId} onChange={pickLeague} options={u.available.map((l) => ({ value: l.id, label: l.name, hint: `${l.playerSeasons.toLocaleString()} player-seasons` }))} />
                <span className="help">{loadingLeagues ? 'Loading league data…' : 'Where your side plays. Each league has its own real clubs and seasons.'}</span>
              </div>
            )}
            {!dailyFixed && (
              <div className="field">
                Draft from
                <Segmented value={wheelScope} onChange={pickScope} options={[{ value: 'league', label: `${u.available.find((l) => l.id === leagueId)?.name ?? 'This league'} only` }, { value: 'europe', label: `European Nights: all ${u.available.length} leagues` }]} />
                <span className="help">{wheelScope === 'europe' ? `The wheel and the market draw from ${listNames(u.available.map((l) => l.country))}.` : 'The wheel and the market stay inside one league.'}</span>
              </div>
            )}
            {!dailyFixed && (
            <label className="field">
              League season to play in
              <select className="input" value={effectiveSeason} onChange={(e) => setLeagueSeason(Number(e.target.value))}>
                {seasons.map((s) => (
                  <option key={s} value={s}>
                    {seasonLabel(s)} {s === u.currentSeason ? '(in progress)' : ''}
                  </option>
                ))}
              </select>
              <span className="help">Your drafted side replaces one real club and plays its 19 rivals with their real squads of that season.</span>
            </label>
            )}
            {!dailyFixed && (
            <label className="field">
              Club whose place you take
              <select className="input" value={host} onChange={(e) => setHostClubId(e.target.value)}>
                {clubsInLeague.map((c) => (
                  <option key={c} value={c}>
                    {u.clubById[c]?.name ?? c}
                  </option>
                ))}
              </select>
              <span className="help row" style={{ gap: 8 }}>
                <ClubBadge clubId={host} size={22} /> You inherit their colours, rivals and fixture list. Their real players sit the season out.
              </span>
            </label>
            )}
            {!dailyFixed && (
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
            )}
            {!isDaily && (
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
            )}

          </div>

          {!isDaily && (
            <div className="panel col">
              <h3>Wheel rules</h3>
              <div className="field">
                Era
                <Segmented
                  value={era}
                  onChange={setEra}
                  options={[
                    { value: 'all', label: 'All eras' },
                    { value: 'early', label: `${seasonLabel(u.firstSeason)} to 2013-14` },
                    { value: 'mid', label: '2014-15 to 2019-20' },
                    { value: 'modern', label: '2020-21 onwards' },
                    { value: 'custom', label: 'Custom' },
                  ]}
                />
              </div>
              {era === 'custom' && (
                <div className="row">
                  <select className="input" value={from} onChange={(e) => setFrom(Number(e.target.value))}>
                    {seasons.map((s) => (
                      <option key={s} value={s}>
                        {seasonLabel(s)}
                      </option>
                    ))}
                  </select>
                  <span>to</span>
                  <select className="input" value={to} onChange={(e) => setTo(Number(e.target.value))}>
                    {seasons.map((s) => (
                      <option key={s} value={s}>
                        {seasonLabel(s)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <label className="field">
                One-club mode
                <select className="input" value={onlyClub} onChange={(e) => { setOnlyClub(e.target.value); if (e.target.value) setOnlyNation('') }}>
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
                <select className="input" value={nations.some((n) => n.nation === onlyNation) ? onlyNation : ''} onChange={(e) => { setOnlyNation(e.target.value); if (e.target.value) setOnlyClub('') }}>
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
              {isManage && (
                <>
                  <label className="field">
                    Squad size to draft: {squadSize}
                    <input type="range" min={16} max={22} value={squadSize} onChange={(e) => setSquadSize(Number(e.target.value))} />
                  </label>
                  <label className="toggle">
                    <input type="checkbox" checked={jobSecurity} onChange={(e) => setJobSecurity(e.target.checked)} />
                    Job security: the board can sack you
                  </label>
                  {u.available.length >= 2 && (
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
          {!dailyFixed && (
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
          <button className="btn primary big block" onClick={start} disabled={!dailyFixed && (!leagueReady || loadingLeagues)}>
            {!dailyFixed && !leagueReady ? 'Loading league data…' : isManage ? 'Start drafting your squad' : 'Spin the wheel'}
          </button>
        </div>
      </div>
    </div>
  )
}
