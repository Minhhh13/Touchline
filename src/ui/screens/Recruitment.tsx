import { useState } from 'react'
import { Binoculars, FileSearch, Star } from 'lucide-react'
import { useStore } from '@game/store'
import { canFullScout, focusActive, focusLabel, gradePlayer, knowledgeOf, maskedView, maxAssignments, scoutableLeagues } from '@game/logic/scouting'
import type { RecruitFocus, ScoutReport } from '@game/types'
import type { Position } from '@engine/types'
import { personalityOf } from '@game/logic/personality'
import { AttributePanel } from '../components/AttributePanel'
import { PlayerRow } from '../components/PlayerRow'
import { Bar, Info, Modal, Pos, Rating } from '../components/bits'
import { LeagueFlag } from '../components/Flag'
import { clubName, money, seasonLabel, wage } from '../format'
import { translator } from '../i18n'
import { dugout } from '../i18n/en/dugout'

const t = translator(dugout)

const POSITIONS: Position[] = ['GK', 'CB', 'LB', 'RB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST']
const AGES: Array<NonNullable<RecruitFocus['age']>> = ['u21', 'u24', 'prime', 'veteran']
const GRADE_CHIP: Record<ScoutReport['grade'], string> = { A: 'good', B: 'info', C: 'warn', D: 'bad' }

/** A knowledge level as a bar colour: the middle band for a half-known league. */
function knowledgeColour(k: number): string {
  return k >= 85 ? 'var(--good)' : k >= 50 ? 'var(--meter-mid)' : 'var(--text-3)'
}

/**
 * The Recruitment box: what the scouts look for (the focus), where they look
 * (assignments, with each league's knowledge) and whether today's full scout is
 * free. Every rule lives in `src/game/logic/scouting.ts`.
 */
export function RecruitmentPanel({ onMessage }: { onMessage: (m: string) => void }) {
  const store = useStore()
  const { universe: u, game } = store
  const [draft, setDraft] = useState<RecruitFocus>(() => game?.recruitFocus ?? {})
  if (!u || !game) return null
  const focus = game.recruitFocus
  const leagues = scoutableLeagues(game)
  const assigned = game.assignments ?? []
  const set = (patch: Partial<RecruitFocus>) => setDraft((d) => ({ ...d, ...patch }))
  return (
    <div className="panel recruit" data-testid="recruitment">
      <div className="panel-head">
        <span className="head-title">
          <h3 className="icon-title">
            <Binoculars size={18} aria-hidden="true" /> {t('recruitment')}
          </h3>
          <Info label={t('aboutRecruitment')}>{t('recruitmentInfo')}</Info>
        </span>
        <span className={`chip ${focusActive(focus) ? 'info' : ''}`} data-testid="focus-chip">
          {t(focusActive(focus) ? 'focusOn' : 'noFocus')}
        </span>
      </div>
      <div className="recruit-form">
        <label className="field">
          {t('positionField')}
          <select className="input sm" value={draft.position ?? ''} onChange={(e) => set({ position: (e.target.value || undefined) as Position | undefined })} data-testid="focus-position">
            <option value="">{t('any')}</option>
            {POSITIONS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          {t('ageField')}
          <select className="input sm" value={draft.age ?? ''} onChange={(e) => set({ age: (e.target.value || undefined) as RecruitFocus['age'] })} data-testid="focus-age">
            <option value="">{t('any')}</option>
            {AGES.map((a) => (
              <option key={a} value={a}>
                {t(`age_${a}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          {t('maxFee')}
          <input className="input sm" type="number" min={0} step={1} placeholder={t('any')} value={draft.maxFee ?? ''} onChange={(e) => set({ maxFee: e.target.value === '' ? undefined : Number(e.target.value) })} data-testid="focus-fee" />
        </label>
        <label className="field">
          {t('deal')}
          <select className="input sm" value={draft.deal ?? ''} onChange={(e) => set({ deal: (e.target.value || undefined) as RecruitFocus['deal'] })}>
            <option value="">{t('any')}</option>
            <option value="permanent">{t('permanent')}</option>
            <option value="loan">{t('loan')}</option>
          </select>
        </label>
      </div>
      <div className="row wrap" style={{ gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
        <button
          className="btn sm primary"
          data-testid="set-focus"
          onClick={() => {
            onMessage(store.setRecruitFocus(draft).message)
          }}
        >
          {t('setFocus')}
        </button>
        {focusActive(focus) && (
          <button
            className="btn sm ghost"
            onClick={() => {
              setDraft({})
              onMessage(store.setRecruitFocus(null).message)
            }}
          >
            {t('clear')}
          </button>
        )}
        <span className="small muted one-line" title={focusLabel(focus)}>{focusLabel(focus)}</span>
      </div>
      <div className="eyebrow" style={{ marginTop: 'var(--space-3)' }}>
        {t('knowledge', { n: assigned.length, max: maxAssignments(game) })}
      </div>
      <div className="knowledge-list">
        {leagues.map((id) => {
          const k = knowledgeOf(game, id)
          const on = assigned.includes(id)
          return (
            <div key={id} className="knowledge-row" data-testid={`knowledge-${id}`}>
              <span className="row" style={{ gap: 6, minWidth: 0 }}>
                <LeagueFlag leagueId={id} /> <span className="one-line">{u.leagues.find((l) => l.id === id)?.name ?? id}</span>
              </span>
              <Bar value={k} colour={knowledgeColour(k)} />
              <span className="mono small">{k}</span>
              <button type="button" className={`chip-btn ${on ? 'active' : ''}`} aria-pressed={on} onClick={() => onMessage(store.setAssignment(id, !on).message)} data-testid={`assign-${id}`} title={t(on ? 'endAssignment' : 'sendScouts')}>
                {t(on ? 'assigned' : 'assign')}
              </button>
            </div>
          )
        })}
      </div>
      <div className="small muted" style={{ marginTop: 'var(--space-2)' }} data-testid="full-scout-state">
        {t('fullScout', { state: canFullScout(game) ? (game.window ? 'freeToday' : 'freeWeek') : game.window ? 'usedToday' : 'usedWeek' })}
      </div>
    </div>
  )
}

/** The scout reports list: graded A to D on what the scouts can see, newest first. */
export function ScoutReportsPanel({ onOpen }: { onOpen: (id: string) => void }) {
  const store = useStore()
  const { universe: u, game } = store
  if (!u || !game) return null
  const reports = (game.scoutReports ?? []).filter((r) => !!u.index[r.playerSeasonId])
  return (
    <div className="panel" data-testid="scout-reports">
      <div className="panel-head">
        <span className="head-title">
          <h3 className="icon-title">
            <FileSearch size={18} aria-hidden="true" /> {t('scoutReports')}
          </h3>
          <Info label={t('aboutReports')}>{t('reportsInfo')}</Info>
        </span>
        <span className="chip">{reports.length}</span>
      </div>
      {reports.length === 0 && <div className="small muted">{t(focusActive(game.recruitFocus) ? 'reportsAfter' : 'setFocusFirst')}</div>}
      <div className="plist lined">
        {reports.map((r) => {
          const p = u.index[r.playerSeasonId]
          const view = maskedView(game, u, p)
          return (
            <PlayerRow
              key={r.playerSeasonId}
              p={p}
              showClub
              range={view.exact ? undefined : view.overall}
              onClick={() => onOpen(p.id)}
              extra={<span className="small muted one-line report-note" title={r.note}>{r.note}</span>}
              right={
                <span className="row" style={{ gap: 4 }}>
                  <span className={`chip ${GRADE_CHIP[r.grade]}`} data-testid="report-grade">
                    {r.grade}
                  </span>
                  {store.shortlist.includes(p.id) && <Star size={14} role="img" aria-label={t('onShortlist')} />}
                </span>
              }
            />
          )
        })}
      </div>
    </div>
  )
}

/**
 * A scout report on any player outside the squad: what the club can see of him
 * (ranges until he is scouted), the full scout, his grade against your starter
 * and what to do next.
 */
export function ScoutModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  const store = useStore()
  const { universe: u, game } = store
  const [msg, setMsg] = useState<string | null>(null)
  if (!u || !game || !id) return null
  const p = u.index[id]
  if (!p) return null
  const view = maskedView(game, u, p)
  const grade = gradePlayer(game, u, p)
  const listed = game.window?.listings.find((l) => l.playerSeasonId === p.id && (l.status === 'available' || l.status === 'bidding'))
  return (
    <Modal open onClose={onClose} title={p.name} testId="scout-modal">
      <div className="player-head">
        <Rating value={p.overall} size="lg" range={view.exact ? undefined : view.overall} />
        <span>
          {p.positions.map((x) => (
            <Pos key={x} p={x} />
          ))}
        </span>
        <span className="chip">{t('ageYears', { n: p.age })}</span>
        <span className="chip">
          {clubName(u, p.clubId)} {seasonLabel(p.season)}
        </span>
        <span className="chip">{money(p.value)}</span>
        <span className="chip">{wage(p.wage)}</span>
        {view.scouted && <span className="chip" title={personalityOf(p).blurb}>{personalityOf(p).label}</span>}
      </div>
      <div className="row between wrap" style={{ gap: 'var(--space-2)', margin: 'var(--space-2) 0' }}>
        <span className="small">
          <span className={`chip ${GRADE_CHIP[grade.grade]}`}>{t('grade', { g: grade.grade })}</span> {grade.note}
        </span>
        <span className="small muted">{view.exact ? t(view.scouted ? 'fullyScouted' : 'knownExactly') : t('knowledgeRange', { k: view.knowledge, n: Math.ceil((view.overall.hi - view.overall.lo) / 2) })}</span>
      </div>
      <AttributePanel p={p} view={view} />
      {view.scouted && (view.pros.length > 0 || view.cons.length > 0) && (
        <div className="row wrap" style={{ gap: 'var(--space-1)', marginTop: 'var(--space-3)' }} data-testid="scout-traits">
          {view.pros.map((t) => (
            <span key={t} className="chip good">
              {t}
            </span>
          ))}
          {view.cons.map((t) => (
            <span key={t} className="chip warn">
              {t}
            </span>
          ))}
        </div>
      )}
      {msg && <div className="notice" style={{ marginTop: 'var(--space-3)' }}>{msg}</div>}
      <div className="row wrap" style={{ gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
        {!view.exact && (
          <button className="btn sm primary" data-testid="full-scout" disabled={!canFullScout(game)} title={t(canFullScout(game) ? 'revealTip' : game.window ? 'oneDay' : 'oneWeek')} onClick={() => setMsg(store.scoutPlayer(p.id).message)}>
            {t('scoutHim')}
          </button>
        )}
        <button className="btn sm" onClick={() => store.toggleShortlist(p.id)}>
          <Star size={14} aria-hidden="true" /> {t(store.shortlist.includes(p.id) ? 'removeShortlist' : 'shortlist')}
        </button>
        {game.window && !listed && (
          <button className="btn sm" onClick={() => setMsg(store.enquire(p.id).message)}>
            {t('enquire')}
          </button>
        )}
        {listed && <span className="small muted">{t('onMarket', { m: money(listed.asking) })}</span>}
        {(game.scoutReports ?? []).some((r) => r.playerSeasonId === p.id) && (
          <button
            className="btn sm ghost"
            onClick={() => {
              store.dismissReport(p.id)
              onClose()
            }}
          >
            {t('dismissReport')}
          </button>
        )}
      </div>
    </Modal>
  )
}
