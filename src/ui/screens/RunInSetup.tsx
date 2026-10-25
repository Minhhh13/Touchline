import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useStore, slotOf } from '@game/store'
import { RUN_IN_LEAGUES, runInCatalogue, suggestRunIns, type RunInJob, type RunInTemplate } from '@engine/scenario'
import { FORMATIONS } from '@engine/formations'
import { formationForStyle } from '@engine/tactics'
import { randomSeed } from '@engine/rng'
import { jobLine, RUN_IN_BRIEF_SHORT, RUN_IN_SPINS, RUN_IN_TEMPLATE_LABEL, runInGameSettings, summariseRunIn } from '@game/logic/runin'
import { ClubBadge, Segmented } from '../components/bits'
import { clubName, seasonLabel } from '../format'

const keyOf = (j: RunInJob) => `${j.clubId}@${j.season}`

/** Setup for a run-in: the brief, the league, three jobs drawn by the seed and the whole catalogue. Its own screen, so Setup.tsx stays untouched. */
export function RunInSetup() {
  const { universe: u, startGame, go, ensureLeagues, loadingLeagues, loadedLeagues, game, parked } = useStore()
  const [template, setTemplate] = useState<RunInTemplate>('survival')
  const [leagueId, setLeagueId] = useState<string>('england')
  const [seed, setSeed] = useState(() => randomSeed())
  const [picked, setPicked] = useState<string | null>(null)
  const [formation, setFormation] = useState<string>('club')
  const barRef = useRef<HTMLDivElement>(null)
  const [barHeight, setBarHeight] = useState(0)
  useEffect(() => {
    const el = barRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setBarHeight(Math.ceil(el.getBoundingClientRect().height)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [u])
  useEffect(() => {
    void ensureLeagues([leagueId])
  }, [ensureLeagues, leagueId])
  const ready = loadedLeagues.includes(leagueId)
  const jobs = useMemo(() => (u && ready ? runInCatalogue(u, template).filter((j) => j.leagueId === leagueId) : []), [u, ready, template, leagueId])
  const suggested = useMemo(() => suggestRunIns(jobs, seed.trim() || 'run-in'), [jobs, seed])
  const bySeason = useMemo(() => {
    const out: Array<{ season: number; jobs: RunInJob[] }> = []
    for (const j of jobs) {
      const last = out.at(-1)
      if (last && last.season === j.season) last.jobs.push(j)
      else out.push({ season: j.season, jobs: [j] })
    }
    return out
  }, [jobs])
  if (!u) return <div className="page">Loading…</div>
  const job = jobs.find((j) => keyOf(j) === picked) ?? suggested[0] ?? null
  const clubStyle = job ? (u.clubById[job.clubId]?.style ?? 'balanced') : 'balanced'
  const formationId = formation === 'club' ? formationForStyle(clubStyle) : formation
  const settings = job ? runInGameSettings(u, job, { seed: seed.trim() || 'run-in', formationId }) : null
  const leagues = u.available.filter((l) => (RUN_IN_LEAGUES as readonly string[]).includes(l.id))
  const unfinished = [game, parked.runin].find((g) => g && slotOf(g) === 'runin' && g.phase !== 'summary')
  const start = () => {
    if (!job) return
    if (unfinished && !confirm(`Take a new job? Your unfinished run-in (${unfinished.settings.teamName}) will be abandoned.`)) return
    startGame(runInGameSettings(u, job, { seed: seed.trim() || randomSeed(), formationId }))
  }
  const row = (j: RunInJob, testid?: string) => (
    <button key={keyOf(j)} type="button" className={`prow ${job && keyOf(j) === keyOf(job) ? 'selected' : ''}`} onClick={() => setPicked(keyOf(j))} data-testid={testid}>
      <ClubBadge clubId={j.clubId} size={30} />
      <span>
        <span className="name">
          {clubName(u, j.clubId)} <span className="muted small">{seasonLabel(j.season)}</span>
        </span>
        <span className="small muted">{jobLine(j)}</span>
      </span>
      <span className="chip">{RUN_IN_BRIEF_SHORT[j.template]}</span>
    </button>
  )

  return (
    <div className="page has-bottom-bar" style={barHeight ? ({ '--bottom-bar-h': `${barHeight}px` } as CSSProperties) : undefined}>
      <div className="row between wrap" style={{ marginBottom: 12 }}>
        <h1>Run-in</h1>
        <button className="btn ghost" onClick={() => go('home')}>
          ← Back
        </button>
      </div>
      <div className="grid two">
        <div className="col">
          <div className="panel col">
            <h3>The job</h3>
            <div className="field" data-testid="runin-template">
              Brief
              <Segmented
                value={template}
                onChange={(t) => {
                  setTemplate(t)
                  setPicked(null)
                }}
                options={[
                  { value: 'title', label: RUN_IN_TEMPLATE_LABEL.title, hint: 'Second or third, within six points of the top: win the title' },
                  { value: 'europe', label: RUN_IN_TEMPLATE_LABEL.europe, hint: 'Fifth to eighth, within five points of fourth: reach the top four' },
                  { value: 'survival', label: RUN_IN_TEMPLATE_LABEL.survival, hint: 'In the bottom three, within six points of safety: stay up' },
                ]}
              />
            </div>
            <div className="field" data-testid="runin-league">
              League
              <Segmented
                value={leagueId}
                onChange={(id) => {
                  setLeagueId(id)
                  setPicked(null)
                }}
                options={leagues.map((l) => ({ value: l.id, label: l.name }))}
              />
              <span className="help">Only leagues with real final tables offer run-ins. The table you take over is projected from the final one, scaled back to matchweek 28.</span>
            </div>
            <label className="field">
              Seed
              <div className="row">
                <input className="input mono" value={seed} onChange={(e) => setSeed(e.target.value)} data-testid="runin-seed" />
                <button className="btn sm" onClick={() => setSeed(randomSeed())}>
                  New
                </button>
              </div>
              <span className="help">The seed draws the three suggested jobs, your {RUN_IN_SPINS} spins and the rest of the season.</span>
            </label>
          </div>
          <div className="panel col">
            <h3>Shape</h3>
            <select className="input" value={formation} onChange={(e) => setFormation(e.target.value)} data-testid="runin-formation">
              <option value="club">The club's own ({formationForStyle(clubStyle)})</option>
              {FORMATIONS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <span className="help">The real squad lines up in it. Four spins of the {leagues.find((l) => l.id === leagueId)?.name ?? 'league'} wheel add to it; Realistic, and the board can sack you from the first week.</span>
          </div>
        </div>

        <div className="col">
          <div className="panel col" data-testid="runin-suggested">
            <h3>Three jobs for this seed</h3>
            {!ready && <span className="muted small">Loading league data…</span>}
            {ready && suggested.length === 0 && <span className="muted small">No jobs of this kind in this league.</span>}
            {suggested.map((j, i) => row(j, `runin-job-${i}`))}
          </div>
          {ready && jobs.length > 0 && (
            <details className="panel" data-testid="runin-browse">
              <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Browse all {jobs.length}</summary>
              <div className="col" style={{ marginTop: 8, gap: 6 }}>
                {bySeason.map((g) => (
                  <div key={g.season} className="col" style={{ gap: 4 }}>
                    <div className="small muted">{seasonLabel(g.season)}</div>
                    {g.jobs.map((j) => row(j))}
                  </div>
                ))}
              </div>
            </details>
          )}
          <div className="bottom-bar" ref={barRef}>
            <div className="small muted" data-testid="runin-summary">
              {settings ? summariseRunIn(u, settings) : ready ? 'Pick a job' : 'Loading league data…'}
            </div>
            <button className="btn primary big block" onClick={start} disabled={!ready || loadingLeagues || !job} data-testid="runin-start">
              {!ready ? 'Loading league data…' : job ? `Take over ${clubName(u, job.clubId)}` : 'Pick a job'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
