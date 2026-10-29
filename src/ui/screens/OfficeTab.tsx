import { useState, type ReactNode } from 'react'
import { Briefcase, Handshake, MessageCircle, Mic, ScrollText, Users } from 'lucide-react'
import { useStorePick } from '../useStorePick'
import { officeActions as act } from '@game/officeActions'
import type { Game } from '@game/types'
import type { LoadedUniverse } from '@engine/universe'
import { EXPECTED_SHARE, STATUS_LABEL, STATUSES, type SquadStatus } from '@engine/status'
import type { Boxes } from '../components/Boxes'
import { playerLookup } from '@game/logic/players'
import { officeItems } from '@game/logic/office'
import { promiseProgress } from '@game/logic/promises'
import { openRequests, restlessPlayers, talkOdds, answerProblem, type RequestAnswer } from '@game/logic/transferRequests'
import { conversationProblem, TOPIC_TONES, type ConversationTopic } from '@game/logic/conversations'
import { pressAnswers, pressProblem, pressQuestions, pressSubject, PRESS_ANSWERS } from '@game/logic/pressConference'
import { feeTalkOf, MAX_FEE_ROUNDS, openingStatus, paymentPlan, sellTalkOf, termsDemand, type Instalments } from '@game/logic/transferTalks'
import { squadIdOf } from '@game/logic/officeCore'
import { nextOpponent, recentShare } from '@game/logic/week'
import { Bar, Info, Modal, Rating } from '../components/bits'
import { onRadioGroupKey, radioTabIndex } from '../a11y'
import { moraleClass } from '../components/Happiness'
import { clubName, meterValue, money, wage } from '../format'
import { rich } from '../i18n/rich'
import { translator } from '../i18n'
import { office } from '../i18n/en/office'

const t = translator(office)
const B = (c: ReactNode) => <b>{c}</b>

/** Items waiting on the manager in the office: the tab's badge and the Inbox strip. */
export function officeAlertCount(game: Game, u: LoadedUniverse): number {
  return officeItems(game, u).length
}

/** The Inbox's strip of office items, each opening the Office. */
export function OfficeInbox({ onOpen }: { onOpen: () => void }) {
  const { universe: u, game } = useStorePick('universe', 'game')
  if (!u || !game) return null
  const items = officeItems(game, u)
  if (!items.length) return null
  return (
    <div className="needs-you" data-testid="office-inbox">
      <span className="needs-you-label">{t('inboxNeeds')}</span>
      {items.slice(0, 3).map((it, i) => (
        <button key={i} type="button" className="btn sm" onClick={onOpen}>
          {it.kind === 'request' ? t('inboxRequest', { name: it.name ?? '' }) : it.kind === 'terms' ? t('inboxTerms', { name: it.name ?? '' }) : t('inboxPromise', { name: it.name ?? '', weeks: it.weeks ?? 0 })}
        </button>
      ))}
    </div>
  )
}

/** The Office tab: player requests and promises, conversations and the press, transfer talks and squad status. */
export function OfficeTab({ onPlayer, boxes }: { onPlayer: (id: string) => void; boxes?: Boxes }) {
  const { universe: u, game } = useStorePick('universe', 'game')
  const [msg, setMsg] = useState<string | null>(null)
  if (!u || !game) return null
  const on = (id: string) => boxes?.on(id) ?? true
  const grid = boxes?.grid([{ track: 'minmax(0, 1fr)', ids: ['requests', 'promises'] }, { track: 'minmax(0, 1fr)', ids: ['talks', 'press'] }, { track: 'minmax(0, 1fr)', ids: ['transfers', 'status'] }]) ?? { className: '', style: undefined }
  return (
    <div className={`grid three fill squad-views office-grid ${grid.className}`} style={grid.style} data-testid="office">
      {(on('requests') || on('promises')) && (
        <div className="col">
          {msg && (
            <div className="notice" role="status" data-testid="office-msg">
              {msg}
            </div>
          )}
          {on('requests') && <RequestsBox game={game} u={u} onPlayer={onPlayer} say={setMsg} />}
          {on('promises') && <PromisesBox game={game} u={u} onPlayer={onPlayer} />}
        </div>
      )}
      {(on('talks') || on('press')) && (
        <div className="col">
          {on('talks') && <TalkBox game={game} u={u} say={setMsg} />}
          {on('press') && <PressBox game={game} u={u} say={setMsg} />}
        </div>
      )}
      {(on('transfers') || on('status')) && (
        <div className="col">
          {on('transfers') && <TransfersBox game={game} say={setMsg} />}
          {on('status') && <StatusBox game={game} u={u} onPlayer={onPlayer} say={setMsg} />}
        </div>
      )}
    </div>
  )
}

type BoxProps = { game: Game; u: LoadedUniverse; say: (m: string) => void }

function RequestsBox({ game, u, onPlayer, say }: BoxProps & { onPlayer: (id: string) => void }) {
  const store = useStorePick('setPlayerPower')
  const get = playerLookup(game, u)
  const open = openRequests(game)
  const settled = Object.values(game.office?.requests ?? {}).filter((r) => r.stage !== 'open' && r.year === game.year)
  const restless = restlessPlayers(game, u).filter((x) => !open.some((r) => r.playerId === get(x.id)?.playerId)).slice(0, 5)
  const week = game.season?.matchweek ?? 0
  const answers: Array<{ a: RequestAnswer; label: string }> = [
    { a: 'talk', label: t('answerTalk') },
    { a: 'promise-minutes', label: t('answerPromiseMinutes') },
    { a: 'promise-contract', label: t('answerPromiseContract') },
    { a: 'list', label: t('answerList') },
    { a: 'refuse', label: t('answerRefuse') },
  ]
  return (
    <div className="panel" data-testid="office-requests">
      <div className="panel-head">
        <span className="head-title">
          <h3 className="icon-title">
            <Briefcase size={18} aria-hidden="true" /> {t('requests')}
          </h3>
          <Info label={t('requests')}>{t('requestsInfo')}</Info>
        </span>
        <span className="row" style={{ gap: 4 }}>
          <label className="toggle small">
            <input type="checkbox" checked={!!game.settings.playerPower} onChange={(e) => store.setPlayerPower(e.target.checked)} data-testid="player-power" />
            {t('playerPower')}
          </label>
          <Info label={t('playerPower')}>{t('playerPowerInfo')}</Info>
        </span>
      </div>
      {open.length === 0 && <div className="small muted">{t('noRequests')}</div>}
      <div className="col" style={{ gap: 'var(--space-2)' }}>
        {open.map((r) => {
          const id = squadIdOf(game, u, r.playerId)
          if (!id) return null
          return (
            <div key={r.playerId} className="card" data-testid="office-request">
              <div className="row between wrap">
                <button type="button" className="link-btn" onClick={() => onPlayer(id)}>
                  {rich(t('requestFrom', { name: r.name }), { b: B })}
                </button>
                <span className="small muted">{t('waitingWeeks', { n: Math.max(0, week - r.at) })}</span>
              </div>
              <div className="small muted">{t(`reason_${r.reason}`)}</div>
              <div className="row wrap" style={{ gap: 4, marginTop: 'var(--space-2)' }}>
                {answers.map(({ a, label }) => {
                  const problem = answerProblem(game, u, id, a)
                  const odds = a === 'talk' || a === 'promise-minutes' || a === 'promise-contract' ? talkOdds(game, u, r, a) : null
                  return (
                    <button key={a} type="button" className={`btn sm ${a === 'refuse' ? 'ghost' : ''}`} disabled={!!problem} title={problem ?? (odds !== null ? t('odds', { pct: Math.round(odds * 100) }) : undefined)} data-testid={`request-${a}`} onClick={() => say(act.answerRequest(id, a).message)}>
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
      {settled.length > 0 && (
        <ul className="small muted" style={{ marginTop: 'var(--space-2)' }}>
          {settled.map((r) => (
            <li key={r.playerId}>
              {r.name}: {r.stage === 'listed' ? t('stage_listed') : r.stage === 'refused' ? t('stage_refused') : t('stage_withdrawn')}
            </li>
          ))}
        </ul>
      )}
      <h4 className="head-title room-sub">
        {t('restless')} <Info label={t('restless')}>{t('restlessInfo')}</Info>
      </h4>
      {restless.length === 0 && <div className="small muted">{t('nobodyRestless')}</div>}
      <div className="plist lined">
        {restless.map(({ id, pressure }) => (
          <button key={id} type="button" className="room-row" onClick={() => onPlayer(id)} data-testid="restless-row">
            <span className="who">
              <b>{get(id)?.name}</b>
              <span className="small muted one-line">{t(`reason_${pressure.reason}`)}</span>
            </span>
            <span className={`chip ${moraleClass(game.squad[id]?.morale ?? 70)}`}>{meterValue(game.squad[id]?.morale ?? 70)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function PromisesBox({ game, u, onPlayer }: { game: Game; u: LoadedUniverse; onPlayer: (id: string) => void }) {
  const rows = promiseProgress(game, u)
  const done = (game.office?.promises ?? []).filter((p) => p.state !== 'open' && p.year === game.year).slice(-4).reverse()
  return (
    <div className="panel" data-testid="office-promises">
      <div className="panel-head">
        <span className="head-title">
          <h3 className="icon-title">
            <ScrollText size={18} aria-hidden="true" /> {t('promises')}
          </h3>
          <Info label={t('promises')}>{t('promisesInfo')}</Info>
        </span>
      </div>
      {rows.length === 0 && <div className="small muted">{t('noPromises')}</div>}
      <div className="col" style={{ gap: 'var(--space-2)' }}>
        {rows.map(({ promise, line, progress }) => {
          const id = squadIdOf(game, u, promise.playerId)
          return (
            <div key={`${promise.kind}-${promise.playerId}`} className="card" data-testid="office-promise">
              <div className="row between">
                <button type="button" className="link-btn" onClick={() => id && onPlayer(id)}>
                  <b>{promise.name}</b>
                </button>
                <span className="chip info">{t(`promiseKind_${promise.kind}`)}</span>
              </div>
              <div className="small muted">{line}</div>
              <Bar value={progress * 100} colour={progress >= 1 ? 'var(--good)' : 'var(--meter-mid)'} />
            </div>
          )
        })}
      </div>
      {done.length > 0 && (
        <div className="col small" style={{ gap: 4, marginTop: 'var(--space-2)' }}>
          {done.map((p) => (
            <div key={`${p.kind}-${p.playerId}-${p.madeAt}`} className="row between">
              <span>
                {p.name} · {t(`promiseKind_${p.kind}`)}
              </span>
              <span className={`chip ${p.state === 'kept' ? 'good' : 'bad'}`}>{t(p.state === 'kept' ? 'kept' : 'broken')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function TalkBox({ game, u, say }: BoxProps) {
  const get = playerLookup(game, u)
  const ids = Object.keys(game.squad).sort((a, b) => (get(a)?.name ?? a).localeCompare(get(b)?.name ?? b))
  const [who, setWho] = useState<string>('')
  const [topic, setTopic] = useState<ConversationTopic>('form')
  const id = who && game.squad[who] ? who : ids[0]
  const problem = id ? conversationProblem(game, u, id) : null
  return (
    <div className="panel" data-testid="office-talks">
      <div className="panel-head">
        <span className="head-title">
          <h3 className="icon-title">
            <MessageCircle size={18} aria-hidden="true" /> {t('talks')}
          </h3>
          <Info label={t('talks')}>{t('talksInfo')}</Info>
        </span>
      </div>
      <label className="small muted" htmlFor="office-talk-player">
        {t('player')}
      </label>
      <select id="office-talk-player" className="input" value={id ?? ''} onChange={(e) => setWho(e.target.value)} data-testid="talk-player">
        {ids.map((x) => (
          <option key={x} value={x}>
            {get(x)?.name} · {meterValue(game.squad[x].morale)}
          </option>
        ))}
      </select>
      <div className="segmented" style={{ margin: 'var(--space-2) 0' }} role="radiogroup" aria-label={t('talks')} onKeyDown={onRadioGroupKey}>
        {(Object.keys(TOPIC_TONES) as ConversationTopic[]).map((tp, i, all) => (
          <button key={tp} type="button" role="radio" aria-checked={topic === tp} tabIndex={radioTabIndex(i, all.indexOf(topic))} className={topic === tp ? 'active' : ''} onClick={() => setTopic(tp)} data-testid={`talk-topic-${tp}`}>
            {t(`topic_${tp}`)}
          </button>
        ))}
      </div>
      {problem && <div className="small muted">{t('spokenThisWeek')}</div>}
      <div className="row wrap" style={{ gap: 4 }}>
        {TOPIC_TONES[topic].map((tone) => (
          <button key={tone} type="button" className="btn sm" disabled={!id || !!problem} data-testid={`talk-tone-${tone}`} onClick={() => id && say(act.converse(id, topic, tone).message)}>
            {t(`tone_${tone}`)}
          </button>
        ))}
      </div>
    </div>
  )
}

function PressBox({ game, u, say }: BoxProps) {
  const problem = pressProblem(game)
  const qs = problem ? [] : pressQuestions(game, u)
  const given = pressAnswers(game)
  const get = playerLookup(game, u)
  const nextClub = nextOpponent(game)?.clubId ?? null
  return (
    <div className="panel" data-testid="office-press">
      <div className="panel-head">
        <span className="head-title">
          <h3 className="icon-title">
            <Mic size={18} aria-hidden="true" /> {t('press')}
          </h3>
          <Info label={t('press')}>{t('pressInfo')}</Info>
        </span>
      </div>
      {qs.length === 0 && <div className="small muted">{t('noPress')}</div>}
      <div className="col" style={{ gap: 'var(--space-2)' }}>
        {qs.map((q) => {
          const subject = pressSubject(game, u, q)
          const name = subject ? get(subject)?.name ?? '' : ''
          const question = q === 'opponent' ? (nextClub ? t('q_opponent', { club: clubName(u, nextClub) }) : t('q_opponentAny')) : q === 'wantaway' ? t('q_wantaway', { name }) : q === 'prospect' ? t('q_prospect', { name }) : t(`q_${q}`)
          const chosen = given[q]
          return (
            <div key={q} className="card" data-testid="press-question">
              <div>
                <b>{question}</b>
              </div>
              <div className="row wrap" style={{ gap: 4, marginTop: 4 }}>
                {Object.keys(PRESS_ANSWERS[q]).map((a) => (
                  <button key={a} type="button" className={`btn sm press-answer ${chosen === a ? 'primary' : ''}`} disabled={!!chosen} data-testid="press-answer" onClick={() => say(act.answerPress(q, a).message)}>
                    {t(`a_${a}` as 'a_respect')}
                  </button>
                ))}
              </div>
              {chosen && <div className="small muted">{t('answered')}</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TransfersBox({ game, say }: Omit<BoxProps, 'u'>) {
  const talks = Object.entries(game.office?.feeTalks ?? {}).filter(([id]) => !!feeTalkOf(game, id))
  const owed = game.office?.instalments ?? []
  return (
    <div className="panel" data-testid="office-transfers">
      <div className="panel-head">
        <span className="head-title">
          <h3 className="icon-title">
            <Handshake size={18} aria-hidden="true" /> {t('transfers')}
          </h3>
          <Info label={t('transfers')}>{t('transfersInfo')}</Info>
        </span>
      </div>
      {!game.window && <div className="small muted">{t('windowShut')}</div>}
      {game.window && talks.length === 0 && <div className="small muted">{t('noTalks')}</div>}
      <div className="col" style={{ gap: 'var(--space-3)' }}>
        {talks.map(([id]) => (
          <div key={id} className="card">
            <FeeTalkPanel listingId={id} say={say} />
          </div>
        ))}
      </div>
      {owed.length > 0 && (
        <>
          <h4 className="room-sub">{t('owed')}</h4>
          <ul className="small muted">
            {owed.map((o, i) => (
              <li key={i}>{t('owedLine', { name: o.name, n: o.left, m: money(o.amount) })}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function StatusBox({ game, u, onPlayer, say }: BoxProps & { onPlayer: (id: string) => void }) {
  const get = playerLookup(game, u)
  const rows = Object.keys(game.squad)
    .map((id) => ({ id, p: get(id), status: (game.contracts[id]?.status ?? 'rotation') as SquadStatus }))
    .filter((x) => !!x.p)
    .sort((a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) || (b.p!.overall - a.p!.overall))
  return (
    <div className="panel" data-testid="office-status">
      <div className="panel-head">
        <span className="head-title">
          <h3 className="icon-title">
            <Users size={18} aria-hidden="true" /> {t('statusBox')}
          </h3>
          <Info label={t('statusBox')}>{t('statusInfo')}</Info>
        </span>
      </div>
      <div className="plist lined">
        {rows.map(({ id, p, status }) => {
          const share = recentShare(game.squad[id])
          const short = share !== null && share < EXPECTED_SHARE[status] - 0.15
          const c = game.contracts[id]
          return (
            <div key={id} className="room-row" data-testid="status-row">
              <button type="button" className="who link-btn" onClick={() => onPlayer(id)}>
                <b>{p!.name}</b>
                <span className="small muted one-line" style={{ fontWeight: 'normal' }}>
                  {STATUS_LABEL[status]} · {t('expects', { pct: Math.round(EXPECTED_SHARE[status] * 100) })}
                  {share !== null ? ` · ${t('played', { pct: Math.round(share * 100) })}` : ''}
                </span>
              </button>
              <span className="row" style={{ gap: 4 }}>
                {c?.listed && <span className="chip warn">{t('listed')}</span>}
                {short && <span className="chip bad">{t('played', { pct: Math.round((share ?? 0) * 100) })}</span>}
                {!c?.loan && (
                  <button type="button" className="chip-btn" onClick={() => say(act.setListed(id, !c?.listed).message)} data-testid="status-list">
                    {c?.listed ? t('unlist') : t('list')}
                  </button>
                )}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Fee talks and then personal terms for one listing; in the Office and in the market's Negotiate dialog. */
export function FeeTalkPanel({ listingId, say }: { listingId: string; say?: (m: string) => void }) {
  const { universe: u, game, showToast } = useStorePick('universe', 'game', 'showToast')
  const listing = game?.window?.listings.find((l) => l.playerSeasonId === listingId)
  const talk = game ? feeTalkOf(game, listingId) : undefined
  const [fee, setFee] = useState<number | null>(null)
  const [sellOn, setSellOn] = useState(0)
  const [inst, setInst] = useState<Instalments>(1)
  const [status, setStatus] = useState<SquadStatus | null>(null)
  const [terms, setTerms] = useState<{ wage?: number; years?: number; signingFee?: number }>({})
  const [note, setNote] = useState<string | null>(null)
  if (!u || !game || !listing) return null
  const p = u.index[listingId]
  if (!p) return null
  const tell = (m: string) => {
    setNote(m)
    say?.(m)
  }
  const feeNow = fee ?? talk?.counter ?? Math.round(listing.asking * 0.9 * 10) / 10
  const plan = paymentPlan({ fee: feeNow, instalments: inst })
  const agreed = talk?.agreed
  const st = status ?? openingStatus(game, u, listingId)
  const demand = agreed ? termsDemand(game, u, listingId, st) : null
  const wageNow = terms.wage ?? demand?.wage ?? p.wage
  const yearsNow = terms.years ?? Math.min(3, demand?.maxYears ?? 3)
  const signNow = terms.signingFee ?? demand?.agentFee ?? 0
  return (
    <div className="col" style={{ gap: 'var(--space-2)' }} data-testid="fee-talk">
      <div className="row between wrap">
        <span>
          <b>{p.name}</b> <Rating value={p.overall} /> <span className="small muted">{clubName(u, p.clubId)}</span>
        </span>
        <span className="chip">{t('asking', { m: money(listing.asking) })}</span>
      </div>
      {note && <div className="small">{note}</div>}
      {talk?.closed ? null : !agreed ? (
        <>
          <div className="eyebrow">{t('feeStage')}</div>
          <div className="row wrap" style={{ gap: 4 }}>
            <input className="input" type="number" min={0.1} step={0.5} value={feeNow} onChange={(e) => setFee(Number(e.target.value))} aria-label={t('fee')} title={t('fee')} data-testid="fee-input" style={{ width: 90 }} />
            <select className="input" value={sellOn} onChange={(e) => setSellOn(Number(e.target.value))} aria-label={t('sellOn')} title={t('sellOn')} data-testid="fee-sellon">
              {[0, 0.1, 0.2].map((x) => (
                <option key={x} value={x}>
                  {x ? `${t('sellOn')} ${Math.round(x * 100)}%` : `${t('sellOn')}: ${t('noSellOn')}`}
                </option>
              ))}
            </select>
            <select className="input" value={inst} onChange={(e) => setInst(Number(e.target.value) as Instalments)} aria-label={t('instalments')} title={t('instalments')} data-testid="fee-instalments">
              {([1, 2, 3] as const).map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? t('inOne') : t('inN', { n })}
                </option>
              ))}
            </select>
          </div>
          <div className="small muted">{plan.payments ? t('payPlan', { now: money(plan.now), n: plan.payments, later: money(plan.later) }) : t('payNow', { m: money(plan.now) })}</div>
          {talk?.counter !== undefined && (
            <div className="small">
              {t('theyWant', { m: money(talk.counter) })} · {t('roundsLeft', { n: MAX_FEE_ROUNDS - talk.rounds })}
            </div>
          )}
          <div className="row wrap" style={{ gap: 4 }}>
            <button type="button" className="btn sm primary" data-testid="fee-offer" onClick={() => tell(act.proposeFee(listingId, { fee: feeNow, sellOn, instalments: inst }).message)}>
              {t('offerFee')}
            </button>
            {talk?.counter !== undefined && (
              <button type="button" className="btn sm" data-testid="fee-accept-counter" onClick={() => tell(act.proposeFee(listingId, { fee: talk.counter!, sellOn, instalments: inst }).message)}>
                {t('acceptCounter', { m: money(talk.counter) })}
              </button>
            )}
            {talk && (
              <button type="button" className="btn sm ghost" onClick={() => act.walkAway(listingId)}>
                {t('walkAway')}
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="eyebrow">
            {t('termsStage')} · {t('agreedFee', { m: money(agreed.fee) })}
          </div>
          {demand && (
            <div className="small muted">
              {t('heAsks', { w: demand.wage, fee: money(demand.agentFee) })} · {t('agentMood', { mood: t(`mood_${demand.mood}`) })}
            </div>
          )}
          <div className="row wrap" style={{ gap: 4 }}>
            <input className="input" type="number" min={1} step={5} value={wageNow} onChange={(e) => setTerms({ ...terms, wage: Number(e.target.value) })} aria-label={t('wage')} title={t('wage')} data-testid="terms-wage" style={{ width: 90 }} />
            <select className="input" value={yearsNow} onChange={(e) => setTerms({ ...terms, years: Number(e.target.value) })} aria-label={t('years')} title={t('years')}>
              {[1, 2, 3, 4, 5].filter((y) => y <= (demand?.maxYears ?? 5)).map((y) => (
                <option key={y} value={y}>
                  {y} · {t('years')}
                </option>
              ))}
            </select>
            <select className="input" value={st} onChange={(e) => setStatus(e.target.value as SquadStatus)} aria-label={t('status')} title={t('status')} data-testid="terms-status">
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
            <input className="input" type="number" min={0} step={0.1} value={signNow} onChange={(e) => setTerms({ ...terms, signingFee: Number(e.target.value) })} aria-label={t('signingFee')} title={t('signingFee')} style={{ width: 80 }} />
          </div>
          <div className="small muted">{wage(wageNow)}</div>
          <div className="row wrap" style={{ gap: 4 }}>
            <button
              type="button"
              className="btn sm primary"
              data-testid="terms-offer"
              onClick={() => {
                const out = act.offerTerms(listingId, { wage: wageNow, years: yearsNow, status: st, signingFee: signNow })
                tell(out.message)
                // Signed, the listing leaves the market and the Negotiate dialog with it: the toast says so (r9)
                if (out.signed && !say) showToast(out.message)
              }}
            >
              {t('offerTerms')}
            </button>
            {demand && (
              <button type="button" className="btn sm" data-testid="terms-meet" onClick={() => setTerms({ wage: demand.wage, years: Math.min(3, demand.maxYears), signingFee: demand.agentFee })}>
                {t('meetDemand')}
              </button>
            )}
            <button type="button" className="btn sm ghost" onClick={() => act.walkAway(listingId)}>
              {t('walkAway')}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

/** The market listing's Negotiate button: the fee and personal terms in a dialog. */
export function NegotiateButton({ listingId, name }: { listingId: string; name: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="btn sm" data-testid="negotiate" onClick={() => setOpen(true)}>
        {t('negotiate')}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={t('negotiateWith', { name })} testId="negotiate-dialog">
        <FeeTalkPanel listingId={listingId} />
      </Modal>
    </>
  )
}

/** Counter an AI club's bid for one of our men (the offer's index in the window). */
export function CounterBidControl({ index, name }: { index: number; name: string }) {
  const store = useStorePick('game', 'showToast')
  const { game } = store
  const o = game?.window?.offers[index]
  const [ask, setAsk] = useState<number | null>(null)
  if (!game || !o) return null
  const final = sellTalkOf(game, o)?.final
  if (final !== undefined) return <span className="chip warn">{t('theirFinal')}</span>
  const value = ask ?? Math.round(o.amount * 1.2 * 10) / 10
  return (
    <span className="row" style={{ gap: 4 }}>
      <input className="input" type="number" min={0.1} step={0.5} value={value} onChange={(e) => setAsk(Number(e.target.value))} aria-label={t('counterLabel', { name })} style={{ width: 80 }} data-testid="counter-input" />
      <button type="button" className="btn sm" data-testid="counter-bid" onClick={() => store.showToast(act.counterBid(index, value).message)}>
        {t('counter')}
      </button>
    </span>
  )
}
