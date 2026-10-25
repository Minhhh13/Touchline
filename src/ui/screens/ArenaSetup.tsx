import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useStore, slotOf } from '@game/store'
import type { GameSettings } from '@game/types'
import { shortNameFor } from '@game/logic/setup'
import { ARENA_FIELDS, arenaNeedsAllLeagues, colourClubs, CUP_SQUAD, cupGameSettings, DEFAULT_CUP_SIZE, DEFAULT_DECADE, GAUNTLET_SQUAD, GAUNTLET_SQUAD_CAP, gauntletGameSettings, latestCompleteSeason, summariseArena } from '@game/logic/arena'
import { arenaFormatLabel } from '@game/logic/modes'
import { FORMATIONS } from '@engine/formations'
import type { ArenaField } from '@engine/knockout'
import { CUP_FIELD_TARGET, cupDecades, type CupSize } from '@engine/cup'
import { GAUNTLET_CEILING } from '@engine/gauntlet'
import { randomSeed } from '@engine/rng'
import { ClubBadge, Segmented } from '../components/bits'
import { seasonLabel } from '../format'
import { CapControl } from '../components/CapControl'
import { capXI, DEFAULT_CAP_CHOICE, type CapChoice } from '@game/logic/cap'

type Era = 'all' | 'early' | 'mid' | 'modern'

/** Whether this viewer last left the arena's More options open; blocked storage reads as closed. */
const ADVANCED_KEY = 'touchline-arena-advanced'
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

function eraRange(era: Era, first: number): { fromSeason?: number; toSeason?: number } {
  if (era === 'early') return { fromSeason: first, toSeason: 2013 }
  if (era === 'mid') return { fromSeason: 2014, toSeason: 2019 }
  if (era === 'modern') return { fromSeason: 2020 }
  return {}
}

/** Setup for an arena format (the Cup, its one-off final, or the Gauntlet). Its own screen, so the quick and season Setup stays untouched. */
export function ArenaSetup() {
  const { universe: u, startGame, go, ensureLeagues, loadingLeagues, loadedLeagues, game, parked, arenaSetupFormat } = useStore()
  const [format, setFormat] = useState<'cup' | 'gauntlet'>(arenaSetupFormat)
  const gauntlet = format === 'gauntlet'
  const [teamName, setTeamName] = useState('Touchline XI')
  const [formationId, setFormationId] = useState('4-3-3')
  const [size, setSize] = useState<CupSize>(DEFAULT_CUP_SIZE)
  const final = !gauntlet && size === 2
  // A one-off final opens against the giants, a bigger Cup against the wheel, until a field is chosen
  const [chosenField, setField] = useState<ArenaField | null>(null)
  const field: ArenaField = chosenField ?? (size === 2 ? 'giants' : 'wheel')
  const [decade, setDecade] = useState(DEFAULT_DECADE)
  const [wheelScope, setWheelScope] = useState<'league' | 'europe'>('league')
  const [leagueId, setLeagueId] = useState('england')
  const [era, setEra] = useState<Era>('all')
  const [difficulty, setDifficulty] = useState<'calibrated' | 'realistic'>('calibrated')
  const [seed, setSeed] = useState(() => randomSeed())
  const [hardMode, setHardMode] = useState(false)
  const [twists, setTwists] = useState(true)
  const [cap, setCap] = useState<CapChoice>(DEFAULT_CAP_CHOICE)
  const [hostClubId, setHostClubId] = useState('')
  const [advanced, setAdvanced] = useState(readAdvanced)
  const moreRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const [barHeight, setBarHeight] = useState(0)
  useEffect(() => {
    const el = barRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setBarHeight(Math.ceil(el.getBoundingClientRect().height)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [u])
  const wheelLeagues = useMemo(() => (wheelScope === 'europe' && u ? u.available.map((l) => l.id) : [leagueId]), [wheelScope, leagueId, u])
  // The giants and the champions come from every league; the wheel field from the wheel's
  const needs = useMemo(() => (u && !gauntlet && arenaNeedsAllLeagues({ arena: { format: 'cup', field } }) ? u.available.map((l) => l.id) : wheelLeagues), [u, gauntlet, field, wheelLeagues])
  useEffect(() => {
    void ensureLeagues(needs)
  }, [ensureLeagues, needs])
  const ready = needs.every((id) => loadedLeagues.includes(id))
  const season = useMemo(() => (u && loadedLeagues.includes(leagueId) ? latestCompleteSeason(u, leagueId) : 0), [u, leagueId, loadedLeagues])
  const clubs = useMemo(() => (u && season ? colourClubs(u, leagueId, season) : []), [u, leagueId, season])

  if (!u) return <div className="page">Loading…</div>
  const toggleAdvanced = (open: boolean) => {
    setAdvanced(open)
    writeAdvanced(open)
  }
  const buildSettings = (preview: boolean): GameSettings | null => {
    if (!ready || !season) return null
    const name = teamName.trim() || 'Touchline XI'
    const c = { teamName: name, formationId, field, wheelLeagues, ...eraRange(era, u.firstSeason), difficulty, seed: seed.trim() || (preview ? 'drawn when you start' : randomSeed()), hardMode, twists, hostClubId: hostClubId || undefined, size, decade, capXI: capXI(cap) }
    return gauntlet ? gauntletGameSettings(u, c, shortNameFor(name)) : cupGameSettings(u, c, shortNameFor(name))
  }
  const preview = buildSettings(true)
  // Starting over an unfinished run asks first, as the Daily does over a Quick Draft
  const unfinished = [game, parked.arena].find((g) => g && slotOf(g) === 'arena' && g.phase !== 'summary')
  const start = () => {
    const s = buildSettings(false)
    if (!s) return
    if (unfinished && !confirm(`Start a new arena run? Your unfinished ${arenaFormatLabel(unfinished.settings.arena)} (${unfinished.settings.teamName}) will be abandoned.`)) return
    startGame(s)
  }

  return (
    <div className="page has-bottom-bar" style={barHeight ? ({ '--bottom-bar-h': `${barHeight}px` } as CSSProperties) : undefined}>
      <div className="row between wrap" style={{ marginBottom: 12 }}>
        <h1>{gauntlet ? 'The Gauntlet' : final ? 'Cup Final' : 'The Cup'}</h1>
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
            <div className="field">
              Format
              <Segmented
                value={format}
                onChange={setFormat}
                options={[
                  { value: 'cup', label: 'The Cup', hint: `Draft ${CUP_SQUAD}, then a knockout in one sitting, or one final` },
                  { value: 'gauntlet', label: 'The Gauntlet', hint: `Draft ${GAUNTLET_SQUAD}, then climb fifteen rungs until the first defeat` },
                ]}
              />
              <span className="help" data-testid="arena-format-help">
                {gauntlet
                  ? `Draft ${GAUNTLET_SQUAD}, then climb a ladder of fifteen real club-seasons from the wheel, each from a stronger slice than the last, home and away in turn. Lose once and the run is over; a level match goes to penalties. One lifeline changes a rung's draw, and surviving rungs 2, 4, 6 and 8 earns a bonus spin (up to ${GAUNTLET_SQUAD_CAP}).`
                  : final
                    ? `Draft ${CUP_SQUAD}, then one final against a real club-season, managed through half time, the 70th minute and a shoot-out if it is level.`
                    : `Draft ${CUP_SQUAD}, then a knockout of ${size} real club-seasons in one sitting: seeded draws, four days between ties, bans that carry and a training focus each round. Level at 90 goes to penalties; the final is on neutral ground.`}
              </span>
            </div>
            {!gauntlet && (
              <div className="field" data-testid="arena-size">
                Size
                <Segmented
                  value={String(size)}
                  onChange={(v) => setSize(Number(v) as CupSize)}
                  options={[
                    { value: '2', label: 'Final', hint: 'One match, one trophy' },
                    { value: '8', label: '8 clubs', hint: 'Three rounds' },
                    { value: '16', label: '16 clubs', hint: 'Four rounds, about ten minutes' },
                    { value: '32', label: '32 clubs', hint: 'Five rounds: the long road' },
                  ]}
                />
              </div>
            )}
            {!gauntlet && (
              <div className="field" data-testid="arena-field">
                {final ? 'Opponent' : 'Field'}
                <Segmented value={field} onChange={setField} options={ARENA_FIELDS.map((f) => ({ value: f.value, label: f.label, hint: f.hint }))} />
                {field === 'decade' && (
                  <select className="input" value={decade} onChange={(e) => setDecade(Number(e.target.value))} data-testid="arena-decade">
                    {cupDecades(u.firstSeason, u.lastSeason).map((d) => (
                      <option key={d} value={d}>
                        The {d}s ({seasonLabel(Math.max(d, u.firstSeason))} to {seasonLabel(Math.min(d + 9, u.lastSeason))})
                      </option>
                    ))}
                  </select>
                )}
                <span className="help">
                  {ARENA_FIELDS.find((f) => f.value === field)?.hint}. Everyone on the same seed {final ? 'meets the same opponent' : 'gets the same field and the same first-round draw'}, whatever they draft.
                </span>
              </div>
            )}
          </div>

          <div className="panel col" ref={moreRef} data-testid="arena-more">
            <button type="button" className="fold-head" onClick={() => toggleAdvanced(!advanced)} aria-expanded={advanced}>
              <h3>More options</h3>
              <span className="small muted">{advanced ? 'Hide ▴' : 'Show ▾'}</span>
            </button>
            {!advanced && <span className="help">Where the wheel draws from, era, difficulty, seed, hard mode, twists and the colours you wear. The line above Start states what they are set to.</span>}
            {advanced && (
              <>
                <div className="field">
                  Draft from
                  <Segmented value={wheelScope} onChange={setWheelScope} options={[{ value: 'league', label: 'One league' }, { value: 'europe', label: `European Nights: all ${u.available.length} leagues` }]} />
                </div>
                {wheelScope === 'league' && (
                  <div className="field">
                    League
                    <Segmented
                      value={leagueId}
                      onChange={(id) => {
                        setLeagueId(id)
                        setHostClubId('')
                      }}
                      options={u.available.map((l) => ({ value: l.id, label: l.name }))}
                    />
                  </div>
                )}
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
                    ]}
                  />
                  <span className="help">{gauntlet ? 'The wheel and the ladder both come from the era.' : field === 'decade' ? 'The wheel comes from the era; the field from its decade.' : field === 'europe' ? 'The wheel comes from the era; Europe from each league’s latest complete season.' : `The wheel and the ${final ? 'opponent' : 'field'} both come from the era.`}</span>
                </div>
                <div className="field">
                  Difficulty
                  <Segmented
                    value={difficulty}
                    onChange={setDifficulty}
                    options={[
                      { value: 'calibrated', label: 'Calibrated', hint: gauntlet ? 'Each rung is capped a little higher than the last' : final ? 'The opponent is pulled towards what a good draft can beat' : 'The field is pulled towards what a good draft can beat' },
                      { value: 'realistic', label: 'Realistic', hint: 'The real side at full strength' },
                    ]}
                  />
                  <span className="help">{difficulty === 'calibrated' ? (gauntlet ? `Rung 1 plays at no more than ${GAUNTLET_CEILING.start}, each rung ${GAUNTLET_CEILING.step} higher, never above its real self.` : final ? 'A giant plays at about 78, a champion 76, a wheel side 72, never above its real self.' : `The field's average is brought to ${CUP_FIELD_TARGET[field]} (every side loses the same points), never above anyone's real self.`) : 'The real squad at full strength. A giant killing counts for the Giant Killer badge.'}</span>
                </div>
                <label className="field">
                  Seed
                  <div className="row">
                    <input className="input mono" value={seed} onChange={(e) => setSeed(e.target.value)} />
                    <button className="btn sm" onClick={() => setSeed(randomSeed())}>
                      New
                    </button>
                  </div>
                  <span className="help">{gauntlet ? 'Share a seed and a friend gets the same wheel and climbs the same ladder.' : final ? 'Share a seed and a friend gets the same wheel and the same opponent.' : 'Share a seed and a friend gets the same wheel, the same field and the same first-round draw.'}</span>
                </label>
                <label className="toggle">
                  <input type="checkbox" checked={hardMode} onChange={(e) => setHardMode(e.target.checked)} />
                  Hard mode: ratings hidden while drafting
                </label>
                <label className="toggle">
                  <input type="checkbox" checked={twists} onChange={(e) => setTwists(e.target.checked)} />
                  Twists: every third spin is golden, basement, blind or decade
                </label>
                <CapControl value={cap} onChange={setCap} squadSize={gauntlet ? GAUNTLET_SQUAD : CUP_SQUAD} />
                {clubs.length > 0 && (
                  <label className="field">
                    Colours
                    <select className="input" value={preview?.hostClubId ?? ''} onChange={(e) => setHostClubId(e.target.value)}>
                      {clubs.map((c) => (
                        <option key={c} value={c}>
                          {u.clubById[c]?.name ?? c}
                        </option>
                      ))}
                    </select>
                    <span className="help row" style={{ gap: 8 }}>
                      {preview && <ClubBadge clubId={preview.hostClubId} size={22} />} Only the colours and the badge on the scoreboard.
                    </span>
                  </label>
                )}
              </>
            )}
          </div>
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
            <p className="help">The wheel only offers players who can fill a slot you still need; {gauntlet ? GAUNTLET_SQUAD - 11 : CUP_SQUAD - 11} more go on the bench.</p>
          </div>
          <div className="bottom-bar" ref={barRef}>
            <div className="small muted" data-testid="arena-summary">
              {preview ? summariseArena(u, preview) : 'Loading league data…'}
              {' · '}
              <button
                type="button"
                className="linklike"
                onClick={() => {
                  toggleAdvanced(true)
                  moreRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }}
              >
                change
              </button>
            </div>
            <button className="btn primary big block" onClick={start} disabled={!ready || loadingLeagues || !preview} data-testid="arena-start">
              {!ready ? 'Loading league data…' : gauntlet ? 'Draft for the Gauntlet' : final ? 'Draft for the final' : 'Draft for the Cup'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
