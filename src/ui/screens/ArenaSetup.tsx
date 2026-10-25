import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useStore, slotOf } from '@game/store'
import type { GameSettings } from '@game/types'
import { shortNameFor } from '@game/logic/setup'
import { arenaNeedsAllLeagues, colourClubs, FINAL_FIELDS, FINAL_SQUAD, finalGameSettings, latestCompleteSeason, summariseArena } from '@game/logic/arena'
import { arenaFormatLabel } from '@game/logic/modes'
import { FORMATIONS } from '@engine/formations'
import type { ArenaField } from '@engine/knockout'
import { randomSeed } from '@engine/rng'
import { ClubBadge, Segmented } from '../components/bits'
import { seasonLabel } from '../format'

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

/** Setup for an arena format (this build: the Cup Final). Its own screen, so the quick and season Setup stays untouched. */
export function ArenaSetup() {
  const { universe: u, startGame, go, ensureLeagues, loadingLeagues, loadedLeagues, game, parked } = useStore()
  const [teamName, setTeamName] = useState('Touchline XI')
  const [formationId, setFormationId] = useState('4-3-3')
  const [field, setField] = useState<ArenaField>('giants')
  const [wheelScope, setWheelScope] = useState<'league' | 'europe'>('league')
  const [leagueId, setLeagueId] = useState('england')
  const [era, setEra] = useState<Era>('all')
  const [difficulty, setDifficulty] = useState<'calibrated' | 'realistic'>('calibrated')
  const [seed, setSeed] = useState(() => randomSeed())
  const [hardMode, setHardMode] = useState(false)
  const [twists, setTwists] = useState(true)
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
  const needs = useMemo(() => (u && arenaNeedsAllLeagues({ arena: { format: 'cup', field } }) ? u.available.map((l) => l.id) : wheelLeagues), [u, field, wheelLeagues])
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
    return finalGameSettings(u, { teamName: name, formationId, field, wheelLeagues, ...eraRange(era, u.firstSeason), difficulty, seed: seed.trim() || (preview ? 'drawn when you start' : randomSeed()), hardMode, twists, hostClubId: hostClubId || undefined }, shortNameFor(name))
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
        <h1>Cup Final</h1>
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
              <Segmented value="final" onChange={() => undefined} options={[{ value: 'final', label: 'Cup Final', hint: `Draft ${FINAL_SQUAD}, then one final from the team sheet to the last penalty` }]} />
              <span className="help">Draft {FINAL_SQUAD}, then one final against a real club-season, managed through half time, the 70th minute and a shoot-out if it is level.</span>
            </div>
            <div className="field" data-testid="arena-field">
              Opponent
              <Segmented value={field} onChange={setField} options={FINAL_FIELDS.map((f) => ({ value: f.value, label: f.label, hint: f.hint }))} />
              <span className="help">{FINAL_FIELDS.find((f) => f.value === field)?.hint}. Everyone on the same seed meets the same opponent, whatever they draft.</span>
            </div>
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
                  <span className="help">The wheel and the opponent both come from the era.</span>
                </div>
                <div className="field">
                  Difficulty
                  <Segmented
                    value={difficulty}
                    onChange={setDifficulty}
                    options={[
                      { value: 'calibrated', label: 'Calibrated', hint: 'The opponent is pulled towards what a good draft can beat' },
                      { value: 'realistic', label: 'Realistic', hint: 'The real side at full strength' },
                    ]}
                  />
                  <span className="help">{difficulty === 'calibrated' ? 'A giant plays at about 78, a champion 76, a wheel side 72, never above its real self.' : 'The real squad at full strength. A giant killing counts for the Giant Killer badge.'}</span>
                </div>
                <label className="field">
                  Seed
                  <div className="row">
                    <input className="input mono" value={seed} onChange={(e) => setSeed(e.target.value)} />
                    <button className="btn sm" onClick={() => setSeed(randomSeed())}>
                      New
                    </button>
                  </div>
                  <span className="help">Share a seed and a friend gets the same wheel and the same opponent.</span>
                </label>
                <label className="toggle">
                  <input type="checkbox" checked={hardMode} onChange={(e) => setHardMode(e.target.checked)} />
                  Hard mode: ratings hidden while drafting
                </label>
                <label className="toggle">
                  <input type="checkbox" checked={twists} onChange={(e) => setTwists(e.target.checked)} />
                  Twists: every third spin is golden, basement, blind or decade
                </label>
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
            <p className="help">The wheel only offers players who can fill a slot you still need; five more go on the bench.</p>
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
              {!ready ? 'Loading league data…' : 'Draft for the final'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
