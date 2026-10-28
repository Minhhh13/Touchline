import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, CircleCheck, Copy, Dices, Footprints, ImageDown, Lock, Repeat, RotateCcw, Share2, Swords, Trophy, Users, Wifi, type LucideIcon } from 'lucide-react'
import { useFocusOnLanding } from '../a11y'
import { type H2HGame } from '@game/store'
import { useStorePick } from '../useStorePick'
import { useTurnSound } from '../sound/useTurnSound'
import { LeagueRetry, LeagueWait, useLeagueGate } from '../components/LeagueRetry'
import { APP_NAME } from '../brand'
import { getFormation } from '@engine/formations'
import { randomSeed } from '@engine/rng'
import { h2hComplete, h2hEligibleSlots, h2hUsable, type H2HDraft } from '@engine/h2h'
import { isComplete, picksMade, fillingXI, suggestSlot, type DraftState } from '@engine/draft'
import { H2H_IDS, type H2HManager, type H2HResult } from '@game/logic/h2h'
import { h2hNeedsClassic, h2hSeasonChoices } from '@game/logic/h2hClassic'
import { h2hTurnKey, nextFirstPicker } from '@game/logic/h2hView'
import { useFlash } from '../useFlash'
import { classicFromIndex, estimatedNote } from '@game/logic/era'
import { CaseReel, TierChip } from '../components/CaseReel'
import { Pitch } from '../components/Pitch'
import { PlayerRow } from '../components/PlayerRow'
import { ClubBadge, EstimatedChip, Info, Segmented, Stat, TeamBadge } from '../components/bits'
import { FormationPicker } from '../components/FormationPicker'
import { LeagueFlag } from '../components/Flag'
import { clubName, fixed, ordinal, seasonLabel, tierName, formationName } from '../format'
import { TeamNameField } from '../components/SetupBits'
import { tierTable } from '@game/logic/rarity'
import { h2hReelPool, reelLeagues } from '@game/logic/reel'
import { h2hTierOdds } from '@game/logic/tierOdds'
import { SpinOdds } from '../components/SpinOdds'
import { renderShareCard, downloadDataUrl } from '../shareCard'
import { GameByGame } from '../components/GameByGame'
import { ratingHidden } from '@game/logic/ratingVisibility'
import { onlineAvailable } from '../../online/api'
import { RoomSetup } from '../online/Rooms'
import { askConfirm } from '../confirm'
import { copyText, hasShareSheet, shareOrCopy } from '../shareSheet'
import { translator } from '../i18n'
import { h2h as h2hText } from '../i18n/en/h2h'

const t = translator(h2hText)

/** The head-to-head a Rematch came from: the setup opens with its managers, clubs, league and rules (on a new wheel). */
let rematchOf: H2HGame | null = null
/** Open the setup on this head-to-head's settings next time it mounts (Rematch). */
export function setRematch(h: H2HGame | null): void {
  rematchOf = h
}

export function H2HSetup() {
  const { universe: u, startH2H, go, ensureLeagues, ensureClassic, classicLoaded, loadingLeagues, loadedLeagues } = useStorePick('universe', 'startH2H', 'go', 'ensureLeagues', 'ensureClassic', 'classicLoaded', 'loadingLeagues', 'loadedLeagues')
  const [last] = useState(() => rematchOf)
  // Read once: a later visit to the setup opens fresh, not on this rematch's settings again
  useEffect(() => {
    rematchOf = null
  }, [])
  const [leagueId, setLeagueId] = useState(last?.leagueId ?? 'england')
  const [wheelScope, setWheelScope] = useState<'league' | 'europe'>((last?.wheelLeagues?.length ?? 1) > 1 ? 'europe' : 'league')
  const [names, setNames] = useState(last ? last.managers.map((m) => m.name) : [t('managerN', { n: 1 }), t('managerN', { n: 2 })])
  const [formations, setFormations] = useState(last ? last.managers.map((m) => m.formationId) : ['4-3-3', '4-4-2'])
  const [leagueSeason, setLeagueSeason] = useState(() => last?.leagueSeason ?? (u ? Math.max(...u.clubSeasons.filter((cs) => cs.complete).map((cs) => cs.season)) : 2025))
  const [hosts, setHosts] = useState(last ? last.managers.map((m) => m.hostClubId) : ['', ''])
  const [difficulty, setDifficulty] = useState<'calibrated' | 'realistic'>(last?.difficulty ?? 'calibrated')
  const [hardMode, setHardMode] = useState(last?.hardMode ?? false)
  // Classic seasons (1992-93 to 2007-08, estimated ratings): off unless asked for, as in Setup; a Rematch keeps the choice
  const [classicOn, setClassicOn] = useState(() => h2hNeedsClassic(last))
  const [seed, setSeed] = useState(() => randomSeed())
  // Two devices instead of one: only in a build with the online layer (an offline build shows exactly the hot-seat setup)
  const [where, setWhere] = useState<'device' | 'online'>('device')
  if (!u) return null
  const online = onlineAvailable()
  const back = (
    <button className="btn ghost" onClick={() => go('home')}>
      {t('back')}
    </button>
  )
  const switcher = online ? <Segmented value={where} onChange={setWhere} options={[{ value: 'device', label: <><Users size={14} aria-hidden="true" /> {t('thisDevice')}</>, testId: 'h2h-where-device' }, { value: 'online', label: <><Wifi size={14} aria-hidden="true" /> {t('playOnline')}</>, testId: 'h2h-where-online' }]} /> : null
  if (online && where === 'online')
    return (
      <div className="page">
        <div className="screen-head">
          <div className="screen-title">
            <h1>{t('title')}</h1>
            <div className="screen-meta">
              <span>{t('metaOnline')}</span>
            </div>
          </div>
          <div className="toolbar">
            {switcher}
            {back}
          </div>
        </div>
        <RoomSetup />
      </div>
    )
  const wheelLeagues = wheelScope === 'europe' ? u.available.map((l) => l.id) : [leagueId]
  // The toggle shows from the data index (England's classic seasons); the classic pack itself loads when it is switched on
  const classicFrom = classicFromIndex(u.available, [...new Set([leagueId, ...wheelLeagues])])
  const classic = classicOn && classicFrom !== undefined
  const seasonChoices = h2hSeasonChoices(u, leagueId, classic)
  const seasons = seasonChoices.map((c) => c.season)
  const effectiveSeason = seasons.includes(leagueSeason) ? leagueSeason : seasons[seasons.length - 1]
  const classicSeason = !!seasonChoices.find((c) => c.season === effectiveSeason)?.classic
  const clubs = u.clubSeasons.filter((cs) => cs.leagueId === leagueId && cs.season === effectiveSeason).map((cs) => cs.clubId).sort()
  const ready = wheelLeagues.every((l) => loadedLeagues.includes(l)) && loadedLeagues.includes(leagueId) && (!classic || classicLoaded)
  const host0 = clubs.includes(hosts[0]) ? hosts[0] : clubs[Math.floor(clubs.length / 3)]
  const host1 = clubs.includes(hosts[1]) && hosts[1] !== host0 ? hosts[1] : clubs.find((c) => c !== host0) ?? clubs[0]
  const short = (n: string) => n.split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase() || 'MGR'
  const nameOf = (i: number) => names[i].trim() || t('managerN', { n: i + 1 })
  return (
    <div className="page">
      <div className="screen-head">
        <div className="screen-title">
          <h1>{t('title')}</h1>
          <div className="screen-meta">
            <span>{t('metaDevice')}</span>
          </div>
        </div>
        {switcher ? (
          <div className="toolbar">
            {switcher}
            {back}
          </div>
        ) : (
          back
        )}
      </div>
      <div className="screen-body scroll-whole fill">
      <ol className="steps" aria-label={t('howItWorks')}>
        {h2hSteps().map(({ Icon, title, line }) => (
          <li key={title}>
            <span className="step-icon" aria-hidden="true">
              <Icon size={20} />
            </span>
            <span>
              <b>{title}</b>
              <span className="small muted">{line}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="grid two">
        {[0, 1].map((i) => {
          // No club until the league's pack has loaded (a league just picked, or offline): no badge until then
          const host: string | undefined = i === 0 ? host0 : host1
          return (
            <div key={i} className="panel col">
              <div className="club-head">
                {host ? <ClubBadge clubId={host} size={36} /> : null}
                <h3 style={{ margin: 0 }}>{t('managerN', { n: i + 1 })}</h3>
              </div>
              <TeamNameField label={t('name')} value={names[i]} onChange={(v) => setNames(names.map((n, j) => (j === i ? v : n)))} fallback={t('managerN', { n: i + 1 })} maxLength={24} testId={`h2h-name-${i}`} taken={[names[1 - i]]} />
              <div className="field formation-field">
                {t('formation')}
                <FormationPicker value={formations[i]} onChange={(id) => setFormations(formations.map((f, j) => (j === i ? id : f)))} label={t('managerFormation', { n: i + 1 })} testId={`h2h-formation-${i}`} />
                <span className="help">{getFormation(formations[i]).blurb}</span>
              </div>
              <label className="field">
                {t('hostClub')}
                <select className="input" value={host ?? ''} onChange={(e) => setHosts(hosts.map((h, j) => (j === i ? e.target.value : h)))}>
                  {clubs.filter((c) => (i === 0 ? c !== host1 : c !== host0)).map((c) => (
                    <option key={c} value={c}>
                      {clubName(u, c)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )
        })}
        <div className="panel col h2h-league">
          <h3 style={{ margin: 0 }}>{t('theLeague')}</h3>
          <div className="grid two">
          <div className="col">
          <div className="field">
            {t('league')}
            <Segmented value={leagueId} onChange={(id) => { setLeagueId(id); setHosts(['', '']); void ensureLeagues(wheelScope === 'europe' ? u.available.map((l) => l.id) : [id]) }} options={u.available.map((l) => ({ value: l.id, label: <><LeagueFlag leagueId={l.id} /> {l.name}</> }))} />
          </div>
          <div className="field">
            {t('draftFrom')}
            <Segmented value={wheelScope} onChange={(sc) => { setWheelScope(sc); void ensureLeagues(sc === 'europe' ? u.available.map((l) => l.id) : [leagueId]) }} options={[{ value: 'league', label: <><LeagueFlag leagueId={leagueId} /> {t('thisLeague')}</> }, { value: 'europe', label: <><LeagueFlag leagueId="europe" /> {t('allLeagues', { n: u.available.length })}</> }]} />
          </div>
          </div>
          <div className="col">
          <label className="field">
            {t('season')}
            <select className="input" value={effectiveSeason} onChange={(e) => setLeagueSeason(Number(e.target.value))}>
              {[...seasonChoices].reverse().map(({ season: s, classic: est }) => (
                <option key={s} value={s}>
                  {t('seasonChoice', { season: seasonLabel(s), current: s === u.currentSeason ? 'yes' : 'no', est: est ? 'yes' : 'no' })}
                </option>
              ))}
            </select>
            {classicSeason && (
              <span className="help">
                <EstimatedChip compact /> {t('classicSeasonHelp')}
              </span>
            )}
          </label>
          {classicFrom !== undefined && (
            <label className="toggle" title={t('classicTip')}>
              <input
                type="checkbox"
                checked={classic}
                data-testid="h2h-classic"
                onChange={(e) => {
                  const on = e.target.checked
                  setClassicOn(on)
                  // Its pack loads now (Start waits for it); one that cannot load switches the toggle back off
                  if (on) void ensureClassic().then((ok) => void (ok || setClassicOn(false)))
                }}
              />
              {t('classicRange', { from: seasonLabel(classicFrom), to: seasonLabel(u.firstSeason - 1) })} <EstimatedChip compact />
            </label>
          )}
          <div className="field">
            <span>
              {t('difficulty')} <Info label={t('aboutDifficulty')}>{t('difficultyInfo')}</Info>
            </span>
            <Segmented value={difficulty} onChange={setDifficulty} options={[{ value: 'calibrated', label: t('calibrated') }, { value: 'realistic', label: t('realistic') }]} />
          </div>
          <label className="toggle">
            <input type="checkbox" checked={hardMode} onChange={(e) => setHardMode(e.target.checked)} />
            {t('hardMode')} <Info label={t('aboutHardMode')}>{t('hardModeInfo')}</Info>
          </label>
          <div className="field">
            <span>
              {t('seed')} <Info label={t('aboutSeeds')}>{t('seedInfo')}</Info>
            </span>
            <div className="row">
              <input className="input mono" aria-label={t('seed')} value={seed} onChange={(e) => setSeed(e.target.value)} />
              <button className="btn sm" onClick={() => setSeed(randomSeed())}>
                {t('newSeed')}
              </button>
            </div>
          </div>
          </div>
          </div>
        </div>
        <div className="h2h-start">
          <LeagueRetry needs={[leagueId, ...wheelLeagues]} classic={classic} />
          <button className="btn primary big block" data-testid="h2h-start" disabled={!ready || loadingLeagues || !host0 || !host1} onClick={() => startH2H([{ name: nameOf(0), shortName: short(nameOf(0)), formationId: formations[0], hostClubId: host0 }, { name: nameOf(1), shortName: short(nameOf(1)), formationId: formations[1], hostClubId: host1 }], leagueId, wheelLeagues, effectiveSeason, difficulty, hardMode, seed.trim() || randomSeed(), classic)}>
            {ready ? t('start') : <LeagueWait needs={[leagueId, ...wheelLeagues]} classic={classic} />}
          </button>
        </div>
      </div>
      </div>
    </div>
  )
}

export function H2HScreen() {
  const { universe: u, h2h, h2hSpin, h2hPick, h2hAuto, h2hFinish, abandonH2H, go, showToast, ensureLeagues, loadingLeagues } = useStorePick('universe', 'h2h', 'h2hSpin', 'h2hPick', 'h2hAuto', 'h2hFinish', 'abandonH2H', 'go', 'showToast', 'ensureLeagues', 'loadingLeagues')
  // A head-to-head renders only against the packs it was drafted from: its leagues and, for a classic one, the classic
  // seasons (a reload whose classic pack failed, or a head-to-head restored from the cloud); they load here, Retry when offline
  const needs = h2h ? [...new Set([h2h.leagueId, ...(h2h.wheelLeagues ?? [])])] : []
  const needsClassic = h2hNeedsClassic(h2h)
  const gate = useLeagueGate(needs, needsClassic)
  const needKey = needs.join()
  useEffect(() => {
    if (gate === 'loading' && !loadingLeagues) void ensureLeagues(needKey.split(','), needsClassic)
  }, [gate, loadingLeagues, needKey, needsClassic, ensureLeagues])
  const packsReady = gate === 'ready'
  // As in the Draft: the spin whose reel has landed, and a selection that belongs to its spin
  const [settled, setSettled] = useState<H2HDraft['current']>(null)
  const [picked, setPicked] = useState<{ id: string; turn: string } | null>(null)
  const d = h2h?.draft
  const spinning = !!d?.current && settled !== d.current
  const revealed = !!d?.current && settled === d.current
  // Keyed to the spin and the manager picking: both pick on one spin, so one manager's selection never carries to the other
  const turn = h2hTurnKey(d)
  const selectedPlayer = picked && turn !== null && picked.turn === turn ? picked.id : null
  const setSelectedPlayer = (id: string | null) => setPicked(id && turn !== null ? { id, turn } : null)
  const pool = useMemo(
    () => (u && h2h && packsReady ? h2hReelPool(u, h2h.draft) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [u, packsReady, h2h?.draft.spins, h2h?.draft.log.length],
  )
  // The leagues the wheel draws from are the draft rules' (an older save may lack `wheelLeagues`)
  const rules = h2h?.draft.drafts[0].rules
  const leagues = useMemo(() => (u && rules ? reelLeagues(u, rules) : []), [u, rules])
  // The exact tier odds of the next spin, shown between spins
  const odds = useMemo(() => (u && h2h && packsReady && !h2h.draft.current && !h2hComplete(h2h.draft) ? h2hTierOdds(u, h2h.draft, leagues) : []), [u, h2h, packsReady, leagues])
  // As in the Draft: the landing puts the focus on the club's name (the squad is the next Tab), and once both have
  // picked it goes to Spin, or to Play the season when the squads are complete
  const clubHeadRef = useRef<HTMLHeadingElement>(null)
  const spinRef = useRef<HTMLButtonElement>(null)
  const finishRef = useRef<HTMLButtonElement>(null)
  const draftDone = !!d && h2hComplete(d)
  useFocusOnLanding(revealed, clubHeadRef)
  useFocusOnLanding(!!d && !d.current && d.log.length > 0 && !draftDone, spinRef)
  useFocusOnLanding(draftDone, finishRef)
  // The turn passing to the other manager, heard once the reel has landed (one screen for both: always the rising pair)
  useTurnSound(d?.picking ?? null, !!d?.current && settled === d.current, true)
  if (!u || !h2h || !d) return <H2HSetup />
  if (!packsReady)
    return (
      <div className="page">
        <div className="screen-head">
          <div className="screen-title">
            <h1>{t('draftTitle')}</h1>
            <div className="screen-meta">
              <span>
                {t('versus', { a: h2h.managers[0].name, b: h2h.managers[1].name })}
              </span>
            </div>
          </div>
          <div className="toolbar">
            <button className="btn ghost sm" onClick={() => go('home')}>
              {t('home')}
            </button>
          </div>
        </div>
        <div className="empty-state" data-testid="h2h-waiting">
          <span className="empty-icon" aria-hidden="true">
            <Dices size={26} />
          </span>
          <h3>
            <LeagueWait needs={needs} classic={needsClassic} />
          </h3>
          <LeagueRetry needs={needs} classic={needsClassic} />
        </div>
      </div>
    )
  if (h2h.result) return <H2HSummary />
  const current = d.current ? u.clubSeasonByKey[`${d.current.clubId}@${d.current.season}`] : null
  const tier = current ? tierTable(u, leagues)[`${current.clubId}@${current.season}`] : undefined
  const complete = h2hComplete(d)
  // The next spin's first picker as the engine decides it: once one squad is complete the other always picks first
  const firstName = h2h.managers[nextFirstPicker(d) ?? d.first].name
  const picking = d.picking
  const manager = picking !== null ? h2h.managers[picking] : null
  const usable = h2hUsable(u, d)
  const usableIds = new Set(usable.map((p) => p.id))
  const selected = selectedPlayer ? u.index[selectedPlayer] : undefined
  const eligible = selected ? h2hEligibleSlots(d, selected).map((s) => s.id) : []
  // Hard mode hides the players on offer; each manager's own picks show
  const hide = ratingHidden(d.drafts[0].rules, 'offer')
  const onPick = (pid: string) => {
    if (picking === null) return
    const p = u.index[pid]
    const slots = h2hEligibleSlots(d, p)
    const myDraft = d.drafts[picking]
    if (fillingXI(myDraft)) {
      if (slots.length === 1) h2hPick(pid, slots[0].id)
      else setSelectedPlayer(pid)
    } else h2hPick(pid, 'bench')
  }
  const onSlot = (idx: 0 | 1, slotId: string) => {
    if (!selected || picking !== idx) return
    if (!eligible.includes(slotId)) {
      showToast(t('cannotPlayThere', { name: selected.name }))
      return
    }
    h2hPick(selected.id, slotId)
    setSelectedPlayer(null)
  }
  return (
    <div className="page">
      <div className="screen-head">
        <div className="screen-title">
          <h1>{t('draftTitle')}</h1>
          <div className="screen-meta">
            <span>
              {t('versus', { a: h2h.managers[0].name, b: h2h.managers[1].name })}
            </span>
            <span>
              <LeagueFlag leagueId={h2h.leagueId} /> {u.leagues.find((l) => l.id === h2h.leagueId)?.name ?? t('leagueFallback')} {seasonLabel(h2h.leagueSeason)}
            </span>
            {h2h.hardMode && <span className="chip">{t('hardMode')}</span>}
            {needsClassic && (
              <span className="chip" data-testid="h2h-classic-chip">
                {t('classicSeasons')} <EstimatedChip compact />
              </span>
            )}
            <span className="mono">{t('seedValue', { seed: h2h.seed })}</span>
          </div>
        </div>
        <div className="toolbar">
          {manager && !spinning && <span className="chip info">{t('toPick', { name: manager.name })}</span>}
          <button className="btn ghost sm" onClick={() => go('home')}>
            {t('home')}
          </button>
          <button className="btn ghost sm danger" onClick={() => void askConfirm(t('abandonConfirm'), { ok: t('abandon'), danger: true }).then((ok) => { if (ok) abandonH2H() })}>
            {t('abandon')}
          </button>
        </div>
      </div>
      <div className="grid draft fill">
        <div className="col">
          <div className="panel col">
            <CaseReel u={u} leagues={leagues} pool={pool} target={d.current} spinKey={d.spins} onSettled={() => setSettled(d.current)} />
            {!d.current && !complete && <SpinOdds odds={odds} label={t('nextSpin')} />}
            {!complete && (
              <button ref={spinRef} className="btn primary spin-btn display" disabled={!!d.current || spinning} onClick={() => h2hSpin()}>
                {d.current ? (spinning ? t('spinning') : t('picks', { name: manager?.name ?? '' })) : t('spinFirst', { name: firstName })}
              </button>
            )}
            {complete && (
              <button ref={finishRef} className="btn primary spin-btn display" onClick={() => h2hFinish()}>
                {t('playSeason')}
              </button>
            )}
            {picking !== null && revealed && (
              <button className="btn sm ghost" onClick={() => h2hAuto()}>
                {t('assistantPick', { name: manager?.name })}
              </button>
            )}
          </div>
          {d.log.length > 0 && (
            <div className="panel tight">
              <div className="eyebrow">{t('draftLog')}</div>
              <ol className="h2h-log">
                {[...d.log].reverse().slice(0, 30).map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ol>
            </div>
          )}
        </div>
        <div className="panel col">
          {!current && (
            <div className="empty-state">
              <span className="empty-icon" aria-hidden="true">
                {complete ? <CircleCheck size={26} /> : <Dices size={26} />}
              </span>
              <h3>{complete ? t('bothComplete') : t('spinPicksFirst', { name: firstName })}</h3>
              {!complete && <p className="muted small">{t('oneSpin')}</p>}
            </div>
          )}
          {current && spinning && !revealed && (
            <div className="club-head">
              <span className="badge" style={{ width: 44, height: 44, background: 'var(--raised)', color: 'var(--text)', fontSize: 18 }}>?</span>
              <div>
                <h2>{t('opening')}</h2>
                <div className="muted small">{t('landing')}</div>
              </div>
            </div>
          )}
          {current && (!spinning || revealed) && (
            <>
              <div className="club-head">
                <ClubBadge clubId={current.clubId} size={44} />
                <div>
                  <h2 ref={clubHeadRef} tabIndex={-1}>{clubName(u, current.clubId)}</h2>
                  <div className="club-sub">
                    <span>{seasonLabel(current.season)}</span>
                    {!current.complete ? (
                      <span>{t('inProgress')}</span>
                    ) : current.champions ? (
                      <span className="chip gold icon-chip">
                        <Trophy size={12} aria-hidden="true" /> {t('champions')}
                      </span>
                    ) : current.position > 0 ? (
                      <span>{ordinal(current.position)}</span>
                    ) : (
                      <span>{t('noTable')}</span>
                    )}
                    {tier && <TierChip tier={tier} />}
                    {current.estimated && <EstimatedChip compact />}
                  </div>
                </div>
              </div>
              {revealed && manager && <div className="notice" aria-live="polite" aria-atomic="true">{t('pickPlayer', { name: manager.name, slot: selected ? 'yes' : 'no', player: selected?.name })}</div>}
              {revealed && (
                <div className="plist lined draft-list">
                  {[...current.squad]
                    .sort((a, b) => b.overall - a.overall)
                    .map((p) => {
                      const takenBy = d.drafts.findIndex((x) => x.takenPlayers.includes(p.playerId) && (Object.values(x.lineup).includes(p.id) || x.bench.includes(p.id)))
                      return (
                        <PlayerRow key={p.id} p={p} hideRatings={hide} hideChampion={current.champions} dim={!usableIds.has(p.id)} selected={selectedPlayer === p.id} onClick={() => onPick(p.id)} extra={takenBy >= 0 ? <span className="chip info">{h2h.managers[takenBy].shortName}</span> : null} right={usableIds.has(p.id) ? <span className={`btn sm ${selectedPlayer === p.id ? 'primary' : ''}`}>{t('draft')}</span> : null} />
                      )
                    })}
                </div>
              )}
            </>
          )}
        </div>
        <div className="col draft-pitch">
          {([0, 1] as const).map((i) => (
            <div key={i} className={`panel ${picking === i ? 'emphasis' : ''}`}>
              <div className="panel-head">
                <span className="club-head">
                  <ClubBadge clubId={h2h.managers[i].hostClubId} size={24} />
                  <h3>
                    {h2h.managers[i].name} · {formationName(h2h.managers[i].formationId)}
                  </h3>
                </span>
                <span className={`chip icon-chip ${isComplete(d.drafts[i]) ? 'good' : ''}`}>
                  {isComplete(d.drafts[i]) && <CircleCheck size={12} aria-hidden="true" />}
                  {picksMade(d.drafts[i])}/{d.drafts[i].rules.squadSize}
                </span>
              </div>
              <div className="h2h-pitch-box">
                <Pitch formation={d.drafts[i].formation} lineup={d.drafts[i].lineup} getPlayer={(id) => u.index[id]} onSlotClick={picking === i && selected ? (s) => onSlot(i, s) : undefined} eligibleSlots={picking === i ? eligible : []} hideRatings={ratingHidden(d.drafts[i].rules, 'squad')} />
              </div>
              {selected && picking === i && suggestSlot(d.drafts[i], selected) && suggestSlot(d.drafts[i], selected) !== 'bench' && (
                <button className="btn block" style={{ marginTop: 8 }} onClick={() => onSlot(i, suggestSlot(d.drafts[i], selected) as string)}>
                  {t('putAt', { name: selected.name, pos: d.drafts[i].formation.slots.find((s) => s.id === suggestSlot(d.drafts[i], selected))?.position })}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function H2HSummary() {
  const { h2h, abandonH2H, go } = useStorePick('h2h', 'abandonH2H', 'go')
  if (!h2h?.result) return null
  return <H2HResultView managers={h2h.managers} result={h2h.result} drafts={h2h.draft.drafts} leagueId={h2h.leagueId} leagueSeason={h2h.leagueSeason} seed={h2h.seed} onRematch={() => { setRematch(h2h); abandonH2H(); go('h2h') }} onHome={() => abandonH2H()} />
}

export interface H2HResultViewProps {
  managers: [H2HManager, H2HManager]
  result: H2HResult
  drafts: [DraftState, DraftState]
  leagueId: string
  leagueSeason: number
  seed: string
  onRematch: () => void
  onHome: () => void
  /** The banner's mode line: "Head-to-head" (hot-seat) or "Online head-to-head"; the share text keeps "Head-to-head" in English when unset. */
  label?: string
  rematchLabel?: string
  /** An online room: this device's seat (its card first, a "You" chip, the banner from its side). */
  you?: 0 | 1
  /** The mode in the share text, which stays English: "Head-to-head" when unset. */
  shareLabel?: string
  testId?: string
}

/** A head-to-head's result, hot-seat or online: the banner with both sides, the derbies, the XIs and the table. */
export function H2HResultView({ managers: m, result: r, drafts, leagueId, leagueSeason, seed, onRematch, onHome, label: labelProp, rematchLabel = t('rematch'), shareLabel = 'Head-to-head', you, testId }: H2HResultViewProps) {
  const { universe: u, showToast } = useStorePick('universe', 'showToast')
  const [copied, flashCopied] = useFlash()
  if (!u) return null
  const label = labelProp ?? t('title')
  // The share text stays English (it travels to whoever reads it)
  // A classic pick or a classic league season: the numbers are TouchLine's estimate, and the share says so (never in an online room)
  const leagueName = u.leagues.find((l) => l.id === leagueId)?.name ?? ''
  const estimated = estimatedNote(u, drafts.flatMap((d) => Object.values(d.lineup)), leagueId, leagueSeason)
  const text = [
    `${APP_NAME} · ${shareLabel} · ${`${leagueName} ${seasonLabel(leagueSeason)}`.trim()}`,
    ...([0, 1] as const).map((i) => `${m[i].name}: ${tierName(r.tiers[i], r.positions[i])} · ${r.rows[i].won}-${r.rows[i].drawn}-${r.rows[i].lost} · ${r.rows[i].points} pts · ${ordinal(r.positions[i])}`),
    `Derbies: ${r.derbies.map((dby) => `${m[dby.homeIdx].shortName} ${dby.homeGoals}-${dby.awayGoals} ${m[dby.homeIdx === 0 ? 1 : 0].shortName}`).join(', ')}`,
    r.winner === null ? 'Dead heat.' : `${m[r.winner].name} wins.`,
    ...(estimated ? [estimated] : []),
    `Seed ${seed}`,
  ].join('\n')
  const sheet = hasShareSheet()
  const copy = async () => {
    // The share sheet on a phone (Messages, WhatsApp...), the clipboard elsewhere
    const out = sheet ? await shareOrCopy({ title: `${APP_NAME} ${label}`, text, url: location.origin + location.pathname }) : await copyText(text)
    if (out === 'failed') showToast(t('shareFailed'))
    else if (out !== 'dismissed') {
      flashCopied()
    }
  }
  const order: Array<0 | 1> = you === 1 ? [1, 0] : [0, 1]
  const card = async (i: 0 | 1) => {
    try {
      const url = await renderShareCard({
        title: m[i].name,
        subtitle: `${shareLabel} v ${m[i === 0 ? 1 : 0].name} · ${leagueName} ${seasonLabel(leagueSeason)}`,
        tier: r.tiers[i],
        row: r.rows[i],
        position: r.positions[i],
        formation: getFormation(m[i].formationId),
        lineup: drafts[i].lineup,
        getPlayer: (id) => u.index[id],
        footer: `${r.winner === null ? 'Dead heat' : r.winner === i ? 'Winner' : 'Runner-up'} · Seed ${seed}${estimated ? ' · estimated ratings' : ''}`,
        hideRatings: ratingHidden(drafts[i].rules, 'squad'),
      })
      downloadDataUrl(url, `touchline-h2h-${m[i].name.replace(/\s+/g, '-').toLowerCase()}.png`)
    } catch {
      showToast(t('cardFailed'))
    }
  }
  return (
    <div className="page summary" data-testid={testId}>
      <div className="tier-banner">
        <div className="banner-meta">
          <span className="bm-team">
            <Swords size={16} aria-hidden="true" /> {label}
          </span>
          <span className="bm-rest">
            <LeagueFlag leagueId={leagueId} label={u.leagues.find((l) => l.id === leagueId)?.name} /> {seasonLabel(leagueSeason)}
            {estimated && <> <EstimatedChip compact /></>}
          </span>
        </div>
        <div className={`tier ${r.winner === null ? '' : 'CHAMPIONS'}`} data-testid="h2h-verdict">{r.winner === null ? t('deadHeat') : you !== undefined && r.winner === you ? t('youWin') : t('wins', { name: m[r.winner].name })}</div>
        <div className="h2h-sides">
          {([0, 1] as const).map((i) => (
            <div key={i} className={`h2h-side ${r.winner === i ? 'won' : ''}`}>
              <div className="club-head">
                <TeamBadge code={m[i].shortName} size={36} />
                <div style={{ textAlign: 'left' }}>
                  <h3 style={{ margin: 0 }}>
                    {m[i].name}
                    {you === i && <span className="chip info h2h-you">{t('you')}</span>}
                  </h3>
                </div>
                {r.winner === i && <Trophy size={20} className="h2h-cup" role="img" aria-label={t('winner')} />}
              </div>
              <span className={`chip ${r.tiers[i] === 'CHAMPIONS' || r.tiers[i] === 'INVINCIBLE' || r.tiers[i] === 'PERFECT' ? 'gold' : ''}`}>{tierName(r.tiers[i], r.positions[i])}</span>
              <div className="record">
                <span className="w">{t('wonN', { n: r.rows[i].won })}</span>
                <span className="d">{t('drawnN', { n: r.rows[i].drawn })}</span>
                <span className="l">{t('lostN', { n: r.rows[i].lost })}</span>
              </div>
              <div className="banner-stats">
                <Stat label={t('points')} value={r.rows[i].points} />
                <Stat label={t('finished')} value={ordinal(r.positions[i])} />
                <Stat label={t('rating')} value={fixed(r.strengths[i], 1)} />
              </div>
            </div>
          ))}
        </div>
        <div className="banner-actions">
          <button className="btn primary" onClick={copy}>
            {copied ? <Check size={16} aria-hidden="true" /> : sheet ? <Share2 size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />} {t(copied ? (sheet ? 'shared' : 'copied') : sheet ? 'shareResult' : 'copyResult')}
          </button>
          {order.map((i) => (
            <button key={i} className="btn" onClick={() => void card(i)} data-testid={`h2h-card-${i}`}>
              <ImageDown size={16} aria-hidden="true" /> {you === i ? t('yourCard') : t('card', { code: m[i].shortName })}
            </button>
          ))}
          <button className="btn" onClick={onRematch} data-testid="h2h-rematch">
            <RotateCcw size={16} aria-hidden="true" /> {rematchLabel}
          </button>
          <button className="btn ghost" onClick={onHome}>
            {t('home')}
          </button>
        </div>
      </div>
      <div className="screen-body fill">
      <div className="grid two">
        <div className="col">
          <div className="panel">
            <h3>{t('derbies')}</h3>
            <div className="fixture-list h2h-derbies">
              {r.derbies.map((dby, i) => (
                <div key={i} className="fixture me">
                  <span className="mw">{t('mw', { n: dby.matchweek })}</span>
                  <span className="h">{m[dby.homeIdx].name}</span>
                  <span className="sc">
                    {dby.homeGoals} - {dby.awayGoals}
                  </span>
                  <span>{m[dby.homeIdx === 0 ? 1 : 0].name}</span>
                </div>
              ))}
            </div>
          </div>
          {([0, 1] as const).map((i) => (
            <div key={i} className="panel">
              <div className="panel-head">
                <h3>{t('xi', { name: m[i].name })}</h3>
                {r.topScorers[i] && u.index[r.topScorers[i]!.playerSeasonId] && (
                  <span className="chip good icon-chip" title={t('topScorer')}>
                    <Footprints size={12} aria-hidden="true" /> {u.index[r.topScorers[i]!.playerSeasonId].name} · {r.topScorers[i]!.goals}
                  </span>
                )}
              </div>
              <Pitch formation={drafts[i].formation} lineup={drafts[i].lineup} getPlayer={(id) => u.index[id]} />
            </div>
          ))}
          {r.results?.map((games, i) => (
            <GameByGame key={i} results={games} title={t('gameByGame', { name: m[i].name })} compact opponent={(id) => (id === H2H_IDS[0] ? { clubId: m[0].hostClubId, name: m[0].name } : id === H2H_IDS[1] ? { clubId: m[1].hostClubId, name: m[1].name } : { clubId: id, name: clubName(u, id) })} />
          ))}
        </div>
        <div className="col">
          <div className="panel">
            <h3>{t('finalTable')}</h3>
            <div className="tbl-wrap">
              <table className="tbl h2h-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{t('colClub')}</th>
                    <th className="num">{t('colW')}</th>
                    <th className="num">{t('colD')}</th>
                    <th className="num">{t('colL')}</th>
                    <th className="num">{t('colGD')}</th>
                    <th className="num">{t('colPts')}</th>
                  </tr>
                </thead>
                <tbody>
                  {r.table.map((row, i) => {
                    const idx: 0 | 1 | null = row.teamId === H2H_IDS[0] ? 0 : row.teamId === H2H_IDS[1] ? 1 : null
                    return (
                      <tr key={row.teamId} className={idx !== null ? 'me' : ''}>
                        <td>{i + 1}</td>
                        {/* The club cell takes the width left and ends a long name in an ellipsis, so GD and Pts stay in view */}
                        <td className="h2h-club" title={idx !== null ? m[idx].name : clubName(u, row.teamId)}>
                          <span className="row" style={{ gap: 8 }}>
                            {idx !== null ? <TeamBadge code={m[idx].shortName} size={22} /> : <ClubBadge clubId={row.teamId} size={22} />}
                            <span className="h2h-club-name">{idx !== null ? m[idx].name : clubName(u, row.teamId)}</span>
                          </span>
                        </td>
                        <td className="num">{row.won}</td>
                        <td className="num">{row.drawn}</td>
                        <td className="num">{row.lost}</td>
                        <td className="num">{row.goalsFor - row.goalsAgainst > 0 ? '+' : ''}{row.goalsFor - row.goalsAgainst}</td>
                        <td className="num" style={{ fontWeight: 700 }}>
                          {row.points}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <details className="panel fold">
            <summary className="panel-head">
              <h3>{t('shareText')}</h3>
              <ChevronDown size={16} className="fold-chevron" aria-hidden="true" />
            </summary>
            <pre className="mono small share-text">{text}</pre>
          </details>
        </div>
      </div>
      </div>
    </div>
  )
}

/** The four rules of a head-to-head, as pictures with a line each. */
const h2hSteps = (): Array<{ Icon: LucideIcon; title: string; line: string }> => [
  { Icon: Dices, title: t('step1Title'), line: t('step1Line') },
  { Icon: Repeat, title: t('step2Title'), line: t('step2Line') },
  { Icon: Lock, title: t('step3Title'), line: t('step3Line') },
  { Icon: Swords, title: t('step4Title'), line: t('step4Line') },
]
