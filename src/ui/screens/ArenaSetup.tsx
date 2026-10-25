import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useStore, slotOf } from '@game/store'
import type { GameSettings } from '@game/types'
import { shortNameFor } from '@game/logic/setup'
import { ARENA_FIELDS, arenaNeedsAllLeagues, colourClubs, CUP_SQUAD, cupGameSettings, DEFAULT_CUP_SIZE, DEFAULT_DECADE, GAUNTLET_SQUAD, GAUNTLET_SQUAD_CAP, gauntletGameSettings, latestCompleteSeason, summariseArena } from '@game/logic/arena'
import { arenaFormatLabel } from '@game/logic/modes'
import { getFormation } from '@engine/formations'
import type { ArenaField } from '@engine/knockout'
import { CUP_FIELD_TARGET, cupDecades, type CupSize } from '@engine/cup'
import { GAUNTLET_CEILING } from '@engine/gauntlet'
import { randomSeed } from '@engine/rng'
import { ClubBadge, Info, Segmented } from '../components/bits'
import { LeagueFlag } from '../components/Flag'
import { Pitch } from '../components/Pitch'
import { FormationPicker } from '../components/FormationPicker'
import { TeamNameField } from '../components/SetupBits'
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

  const shown = getFormation(formationId)
  return (
    // Main's setup layout (DESIGN_SYSTEM.md, Setup): numbered steps in two boxes, one screen on a desktop
    <div className="page setup-page arena-setup has-bottom-bar" style={barHeight ? ({ '--bottom-bar-h': `${barHeight}px` } as CSSProperties) : undefined}>
      <div className="setup-flow setup-wide">
        <div className="row between wrap" style={{ alignItems: 'flex-start' }}>
          <div>
            <h1>{gauntlet ? 'The Gauntlet' : final ? 'Cup Final' : 'The Cup'}</h1>
            <p className="muted setup-sub" data-testid="arena-format-help">
              {gauntlet ? `Draft ${GAUNTLET_SQUAD}, climb fifteen rungs, lose once and it is over.` : final ? `Draft ${CUP_SQUAD}, then one final.` : `Draft ${CUP_SQUAD}, then a knockout of ${size} in one sitting.`}{' '}
              <Info label="About the format">{gauntlet
                    ? `Draft ${GAUNTLET_SQUAD}, then climb a ladder of fifteen real club-seasons from the wheel, each from a stronger slice than the last, home and away in turn. Lose once and the run is over; a level match goes to penalties. One lifeline changes a rung's draw, and surviving rungs 2, 4, 6 and 8 earns a bonus spin (up to ${GAUNTLET_SQUAD_CAP}).`
                    : final
                      ? `Draft ${CUP_SQUAD}, then one final against a real club-season, managed through half time, the 70th minute and a shoot-out if it is level.`
                      : `Draft ${CUP_SQUAD}, then a knockout of ${size} real club-seasons in one sitting: seeded draws, four days between ties, bans that carry and a training focus each round. Level at 90 goes to penalties; the final is on neutral ground.`}</Info>
            </p>
          </div>
          <button className="btn ghost" onClick={() => go('home')}>
            ← Back
          </button>
        </div>

        <div className="setup-grid">
          <div className="panel setup-box">
            <section className="setup-step setup-formation">
              <StepHead n={1} title="Pick your formation" />
              <div className="setup-formation-body">
                <FormationPicker value={formationId} onChange={setFormationId} />
                <div className="setup-preview">
                  <div className="pitch-mini" data-testid="formation-preview" inert>
                    <Pitch formation={shown} lineup={{}} getPlayer={() => undefined} />
                  </div>
                  <p className="help setup-line">
                    <b>{shown.name}</b>: {gauntlet ? GAUNTLET_SQUAD - 11 : CUP_SQUAD - 11} more go on the bench.
                  </p>
                </div>
              </div>
            </section>
            <section className="setup-step setup-team">
              <StepHead n={2} title="Name your team" />
              <div className="setup-name">
                <TeamNameField value={teamName} onChange={setTeamName} fallback="Touchline XI" />
              </div>
            </section>
          </div>

          <div className="panel setup-box">
            <section className="setup-step">
              <StepHead n={3} title={gauntlet ? 'The ladder' : final ? 'The final' : 'The cup'} />
              <div className="setup-rules arena-rules">
                <div className="setup-opt setup-wide-opt">
                  <h3>Format</h3>
                  <Segmented
                    value={format}
                    onChange={setFormat}
                    options={[
                      { value: 'cup', label: 'The Cup', hint: `Draft ${CUP_SQUAD}, then a knockout in one sitting, or one final` },
                      { value: 'gauntlet', label: 'The Gauntlet', hint: `Draft ${GAUNTLET_SQUAD}, then climb fifteen rungs until the first defeat` },
                    ]}
                  />
                </div>
                {!gauntlet && (
                  <div className="setup-opt setup-wide-opt" data-testid="arena-size">
                    <h3>Size</h3>
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
                  <div className="setup-opt setup-wide-opt" data-testid="arena-field">
                    <h3>
                      {final ? 'Opponent' : 'Field'}{' '}
                      <Info label="About the field">
                        {ARENA_FIELDS.find((f) => f.value === field)?.hint}. Everyone on the same seed {final ? 'meets the same opponent' : 'gets the same field and the same first-round draw'}, whatever they draft.
                      </Info>
                    </h3>
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
                  </div>
                )}
                <div className="setup-opt setup-wide-opt setup-more" ref={moreRef} data-testid="arena-more">
                  <button type="button" className="fold-head" onClick={() => toggleAdvanced(!advanced)} aria-expanded={advanced}>
                    <h3>More options</h3>
                    <span className="small muted">{advanced ? 'Hide ▴' : 'Show ▾'}</span>
                  </button>
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
                            options={u.available.map((l) => ({ value: l.id, label: <><LeagueFlag leagueId={l.id} /> {l.name}</> }))}
                          />
                        </div>
                      )}
                      <div className="field">
                        <span>
                          Era <Info label="About the era">{gauntlet ? 'The wheel and the ladder both come from the era.' : field === 'decade' ? 'The wheel comes from the era; the field from its decade.' : field === 'europe' ? 'The wheel comes from the era; Europe from each league’s latest complete season.' : `The wheel and the ${final ? 'opponent' : 'field'} both come from the era.`}</Info>
                        </span>
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
                      </div>
                      <div className="field">
                        <span>
                          Difficulty{' '}
                          <Info label="About the difficulty">{difficulty === 'calibrated' ? (gauntlet ? `Rung 1 plays at no more than ${GAUNTLET_CEILING.start}, each rung ${GAUNTLET_CEILING.step} higher, never above its real self.` : final ? 'A giant plays at about 78, a champion 76, a wheel side 72, never above its real self.' : `The field's average is brought to ${CUP_FIELD_TARGET[field]} (every side loses the same points), never above anyone's real self.`) : 'The real squad at full strength. A giant killing counts for the Giant Killer badge.'}</Info>
                        </span>
                        <Segmented
                          value={difficulty}
                          onChange={setDifficulty}
                          options={[
                            { value: 'calibrated', label: 'Calibrated', hint: gauntlet ? 'Each rung is capped a little higher than the last' : final ? 'The opponent is pulled towards what a good draft can beat' : 'The field is pulled towards what a good draft can beat' },
                            { value: 'realistic', label: 'Realistic', hint: 'The real side at full strength' },
                          ]}
                        />
                      </div>
                      <label className="field">
                        <span>
                          Seed <Info label="About the seed">{gauntlet ? 'Share a seed and a friend gets the same wheel and climbs the same ladder.' : final ? 'Share a seed and a friend gets the same wheel and the same opponent.' : 'Share a seed and a friend gets the same wheel, the same field and the same first-round draw.'}</Info>
                        </span>
                        <div className="row">
                          <input className="input mono" value={seed} onChange={(e) => setSeed(e.target.value)} />
                          <button className="btn sm" onClick={() => setSeed(randomSeed())}>
                            New
                          </button>
                        </div>
                      </label>
                      <div className="toggle-grid">
                        <label className="toggle">
                          <input type="checkbox" checked={hardMode} onChange={(e) => setHardMode(e.target.checked)} />
                          Hard mode
                        </label>
                        <label className="toggle" title="Every third spin is golden, basement, blind or decade">
                          <input type="checkbox" checked={twists} onChange={(e) => setTwists(e.target.checked)} />
                          Twists
                        </label>
                      </div>
                      <CapControl value={cap} onChange={setCap} squadSize={gauntlet ? GAUNTLET_SQUAD : CUP_SQUAD} />
                      {clubs.length > 0 && (
                        <label className="field">
                          <span>
                            Colours <Info label="About the colours">Only the colours and the badge on the scoreboard.</Info>
                          </span>
                          <div className="row" style={{ gap: 8 }}>
                            {preview && <ClubBadge clubId={preview.hostClubId} size={22} />}
                            <select className="input" value={preview?.hostClubId ?? ''} onChange={(e) => setHostClubId(e.target.value)}>
                              {clubs.map((c) => (
                                <option key={c} value={c}>
                                  {u.clubById[c]?.name ?? c}
                                </option>
                              ))}
                            </select>
                          </div>
                        </label>
                      )}
                    </>
                  )}
                </div>
              </div>
            </section>

            <section className="setup-step setup-start bottom-bar" ref={barRef}>
              <StepHead n={4} title="Spin" />
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
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}

/** A step's numbered badge and short title, as Setup draws it. */
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
