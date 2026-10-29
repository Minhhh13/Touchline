import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Check, Copy, Dices, DoorOpen, Hourglass, Link2, Lock, RefreshCw, Repeat, RotateCcw, Share2, Swords, Wifi, WifiOff, type LucideIcon } from 'lucide-react'
import { useStore } from '@game/store'
import { useStorePick } from '../useStorePick'
import { useFlash } from '../useFlash'
import { ENGINE_VERSION } from '@engine/version'
import { fillingXI } from '@engine/draft'
import { h2hComplete, h2hEligibleSlots, h2hUsable, type H2HDraft } from '@engine/h2h'
import type { H2HManager } from '@game/logic/h2h'
import type { LoadedUniverse } from '@engine/universe'
import { draftFromEvents, roomClubs, roomEndLine, roomLeagues, roomLogLine, roomSeasons, roomWheel, ROOM_IDLE_MINUTES, ROOM_KEEP_HOURS, ROOM_WAIT_MINUTES, type RoomSettings, type RoomView } from '@game/logic/h2hRoom'
import { clockText, pollDelay, ROOM_CODE_INPUT_MAX, roomCodeFrom, roomInviteText, turnClock, waitClock, type RematchNote, type RoomUi } from '../../online/rooms'
import { tierTable } from '@game/logic/rarity'
import { h2hReelPool, reelLeagues } from '@game/logic/reel'
import { ratingHidden } from '@game/logic/ratingVisibility'
import { useOnline } from '../../online/state'
import { useTurnSound } from '../sound/useTurnSound'
import { closeRoom, createRoom, joinRoom, leaveRoom, openRoom, pickInRoom, refreshRoom, rematchRoom, resumeRoom, roomSeats } from '../../online/api'
import { formatCode, roomLink } from '../../online/core/codes'
import { CaseReel } from '../components/CaseReel'
import { Info, Segmented } from '../components/bits'
import { LeagueFlag } from '../components/Flag'
import { BoardMessage, DraftBoard, H2HHead, H2HSteps, ManagerCard, ManagerFields, OfferPanel, OfferRows, SquadPitches, TurnBanner, TurnPill } from '../components/H2HBoard'
import { seasonLabel } from '../format'
import { H2HResultView } from '../screens/H2H'
import { roomVersionNote } from '../../online/engineRoute'
import { askConfirm } from '../confirm'
import { copyText, hasShareSheet, shareOrCopy } from '../shareSheet'
import { translator } from '../i18n'
import { h2h as h2hText } from '../i18n/en/h2h'
import { rich } from '../i18n/rich'

const t = translator(h2hText)

/** A clock figure inside a sentence (`<m>0:42</m>`). */
const MONO = { m: (c: ReactNode) => <span className="mono">{c}</span> }

/** The page's own address, for the room's link (none when rendered off a page, as the tests do). */
const here = () => (typeof location === 'undefined' ? { origin: '', pathname: '/' } : location)

/** The four rules of an online room, as pictures with a line each (the hot-seat's, for two devices). */
const roomSteps = (): Array<{ Icon: LucideIcon; title: string; line: string }> => [
  { Icon: Link2, title: t('roomStep1Title'), line: t('roomStep1Line') },
  { Icon: Dices, title: t('roomStep2Title'), line: t('roomStep2Line') },
  { Icon: Repeat, title: t('roomStep3Title'), line: t('roomStep3Line') },
  { Icon: Swords, title: t('roomStep4Title'), line: t('roomStep4Line') },
]

/** Whole minutes to a deadline, never more than the rule's own limit (this device's clock may run behind the server's). */
const minutesLeft = (iso: string | null, now: number, cap: number) => (iso ? Math.min(cap, Math.max(0, Math.ceil((Date.parse(iso) - now) / 60000))) : 0)

/** A clock that ticks every `ms` (15 seconds for the "closes in" lines, a second for a turn's timer). */
function useNow(ms = 15000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

/** A new room with a finished or ended room's settings and this seat's manager (name, shape, club); a second press opens the one already made. */
let rematching = false
async function rematch(u: LoadedUniverse, view: RoomView, seat: 0 | 1, showToast: (t: string) => void): Promise<void> {
  if (rematching || !view.managers[seat]) return
  rematching = true
  try {
    const r = await rematchRoom(view, seat, ENGINE_VERSION, u.generatedAt ?? '')
    if (!r.ok) {
      showToast(r.message)
      return
    }
    const other = view.managers[seat === 0 ? 1 : 0]
    const code = formatCode(r.code)
    showToast(other ? t(r.reused ? 'rematchBack' : 'rematchOpen', { code, name: other.name }) : t(r.reused ? 'rematchBackAnon' : 'rematchOpenAnon', { code }))
  } finally {
    rematching = false
  }
}

/** The other manager's way into a rematch they did not make: their code or link, opened here instead of a second room. */
function JoinRematch({ name, own }: { name: string | null; own?: string }) {
  const [code, setCode] = useState('')
  const typed = roomCodeFrom(code)
  // From your own rematch's waiting room (both pressed Rematch at once, QA r11): the friend's room opens and yours, still
  // empty, closes, so neither of you waits in a room nobody will join
  const open = () => {
    if (!typed || typed === own) return
    void (async () => {
      if (own) await leaveRoom()
      await openRoom(typed)
    })()
  }
  return (
    <div className="room-join-rematch col" data-testid="room-join-rematch">
      <div className="field">
        <span className="small muted" id="room-rematch-help">{t('joinRematchHelp', { name: name ?? 'none' })}</span>
        <span className="row">
          <input className="input mono grow" value={code} onChange={(e) => setCode(e.target.value)} placeholder="K7Q2-MX9A" maxLength={ROOM_CODE_INPUT_MAX} autoCapitalize="characters" autoComplete="off" spellCheck={false} aria-label={t('joinRematch')} aria-describedby="room-rematch-help" data-testid="room-rematch-code" onKeyDown={(e) => e.key === 'Enter' && open()} />
          <button className="btn" disabled={!typed} onClick={open} data-testid="room-rematch-join">
            <DoorOpen size={16} aria-hidden="true" /> {t('joinRematchOpen')}
          </button>
        </span>
      </div>
    </div>
  )
}

/** Head-to-head setup's online half: make a room, or open one by its code. */
export function RoomSetup() {
  const { universe: u, ensureLeagues, loadingLeagues, loadedLeagues, go, showToast } = useStorePick('universe', 'ensureLeagues', 'loadingLeagues', 'loadedLeagues', 'go', 'showToast')
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
  const typed = roomCodeFrom(code)
  // Something typed that is not a code yet: said once the box holds as many characters as a code
  const codeProblem = !typed && code.replace(/[^A-Za-z0-9]/g, '').length >= 8
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
    <div className="screen-body scroll-whole fill h2h-setup" data-testid="room-setup">
      <H2HSteps label={t('roomHowItWorks')} steps={roomSteps()} />
      <div className="grid two">
        <div className="panel col" data-testid="room-create-panel">
          <h3 style={{ margin: 0 }}>{t('makeRoom')}</h3>
          <div className="grid two">
            <div className="col">
              <ManagerFields u={u} name={name} onName={setName} nameLabel={t('yourName')} fallback={t('managerN', { n: 1 })} formationId={formationId} onFormation={setFormationId} formationLabel={t('yourFormation')} clubs={clubs} clubId={hostClubId} onClub={setHost} testIds={{ name: 'room-name', formation: 'room-formation', club: 'room-club' }} />
            </div>
            <div className="col">
              <div className="field">
                {t('league')}
                <Segmented label={t('league')} value={leagueId} onChange={(id) => { setLeagueId(id); setHost(''); void ensureLeagues(roomWheel(u, id, scope)) }} options={u.available.map((l) => ({ value: l.id, label: <><LeagueFlag leagueId={l.id} /> {l.name}</> }))} />
              </div>
              <div className="field">
                {t('draftFrom')}
                <Segmented label={t('draftFrom')} value={scope} onChange={(sc) => { setScope(sc); void ensureLeagues(roomWheel(u, leagueId, sc)) }} options={[{ value: 'league', label: <><LeagueFlag leagueId={leagueId} /> {t('thisLeague')}</> }, { value: 'all', label: <><LeagueFlag leagueId="europe" /> {t('allLeagues', { n: u.available.length })}</> }]} />
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
                <Segmented label={t('difficulty')} value={difficulty} onChange={setDifficulty} options={[{ value: 'calibrated', label: t('calibrated') }, { value: 'realistic', label: t('realistic') }]} />
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
            <input className="input mono room-code-input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="K7Q2-MX9A" maxLength={ROOM_CODE_INPUT_MAX} autoCapitalize="characters" autoComplete="off" spellCheck={false} aria-invalid={codeProblem || undefined} aria-describedby="room-code-help" data-testid="room-code-input" onKeyDown={(e) => e.key === 'Enter' && typed && void open(typed)} />
          </label>
          <span id="room-code-help" className={`small ${codeProblem ? 'bad-text' : 'muted'}`} aria-live="polite" data-testid="room-code-help">
            {codeProblem ? t('codeNotValid') : typed ? t('codeReady', { code: formatCode(typed) }) : t('codePasteLink')}
          </span>
          <button className="btn primary block" disabled={!typed} onClick={() => typed && void open(typed)} data-testid="room-open">
            <DoorOpen size={16} aria-hidden="true" /> {t('openRoom')}
          </button>
          {seats.length > 0 && (
            <div className="col" style={{ gap: 'var(--space-2)' }}>
              <div className="eyebrow">{t('yourRooms')}</div>
              <div className="row wrap">
                {seats.map((c) => (
                  <button key={c} className="btn sm mono" onClick={() => void open(c)} aria-label={t('openRoomCode', { code: formatCode(c) })} data-testid="room-seat">
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
  const { universe: u, go, ensureLeagues, loadedLeagues } = useStorePick('universe', 'go', 'ensureLeagues', 'loadedLeagues')
  const view = ui?.view ?? null
  const code = ui?.code ?? null
  // The room's code stays in the address, so a reload or a shared tab opens the same room; it goes when the screen does
  useEffect(() => {
    if (!code) return
    if (location.hash !== `#h=${code}`) history.replaceState(null, '', `${location.pathname}${location.search}#h=${code}`)
  }, [code])
  // Another room on the same screen (a rematch, a room opened from a result): its top, not the old room's scroll
  useEffect(() => {
    if (code) window.scrollTo(0, 0)
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
    <H2HHead
      title={t('onlineTitle')}
      chip={
        code && (
          <span className="chip mono" data-testid="room-code-chip">
            {formatCode(code)}
          </span>
        )
      }
      league={view ? { u, id: view.settings.leagueId, season: view.settings.leagueSeason } : undefined}
      extra={view?.settings.hardMode && <span className="chip">{t('hardMode')}</span>}
      actions={
        <button className="btn ghost sm" onClick={() => go('h2h')}>
          {t('backToH2H')}
        </button>
      }
    />
  )
  let body: React.ReactNode
  if (!ui) body = <RoomMessage icon={<Wifi size={26} />} title={t('noRoom')} line={t('noRoomLine')} />
  else if (ui.missing) body = <RoomMessage icon={<DoorOpen size={26} />} title={t('noCode')} line={t('noCodeLine', { n: ROOM_KEEP_HOURS })} testId="room-missing" action={<button className="btn primary" onClick={() => go('h2h')}>{t('makeOrJoin')}</button>} />
  else if (!view) body = ui.errorCode === 'network' || ui.errorCode === 'timeout' ? <RoomMessage icon={<WifiOff size={26} />} title={t('noConnection')} line={t('noConnectionLine')} testId="room-loading" action={<button className="btn primary" onClick={() => void refreshRoom()} data-testid="room-retry"><RefreshCw size={16} aria-hidden="true" /> {t('tryAgain')}</button>} /> : <RoomMessage icon={<Hourglass size={26} />} title={t('openingRoom')} line={ui.error ?? t('readingRoom')} testId="room-loading" />
  else if (versionNote) body = <RoomMessage icon={<Lock size={26} />} title={versionNote.title} line={versionNote.line} testId="room-version" action={versionNote.older ? <button className="btn primary" onClick={() => go('h2h')}>{t('makeNewRoom')}</button> : <button className="btn primary" onClick={() => location.reload()}>{t('reload')}</button>} />
  else if (missingLeagues.length) body = <RoomMessage icon={<Hourglass size={26} />} title={t('loadingLeagues')} line={t('leaguesNeeded')} />
  else if (view.status === 'waiting') body = ui.seat === null ? <RoomJoin view={view} /> : <RoomWaiting view={view} rematch={ui.rematch ?? null} />
  else if (view.status === 'drafting') body = <RoomDraft view={view} seat={ui.seat} />
  else if (view.status === 'finished' && view.result && view.managers[1]) return <RoomResult view={view} seat={ui.seat} />
  else body = <RoomEnded view={view} seat={ui.seat} />
  return (
    <div className={`page room-page ${view?.status === 'drafting' && !versionNote && !missingLeagues.length ? 'has-turn-pill' : ''}`} data-testid="room-screen" data-status={view?.status ?? 'none'}>
      {head}
      {ui && view && !versionNote && <RoomStatusLine ui={ui} />}
      {body}
    </div>
  )
}

/** The room's messages (loading, ended, not found) in the head-to-head's one message box. */
const RoomMessage = BoardMessage

/** The room's connection and the last refusal, each with what to do next: a dropped connection counts down to its next try. */
function RoomStatusLine({ ui }: { ui: RoomUi }) {
  const now = useNow(1000)
  const offline = ui.errorCode === 'network' || ui.errorCode === 'timeout'
  const synced = ui.syncedAt ?? null
  // The next try, as the session plans it (a dropped connection backs off to 30 s)
  const wait = offline ? (pollDelay(ui.view, ui.seat, true, ui.failures ?? 0) ?? 0) : 0
  const ago = synced !== null ? now - synced : 0
  if (offline)
    return (
      <div className="notice warn room-notice row between wrap" role="status" data-testid="room-offline">
        <span className="row">
          <WifiOff size={16} aria-hidden="true" /> {ui.error}
          {synced !== null && <span className="muted small">{t('lastInTouch', { ago: clockText(ago), n: Math.ceil(wait / 1000) })}</span>}
        </span>
        <button className="btn sm" onClick={() => void refreshRoom()} data-testid="room-retry">
          <RefreshCw size={14} aria-hidden="true" /> {t('tryAgain')}
        </button>
      </div>
    )
  // Refused a full room: the watching note says the same where it matters
  if (ui.error && !(ui.errorCode === 'room_full' && ui.view && ui.view.status !== 'waiting'))
    return (
      <div className="notice warn room-notice" role="alert" data-testid="room-error">
        {ui.error}
      </div>
    )
  return null
}

/** A room that ended without a result: why, and a way on (the same room again for a manager who held a seat). */
function RoomEnded({ view, seat }: { view: RoomView; seat: 0 | 1 | null }) {
  const { universe: u, go, showToast } = useStorePick('universe', 'go', 'showToast')
  const [busy, setBusy] = useState(false)
  if (!u) return null
  const other = seat === null ? null : view.managers[seat === 0 ? 1 : 0]
  // A seat still held on this device means this device did not leave: the other manager did
  const line = view.status === 'left' && other ? t('otherLeftLine', { name: other.name }) : `${roomEndLine(view.status)} ${t(seat === null ? 'endedWatcher' : 'endedSeat')}`
  return (
    <RoomMessage
      icon={<DoorOpen size={26} />}
      title={view.status === 'left' && other ? t('otherLeft', { name: other.name }) : t('roomEnded')}
      line={line}
      testId="room-ended"
      action={
        <div className="room-ended-actions">
          <div className="row wrap room-ended-buttons">
            {seat !== null && (
              <button className="btn primary" disabled={busy} onClick={() => { setBusy(true); void rematch(u, view, seat, showToast).finally(() => setBusy(false)) }} data-testid="room-rematch">
                <RotateCcw size={16} aria-hidden="true" /> {t(busy ? 'makingRoom' : 'sameRoomAgain')}
              </button>
            )}
            <button className={`btn ${seat === null ? 'primary' : ''}`} onClick={() => go('h2h')}>
              {t('newRoom')}
            </button>
          </div>
          {seat !== null && <JoinRematch name={other?.name ?? null} />}
        </div>
      }
    />
  )
}

/** Share the room's link: the share sheet on a phone, the clipboard elsewhere. */
function ShareRoom({ view, primary, rematch }: { view: RoomView; primary?: boolean; rematch?: RematchNote | null }) {
  const showToast = useStore((s) => s.showToast)
  const [copied, flashCopied] = useFlash()
  const [codeCopied, flashCode] = useFlash()
  const sheet = hasShareSheet()
  const link = roomLink(view.code, here().origin, here().pathname)
  const go = async () => {
    const out = await shareOrCopy({ title: t('inviteTitle'), text: roomInviteText(view.managers[0]?.name ?? null, view.code, rematch), url: link })
    if (out === 'failed') showToast(t('shareLinkFailed'))
    else if (out !== 'dismissed') flashCopied()
  }
  const copy = async () => {
    const out = await copyText(link)
    if (out === 'failed') showToast(t('copyLinkFailed'))
    else flashCopied()
  }
  // The code alone, for a friend who types it in (Head-to-head, Join with a code)
  const copyCode = async () => {
    const out = await copyText(formatCode(view.code))
    if (out === 'failed') showToast(t('copyCodeFailed'))
    else flashCode()
  }
  return (
    <div className="col" style={{ gap: 'var(--space-2)' }}>
      <div className="room-share">
        <input className="input mono" readOnly value={link} aria-label={t('roomLink')} data-testid="room-link" onFocus={(e) => e.currentTarget.select()} />
        {sheet ? (
          <button className={`btn ${primary ? 'primary' : ''}`} onClick={() => void go()} data-testid="room-share">
            {copied ? <Check size={16} aria-hidden="true" /> : <Share2 size={16} aria-hidden="true" />} {t(copied ? 'sent' : 'shareInvite')}
          </button>
        ) : (
          <button className={`btn ${primary ? 'primary' : ''}`} onClick={() => void copy()} data-testid="room-copy">
            {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />} {t(copied ? 'copied' : 'copyLink')}
          </button>
        )}
      </div>
      <button className="btn sm ghost" onClick={() => void copyCode()} aria-label={t('copyCodeAria', { code: formatCode(view.code) })} data-testid="room-copy-code">
        {codeCopied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />} {t(codeCopied ? 'copied' : 'copyCode')}
      </button>
      <span className="sr-only" role="status">
        {copied || codeCopied ? t('copied') : ''}
      </span>
    </div>
  )
}

/** A line naming the room's league season and wheel. */
function settingsLine(u: NonNullable<ReturnType<typeof useStore.getState>['universe']>, s: RoomSettings): string {
  const league = u.available.find((l) => l.id === s.leagueId)?.name ?? s.leagueId
  return t('settingsLine', { league, season: seasonLabel(s.leagueSeason), wheel: s.wheelLeagues.length > 1 ? 'all' : 'one', n: s.wheelLeagues.length, difficulty: s.difficulty, hard: s.hardMode ? 'yes' : 'no' })
}

/** Seat 0, waiting: the code, the link to share and the deadline. */
function RoomWaiting({ view, rematch }: { view: RoomView; rematch: RematchNote | null }) {
  const u = useStore((s) => s.universe)
  const now = useNow(1000)
  if (!u) return null
  const clock = waitClock(view, now)
  const again = rematch?.opponent ?? null
  return (
    <div className="screen-body fill">
      <div className="grid two">
        <div className="panel col room-wait" data-testid="room-waiting">
          <div className="eyebrow" data-testid={again ? 'room-rematch-for' : undefined}>{again ? t('rematchTitle', { name: again }) : t('roomCode')}</div>
          <div className="room-code mono" data-testid="room-code">
            {formatCode(view.code)}
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            {again ? t('rematchHelp', { name: again }) : t('shareHelp')}
          </p>
          <ShareRoom view={view} primary rematch={rematch} />
          {again && <JoinRematch name={again} own={view.code} />}
          <div className="notice icon-notice room-clock" data-testid="room-wait-clock">
            <Hourglass size={16} aria-hidden="true" />
            <span>
              {t('waitingClock')} <span className="mono">{clockText(clock?.elapsed ?? 0)}</span>
              <span className="muted small">{t('waitingClosesIn', { n: minutesLeft(view.expiresAt, now, ROOM_WAIT_MINUTES) })}</span>
            </span>
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            {t('leaveScreenNote')}
          </p>
          <button className="btn ghost danger" onClick={() => void askConfirm(t('closeConfirm'), { ok: t('closeOk'), danger: true }).then((ok) => { if (ok) void leaveRoom() })} data-testid="room-leave">
            {t('closeRoom')}
          </button>
        </div>
        <div className="panel col">
          <h3 style={{ margin: 0 }}>{t('theRoom')}</h3>
          <ManagerCard u={u} m={view.managers[0]} you />
          <ManagerCard u={u} m={null} />
          <div className="muted small">{settingsLine(u, view.settings)}</div>
        </div>
      </div>
    </div>
  )
}

/** A device without a seat, on a waiting room: take the other seat. */
function RoomJoin({ view }: { view: RoomView }) {
  const u = useStore((s) => s.universe)
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
          <ManagerFields u={u} name={name} onName={setName} nameLabel={t('yourName')} fallback={t('managerN', { n: 2 })} taken={[host.name]} formationId={formationId} onFormation={setFormationId} formationLabel={t('yourFormation')} blurb={false} clubs={clubs} clubId={hostClubId} onClub={setClub} testIds={{ name: 'room-join-name', formation: 'room-join-formation', club: 'room-join-club' }} />
          <button className="btn primary big block" disabled={busy} onClick={() => void joinRoom({ name: name.trim() || t('managerN', { n: 2 }), formationId, hostClubId }, ENGINE_VERSION, u.generatedAt ?? '')} data-testid="room-join-btn">
            {t(busy ? 'joining' : 'joinStart')}
          </button>
          <p className="muted small" style={{ margin: 0 }} data-testid="room-join-as">
            {t(signedIn ? 'joinAccount' : 'joinGuest')}
          </p>
          {signedIn && (
            <button className="btn ghost sm" onClick={() => void resumeRoom()} data-testid="room-resume">
              {t('myRoom')}
            </button>
          )}
        </div>
        <div className="panel col">
          <h3 style={{ margin: 0 }}>{t('theRoom')}</h3>
          <ManagerCard u={u} m={host} />
          <ManagerCard u={u} m={null} />
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
  const { universe: u, showToast } = useStorePick('universe', 'showToast')
  const busy = useOnline((s) => s.room?.busy ?? false)
  const signedIn = useOnline((s) => !!s.session)
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
  // The turn passing, heard once the reel has landed: rising for this seat's pick, falling for the other's
  const turnKey = d?.current ? `${d.spins}:${d.current.clubId}@${d.current.season}` : null
  useTurnSound(d?.picking ?? null, !!turnKey && settled === turnKey, seat !== null && d?.picking === seat)
  if (!u || !d) return <RoomMessage icon={<Lock size={26} />} title={t('cannotShow')} line={t('cannotShowLine')} />
  const currentKey = turnKey
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
    <DraftBoard
      testId="room-draft"
      turn={mine ? 'mine' : 'theirs'}
      log={d.log.map((l) => roomLogLine(l, view.managers))}
      controls={
        <>
          <CaseReel u={u} leagues={leagues} pool={pool} target={d.current} spinKey={d.spins} onSettled={() => setSettled(currentKey)} />
          <TurnBanner mine={mine} line={busy && mine ? t('sendingPick') : turnLine} testId="room-turn" />
          <TurnTimer view={view} mine={mine} name={picking === null ? null : managers[picking].name} watching={seat === null} />
          <RoomTurnPill view={view} mine={mine} line={busy && mine ? t('sendingPick') : turnLine} />
          {seat === null && (
            <div className="notice col" style={{ gap: 'var(--space-2)' }} data-testid="room-watching">
              <span>{t('watching')} {t(signedIn ? 'watchingSignedIn' : 'watchingSignedOut')}</span>
              <span className="row wrap">
                {signedIn && (
                  <button className="btn sm" onClick={() => void resumeRoom()} data-testid="room-resume">
                    {t('takeSeatBack')}
                  </button>
                )}
                <button className="btn sm ghost" onClick={() => useStore.getState().go('h2h')}>
                  {t('makeOwnRoom')}
                </button>
              </span>
            </div>
          )}
          {seat !== null && (
            <button className="btn ghost sm danger" onClick={() => void askConfirm(t('leaveConfirm'), { ok: t('leaveOk'), danger: true }).then((ok) => { if (ok) void leaveRoom() })} data-testid="room-leave">
              {t('leaveRoom')}
            </button>
          )}
        </>
      }
      offer={<OfferPanel u={u} current={current} tier={tier} spinning={spinning} revealed={revealed} complete={h2hComplete(d)} waitingTitle={t('nextSpinOnWay')} notice={mine && <div className="notice">{t('yourPickSlot', { slot: selected ? 'yes' : 'no', player: selected?.name })}</div>} testId="room-squad" rows={current && <OfferRows current={current} managers={managers} takenBy={(p) => d.drafts.findIndex((x) => Object.values(x.lineup).includes(p.id) || x.bench.includes(p.id))} usableIds={usableIds} selectedId={selectedId} hide={hide} onPick={onPick} draftTestId="room-draft-btn" />} />}
      pitches={<SquadPitches u={u} d={d} managers={managers} picking={picking} you={seat} placing={mine ? seat : null} selected={selected} eligible={eligible} slotClick={(i) => (s) => onSlot(i, s)} onSlot={onSlot} />}
    />
  )
}

/** Whose turn and for how long, ticking each second, and the idle deadline; a long quiet turn says the other manager may have gone. */
function TurnTimer({ view, mine, name, watching }: { view: RoomView; mine: boolean; name: string | null; watching: boolean }) {
  const now = useNow(1000)
  const clock = turnClock(view, now)
  if (!clock || name === null) return null
  const late = clock.left <= 3 * 60000
  return (
    <div className="col room-clock" style={{ gap: 'var(--space-1)' }} data-testid="room-turn-clock" data-quiet={clock.quiet && !mine ? 'yes' : 'no'}>
      <div className="row between small">
        <span>
          {mine ? t('yourClock') : t('theirClock', { name })} <span className="mono" data-testid="room-turn-elapsed">{clockText(clock.elapsed)}</span>
        </span>
        <span className={late ? 'bad-text' : 'muted'}>{rich(t('timesOutIn', { clock: clockText(clock.left) }), MONO)}</span>
      </div>
      <div className="meter room-meter" aria-hidden="true">
        <span style={{ transform: `scaleX(${Math.min(1, clock.elapsed / (ROOM_IDLE_MINUTES * 60000))})` }} />
      </div>
      {mine && late && <div className="notice warn small" data-testid="room-late">{t('pickWithin', { n: Math.max(1, Math.ceil(clock.left / 60000)) })}</div>}
      {!mine && !watching && clock.quiet && (
        <div className="notice small" data-testid="room-quiet">
          {t('quietTurn', { name, n: Math.floor(clock.elapsed / 60000), idle: ROOM_IDLE_MINUTES })}
        </div>
      )}
    </div>
  )
}

/** The phone's turn pill, with the turn's clock. */
function RoomTurnPill({ view, mine, line }: { view: RoomView; mine: boolean; line: string }) {
  const now = useNow(1000)
  const clock = turnClock(view, now)
  return <TurnPill mine={mine} line={line} clock={clock ? clockText(clock.elapsed) : null} testId="room-turn-pill" />
}

/** The room's season, as the server played it (the hot-seat's result screen), with a rematch for a manager who held a seat. */
function RoomResult({ view, seat }: { view: RoomView; seat: 0 | 1 | null }) {
  const { universe: u, go, showToast } = useStorePick('universe', 'go', 'showToast')
  const managers = view.managers as [H2HManager, H2HManager]
  const d = useMemo(() => (u ? draftFromEvents(u, view.settings, managers, view.events) : null), [u, view.code, view.version]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!u || !d || !view.result) return null
  const onRematch = () => {
    if (seat === null) go('h2h')
    else void rematch(u, view, seat, showToast)
  }
  return <H2HResultView managers={managers} result={view.result} drafts={d.drafts} leagueId={view.settings.leagueId} leagueSeason={view.settings.leagueSeason} seed={view.seed ?? view.code} label={t('resultLabel')} shareLabel="Online head-to-head" rematchLabel={t(seat === null ? 'newRoom' : 'rematch')} onRematch={onRematch} onHome={() => go('home')} you={seat ?? undefined} testId="room-result" extra={seat === null ? undefined : <JoinRematch name={managers[seat === 0 ? 1 : 0].name} />} />
}
