/**
 * The widgets that read the match feed itself: match events, the full
 * commentary, match stats, the momentum chart, the dugout, and the
 * commentary banner across the dashboard.
 */
import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { benchAt, managerWindowsUsed, MAX_SUBS, MAX_WINDOWS, subsMade } from '@engine/match'
import { MOMENTUM_BINS } from '@engine/matchDetail'
import { statsAt } from '@engine/matchStats'
import { isAvailable } from '@game/logic/players'
import { minuteLabel } from '../../format'
import { latestLine, type CommentaryLine } from '../../match/commentary'
import { momentumScale } from '../../match/charts'
import { surname } from '../../match/shirts'
import { assistantCheckpoint, assistantLine } from '../../match/assistant'
import { ChangeIcon, EventIcon, SubIcon } from '../icons'
import { keyItems, momentumSpells, statRows } from '../model'
import type { PanelProps } from '../types'
import { Empty, Swatch, TeamCode } from './bits'
import { translator } from '../../i18n'
import { match } from '../../i18n/en/match'
import { rich } from '../../i18n/rich'
import { changeLineText, commentaryLineText, commentaryPiece, eventLine } from '../../i18n/commentaryText'
import { useSayOnce } from '../../liveOnce'

const tx = translator(match)

const MONO = { b: (c: ReactNode) => <b className="mono">{c}</b> }

/** Key events to the clock, home on the left and away on the right, newest at the bottom. */
export function MatchEvents({ d }: PanelProps) {
  const items = useMemo(() => keyItems(d.feed, d.minute), [d.feed, d.minute])
  const ref = useAutoScroll(items.length)
  if (!items.length) return <Empty>{tx('eventsEmpty')}</Empty>
  return (
    <ol className="md-events" ref={ref}>
      {items.map((it, i) => {
        if (it.kind === 'change') {
          const team = it.entry.side === 'home' ? d.home.code : d.away.code
          return (
            <li key={`c${i}`} className={`md-ev change ${it.entry.side}`}>
              <span className="min mono">{minuteLabel(it.minute)}</span>
              <ChangeIcon />
              <span className="txt">{changeLineText(it.entry, team) ?? tx('teamChange', { team })}</span>
            </li>
          )
        }
        const e = it.event
        const whistle = e.type === 'half_time' || e.type === 'full_time'
        const sub = e.type === 'substitution'
        const who = sub ? tx('subFor', { on: surname(e.secondaryName ?? (e.secondaryId ? d.getName(e.secondaryId) : undefined)), off: surname(e.playerName) }) : e.playerName ? `${e.playerName}${e.type === 'penalty' ? tx('penMark') : e.type === 'own_goal' ? tx('ogMark') : ''}${e.type === 'goal' && e.secondaryName ? ` (${e.secondaryName})` : ''}` : eventLine(e.text)
        return (
          <li key={`e${i}`} className={`md-ev ${whistle ? 'whistle' : e.side} ${e.type}`}>
            <span className="min mono">{whistle ? '' : minuteLabel(e.minute)}</span>
            <EventIcon type={e.type} />
            <span className="txt">{whistle ? eventLine(e.text) : who}</span>
          </li>
        )
      })}
    </ol>
  )
}

/** The full commentary to the clock, newest at the bottom. */
export function CommentaryList({ d }: PanelProps) {
  const lines = useMemo(() => d.commentary.filter((l) => l.minute <= d.minute), [d.commentary, d.minute])
  const ref = useAutoScroll(lines.length)
  return (
    <ol className="md-commentary" ref={ref}>
      {lines.map((l, i) => (
        <li key={i} className={`md-line ${l.kind} ${l.side ?? ''}`}>
          <span className="min mono">{l.minute > 0 ? minuteLabel(l.minute) : ''}</span>
          <span className="txt">{commentaryLineText(l)}</span>
        </li>
      ))}
    </ol>
  )
}

/** Keeps a list scrolled to its newest line as lines arrive. */
function useAutoScroll(n: number) {
  const ref = useRef<HTMLOListElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [n])
  return ref
}

/** The full two-column stats table at the clock. */
export function MatchStats({ d }: PanelProps) {
  const at = statsAt(d.series, d.minute)
  return (
    <div className="md-stats-table">
      <div className="md-stats-head">
        <TeamCode view={d.home} />
        <span className="muted small">{tx('statsAt', { at: d.minute <= 0 ? tx('kickOff') : minuteLabel(d.minute) })}</span>
        <TeamCode view={d.away} />
      </div>
      {statRows(at.home, at.away).map((r) => (
        <div key={r.label} className="md-stat-row">
          <span className="mono h">{r.home}</span>
          <div className="mid">
            <span className="lbl">{r.label}</span>
            <span className="md-share" aria-hidden>
              <span style={{ width: `${r.share * 100}%`, background: d.home.colour }} />
              <span style={{ width: `${(1 - r.share) * 100}%`, background: d.away.colour }} />
            </span>
          </div>
          <span className="mono a">{r.away}</span>
        </div>
      ))}
    </div>
  )
}

/** A larger momentum chart with the spells named (its own testid: the strip keeps `momentum-bar`). */
export function MomentumWidget({ d }: PanelProps) {
  const W = 360
  const H = 110
  const mid = 52
  const x0 = 30
  const step = (W - x0 - 4) / MOMENTUM_BINS
  const bw = step * 0.84
  const amp = 40
  const m = d.feed.momentum
  const spells = momentumSpells(m, d.minute)
  // Scaled to the biggest swing so far; the gutter says what a full bar means
  const scale = momentumScale(m, d.minute)
  const top = Math.round((0.5 + scale) * 100)
  return (
    <div className="md-momentum" data-testid="momentum-widget">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={tx('momentumLabel')}>
        <line x1={x0} y1={mid - amp} x2={W - 4} y2={mid - amp} stroke="var(--line)" strokeDasharray="1 3" />
        <line x1={x0} y1={mid + amp} x2={W - 4} y2={mid + amp} stroke="var(--line)" strokeDasharray="1 3" />
        <line x1={x0} y1={mid} x2={W - 4} y2={mid} stroke="var(--line-2)" />
        {[
          [mid - amp, `${top}%`],
          [mid, '50'],
          [mid + amp, `${top}%`],
        ].map(([y, t]) => (
          <text key={String(y)} x={x0 - 4} y={Number(y) + 3} fontSize="8" fill="var(--text-2)" textAnchor="end">
            {t}
          </text>
        ))}
        <line x1={x0 + 9 * step - 1} y1={4} x2={x0 + 9 * step - 1} y2={H - 14} stroke="var(--text-3)" strokeDasharray="2 2" />
        {m.slice(0, MOMENTUM_BINS).map((v, i) => {
          const frac = Math.max(0, Math.min(1, (d.minute - i * 5) / 5))
          if (frac <= 0) return null
          const h = Math.max(-1, Math.min(1, (v - 0.5) / scale)) * amp * frac
          return (
            <rect key={i} x={x0 + i * step} y={h >= 0 ? mid - h : mid} width={bw} height={Math.max(0.5, Math.abs(h))} rx="2" fill={h >= 0 ? d.home.colour : d.away.colour} stroke="var(--text-2)" strokeWidth="0.6" strokeOpacity="0.6">
              <title>{`${i * 5 + 1}-${i * 5 + 5}': ${h >= 0 ? d.home.code : d.away.code} ${Math.round((h >= 0 ? v : 1 - v) * 100)}%`}</title>
            </rect>
          )
        })}
        {[0, 45, 90].map((x) => (
          <text key={x} x={x0 + (x / 5) * step} y={H - 3} fontSize="8" fill="var(--text-3)" textAnchor={x === 0 ? 'start' : x === 90 ? 'end' : 'middle'}>
            {x === 0 ? "0'" : x === 45 ? tx('ht') : "90'"}
          </text>
        ))}
      </svg>
      <ul className="md-spells small">
        {spells.length === 0 && <li className="muted">{tx('noSpell')}</li>}
        {spells.map((s, i) => (
          <li key={i}>
            <Swatch colour={s.side === 'home' ? d.home.colour : d.away.colour} /> {tx('onTop', { code: s.side === 'home' ? d.home.code : d.away.code, from: s.from, to: s.to })} <span className="muted">({Math.round(s.strength * 100)}%)</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Our dugout: the bench, the changes made, the counters, the talk and the shout as they landed, the assistant's notes. */
export function Dugout({ d }: PanelProps) {
  const side = d.userSide ?? 'home'
  const fs = side === 'home' ? d.feed.home : d.feed.away
  const subs = fs.subs.filter((s) => s.minute <= d.minute)
  const mp = d.live?.mp
  const available = mp ? benchAt(mp, side, Math.max(0, d.minute), (id) => d.game.squad[id]) : []
  const appeared = new Set(fs.appearances.filter((a) => a.onAt > 0 && a.onAt <= d.minute).map((a) => a.psId))
  const unavailable = fs.bench.filter((id) => !available.includes(id) && !appeared.has(id) && !isAvailable(d.game.squad[id]))
  const made = mp ? subsMade(mp, side, d.minute) : subs.length
  const windows = mp ? managerWindowsUsed(mp, side) : 0
  const name = (id: string) => d.getName(id) ?? id
  return (
    <div className="md-dugout small">
      <div className="md-counters">
        <span>
          {rich(tx('dugoutSubs', { n: MAX_SUBS - made, max: MAX_SUBS }), MONO)}
        </span>
        {mp && (
          <span>
            {rich(tx('dugoutStoppages', { n: MAX_WINDOWS - windows, max: MAX_WINDOWS }), MONO)}
          </span>
        )}
        {mp && d.hand?.editable && (
          <button type="button" className="btn sm md-dugout-btn" onClick={() => d.hand?.open('subs')} aria-haspopup="dialog">
            {tx('makeChange')}
          </button>
        )}
      </div>
      {fs.bench.length > 0 ? (
        <div className="md-bench">
          <div className="lbl">{tx('bench')}</div>
          {fs.bench.map((id) => (
            <div key={id} className={`md-bench-row ${appeared.has(id) ? 'used' : unavailable.includes(id) ? 'unavailable' : ''}`}>
              <span>{name(id)}</span>
              <span className="muted">{appeared.has(id) ? tx('benchOn') : unavailable.includes(id) ? tx('benchUnavailable') : available.includes(id) ? tx('benchReady') : ''}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="muted">{tx('benchNotKept')}</div>
      )}
      {subs.length > 0 && (
        <div className="md-bench">
          <div className="lbl">{tx('changes')}</div>
          {subs.map((s, i) => (
            <div key={i} className="md-bench-row">
              <span>
                <SubIcon /> {tx('subFor', { on: surname(name(s.on)), off: surname(name(s.off)) })}
              </span>
              <span className="muted mono">
                {minuteLabel(s.minute)} {s.reason}
              </span>
            </div>
          ))}
        </div>
      )}
      <ul className="md-notes">
        {fs.talkText && <li>{fs.talkText}</li>}
        {fs.halfTimeText && d.minute >= 45 && <li>{fs.halfTimeText}</li>}
        {fs.lateText && d.minute >= 70 && <li>{fs.lateText}</li>}
        {fs.modifiers.notes.slice(0, 3).map((n, i) => (
          <li key={i} className="muted">
            {n}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The latest line across the dashboard; key moments are also announced to screen readers. */
export function CommentaryBanner({ d }: PanelProps) {
  const lines = useMemo(() => d.commentary.filter((l) => l.minute <= d.minute), [d.commentary, d.minute])
  const line: CommentaryLine | null = latestLine(lines)
  const key = useMemo(() => {
    for (let i = lines.length - 1; i >= 0; i--) if (['goal', 'card', 'injury', 'sub'].includes(lines[i].kind)) return lines[i]
    return null
  }, [lines])
  // The assistant's word at 15, 30, 60 and 80 minutes, for a few minutes, unless a moment since has taken the banner
  const cp = assistantCheckpoint(d.minute)
  const side = d.userSide
  const assist = useMemo(() => (cp !== null && side ? assistantLine(d.feed, d.series, side, cp, d.getName) : null), [cp, side, d.feed, d.series, d.getName])
  const showAssist = !!assist && (!line || line.kind === 'play' || line.minute < assist.minute)
  // One region for both, mounted throughout, each moment said once: two regions swapped in place re-read the booking
  // before the assistant's word once his word went (a11y round 7)
  const keyAt = key ? lines.lastIndexOf(key) : -1
  const said = useSayOnce(showAssist && assist ? `a${assist.minute}` : key ? `k${keyAt}` : null, showAssist && assist ? tx('assistantSays', { text: commentaryPiece(assist.text) }) : key ? `${minuteLabel(key.minute)} ${commentaryLineText(key)}` : '')
  const region = (
    <span className="sr-only" aria-live="polite" data-testid="banner-live">
      {said}
    </span>
  )
  if (showAssist && assist) {
    return (
      <div className="md-banner assistant key" data-testid="assistant-line">
        <span className="min mono">{minuteLabel(assist.minute)}</span>
        <span className="txt" key={`a${assist.minute}`}>
          <b className="md-assistant-tag">{tx('assistant')}</b> {commentaryPiece(assist.text)}
        </span>
        {region}
      </div>
    )
  }
  const tone = line?.kind === 'goal' ? 'goal' : line?.kind === 'card' ? 'card' : ''
  const moment = !!line && line.kind !== 'play'
  return (
    <div className={`md-banner ${tone} ${moment ? 'key' : ''}`}>
      <span className="min mono">{line && line.minute > 0 ? minuteLabel(line.minute) : "0'"}</span>
      <span className="txt" key={`${line?.minute}-${line?.text}`}>
        {line ? commentaryLineText(line) : tx('teamsOut')}
      </span>
      {region}
    </div>
  )
}
