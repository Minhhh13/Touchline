import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { slotOf } from '@game/store'
import { useStorePick } from '../useStorePick'
import { LeagueRetry, LeagueWait } from '../components/LeagueRetry'
import type { GameSettings } from '@game/types'
import { rememberTeamName, useTeamName } from '../teamName'
import { ARENA_FIELDS, arenaNeedsAllLeagues, colourClubs, CUP_SQUAD, cupGameSettings, DEFAULT_CUP_SIZE, DEFAULT_DECADE, GAUNTLET_BONUS_AFTER, GAUNTLET_SQUAD, GAUNTLET_SQUAD_CAP, gauntletGameSettings, latestCompleteSeason, summariseArena } from '@game/logic/arena'
import { arenaFormatText } from '../i18n/modeText'
import { rich, B } from '../i18n/rich'
import { translator } from '../i18n'
import { arena } from '../i18n/en/arena'

const t = translator(arena)
import { getFormation } from '@engine/formations'
import type { ArenaField } from '@engine/knockout'
import { CUP_FIELD_TARGET, cupDecades, cupRoundCount, cupRoundName, type CupSize } from '@engine/cup'
import { GAUNTLET_BANDS, GAUNTLET_CEILING, GAUNTLET_RUNGS, gauntletHome } from '@engine/gauntlet'
import { ChevronRight, Gift, Trophy } from 'lucide-react'
import { gauntletBandText } from '../arenaText'
import { randomSeed } from '@engine/rng'
import { ClubBadge, Info, Segmented } from '../components/bits'
import { LeagueFlag } from '../components/Flag'
import { Pitch } from '../components/Pitch'
import { FormationPicker } from '../components/FormationPicker'
import { TeamNameField } from '../components/SetupBits'
import { seasonLabel } from '../format'
import { CapControl } from '../components/CapControl'
import { capXI, DEFAULT_CAP_CHOICE, type CapChoice } from '@game/logic/cap'
import { askConfirm } from '../confirm'

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
  const { universe: u, startGame, go, ensureLeagues, loadingLeagues, loadedLeagues, game, parked, arenaSetupFormat } = useStorePick('universe', 'startGame', 'go', 'ensureLeagues', 'loadingLeagues', 'loadedLeagues', 'game', 'parked', 'arenaSetupFormat')
  const [format, setFormat] = useState<'cup' | 'gauntlet'>(arenaSetupFormat)
  const gauntlet = format === 'gauntlet'
  // An invented club name, or the one this viewer last typed (teamName.ts)
  const team = useTeamName()
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

  if (!u) return <div className="page">{t('loading')}</div>
  const toggleAdvanced = (open: boolean) => {
    setAdvanced(open)
    writeAdvanced(open)
  }
  const buildSettings = (preview: boolean): GameSettings | null => {
    if (!ready || !season) return null
    const name = team.name
    const c = { teamName: name, formationId, field, wheelLeagues, ...eraRange(era, u.firstSeason), difficulty, seed: seed.trim() || (preview ? t('seedLater') : randomSeed()), hardMode, twists, hostClubId: hostClubId || undefined, size, decade, capXI: capXI(cap) }
    return gauntlet ? gauntletGameSettings(u, c, team.shortName) : cupGameSettings(u, c, team.shortName)
  }
  const preview = buildSettings(true)
  // Starting over an unfinished run asks first, as the Daily does over a Quick Draft
  const unfinished = [game, parked.arena].find((g) => g && slotOf(g) === 'arena' && g.phase !== 'summary')
  const start = async () => {
    const s = buildSettings(false)
    if (!s) return
    if (unfinished && !(await askConfirm(t('newRunConfirm', { format: arenaFormatText(unfinished.settings.arena), team: unfinished.settings.teamName }), { ok: t('startOk'), danger: true }))) return
    rememberTeamName(s.teamName)
    startGame(s)
  }

  const shown = getFormation(formationId)
  return (
    // Main's setup layout (DESIGN_SYSTEM.md, Setup): numbered steps in two boxes, one screen on a desktop
    <div className="page setup-page arena-setup has-bottom-bar" style={barHeight ? ({ '--bottom-bar-h': `${barHeight}px` } as CSSProperties) : undefined}>
      <div className="setup-flow setup-wide">
        <div className="row between wrap" style={{ alignItems: 'flex-start' }}>
          <div>
            <h1>{t(gauntlet ? 'theGauntlet' : final ? 'cupFinal' : 'theCup')}</h1>
            <p className="muted setup-sub" data-testid="arena-format-help">
              {gauntlet ? t('helpGauntlet', { n: GAUNTLET_SQUAD }) : final ? t('helpFinal', { n: CUP_SQUAD }) : t('helpCup', { n: CUP_SQUAD, size })}{' '}
              <Info label={t('aboutFormat')}>{gauntlet
                    ? t('infoGauntlet', { n: GAUNTLET_SQUAD, cap: GAUNTLET_SQUAD_CAP })
                    : final
                      ? t('infoFinal', { n: CUP_SQUAD })
                      : t('infoCup', { n: CUP_SQUAD, size })}</Info>
            </p>
          </div>
          <button className="btn ghost" onClick={() => go('home')}>
            {t('back')}
          </button>
        </div>

        <div className="setup-grid">
          <div className="panel setup-box">
            <section className="setup-step setup-formation">
              <StepHead n={1} title={t('stepFormation')} />
              <div className="setup-formation-body">
                <FormationPicker value={formationId} onChange={setFormationId} />
                <div className="setup-preview">
                  <div className="pitch-mini" data-testid="formation-preview" inert>
                    <Pitch formation={shown} lineup={{}} getPlayer={() => undefined} />
                  </div>
                  <p className="help setup-line">
                    {rich(t('benchLine', { name: shown.name, n: gauntlet ? GAUNTLET_SQUAD - 11 : CUP_SQUAD - 11 }), B)}
                  </p>
                </div>
              </div>
            </section>
            <section className="setup-step setup-team">
              <StepHead n={2} title={t('stepName')} />
              <div className="setup-name">
                <TeamNameField value={team.value} onChange={team.setValue} fallback={team.fallback} />
              </div>
            </section>
          </div>

          <div className="panel setup-box">
            <section className="setup-step">
              <StepHead n={3} title={t(gauntlet ? 'stepLadder' : final ? 'stepFinal' : 'stepCup')} />
              <div className="setup-rules arena-rules">
                <div className="setup-opt setup-wide-opt">
                  <h3>{t('format')}</h3>
                  <Segmented
                    value={format}
                    onChange={setFormat}
                    options={[
                      { value: 'cup', label: t('theCup'), hint: t('cupHint', { n: CUP_SQUAD }) },
                      { value: 'gauntlet', label: t('theGauntlet'), hint: t('gauntletHint', { n: GAUNTLET_SQUAD }) },
                    ]}
                  />
                </div>
                {!gauntlet && (
                  <div className="setup-opt setup-wide-opt" data-testid="arena-size">
                    <h3>{t('size')}</h3>
                    <Segmented
                      value={String(size)}
                      onChange={(v) => setSize(Number(v) as CupSize)}
                      options={[
                        { value: '2', label: t('sizeFinal'), hint: t('sizeFinalHint') },
                        { value: '8', label: t('sizeClubs', { n: 8 }), hint: t('size8Hint') },
                        { value: '16', label: t('sizeClubs', { n: 16 }), hint: t('size16Hint') },
                        { value: '32', label: t('sizeClubs', { n: 32 }), hint: t('size32Hint') },
                      ]}
                    />
                  </div>
                )}
                {!gauntlet && (
                  <div className="setup-opt setup-wide-opt" data-testid="arena-field">
                    <h3>
                      {t(final ? 'opponent' : 'field')}{' '}
                      <Info label={t('aboutField')}>
                        {t('fieldInfo', { hint: t(`fieldHint_${field}`), final: final ? 'yes' : 'no' })}
                      </Info>
                    </h3>
                    <Segmented value={field} onChange={setField} options={ARENA_FIELDS.map((f) => ({ value: f.value, label: t(`field_${f.value}`), hint: t(`fieldHint_${f.value}`) }))} />
                    {field === 'decade' && (
                      <select className="input" value={decade} onChange={(e) => setDecade(Number(e.target.value))} data-testid="arena-decade">
                        {cupDecades(u.firstSeason, u.lastSeason).map((d) => (
                          <option key={d} value={d}>
                            {t('decadeOption', { d, from: seasonLabel(Math.max(d, u.firstSeason)), to: seasonLabel(Math.min(d + 9, u.lastSeason)) })}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}
                {!advanced && <RoadAhead gauntlet={gauntlet} size={size} />}
                <div className="setup-opt setup-wide-opt setup-more" ref={moreRef} data-testid="arena-more">
                  <button type="button" className="fold-head" onClick={() => toggleAdvanced(!advanced)} aria-expanded={advanced}>
                    <h3>{t('moreOptions')}</h3>
                    <span className="small muted">{t(advanced ? 'hide' : 'show')}</span>
                  </button>
                  {advanced && (
                    <>
                      <div className="field">
                        {t('draftFrom')}
                        <Segmented value={wheelScope} onChange={setWheelScope} options={[{ value: 'league', label: t('oneLeague') }, { value: 'europe', label: t('europeanNights', { n: u.available.length }) }]} />
                      </div>
                      {wheelScope === 'league' && (
                        <div className="field">
                          {t('league')}
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
                          {t('era')} <Info label={t('aboutEra')}>{gauntlet ? t('eraGauntlet') : field === 'decade' ? t('eraDecade') : field === 'europe' ? t('eraEurope') : t('eraOther', { final: final ? 'yes' : 'no' })}</Info>
                        </span>
                        <Segmented
                          value={era}
                          onChange={setEra}
                          options={[
                            { value: 'all', label: t('allEras') },
                            { value: 'early', label: t('eraEarly', { from: seasonLabel(u.firstSeason) }) },
                            { value: 'mid', label: t('eraMid') },
                            { value: 'modern', label: t('eraModern') },
                          ]}
                        />
                      </div>
                      <div className="field">
                        <span>
                          {t('difficulty')}{' '}
                          <Info label={t('aboutDifficulty')}>{difficulty === 'calibrated' ? (gauntlet ? t('diffGauntlet', { start: GAUNTLET_CEILING.start, step: GAUNTLET_CEILING.step }) : final ? t('diffFinal') : t('diffCup', { n: CUP_FIELD_TARGET[field] })) : t('diffRealistic')}</Info>
                        </span>
                        <Segmented
                          value={difficulty}
                          onChange={setDifficulty}
                          options={[
                            { value: 'calibrated', label: t('calibrated'), hint: t(gauntlet ? 'calGauntletHint' : final ? 'calFinalHint' : 'calCupHint') },
                            { value: 'realistic', label: t('realistic'), hint: t('realisticHint') },
                          ]}
                        />
                      </div>
                      <label className="field">
                        <span>
                          {t('seed')} <Info label={t('aboutSeed')}>{t(gauntlet ? 'seedGauntlet' : final ? 'seedFinal' : 'seedCup')}</Info>
                        </span>
                        <div className="row">
                          <input className="input mono" value={seed} onChange={(e) => setSeed(e.target.value)} />
                          <button className="btn sm" onClick={() => setSeed(randomSeed())}>
                            {t('newSeed')}
                          </button>
                        </div>
                      </label>
                      <div className="toggle-grid">
                        <label className="toggle">
                          <input type="checkbox" checked={hardMode} onChange={(e) => setHardMode(e.target.checked)} />
                          {t('hardMode')}
                        </label>
                        <label className="toggle" title={t('twistsTip')}>
                          <input type="checkbox" checked={twists} onChange={(e) => setTwists(e.target.checked)} />
                          {t('twists')}
                        </label>
                      </div>
                      <CapControl value={cap} onChange={setCap} squadSize={gauntlet ? GAUNTLET_SQUAD : CUP_SQUAD} />
                      {clubs.length > 0 && (
                        <label className="field">
                          <span>
                            {t('colours')} <Info label={t('aboutColours')}>{t('coloursInfo')}</Info>
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
              <StepHead n={4} title={t('stepSpin')} />
              <div className="small muted" data-testid="arena-summary">
                {preview ? summariseArena(u, preview) : <LeagueWait needs={needs} />}
                {' · '}
                <button
                  type="button"
                  className="linklike"
                  onClick={() => {
                    toggleAdvanced(true)
                    moreRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }}
                >
                  {t('change')}
                </button>
              </div>
              <LeagueRetry needs={needs} />
              <button className="btn primary big block" onClick={start} disabled={!ready || loadingLeagues || !preview} data-testid="arena-start">
                {!ready ? <LeagueWait needs={needs} /> : t(gauntlet ? 'draftGauntlet' : final ? 'draftFinal' : 'draftCup')}
              </button>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * The road ahead, under the format's choices while More options is closed (the box's foot was empty): the Cup's rounds
 * to the final, or the Gauntlet's fifteen rungs from the weakest tenth of the wheel to its strongest 5%, the rungs that
 * earn a bonus spin marked. Display only: the draw and the ladder are made when the run starts.
 */
function RoadAhead({ gauntlet, size }: { gauntlet: boolean; size: CupSize }) {
  if (gauntlet)
    return (
      <div className="setup-opt setup-wide-opt road-ahead" data-testid="arena-road">
        <h3>{t('roadAhead')}</h3>
        <ol className="road-rungs" aria-label={t('rungsLabel')}>
          {Array.from({ length: GAUNTLET_RUNGS }, (_, i) => {
            const rung = i + 1
            const bonus = GAUNTLET_BONUS_AFTER.includes(rung)
            const tip = t('roadRungTip', { n: rung, band: gauntletBandText(rung), home: gauntletHome(rung) ? 'yes' : 'no', bonus: bonus ? 'yes' : 'no' })
            return (
              <li key={rung} className={`road-rung${rung > GAUNTLET_BANDS ? ' top' : ''}${bonus ? ' bonus' : ''}`} title={tip} style={{ '--rung': Math.min(rung, GAUNTLET_BANDS + 2) } as CSSProperties}>
                <span className="sr-only">{tip}</span>
                <span aria-hidden="true">{rung}</span>
                {bonus && <Gift size={12} aria-hidden="true" />}
              </li>
            )
          })}
        </ol>
        <p className="help">{t('roadGauntletLine', { top: GAUNTLET_BANDS + 1 })}</p>
      </div>
    )
  const rounds = cupRoundCount(size)
  return (
    <div className="setup-opt setup-wide-opt road-ahead" data-testid="arena-road">
      <h3>{t('roadAhead')}</h3>
      <ol className="road-rounds" aria-label={t('roadRounds')}>
        {Array.from({ length: rounds }, (_, r) => {
          const { code, name } = cupRoundName(size, r)
          // In brackets, so the catalogue test reads the template's prefix as a use of the round_ keys
          const key = (`round_${code}`)
          const last = r === rounds - 1
          return (
            <li key={code} className={`road-round${last ? ' final' : ''}`}>
              {last && <Trophy size={14} aria-hidden="true" />}
              <span>{t.has(key) ? t(key) : name}</span>
              {!last && <ChevronRight size={14} aria-hidden="true" className="road-arrow" />}
            </li>
          )
        })}
      </ol>
      <p className="help">{t('roadCupLine', { n: rounds })}</p>
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
