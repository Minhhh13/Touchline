import { useEffect, useMemo, useState } from 'react'
import { Check, CircleCheck, Copy, Dices, DoorOpen, Hourglass, Link2, Lock, Repeat, Swords, Trophy, Wifi, WifiOff, type LucideIcon } from 'lucide-react'
import { useStore } from '@game/store'
import { ENGINE_VERSION } from '@engine/version'
import { getFormation } from '@engine/formations'
import { fillingXI, isComplete, picksMade, suggestSlot } from '@engine/draft'
import { h2hComplete, h2hEligibleSlots, h2hUsable, type H2HDraft } from '@engine/h2h'
import type { H2HManager } from '@game/logic/h2h'
import { draftFromEvents, roomClubs, roomEndLine, roomLeagues, roomLogLine, roomSeasons, roomWheel, ROOM_IDLE_MINUTES, ROOM_KEEP_HOURS, ROOM_WAIT_MINUTES, type RoomSettings, type RoomView } from '@game/logic/h2hRoom'
import { tierTable } from '@game/logic/rarity'
import { h2hReelPool, reelLeagues } from '@game/logic/reel'
import { ratingHidden } from '@game/logic/ratingVisibility'
import { useOnline } from '../../online/state'
import { closeRoom, createRoom, joinRoom, leaveRoom, openRoom, pickInRoom, resumeRoom, roomSeats } from '../../online/api'
import { formatCode, normaliseCode, roomLink } from '../../online/core/codes'
import { CaseReel, TierChip } from '../components/CaseReel'
import { Pitch } from '../components/Pitch'
import { PlayerRow } from '../components/PlayerRow'
import { ClubBadge, Info, Segmented } from '../components/bits'
import { FormationPicker } from '../components/FormationPicker'
import { LeagueFlag } from '../components/Flag'
import { TeamNameField } from '../components/SetupBits'
import { clubName, formationName, ordinal, seasonLabel } from '../format'
import { H2HResultView } from '../screens/H2H'
import { roomVersionNote } from '../../online/engineRoute'
import { translator } from '../i18n'
import { h2h as h2hText } from '../i18n/en/h2h'

const t = translator(h2hText)

/** The four rules of an online room, as pictures with a line each (the hot-seat's, for two devices). */
const roomSteps = (): Array<{ Icon: LucideIcon; title: string; line: string }> => [
  { Icon: Link2, title: t('roomStep1Title'), line: t('roomStep1Line') },
  { Icon: Dices, title: t('roomStep2Title'), line: t('roomStep2Line') },
  { Icon: Repeat, title: t('roomStep3Title'), line: t('roomStep3Line') },
  { Icon: Swords, title: t('roomStep4Title'), line: t('roomStep4Line') },
]

/** Whole minutes to a deadline, never more than the rule's own limit (this device's clock may run behind the server's). */
const minutesLeft = (iso: string | null, now: number, cap: number) => (iso ? Math.min(cap, Math.max(0, Math.ceil((Date.parse(iso) - now) / 60000))) : 0)

/** A clock that ticks every 15 seconds, for the "closes in" lines. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000)
    return () => clearInterval(t)
  }, [])
  return now
}

/** Head-to-head setup's online half: make a room, or open one by its code. */
export function RoomSetup() {
  const { universe: u, ensureLeagues, loadingLeagues, loadedLeagues, go, showToast } = useStore()
  const [leagueId, setLeagueId] = useState('england')
  const [scope, setScope] = useState<'league' | 'all'>('league')
  const [season, setSeason] = useState(0)
  const [difficulty, setDifficulty] = useState<'calibrated' | 'realistic'>('calibrated')
  const [hardMode, setHardMode] = useState(false)
  const [name, setName] = useState('')
  const [formationId, setFormationId] = useState('4-3-3')
  const [host, setHost] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [seats, setSeats] = useState<string[]>([])
  useEffect(() => {
    let live = true
    void roomSeats().then((s) => live && setSeats(s))
    return () => {
      live = false
    }
  }, [])
  if (!u) return null
  const seasons = roomSeasons(u, leagueId)
  const leagueSeason = seasons.includes(season) ? season : seasons[seasons.length - 1]
  const settings: RoomSettings = { leagueId, wheelLeagues: roomWheel(u, leagueId, scope), leagueSeason, difficulty, hardMode }
  const clubs = roomClubs(u, settings)
  const hostClubId = clubs.includes(host) ? host : clubs[Math.floor(clubs.length / 3)]
  const ready = roomLeagues(u, settings).every((l) => loadedLeagues.includes(l))
  const typed = normaliseCode(code)
  const open = async (c: string) => {
    go('room')
    await openRoom(c)
  }
  const make = async () => {
    setBusy(true)
    setError(null)
    const r = await createRoom(settings, { name: name.trim() || t('managerN', { n: 1 }), formationId, hostClubId }, ENGINE_VERSION, u.generatedAt ?? '')
    setBusy(false)
    if (!r.ok) {
      setError(r.message)
      return
    }
    showToast(t('roomOpenToast', { code: formatCode(r.code) }))
    go('room')
  }
  return (
    <div className="screen-body scroll-whole fill" data-testid="room-setup">
      <ol className="steps" aria-label={t('roomHowItWorks')}>
        {roomSteps().map(({ Icon, title, line }) => (
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
        <div className="panel col" data-testid="room-create-panel">
          <h3 style={{ margin: 0 }}>{t('makeRoom')}</h3>
          <div className="grid two">
            <div className="col">
              <TeamNameField label={t('yourName')} value={name} onChange={setName} fallback={t('managerN', { n: 1 })} maxLength={24} testId="room-name" />
              <div className="field formation-field">
                {t('formation')}
                <FormationPicker value={formationId} onChange={setFormationId} label={t('yourFormation')} testId="room-formation" />
                <span className="help">{getFormation(formationId).blurb}</span>
              </div>
              <label className="field">
                {t('hostClub')}
                <select className="input" value={hostClubId} onChange={(e) => setHost(e.target.value)} data-testid="room-club">
                  {clubs.map((c) => (
                    <option key={c} value={c}>
                      {clubName(u, c)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="col">
              <div className="field">
                {t('league')}
                <Segmented value={leagueId} onChange={(id) => { setLeagueId(id); setHost(''); void ensureLeagues(roomWheel(u, id, scope)) }} options={u.available.map((l) => ({ value: l.id, label: <><LeagueFlag leagueId={l.id} /> {l.name}</> }))} />
              </div>
              <div className="field">
                {t('draftFrom')}
                <Segmented value={scope} onChange={(sc) => { setScope(sc); void ensureLeagues(roomWheel(u, leagueId, sc)) }} options={[{ value: 'league', label: <><LeagueFlag leagueId={leagueId} /> {t('thisLeague')}</> }, { value: 'all', label: <><LeagueFlag leagueId="europe" /> {t('allLeagues', { n: u.available.length })}</> }]} />
              </div>
              <label className="field">
                {t('season')}
                <select className="input" value={leagueSeason} onChange={(e) => setSeason(Number(e.target.value))}>
                  {seasons.map((s) => (
                    <option key={s} value={s}>
                      {seasonLabel(s)}
                    </option>
                  ))}
                </select>
              </label>
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
            </div>
          </div>
          {error && (
            <div className="notice danger" role="alert" data-testid="room-error">
              {error}
            </div>
          )}
          <button className="btn primary big block" data-testid="room-create" disabled={!ready || loadingLeagues || busy} onClick={() => void make()}>
            {t(!ready ? 'loadingLeagues' : busy ? 'makingRoom' : 'makeTheRoom')}
          </button>
        </div>
        <div className="panel col" data-testid="room-join-panel">
          <h3 style={{ margin: 0 }}>{t('joinWithCode')}</h3>
          <p className="muted small" style={{ margin: 0 }}>
            {t('joinHelp')}
          </p>
          <label className="field">
            {t('roomCode')}
            <input className="input mono room-code-input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="K7Q2-MX9A" maxLength={12} autoCapitalize="characters" spellCheck={false} data-testid="room-code-input" onKeyDown={(e) => e.key === 'Enter' && typed && void open(typed)} />
          </label>
          <button className="btn primary block" disabled={!typed} onClick={() => typed && void open(typed)} data-testid="room-open">
            <DoorOpen size={16} aria-hidden="true" /> {t('openRoom')}
          </button>
          {seats.length > 0 && (
            <div className="col" style={{ gap: 'var(--space-2)' }}>
              <div className="eyebrow">{t('yourRooms')}</div>
              <div className="row wrap">
                {seats.map((c) => (
                  <button key={c} className="btn sm mono" onClick={() => void open(c)} data-testid="room-seat">
                    {formatCode(c)}
                  </button>
                ))}
              </div>
            </div>
          )}
          <ul className="room-rules small muted">
            <li>{t('ruleWait', { n: ROOM_WAIT_MINUTES })}</li>
            <li>{t('ruleIdle', { n: ROOM_IDLE_MINUTES })}</li>
            <li>{t('ruleKeep', { n: ROOM_KEEP_HOURS })}</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

/** The screen of an online room (screen `room`): the join step, the waiting room, the draft and the result. */
export function RoomScreen() {
  const ui = useOnline((s) => s.room)
  const { universe: u, go, ensureLeagues, loadedLeagues } = useStore()
  const view = ui?.view ?? null
  const code = ui?.code ?? null
  // The room's code stays in the address, so a reload or a shared tab opens the same room; it goes when the screen does
  useEffect(() => {
    if (!code) return
    if (location.hash !== `#h=${code}`) history.replaceState(null, '', `${location.pathname}${location.search}#h=${code}`)
  }, [code])
  useEffect(
    () => () => {
      if (/^#h=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search)
      closeRoom()
    },
    [],
  )
  const needs = view && u ? roomLeagues(u, view.settings) : []
  const missingLeagues = needs.filter((l) => !loadedLeagues.includes(l))
  useEffect(() => {
    if (missingLeagues.length) void ensureLeagues(needs)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingLeagues.join(',')])
  if (!u) return null
  const versionNote = view ? roomVersionNote(view, { engine: ENGINE_VERSION, data: u.generatedAt ?? '' }) : null
  const head = (
    <div className="screen-head">
      <div className="screen-title">
        <h1>{t('onlineTitle')}</h1>
        <div className="screen-meta">
          {code && (
            <span className="chip mono" data-testid="room-code-chip">
              {formatCode(code)}
            </span>
          )}
          {view && (
            <span>
              <LeagueFlag leagueId={view.settings.leagueId} /> {u.leagues.find((l) => l.id === view.settings.leagueId)?.name ?? u.available.find((l) => l.id === view.settings.leagueId)?.name ?? t('leagueFallback')} {seasonLabel(view.settings.leagueSeason)}
            </span>
          )}
          {view?.settings.hardMode && <span className="chip">{t('hardMode')}</span>}
        </div>
      </div>
      <div className="toolbar">
        <button className="btn ghost sm" onClick={() => go('h2h')}>
          {t('backToH2H')}
        </button>
      </div>
    </div>
  )
  let body: React.ReactNode
  if (!ui) body = <RoomMessage icon={<Wifi size={26} />} title={t('noRoom')} line={t('noRoomLine')} />
  else if (ui.missing) body = <RoomMessage icon={<DoorOpen size={26} />} title={t('noCode')} line={t('noCodeLine', { n: ROOM_KEEP_HOURS })} testId="room-missing" />
  else if (!view) body = ui.errorCode === 'network' ? <RoomMessage icon={<WifiOff size={26} />} title={t('noConnection')} line={t('noConnectionLine')} testId="room-loading" /> : <RoomMessage icon={<Hourglass size={26} />} title={t('openingRoom')} line={ui.error ?? t('readingRoom')} testId="room-loading" />
  else if (versionNote) body = <RoomMessage icon={<Lock size={26} />} title={versionNote.title} line={versionNote.line} testId="room-version" action={versionNote.older ? <button className="btn primary" onClick={() => go('h2h')}>{t('makeNewRoom')}</button> : <button className="btn primary" onClick={() => location.reload()}>{t('reload')}</button>} />
  else if (missingLeagues.length) body = <RoomMessage icon={<Hourglass size={26} />} title={t('loadingLeagues')} line={t('leaguesNeeded')} />
  else if (view.status === 'waiting') body = ui.seat === null ? <RoomJoin view={view} /> : <RoomWaiting view={view} />
  else if (view.status === 'drafting') body = <RoomDraft view={view} seat={ui.seat} />
  else if (view.status === 'finished' && view.result && view.managers[1]) return <RoomResult view={view} />
  else body = <RoomMessage icon={<DoorOpen size={26} />} title={t('roomEnded')} line={roomEndLine(view.status)} testId="room-ended" action={<button className="btn primary" onClick={() => go('h2h')}>{t('makeNewRoom')}</button>} />
  return (
    <div className="page" data-testid="room-screen" data-status={view?.status ?? 'none'}>
      {head}
      {ui?.error && view && (
        <div className="notice warn room-notice" role="alert" data-testid="room-error">
          {ui.error}
        </div>
      )}
      {body}
    </div>
  )
}

function RoomMessage({ icon, title, line, action, testId }: { icon: React.ReactNode; title: string; line: string; action?: React.ReactNode; testId?: string }) {
  return (
    <div className="screen-body fill">
      <div className="panel col" data-testid={testId}>
        <div className="empty-state">
          <span className="empty-icon" aria-hidden="true">
            {icon}
          </span>
          <h3>{title}</h3>
          <p className="muted small">{line}</p>
          {action}
        </div>
      </div>
    </div>
  )
}

/** A line naming the room's league season and wheel. */
function settingsLine(u: NonNullable<ReturnType<typeof useStore.getState>['universe']>, s: RoomSettings): string {
  const league = u.available.find((l) => l.id === s.leagueId)?.name ?? s.leagueId
  return t('settingsLine', { league, season: seasonLabel(s.leagueSeason), wheel: s.wheelLeagues.length > 1 ? 'all' : 'one', n: s.wheelLeagues.length, difficulty: s.difficulty, hard: s.hardMode ? 'yes' : 'no' })
}

/** Seat 0, waiting: the code, the link to share and the deadline. */
function RoomWaiting({ view }: { view: RoomView }) {
  const { universe: u, showToast } = useStore()
  const now = useNow()
  const [copied, setCopied] = useState(false)
  if (!u) return null
  const link = roomLink(view.code, location.origin, location.pathname)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      showToast(t('copyLinkFailed'))
    }
  }
  return (
    <div className="screen-body fill">
      <div className="grid two">
        <div className="panel col room-wait" data-testid="room-waiting">
          <div className="eyebrow">{t('roomCode')}</div>
          <div className="room-code mono" data-testid="room-code">
            {formatCode(view.code)}
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            {t('shareHelp')}
          </p>
          <div className="room-share">
            <input className="input mono" readOnly value={link} aria-label={t('roomLink')} data-testid="room-link" onFocus={(e) => e.currentTarget.select()} />
            <button className="btn primary" onClick={() => void copy()} data-testid="room-copy">
              {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />} {t(copied ? 'copied' : 'copyLink')}
            </button>
          </div>
          <div className="notice icon-notice">
            <Hourglass size={16} aria-hidden="true" /> {t('waitingClosesIn', { n: minutesLeft(view.expiresAt, now, ROOM_WAIT_MINUTES) })}
          </div>
          <button className="btn ghost danger" onClick={() => confirm(t('closeConfirm')) && void leaveRoom()} data-testid="room-leave">
            {t('closeRoom')}
          </button>
        </div>
        <div className="panel col">
          <h3 style={{ margin: 0 }}>{t('theRoom')}</h3>
          <ManagerCard m={view.managers[0]} you />
          <div className="muted small">{settingsLine(u, view.settings)}</div>
        </div>
      </div>
    </div>
  )
}

function ManagerCard({ m, you, turn }: { m: H2HManager | null; you?: boolean; turn?: boolean }) {
  const { universe: u } = useStore()
  if (!u) return null
  if (!m)
    return (
      <div className="club-head room-manager empty">
        <span className="badge" style={{ width: 36, height: 36, background: 'var(--raised)', color: 'var(--text-2)' }}>?</span>
        <div className="muted">{t('waitingOther')}</div>
      </div>
    )
  return (
    <div className={`club-head room-manager ${turn ? 'turn' : ''}`}>
      <ClubBadge clubId={m.hostClubId} size={36} />
      <div>
        <b>{m.name}</b>
        {you && <span className="chip info" style={{ marginLeft: 8 }}>{t('you')}</span>}
        <div className="muted small">
          {t('inPlaceOf', { formation: formationName(m.formationId), club: clubName(u, m.hostClubId) })}
        </div>
      </div>
    </div>
  )
}

/** A device without a seat, on a waiting room: take the other seat. */
function RoomJoin({ view }: { view: RoomView }) {
  const { universe: u } = useStore()
  const signedIn = useOnline((s) => !!s.session)
  const busy = useOnline((s) => s.room?.busy ?? false)
  const now = useNow()
  const host = view.managers[0]
  const [name, setName] = useState('')
  const [formationId, setFormationId] = useState('4-4-2')
  const [club, setClub] = useState('')
  if (!u) return null
  const clubs = roomClubs(u, view.settings).filter((c) => c !== host.hostClubId)
  const hostClubId = clubs.includes(club) ? club : clubs[Math.floor((clubs.length * 2) / 3)]
  return (
    <div className="screen-body fill">
      <div className="grid two">
        <div className="panel col" data-testid="room-join">
          <h3 style={{ margin: 0 }}>{t('joinRoom', { name: host.name })}</h3>
          <div className="muted small">{settingsLine(u, view.settings)}</div>
          <TeamNameField label={t('yourName')} value={name} onChange={setName} fallback={t('managerN', { n: 2 })} maxLength={24} testId="room-join-name" taken={[host.name]} />
          <div className="field formation-field">
            {t('formation')}
            <FormationPicker value={formationId} onChange={setFormationId} label={t('yourFormation')} testId="room-join-formation" />
          </div>
          <label className="field">
            {t('hostClub')}
            <select className="input" value={hostClubId} onChange={(e) => setClub(e.target.value)} data-testid="room-join-club">
              {clubs.map((c) => (
                <option key={c} value={c}>
                  {clubName(u, c)}
                </option>
              ))}
            </select>
          </label>
          <button className="btn primary big block" disabled={busy} onClick={() => void joinRoom({ name: name.trim() || t('managerN', { n: 2 }), formationId, hostClubId }, ENGINE_VERSION, u.generatedAt ?? '')} data-testid="room-join-btn">
            {t(busy ? 'joining' : 'joinStart')}
          </button>
          {signedIn && (
            <button className="btn ghost sm" onClick={() => void resumeRoom()} data-testid="room-resume">
              {t('myRoom')}
            </button>
          )}
        </div>
        <div className="panel col">
          <h3 style={{ margin: 0 }}>{t('theRoom')}</h3>
          <ManagerCard m={host} />
          <ManagerCard m={null} />
          <div className="notice icon-notice">
            <Hourglass size={16} aria-hidden="true" /> {t('closesIfNobody', { n: minutesLeft(view.expiresAt, now, ROOM_WAIT_MINUTES) })}
          </div>
        </div>
      </div>
    </div>
  )
}

/** The draft: the reel and whose turn, the squad on the wheel, both pitches. Picks go to the server. */
function RoomDraft({ view, seat }: { view: RoomView; seat: 0 | 1 | null }) {
  const { universe: u, showToast } = useStore()
  const busy = useOnline((s) => s.room?.busy ?? false)
  const signedIn = useOnline((s) => !!s.session)
  const now = useNow()
  const managers = view.managers as [H2HManager, H2HManager]
  const d = useMemo<H2HDraft | null>(() => {
    if (!u) return null
    try {
      return draftFromEvents(u, view.settings, managers, view.events)
    } catch {
      return null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [u, view.code, view.version])
  const [settled, setSettled] = useState<string | null>(null)
  const [picked, setPicked] = useState<{ id: string; spin: number } | null>(null)
  const pool = useMemo(() => (u && d ? h2hReelPool(u, d) : []), [u, d])
  const rules = d?.drafts[0].rules
  const leagues = useMemo(() => (u && rules ? reelLeagues(u, rules) : []), [u, rules])
  if (!u || !d) return <RoomMessage icon={<Lock size={26} />} title={t('cannotShow')} line={t('cannotShowLine')} />
  const currentKey = d.current ? `${d.spins}:${d.current.clubId}@${d.current.season}` : null
  const revealed = !!currentKey && settled === currentKey
  const spinning = !!currentKey && !revealed
  const current = d.current ? u.clubSeasonByKey[`${d.current.clubId}@${d.current.season}`] : null
  const tier = current ? tierTable(u, leagues)[`${current.clubId}@${current.season}`] : undefined
  const picking = d.picking
  const mine = seat !== null && picking === seat
  const usable = mine ? h2hUsable(u, d) : []
  const usableIds = new Set(usable.map((p) => p.id))
  const selectedId = picked && picked.spin === d.spins ? picked.id : null
  const selected = selectedId ? u.index[selectedId] : undefined
  const eligible = selected && mine ? h2hEligibleSlots(d, selected).map((s) => s.id) : []
  const hide = ratingHidden(d.drafts[0].rules, 'offer')
  const send = (pid: string, slot: string) => {
    setPicked(null)
    void pickInRoom(pid, slot)
  }
  const onPick = (pid: string) => {
    if (!mine || busy || !usableIds.has(pid)) return
    const p = u.index[pid]
    const slots = h2hEligibleSlots(d, p)
    if (fillingXI(d.drafts[seat])) {
      if (slots.length === 1) send(pid, slots[0].id)
      else setPicked({ id: pid, spin: d.spins })
    } else send(pid, 'bench')
  }
  const onSlot = (idx: 0 | 1, slotId: string) => {
    if (!selected || !mine || idx !== seat) return
    if (!eligible.includes(slotId)) {
      showToast(t('cannotPlayThere', { name: selected.name }))
      return
    }
    send(selected.id, slotId)
  }
  const other = seat === null ? null : managers[seat === 0 ? 1 : 0]
  const turnLine = picking === null ? t('spinning') : mine ? t('yourPick') : seat === null ? t('toPick', { name: managers[picking].name }) : t('waitingFor', { name: other?.name })
  return (
    <div className="grid draft fill" data-testid="room-draft" data-turn={mine ? 'mine' : 'theirs'}>
      <div className="col">
        <div className="panel col">
          <CaseReel u={u} leagues={leagues} pool={pool} target={d.current} spinKey={d.spins} onSettled={() => setSettled(currentKey)} />
          <div className={`room-turn ${mine ? 'mine' : ''}`} data-testid="room-turn" aria-live="polite">
            {mine ? <CircleCheck size={18} aria-hidden="true" /> : <Hourglass size={18} aria-hidden="true" />} {turnLine}
          </div>
          <div className="muted small">
            {t('timesOut', { n: ROOM_IDLE_MINUTES, left: minutesLeft(view.idleAt, now, ROOM_IDLE_MINUTES) })}
          </div>
          {seat === null && (
            <div className="notice">
              {t('watching')}
              {signedIn && (
                <button className="btn sm" style={{ marginLeft: 8 }} onClick={() => void resumeRoom()}>
                  {t('takeSeatBack')}
                </button>
              )}
            </div>
          )}
          {seat !== null && (
            <button className="btn ghost sm danger" onClick={() => confirm(t('leaveConfirm')) && void leaveRoom()} data-testid="room-leave">
              {t('leaveRoom')}
            </button>
          )}
        </div>
        {d.log.length > 0 && (
          <div className="panel tight">
            <div className="eyebrow">{t('draftLog')}</div>
            <ol className="h2h-log">
              {[...d.log].reverse().slice(0, 30).map((l, i) => (
                <li key={i}>{roomLogLine(l, view.managers)}</li>
              ))}
            </ol>
          </div>
        )}
      </div>
      <div className="panel col">
        {!current && (
          <div className="empty-state">
            <span className="empty-icon" aria-hidden="true">
              {h2hComplete(d) ? <CircleCheck size={26} /> : <Dices size={26} />}
            </span>
            <h3>{t(h2hComplete(d) ? 'bothComplete' : 'nextSpinOnWay')}</h3>
          </div>
        )}
        {current && spinning && (
          <div className="club-head">
            <span className="badge" style={{ width: 44, height: 44, background: 'var(--raised)', color: 'var(--text)', fontSize: 18 }}>?</span>
            <div>
              <h2>{t('opening')}</h2>
              <div className="muted small">{t('landing')}</div>
            </div>
          </div>
        )}
        {current && revealed && (
          <>
            <div className="club-head">
              <ClubBadge clubId={current.clubId} size={44} />
              <div>
                <h2>{clubName(u, current.clubId)}</h2>
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
                </div>
              </div>
            </div>
            {mine && <div className="notice">{t('yourPickSlot', { slot: selected ? 'yes' : 'no', player: selected?.name })}</div>}
            <div className="plist lined draft-list" data-testid="room-squad">
              {[...current.squad]
                .sort((a, b) => b.overall - a.overall)
                .map((p) => {
                  const takenBy = d.drafts.findIndex((x) => Object.values(x.lineup).includes(p.id) || x.bench.includes(p.id))
                  return (
                    <PlayerRow key={p.id} p={p} hideRatings={hide} hideChampion={current.champions} dim={!usableIds.has(p.id)} selected={selectedId === p.id} onClick={() => onPick(p.id)} extra={takenBy >= 0 ? <span className="chip info">{managers[takenBy].shortName}</span> : null} right={usableIds.has(p.id) ? <span className={`btn sm ${selectedId === p.id ? 'primary' : ''}`} data-testid="room-draft-btn">{t('draft')}</span> : null} />
                  )
                })}
            </div>
          </>
        )}
      </div>
      <div className="col draft-pitch">
        {([0, 1] as const).map((i) => (
          <div key={i} className={`panel ${picking === i ? 'emphasis' : ''}`}>
            <div className="panel-head">
              <span className="club-head">
                <ClubBadge clubId={managers[i].hostClubId} size={24} />
                <h3>
                  {managers[i].name}
                  {seat === i ? t('youSuffix') : ''} · {formationName(managers[i].formationId)}
                </h3>
              </span>
              <span className={`chip icon-chip ${isComplete(d.drafts[i]) ? 'good' : ''}`}>
                {isComplete(d.drafts[i]) && <CircleCheck size={12} aria-hidden="true" />}
                {picksMade(d.drafts[i])}/{d.drafts[i].rules.squadSize}
              </span>
            </div>
            <Pitch formation={d.drafts[i].formation} lineup={d.drafts[i].lineup} getPlayer={(id) => u.index[id]} onSlotClick={(s) => onSlot(i, s)} eligibleSlots={mine && seat === i ? eligible : []} hideRatings={ratingHidden(d.drafts[i].rules, 'squad')} />
            {selected && mine && seat === i && suggestSlot(d.drafts[i], selected) && suggestSlot(d.drafts[i], selected) !== 'bench' && (
              <button className="btn block" style={{ marginTop: 8 }} onClick={() => onSlot(i, suggestSlot(d.drafts[i], selected) as string)}>
                {t('putAt', { name: selected.name, pos: d.drafts[i].formation.slots.find((s) => s.id === suggestSlot(d.drafts[i], selected))?.position })}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/** The room's season, as the server played it (the hot-seat's result screen). */
function RoomResult({ view }: { view: RoomView }) {
  const { universe: u, go } = useStore()
  const managers = view.managers as [H2HManager, H2HManager]
  const d = useMemo(() => (u ? draftFromEvents(u, view.settings, managers, view.events) : null), [u, view.code, view.version]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!u || !d || !view.result) return null
  return <H2HResultView managers={managers} result={view.result} drafts={d.drafts} leagueId={view.settings.leagueId} leagueSeason={view.settings.leagueSeason} seed={view.seed ?? view.code} label={t('onlineTitle')} shareLabel="Online head-to-head" rematchLabel={t('newRoom')} onRematch={() => go('h2h')} onHome={() => go('home')} testId="room-result" />
}
