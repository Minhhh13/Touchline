import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useStore, slotOf } from '@game/store'
import { LeagueRetry, LeagueWait } from '../components/LeagueRetry'
import { RUN_IN_LEAGUES, runInCatalogue, suggestRunIns, type RunInJob, type RunInTemplate } from '@engine/scenario'
import { FORMATIONS } from '@engine/formations'
import { formationForStyle } from '@engine/tactics'
import { randomSeed } from '@engine/rng'
import { runInWeekSeed } from '@game/logic/runinWeekly'
import { RUN_IN_BRIEF_SHORT, RUN_IN_SPINS, runInGameSettings, summariseRunIn } from '@game/logic/runin'
import { ClubBadge, Info, Segmented } from '../components/bits'
import { LeagueFlag } from '../components/Flag'
import { clubName, formationName, seasonLabel } from '../format'
import { askConfirm } from '../confirm'
import { translator } from '../i18n'
import { runin } from '../i18n/en/runin'
import { jobText, templateText } from '../runInText'

const t = translator(runin)

const keyOf = (j: RunInJob) => `${j.clubId}@${j.season}`

/** Setup for a run-in: the brief, the league, three jobs drawn by the seed and the whole catalogue. Its own screen, so Setup.tsx stays untouched. */
export function RunInSetup() {
  const { universe: u, startGame, go, ensureLeagues, loadingLeagues, loadedLeagues, game, parked, startRunInWeek, showToast } = useStore()
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
  if (!u) return <div className="page">{t('loading')}</div>
  const job = jobs.find((j) => keyOf(j) === picked) ?? suggested[0] ?? null
  const clubStyle = job ? (u.clubById[job.clubId]?.style ?? 'balanced') : 'balanced'
  const formationId = formation === 'club' ? formationForStyle(clubStyle) : formation
  const settings = job ? runInGameSettings(u, job, { seed: seedValue, formationId }) : null
  const leagues = u.available.filter((l) => (RUN_IN_LEAGUES as readonly string[]).includes(l.id))
  const unfinished = [game, parked.runin].find((g) => g && slotOf(g) === 'runin' && g.phase !== 'summary')
  const start = async () => {
    if (!job) return
    if (unfinished && !(await askConfirm(t('newJobConfirm', { team: unfinished.settings.teamName }), { ok: t('takeJobOk'), danger: true }))) return
    startGame(runInGameSettings(u, job, { seed: seedValue, formationId }))
  }
  // The Run-in of the week: one job for everyone, ranked on the World leaderboard when the assistant plays it from the draft
  const playWeek = async () => {
    if (unfinished && !(await askConfirm(t('weekConfirm', { team: unfinished.settings.teamName }), { ok: t('takeJobOk'), danger: true }))) return
    if (!(await startRunInWeek(runInWeekSeed()))) showToast(t('weekLoadFailed'))
  }
  const row = (j: RunInJob, testid?: string) => (
    <button key={keyOf(j)} type="button" className={`prow ${job && keyOf(j) === keyOf(job) ? 'selected' : ''}`} onClick={() => setPicked(keyOf(j))} data-testid={testid}>
      <ClubBadge clubId={j.clubId} size={30} />
      <span>
        <span className="name">
          {clubName(u, j.clubId)} <span className="muted small">{seasonLabel(j.season)}</span>
        </span>
        <span className="small muted">{jobText(j)}</span>
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
            <h1>{t('title')}</h1>
            <p className="muted setup-sub">
              {t('sub')}{' '}
              <Info label={t('aboutRunIn')}>{t('runInInfo')}</Info>
            </p>
          </div>
          <div className="row">
            <button className="btn" onClick={() => void playWeek()} data-testid="runin-week" title={t('weekTip')}>
              {t('weekButton')}
            </button>
            <button className="btn ghost" onClick={() => go('home')}>
              {t('back')}
            </button>
          </div>
        </div>

        <div className="setup-grid">
          <div className="panel setup-box">
            <section className="setup-step">
              <StepHead n={1} title={t('stepBrief')} />
              <div className="field" data-testid="runin-template">
                <Segmented
                  value={template}
                  onChange={(v) => {
                    setTemplate(v)
                    setPicked(null)
                  }}
                  options={[
                    { value: 'title', label: templateText('title'), hint: t('titleHint') },
                    { value: 'europe', label: templateText('europe'), hint: t('europeHint') },
                    { value: 'survival', label: templateText('survival'), hint: t('survivalHint') },
                  ]}
                />
              </div>
            </section>
            <section className="setup-step">
              <StepHead n={2} title={t('stepLeague')} />
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
              <StepHead n={3} title={t('stepShape')} />
              <label className="field">
                <span>
                  {t('shape')} <Info label={t('aboutShape')}>{t('shapeInfo', { league: leagues.find((l) => l.id === leagueId)?.name ?? t('leagueFallback') })}</Info>
                </span>
                <select className="input" value={formation} onChange={(e) => setFormation(e.target.value)} data-testid="runin-formation">
                  <option value="club">{t('clubOwn', { name: formationName(formationForStyle(clubStyle)) })}</option>
                  {FORMATIONS.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>
                  {t('seed')} <Info label={t('aboutSeed')}>{t('seedInfo', { n: RUN_IN_SPINS })}</Info>
                </span>
                <div className="row">
                  <input className="input mono" value={seed} onChange={(e) => setSeed(e.target.value)} data-testid="runin-seed" />
                  <button className="btn sm" onClick={() => setSeed(randomSeed())}>
                    {t('newSeed')}
                  </button>
                </div>
              </label>
            </section>
          </div>

          <div className="panel setup-box">
            <section className="setup-step">
              <StepHead n={4} title={t('stepJob')} />
              <div className="setup-rules runin-jobs">
                <div className="setup-opt setup-wide-opt col" data-testid="runin-suggested">
                  <h3>{t('threeJobs')}</h3>
                  {!ready && <span className="muted small"><LeagueWait needs={[leagueId]} /></span>}
                  {ready && suggested.length === 0 && <span className="muted small">{t('noJobs')}</span>}
                  {suggested.map((j, i) => row(j, `runin-job-${i}`))}
                </div>
                {ready && jobs.length > 0 && (
                  <details className="setup-opt setup-wide-opt" data-testid="runin-browse">
                    <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{t('browseAll', { n: jobs.length })}</summary>
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
              <StepHead n={5} title={t('stepTake')} />
              <div className="small muted" data-testid="runin-summary">
                {settings ? summariseRunIn(u, settings) : ready ? t('pickJob') : <LeagueWait needs={[leagueId]} />}
              </div>
              <LeagueRetry needs={[leagueId]} />
              <button className="btn primary big block" onClick={start} disabled={!ready || loadingLeagues || !job} data-testid="runin-start">
                {!ready ? <LeagueWait needs={[leagueId]} /> : job ? t('takeOver', { club: clubName(u, job.clubId) }) : t('pickJob')}
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
      <span className="sr-only">{t('stepN', { n })}</span>
      {title}
    </h3>
  )
}
