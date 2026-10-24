import { useMemo, useState } from 'react'
import { useStore, todaysDailySeed } from '@game/store'
import type { GameSettings, Mode } from '@game/types'
import { FORMATIONS } from '@engine/formations'
import { QUICK_RULES, SEASON_RULES, type DraftRules } from '@engine/draft'
import { randomSeed } from '@engine/rng'
import { seasonLabel } from '../format'
import { ClubBadge, Segmented } from '../components/bits'

const MODE_TITLE: Record<Mode, string> = { quick: 'Quick Draft', daily: 'Daily Challenge', season: 'Season', dynasty: 'Dynasty' }

type Era = 'all' | 'early' | 'mid' | 'modern' | 'custom'

export function Setup() {
  const { universe: u, setupMode: mode, startGame, go } = useStore()
  const [teamName, setTeamName] = useState('Touchline XI')
  const [formationId, setFormationId] = useState('4-3-3')
  const [era, setEra] = useState<Era>('all')
  const [from, setFrom] = useState(u?.firstSeason ?? 2008)
  const [to, setTo] = useState(u?.lastSeason ?? 2026)
  const [onlyClub, setOnlyClub] = useState('')
  const [hardMode, setHardMode] = useState(false)
  const [leagueSeason, setLeagueSeason] = useState(() => {
    if (!u) return 2025
    const complete = u.clubSeasons.filter((cs) => cs.complete).map((cs) => cs.season)
    return Math.max(...complete)
  })
  const [hostClubId, setHostClubId] = useState('')
  const [jobSecurity, setJobSecurity] = useState(true)
  const [difficulty, setDifficulty] = useState<'calibrated' | 'realistic'>('calibrated')
  const [seed, setSeed] = useState(() => randomSeed())
  const [squadSize, setSquadSize] = useState(18)

  const seasons = useMemo(() => (u ? Array.from({ length: u.lastSeason - u.firstSeason + 1 }, (_, i) => u.firstSeason + i) : []), [u])
  const clubsInLeague = useMemo(() => (u ? u.clubSeasons.filter((cs) => cs.season === leagueSeason).map((cs) => cs.clubId).sort((a, b) => (u.clubById[a]?.name ?? a).localeCompare(u.clubById[b]?.name ?? b)) : []), [u, leagueSeason])
  const allClubs = useMemo(() => (u ? [...u.clubs].sort((a, b) => a.name.localeCompare(b.name)) : []), [u])
  const host = hostClubId && clubsInLeague.includes(hostClubId) ? hostClubId : clubsInLeague[Math.floor(clubsInLeague.length / 2)] ?? ''

  if (!u) return <div className="page">Loading…</div>

  const isDaily = mode === 'daily'
  const isManage = mode === 'season' || mode === 'dynasty'

  const eraRange = (): { fromSeason?: number; toSeason?: number } => {
    if (isDaily) return {}
    switch (era) {
      case 'early':
        return { fromSeason: u.firstSeason, toSeason: 2013 }
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

  const start = () => {
    const base: DraftRules = isManage ? { ...SEASON_RULES, squadSize } : QUICK_RULES
    const rules: DraftRules = { ...base, ...eraRange(), onlyClub: !isDaily && onlyClub ? onlyClub : undefined, hardMode: !isDaily && hardMode }
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
      formationId,
      teamName: name,
      shortName: short.length >= 2 ? short : name.slice(0, 3).toUpperCase(),
      hostClubId: host,
      leagueSeason,
      rules,
      jobSecurity: isManage ? jobSecurity : false,
      difficulty,
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
            <label className="field">
              League season to play in
              <select className="input" value={leagueSeason} onChange={(e) => setLeagueSeason(Number(e.target.value))}>
                {seasons.map((s) => (
                  <option key={s} value={s}>
                    {seasonLabel(s)} {s === u.currentSeason ? '(in progress)' : ''}
                  </option>
                ))}
              </select>
              <span className="help">Your drafted side replaces one real club and plays its 19 rivals with their real squads of that season.</span>
            </label>
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
            {isDaily && <div className="notice">Today's puzzle: everyone spins the same wheel in the same order. Seed {todaysDailySeed()}.</div>}
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
                <select className="input" value={onlyClub} onChange={(e) => setOnlyClub(e.target.value)}>
                  <option value="">Off: every club</option>
                  {allClubs.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} only
                    </option>
                  ))}
                </select>
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
                </>
              )}
            </div>
          )}
        </div>

        <div className="col">
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
          <button className="btn primary big block" onClick={start}>
            {isManage ? 'Start drafting your squad' : 'Spin the wheel'}
          </button>
        </div>
      </div>
    </div>
  )
}
