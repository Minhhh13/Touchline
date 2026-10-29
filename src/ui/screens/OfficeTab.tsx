import { useState, type ReactNode } from 'react'
import { Briefcase, Handshake, MessageCircle, Mic, Newspaper, ScrollText, Users } from 'lucide-react'
import { officeActions as act } from '@game/officeActions'
import type { Game, OfficePromise, TransferRequest } from '@game/types'
import type { LoadedUniverse } from '@engine/universe'
import { EXPECTED_SHARE, STATUSES, type SquadStatus } from '@engine/status'
import type { Boxes } from '../components/Boxes'
import { playerLookup } from '@game/logic/players'
import { officeItems } from '@game/logic/office'
import { openRequests, restlessPlayers } from '@game/logic/transferRequests'
import { conversationProblem, TOPIC_TONES, type ConversationTopic, type ConversationTone } from '@game/logic/conversations'
import { bigMatchOf, BOAST_ANSWER, BOAST_LOST, BOAST_WON, pressAnswers, pressEffect, pressProblem, pressQuestions, pressSubject, PRESS_ANSWERS, type PressEffect, type PressQuestion } from '@game/logic/pressConference'
import { feeTalkOf, MAX_FEE_ROUNDS, MAX_TERMS_OFFERS, openingStatus, paymentPlan, sellTalkOf, termsDemand, type Instalments } from '@game/logic/transferTalks'
import { squadIdOf } from '@game/logic/officeCore'
import { CONTRACT_WEEKS } from '@game/logic/promises'
import { boardMood, minutesTerms, playerRead, promiseClocks, promisesTo, requestDeadline, requestRisks, type AnswerRisk, type PromiseClock } from '@game/logic/officeView'
import { personalityOf } from '@game/logic/personality'
import { pickVariant } from '@game/logic/flavour'
import type { StopReason } from '@game/logic/seasonHighlights'
import { nextOpponent, recentShare } from '@game/logic/week'
import { Bar, Info, Modal, Rating, Tip } from '../components/bits'
import { onRadioGroupKey, radioTabIndex } from '../a11y'
import { moraleClass, signed } from '../components/Happiness'
import { clubName, meterValue, money, moraleWord, wage } from '../format'
import { rich } from '../i18n/rich'
import { translator } from '../i18n'
import { office } from '../i18n/en/office'
import { useStorePick } from '../useStorePick'
import { statusLabel } from '../i18n/engineText'
import { logicLine } from '../i18n/logicText'

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
  const requests = game.office?.requests ?? {}
  return (
    <>
    {/* The Office's tip where its first item lands, in the Inbox, as well as on its own tab */}
    <Tip id="office-first">{t('officeTip')}</Tip>
    <div className="needs-you" data-testid="office-inbox">
      <span className="needs-you-label">{t('inboxNeeds')}</span>
      {items.slice(0, 3).map((it, i) => {
        const req = it.kind === 'request' ? Object.values(requests).find((r) => r.name === it.name && r.stage === 'open') : undefined
        const label = it.kind === 'request' ? (req ? t('inboxRequestDue', { name: it.name ?? '', n: requestDeadline(req).weeksLeft }) : t('inboxRequest', { name: it.name ?? '' })) : it.kind === 'terms' ? t('inboxTerms', { name: it.name ?? '' }) : t('inboxPromise', { name: it.name ?? '', weeks: it.weeks ?? 0 })
        const urgent = (it.kind === 'promise' && (it.weeks ?? 0) <= 1) || (req && requestDeadline(req).weeksLeft <= 1)
        return (
          <button key={i} type="button" className={`btn sm ${urgent ? 'urgent' : ''}`} onClick={onOpen} data-testid="office-inbox-item">
            {label}
          </button>
        )
      })}
    </div>
    </>
  )
}

/** The Office tab: player requests and promises, conversations and the press, transfer talks and squad status. */
export function OfficeTab({ onPlayer, boxes }: { onPlayer: (id: string) => void; boxes?: Boxes }) {
  const { universe: u, game } = useStorePick('universe', 'game')
  if (!u || !game) return null
  const on = (id: string) => boxes?.on(id) ?? true
  const grid = boxes?.grid([{ track: 'minmax(0, 1fr)', ids: ['requests', 'promises'] }, { track: 'minmax(0, 1fr)', ids: ['talks', 'press'] }, { track: 'minmax(0, 1fr)', ids: ['transfers', 'status'] }]) ?? { className: '', style: undefined }
  return (
    <div className={`grid three fill squad-views office-grid ${grid.className}`} style={grid.style} data-testid="office">
      {(on('requests') || on('promises')) && (
        <div className="col">
          {on('requests') && <RequestsBox game={game} u={u} onPlayer={onPlayer} />}
          {on('promises') && <PromisesBox game={game} u={u} onPlayer={onPlayer} />}
        </div>
      )}
      {(on('talks') || on('press')) && (
        <div className="col">
          {on('talks') && <TalkBox game={game} u={u} />}
          {on('press') && <PressBox game={game} u={u} />}
        </div>
      )}
      {(on('transfers') || on('status')) && (
        <div className="col">
          {on('transfers') && <TransfersBox game={game} />}
          {on('status') && <StatusBox game={game} u={u} onPlayer={onPlayer} />}
        </div>
      )}
    </div>
  )
}

type BoxProps = { game: Game; u: LoadedUniverse }

/** A box's own answer line: what the last choice in it did, next to where it was made (a phone keeps it in view). */
function useNote(): [string | null, (m: string) => void] {
  return useState<string | null>(null)
}

function Note({ text, testId }: { text: string | null; testId: string }) {
  return (
    <div className="office-note" role="status" data-testid={testId}>
      {text}
    </div>
  )
}

/** A signed morale or confidence change as a chip: green up, red down. */
function Delta({ label, d }: { label: string; d: number }) {
  return <span className={`office-fx ${d > 0 ? 'up' : d < 0 ? 'down' : ''}`}>{label}</span>
}

function RequestsBox({ game, u, onPlayer }: BoxProps & { onPlayer: (id: string) => void }) {
  const { setPlayerPower } = useStorePick('setPlayerPower')
  const [note, say] = useNote()
  const get = playerLookup(game, u)
  const open = openRequests(game)
  const settled = Object.values(game.office?.requests ?? {}).filter((r) => r.stage !== 'open' && r.year === game.year)
  const restless = restlessPlayers(game, u).filter((x) => !open.some((r) => r.playerId === get(x.id)?.playerId)).slice(0, 5)
  const week = game.season?.matchweek ?? 0
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
            <input type="checkbox" checked={!!game.settings.playerPower} onChange={(e) => setPlayerPower(e.target.checked)} data-testid="player-power" />
            {t('playerPower')}
          </label>
          <Info label={t('playerPower')}>{t('playerPowerInfo')}</Info>
        </span>
      </div>
      <Note text={note} testId="office-msg" />
      {open.length === 0 && <div className="small muted">{t('noRequests')}</div>}
      <div className="col" style={{ gap: 'var(--space-2)' }}>
        {open.map((r) => {
          const id = squadIdOf(game, u, r.playerId)
          if (!id) return null
          return <RequestCard key={r.playerId} game={game} u={u} id={id} req={r} week={week} onPlayer={onPlayer} say={say} />
        })}
      </div>
      {settled.length > 0 && (
        <ul className="small muted office-settled">
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
              <span className="small muted one-line">{pressure.parts.map((x) => t(`reason_${x.reason}`)).join(' · ')}</span>
            </span>
            <span className={`chip ${moraleClass(game.squad[id]?.morale ?? 70)}`}>{meterValue(game.squad[id]?.morale ?? 70)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function answerLabel(a: AnswerRisk['answer']): string {
  return a === 'talk' ? t('answerTalk') : a === 'promise-minutes' ? t('answerPromiseMinutes') : a === 'promise-contract' ? t('answerPromiseContract') : a === 'list' ? t('answerList') : t('answerRefuse')
}

/** What an answer risks, in one line: the odds, his morale either way, the promise it makes and who else feels it. */
function riskLine(game: Game, r: AnswerRisk): string {
  if (r.answer === 'list') return t('riskList', { d: signed(r.win ?? 0) })
  if (r.answer === 'refuse') {
    const parts = [t('riskRefuse', { d: signed(r.lose ?? 0) })]
    if (r.ripple) parts.push(r.ripple.squadWide ? t('riskRippleSquad', { n: r.ripple.men }) : t('riskRippleGroup', { n: r.ripple.men, d: signed(r.ripple.each) }))
    return parts.join(' · ')
  }
  const parts = [t('riskOdds', { pct: Math.round((r.odds ?? 0) * 100) }), t('riskWorks', { d: signed(r.win ?? 0) }), t('riskFails', { d: signed(r.lose ?? 0) })]
  if (r.promise === 'minutes') {
    const m = minutesTerms(game)
    parts.push(t('riskPromiseMinutes', { pct: m.pct, weeks: m.weeks, d: signed(r.promiseLift ?? 0) }))
  } else if (r.promise === 'contract') parts.push(t('riskPromiseContract', { weeks: CONTRACT_WEEKS, d: signed(r.promiseLift ?? 0) }))
  return parts.join(' · ')
}

function RequestCard({ game, u, id, req, week, onPlayer, say }: BoxProps & { id: string; req: TransferRequest; week: number; onPlayer: (id: string) => void; say: (m: string) => void }) {
  const risks = requestRisks(game, u, id, req)
  const deadline = requestDeadline(req)
  return (
    <div className="card office-request" data-testid="office-request">
      <div className="row between wrap">
        <button type="button" className="link-btn" onClick={() => onPlayer(id)}>
          {rich(t('requestFrom', { name: req.name }), { b: B })}
        </button>
        <span className="small muted">{t('waitingWeeks', { n: Math.max(0, week - req.at) })}</span>
      </div>
      <div className="small muted">{t(`reason_${req.reason}`)}</div>
      <div className={`small office-deadline ${deadline.weeksLeft <= 1 ? 'due' : ''}`} data-testid="request-deadline">
        {t('deadline', { n: deadline.weeksLeft, cost: signed(deadline.cost) })}
      </div>
      <PlayerView game={game} u={u} id={id} />
      <ul className="office-choices" aria-label={t('requests')}>
        {risks.map((r) => (
          <li key={r.answer} className="office-choice">
            <button type="button" className={`btn sm ${r.answer === 'refuse' ? 'ghost' : ''}`} disabled={!!r.problem} data-testid={`request-${r.answer}`} onClick={() => say(act.answerRequest(id, r.answer).message)}>
              {answerLabel(r.answer)}
            </button>
            <span className="small muted" data-testid={`risk-${r.answer}`}>
              {r.problem ? logicLine(r.problem) : riskLine(game, r)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** What he thinks: his morale, how he takes a hard word, his agent and whether he believes a promise. */
function PlayerView({ game, u, id }: BoxProps & { id: string }) {
  const read = playerRead(game, u, id)
  const p = playerLookup(game, u)(id)
  if (!read || !p) return null
  const persona = personalityOf(p)
  const skin = read.skin >= 0.5 ? t('viewSkin_well') : read.skin <= -0.5 ? t('viewSkin_badly') : t('viewSkin_even')
  const promised = promisesTo(game, u, id).filter((x) => x.state === 'open')
  return (
    <div className="office-view" role="group" aria-label={t('hisView')} data-testid="player-view">
      <span className="eyebrow">{t('hisView')}</span>
      <span className="row wrap" style={{ gap: 4 }}>
        <span className={`chip ${moraleClass(read.morale)}`}>{t('viewMorale', { word: moraleWord(read.morale) })}</span>
        <span className="chip" title={logicLine(persona.blurb)}>{logicLine(persona.label)}</span>
        <span className="chip muted">{skin}</span>
        <span className={`chip ${read.agent === 'greedy' ? 'warn' : read.agent === 'loyal' ? 'good' : ''}`} title={t(`agentHelp_${read.agent}`)} data-testid="view-agent">
          {t('viewAgent', { mood: t(`mood_${read.agent}`) })}
        </span>
        <span className={`chip ${read.trust === 'wary' ? 'bad' : read.trust === 'trusts' ? 'good' : 'muted'}`} title={t('viewTrustInfo')} data-testid="view-trust">
          {read.trust === 'wary' ? t('viewTrust_wary', { n: read.broken }) : t(`viewTrust_${read.trust}`)}
        </span>
      </span>
      {read.restless && <span className="small muted">{t('viewRestless', { why: t(`reason_${read.restless}`) })}</span>}
      {promised.length > 0 && (
        <span className="small muted">
          {t('promisedTo')}: {promised.map((x) => t(`promiseKind_${x.kind}`)).join(', ')}
        </span>
      )}
    </div>
  )
}

const URGENCY_CHIP = { due: 'bad', soon: 'warn', calm: 'info' } as const

/** One promise's clock and where it stands, in words. */
function clockText(c: PromiseClock): string {
  const pct = (v: number | undefined) => Math.round((v ?? 0) * 100)
  if (c.promise.kind === 'minutes') {
    if (c.track === 'lost') return t('track_lost', { got: pct(c.share), want: pct(c.target) })
    if (c.track === 'behind') return t('track_behind', { got: pct(c.share), want: pct(c.target), need: c.needPerMatch ?? 0 })
    return c.share === undefined ? t('track_onStart', { want: pct(c.target) }) : t('track_on', { got: pct(c.share), want: pct(c.target) })
  }
  if (c.promise.kind === 'contract') return t('track_contract')
  return t('track_signing', { pos: c.promise.position ?? '', n: c.promise.overall ?? 0 })
}

function PromisesBox({ game, u, onPlayer }: BoxProps & { onPlayer: (id: string) => void }) {
  const rows = promiseClocks(game, u)
  const done = (game.office?.promises ?? []).filter((p) => p.state !== 'open' && p.year === game.year).slice(-4).reverse()
  const stakes = playerRead(game, u, Object.keys(game.squad)[0] ?? '')?.stakes
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
        {rows.map((c) => {
          const id = squadIdOf(game, u, c.promise.playerId)
          const tone = c.track === 'lost' ? 'var(--bad)' : c.track === 'behind' ? 'var(--meter-mid)' : 'var(--good)'
          return (
            <div key={`${c.promise.kind}-${c.promise.playerId}`} className={`card office-promise ${c.urgency}`} data-testid="office-promise">
              <div className="row between wrap" style={{ gap: 4 }}>
                <button type="button" className="link-btn" onClick={() => id && onPlayer(id)}>
                  <b>{c.promise.name}</b>
                </button>
                <span className="row" style={{ gap: 4 }}>
                  <span className="chip">{t(`promiseKind_${c.promise.kind}`)}</span>
                  <span className={`chip ${URGENCY_CHIP[c.urgency]}`} data-testid="promise-clock">
                    {c.weeksLeft === null ? t(c.promise.windowSeen ? 'untilWindow' : 'untilNextWindow') : t('weeksLeft', { n: c.weeksLeft })}
                  </span>
                </span>
              </div>
              <div className={`small ${c.track === 'lost' ? 'res-l' : 'muted'}`} data-testid="promise-track">
                {clockText(c)}
              </div>
              <Bar value={c.progress * 100} colour={tone} />
            </div>
          )
        })}
      </div>
      {rows.length > 0 && stakes && <div className="small muted office-stakes">{t('stakes', { kept: signed(stakes.kept), broken: signed(stakes.broken), ripple: signed(stakes.ripple) })}</div>}
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

function TalkBox({ game, u }: BoxProps) {
  const get = playerLookup(game, u)
  const ids = Object.keys(game.squad).sort((a, b) => (get(a)?.name ?? a).localeCompare(get(b)?.name ?? b))
  const [who, setWho] = useState<string>('')
  const [topic, setTopic] = useState<ConversationTopic>('form')
  const [note, say] = useNote()
  const id = who && game.squad[who] ? who : ids[0]
  const problem = id ? conversationProblem(game, u, id) : null
  const topics = Object.keys(TOPIC_TONES) as ConversationTopic[]
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
      {id && <PlayerView game={game} u={u} id={id} />}
      <div className="segmented" style={{ margin: 'var(--space-2) 0' }} role="radiogroup" aria-label={t('talks')} onKeyDown={onRadioGroupKey}>
        {topics.map((tp, i) => (
          <button key={tp} type="button" role="radio" aria-checked={topic === tp} tabIndex={radioTabIndex(i, topics.indexOf(topic))} className={topic === tp ? 'active' : ''} onClick={() => setTopic(tp)} data-testid={`talk-topic-${tp}`}>
            {t(`topic_${tp}`)}
          </button>
        ))}
      </div>
      {problem && <div className="small muted">{t('spokenThisWeek')}</div>}
      <ul className="office-choices">
        {TOPIC_TONES[topic].map((tone: ConversationTone) => (
          <li key={tone} className="office-choice">
            <button type="button" className="btn sm" disabled={!id || !!problem} data-testid={`talk-tone-${tone}`} onClick={() => id && say(act.converse(id, topic, tone).message)}>
              {t(`tone_${tone}`)}
            </button>
            <span className="small muted">{t(`toneHint_${tone}`)}</span>
          </li>
        ))}
      </ul>
      <Note text={note} testId="talk-msg" />
    </div>
  )
}

const BIG_KINDS: ReadonlyArray<StopReason['kind']> = ['derby', 'title-decider', 'title-run-in', 'survival-run-in', 'brief', 'final', 'semi-final']

/** The press's line on the week's big match: one of two for its kind, picked by a hash of the week (display only). */
function pressLine(game: Game, u: LoadedUniverse, stop: StopReason): string | null {
  if (!BIG_KINDS.includes(stop.kind)) return null
  const n = pickVariant([0, 1] as const, `press-line|${game.id}|${game.year}|${stop.matchweek}`)
  return t(`line_${stop.kind}_${n}` as 'line_derby_0', { club: stop.opponentClubId ? clubName(u, stop.opponentClubId) : '' })
}

/** An answer's effect as chips: the squad, the man asked about and the board. */
function effectChips(fx: PressEffect | null, name: string): Array<{ label: string; d: number }> {
  if (!fx) return []
  const out: Array<{ label: string; d: number }> = []
  if (fx.team) out.push({ label: t('fxSquad', { d: signed(fx.team) }), d: fx.team })
  if (fx.player && name) out.push({ label: t('fxPlayer', { name, d: signed(fx.player) }), d: fx.player })
  if (fx.board) out.push({ label: t('fxBoard', { d: signed(fx.board) }), d: fx.board })
  return out.length ? out : [{ label: t('fxNone'), d: 0 }]
}

function PressBox({ game, u }: BoxProps) {
  const [note, say] = useNote()
  const problem = pressProblem(game)
  const qs = problem ? [] : pressQuestions(game, u)
  const given = pressAnswers(game)
  const get = playerLookup(game, u)
  const nextClub = nextOpponent(game)?.clubId ?? null
  const big = problem ? null : bigMatchOf(game, u)
  const line = big ? pressLine(game, u, big) : null
  const confidence = Math.round(game.season?.confidence ?? 0)
  const boast = game.office?.boast && game.office.boast.year === game.year ? game.office.boast : null
  return (
    <div className="panel" data-testid="office-press">
      <div className="panel-head">
        <span className="head-title">
          <h3 className="icon-title">
            <Mic size={18} aria-hidden="true" /> {t('press')}
          </h3>
          <Info label={t('press')}>{t('pressInfo')}</Info>
        </span>
        {game.season && (
          <span className={`chip ${confidence < 25 ? 'bad' : confidence < 45 ? 'warn' : 'muted'}`} data-testid="board-view">
            {t('boardView', { mood: t(`boardMood_${boardMood(confidence)}`) })} · {t('boardConfidence', { n: confidence })}
          </span>
        )}
      </div>
      {line && (
        <div className="office-headline" data-testid="press-line">
          <Newspaper size={16} aria-hidden="true" />
          <span>
            <span className="eyebrow">{t('pressLine')}</span>
            <span className="office-headline-text">{line}</span>
          </span>
        </div>
      )}
      {boast && <div className="small office-boast" data-testid="press-boast">{t('boastOpen', { team: signed(BOAST_WON.team), won: signed(BOAST_WON.board), lost: signed(BOAST_LOST.board) })}</div>}
      {qs.length === 0 && <div className="small muted">{t('noPress')}</div>}
      <div className="col" style={{ gap: 'var(--space-2)' }}>
        {qs.map((q: PressQuestion) => {
          const subject = pressSubject(game, u, q)
          const name = subject ? get(subject)?.name ?? '' : ''
          const club = big?.opponentClubId ? clubName(u, big.opponentClubId) : nextClub ? clubName(u, nextClub) : ''
          const question =
            q === 'opponent' ? (nextClub ? t('q_opponent', { club: clubName(u, nextClub) }) : t('q_opponentAny'))
            : q === 'wantaway' ? t('q_wantaway', { name })
            : q === 'prospect' ? t('q_prospect', { name })
            : q === 'big-match' ? t('q_big-match', { label: big?.label ?? '', club })
            : q === 'big-tie' ? t('q_big-tie', { label: big?.label ?? '', club })
            : t(`q_${q}`)
          const chosen = given[q]
          return (
            <div key={q} className="card" data-testid="press-question">
              <div>
                <b>{question}</b>
              </div>
              <ul className="office-choices">
                {Object.keys(PRESS_ANSWERS[q]).map((a) => {
                  const chips = effectChips(pressEffect(game, u, q, a), name)
                  return (
                    <li key={a} className="office-choice">
                      <button type="button" className={`btn sm press-answer ${chosen === a ? 'primary' : ''}`} disabled={!!chosen} aria-pressed={chosen === a} data-testid="press-answer" onClick={() => say(act.answerPress(q, a).message)}>
                        {t(`a_${a}` as 'a_respect')}
                      </button>
                      <span className="row wrap" style={{ gap: 4 }} data-testid="press-effect">
                        {chips.map((c) => (
                          <Delta key={c.label} label={c.label} d={c.d} />
                        ))}
                        {q === 'big-match' && a === BOAST_ANSWER && <span className="small muted">{t('fxBoast', { won: signed(BOAST_WON.board), lost: signed(BOAST_LOST.board) })}</span>}
                      </span>
                    </li>
                  )
                })}
              </ul>
              {chosen && <div className="small muted">{t('answered')}</div>}
            </div>
          )
        })}
      </div>
      <Note text={note} testId="press-msg" />
    </div>
  )
}

function TransfersBox({ game }: { game: Game }) {
  const [note, say] = useNote()
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
      <Note text={note} testId="transfers-msg" />
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

function StatusBox({ game, u, onPlayer }: BoxProps & { onPlayer: (id: string) => void }) {
  const [note, say] = useNote()
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
      <Note text={note} testId="status-msg" />
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
                  {statusLabel(status)} · {t('expects', { pct: Math.round(EXPECTED_SHARE[status] * 100) })}
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

/** The promises made to a player, for the player card's Happiness view: open ones with their clock, then the settled. */
export function PromisesToHim({ id }: { id: string }) {
  const { universe: u, game } = useStorePick('universe', 'game')
  if (!u || !game) return null
  const list = promisesTo(game, u, id)
  if (!list.length) return null
  const clocks = new Map(promiseClocks(game, u).map((c) => [`${c.promise.kind}|${c.promise.playerId}`, c]))
  return (
    <div className="office-promised" data-testid="promises-to-him">
      <span className="eyebrow">{t('promisedTo')}</span>
      <ul className="small">
        {list.map((p: OfficePromise) => {
          const c = p.state === 'open' ? clocks.get(`${p.kind}|${p.playerId}`) : undefined
          return (
            <li key={`${p.kind}-${p.madeAt}`} className="row between">
              <span>{t(`promiseKind_${p.kind}`)}</span>
              {p.state === 'open' ? (
                <span className={`chip ${c ? URGENCY_CHIP[c.urgency] : 'info'}`}>{c && c.weeksLeft !== null ? t('weeksLeft', { n: c.weeksLeft }) : t('untilWindow')}</span>
              ) : (
                <span className={`chip ${p.state === 'kept' ? 'good' : 'bad'}`}>{t(p.state === 'kept' ? 'kept' : 'broken')}</span>
              )}
            </li>
          )
        })}
      </ul>
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
                  {x ? t('sellOnPct', { pct: Math.round(x * 100) }) : t('sellOnNone')}
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
          <div className="small" data-testid="fee-rounds">
            {talk?.counter !== undefined ? `${t('theyWant', { m: money(talk.counter) })} · ` : ''}
            {t('roundsLeft', { n: MAX_FEE_ROUNDS - (talk?.rounds ?? 0) })}
          </div>
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
            <div className="small muted" data-testid="terms-demand">
              {t('heAsks', { w: demand.wage, fee: money(demand.agentFee) })}
            </div>
          )}
          {demand && (
            <div className="row wrap small" style={{ gap: 4 }}>
              <span className={`chip ${demand.mood === 'greedy' ? 'warn' : demand.mood === 'loyal' ? 'good' : ''}`} data-testid="terms-agent">
                {t('agentMood', { mood: t(`mood_${demand.mood}`) })}
              </span>
              <span className="muted">{t(`agentHelp_${demand.mood}`)}</span>
            </div>
          )}
          <div className="small" data-testid="terms-left">
            {t('offersLeft', { n: MAX_TERMS_OFFERS - (talk?.termsFailed ?? 0) })}
          </div>
          <div className="row wrap" style={{ gap: 4 }}>
            <input className="input" type="number" min={1} step={5} value={wageNow} onChange={(e) => setTerms({ ...terms, wage: Number(e.target.value) })} aria-label={t('wage')} title={t('wage')} data-testid="terms-wage" style={{ width: 90 }} />
            <select className="input" value={yearsNow} onChange={(e) => setTerms({ ...terms, years: Number(e.target.value) })} aria-label={t('years')} title={t('years')}>
              {[1, 2, 3, 4, 5].filter((y) => y <= (demand?.maxYears ?? 5)).map((y) => (
                <option key={y} value={y}>
                  {t('yearsN', { n: y })}
                </option>
              ))}
            </select>
            <select className="input" value={st} onChange={(e) => setStatus(e.target.value as SquadStatus)} aria-label={t('status')} title={t('status')} data-testid="terms-status">
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
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
  const { game, showToast } = useStorePick('game', 'showToast')
  const o = game?.window?.offers[index]
  const [ask, setAsk] = useState<number | null>(null)
  if (!game || !o) return null
  const final = sellTalkOf(game, o)?.final
  if (final !== undefined) return <span className="chip warn">{t('theirFinal')}</span>
  const value = ask ?? Math.round(o.amount * 1.2 * 10) / 10
  return (
    <span className="row" style={{ gap: 4 }}>
      <input className="input" type="number" min={0.1} step={0.5} value={value} onChange={(e) => setAsk(Number(e.target.value))} aria-label={t('counterLabel', { name })} style={{ width: 80 }} data-testid="counter-input" />
      <button type="button" className="btn sm" data-testid="counter-bid" onClick={() => showToast(act.counterBid(index, value).message)}>
        {t('counter')}
      </button>
    </span>
  )
}
