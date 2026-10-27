import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useStore, slotOf } from '@game/store'
import { LeagueRetry, LeagueWait } from '../components/LeagueRetry'
import { RUN_IN_LEAGUES, runInCatalogue, suggestRunIns, type RunInJob, type RunInTemplate } from '@engine/scenario'
import { FORMATIONS } from '@engine/formations'
import { formationForStyle } from '@engine/tactics'
import { randomSeed } from '@engine/rng'
import { jobLine, RUN_IN_BRIEF_SHORT, RUN_IN_SPINS, RUN_IN_TEMPLATE_LABEL, runInGameSettings, summariseRunIn } from '@game/logic/runin'
import { ClubBadge, Info, Segmented } from '../components/bits'
import { LeagueFlag } from '../components/Flag'
import { clubName, formationName, seasonLabel } from '../format'
import { askConfirm } from '../confirm'

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
  // One seed for the suggestions, the line above Start and the game: a blank box plays as `run-in`
  const seedValue = seed.trim() || 'run-in'
  const suggested = useMemo(() => suggestRunIns(jobs, seedValue), [jobs, seedValue])
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
  const settings = job ? runInGameSettings(u, job, { seed: seedValue, formationId }) : null
  const leagues = u.available.filter((l) => (RUN_IN_LEAGUES as readonly string[]).includes(l.id))
  const unfinished = [game, parked.runin].find((g) => g && slotOf(g) === 'runin' && g.phase !== 'summary')
  const start = async () => {
    if (!job) return
    if (unfinished && !(await askConfirm(`Take a new job? Your unfinished run-in (${unfinished.settings.teamName}) will be abandoned.`, { ok: 'Take the job', danger: true }))) return
    startGame(runInGameSettings(u, job, { seed: seedValue, formationId }))
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
    // Main's setup layout: numbered steps in two boxes, one screen on a desktop (the job list scrolls inside its box)
    <div className="page setup-page runin-setup has-bottom-bar" style={barHeight ? ({ '--bottom-bar-h': `${barHeight}px` } as CSSProperties) : undefined}>
      <div className="setup-flow setup-wide">
        <div className="row between wrap" style={{ alignItems: 'flex-start' }}>
          <div>
            <h1>Run-in</h1>
            <p className="muted setup-sub">
              Take over a real club at matchweek 28 with a brief, four spins and ten games.{' '}
              <Info label="About the run-in">Only leagues with real final tables offer run-ins. The table you take over is projected from the final one, scaled back to matchweek 28. The real squad lines up in your shape; Realistic, and the board can sack you from the first week.</Info>
            </p>
          </div>
          <button className="btn ghost" onClick={() => go('home')}>
            ← Back
          </button>
        </div>

        <div className="setup-grid">
          <div className="panel setup-box">
            <section className="setup-step">
              <StepHead n={1} title="Choose the brief" />
              <div className="field" data-testid="runin-template">
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
            </section>
            <section className="setup-step">
              <StepHead n={2} title="Choose your league" />
              <div className="field setup-league" data-testid="runin-league">
                <Segmented
                  value={leagueId}
                  onChange={(id) => {
                    setLeagueId(id)
                    setPicked(null)
                  }}
                  options={leagues.map((l) => ({ value: l.id, label: <><LeagueFlag leagueId={l.id} /> {l.name}</> }))}
                />
              </div>
            </section>
            <section className="setup-step">
              <StepHead n={3} title="Shape and seed" />
              <label className="field">
                <span>
                  Shape <Info label="About the shape">The real squad lines up in it. Four spins of the {leagues.find((l) => l.id === leagueId)?.name ?? 'league'} wheel add to it.</Info>
                </span>
                <select className="input" value={formation} onChange={(e) => setFormation(e.target.value)} data-testid="runin-formation">
                  <option value="club">The club's own ({formationName(formationForStyle(clubStyle))})</option>
                  {FORMATIONS.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>
                  Seed <Info label="About the seed">The seed draws the three suggested jobs, your {RUN_IN_SPINS} spins and the rest of the season.</Info>
                </span>
                <div className="row">
                  <input className="input mono" value={seed} onChange={(e) => setSeed(e.target.value)} data-testid="runin-seed" />
                  <button className="btn sm" onClick={() => setSeed(randomSeed())}>
                    New
                  </button>
                </div>
              </label>
            </section>
          </div>

          <div className="panel setup-box">
            <section className="setup-step">
              <StepHead n={4} title="Pick the job" />
              <div className="setup-rules runin-jobs">
                <div className="setup-opt setup-wide-opt col" data-testid="runin-suggested">
                  <h3>Three jobs for this seed</h3>
                  {!ready && <span className="muted small"><LeagueWait needs={[leagueId]} /></span>}
                  {ready && suggested.length === 0 && <span className="muted small">No jobs of this kind in this league.</span>}
                  {suggested.map((j, i) => row(j, `runin-job-${i}`))}
                </div>
                {ready && jobs.length > 0 && (
                  <details className="setup-opt setup-wide-opt" data-testid="runin-browse">
                    <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Browse all {jobs.length}</summary>
                    <div className="col" style={{ marginTop: 8, gap: 6 }}>
                      {bySeason.map((g) => (
                        <div key={g.season} className="col" style={{ gap: 4 }}>
                          <div className="eyebrow">{seasonLabel(g.season)}</div>
                          {g.jobs.map((j) => row(j))}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            </section>
            <section className="setup-step setup-start bottom-bar" ref={barRef}>
              <StepHead n={5} title="Take the job" />
              <div className="small muted" data-testid="runin-summary">
                {settings ? summariseRunIn(u, settings) : ready ? 'Pick a job' : <LeagueWait needs={[leagueId]} />}
              </div>
              <LeagueRetry needs={[leagueId]} />
              <button className="btn primary big block" onClick={start} disabled={!ready || loadingLeagues || !job} data-testid="runin-start">
                {!ready ? <LeagueWait needs={[leagueId]} /> : job ? `Take over ${clubName(u, job.clubId)}` : 'Pick a job'}
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
