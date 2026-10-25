/**
 * The widgets that read the match feed itself: match events, the full
 * commentary, match stats, the momentum chart, the dugout, and the
 * commentary banner across the dashboard.
 */
import { useEffect, useMemo, useRef } from 'react'
import { benchAt, managerWindowsUsed, MAX_SUBS, MAX_WINDOWS, subsMade } from '@engine/match'
import { MOMENTUM_BINS } from '@engine/matchDetail'
import { statsAt } from '@engine/matchStats'
import { isAvailable } from '@game/logic/players'
import { minuteLabel } from '../../format'
import { changeText, latestLine, type CommentaryLine } from '../../match/commentary'
import { surname } from '../../match/shirts'
import { ChangeIcon, EventIcon, SubIcon } from '../icons'
import { keyItems, momentumSpells, statRows } from '../model'
import type { PanelProps } from '../types'
import { Empty, Swatch, TeamCode } from './bits'

/** Key events to the clock, home on the left and away on the right, newest at the bottom. */
export function MatchEvents({ d }: PanelProps) {
  const items = useMemo(() => keyItems(d.feed, d.minute), [d.feed, d.minute])
  const ref = useAutoScroll(items.length)
  if (!items.length) return <Empty>Kick-off. Goals, cards, changes and substitutions appear here.</Empty>
  return (
    <ol className="md-events" ref={ref}>
      {items.map((it, i) => {
        if (it.kind === 'change') {
          const team = it.entry.side === 'home' ? d.home.code : d.away.code
          return (
            <li key={`c${i}`} className={`md-ev change ${it.entry.side}`}>
              <span className="min mono">{minuteLabel(it.minute)}</span>
              <ChangeIcon />
              <span className="txt">{changeText(it.entry, team) ?? `${team} make a change.`}</span>
            </li>
          )
        }
        const e = it.event
        const whistle = e.type === 'half_time' || e.type === 'full_time'
        const sub = e.type === 'substitution'
        const who = sub ? `${surname(e.secondaryName ?? (e.secondaryId ? d.getName(e.secondaryId) : undefined))} for ${surname(e.playerName)}` : e.playerName ? `${e.playerName}${e.type === 'penalty' ? ' (pen)' : e.type === 'own_goal' ? ' (og)' : ''}${e.type === 'goal' && e.secondaryName ? ` (${e.secondaryName})` : ''}` : e.text
        return (
          <li key={`e${i}`} className={`md-ev ${whistle ? 'whistle' : e.side} ${e.type}`}>
            <span className="min mono">{whistle ? '' : minuteLabel(e.minute)}</span>
            <EventIcon type={e.type} />
            <span className="txt">{whistle ? e.text : who}</span>
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
          <span className="txt">{l.text}</span>
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
        <span className="muted small">at {d.minute <= 0 ? 'kick-off' : minuteLabel(d.minute)}</span>
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
  const step = 19
  const bw = 16
  const x0 = 10
  const m = d.feed.momentum
  const spells = momentumSpells(m, d.minute)
  return (
    <div className="md-momentum" data-testid="momentum-widget">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Match momentum by five-minute spell">
        <line x1={x0} y1={mid} x2={x0 + MOMENTUM_BINS * step} y2={mid} stroke="var(--line-2)" />
        <line x1={x0 + 9 * step - 1} y1={4} x2={x0 + 9 * step - 1} y2={H - 14} stroke="var(--line-2)" strokeDasharray="2 2" />
        {m.slice(0, MOMENTUM_BINS).map((v, i) => {
          const frac = Math.max(0, Math.min(1, (d.minute - i * 5) / 5))
          if (frac <= 0) return null
          const h = (v - 0.5) * 2 * 44 * frac
          return <rect key={i} x={x0 + i * step} y={h >= 0 ? mid - h : mid} width={bw} height={Math.max(0.5, Math.abs(h))} rx="2" fill={h >= 0 ? d.home.colour : d.away.colour} stroke="var(--text-3)" strokeWidth="0.75" opacity="0.95" />
        })}
        {[0, 45, 90].map((x) => (
          <text key={x} x={x0 + (x / 5) * step} y={H - 3} fontSize="8" fill="var(--text-3)" textAnchor={x === 0 ? 'start' : 'middle'}>
            {x === 0 ? "0'" : x === 45 ? 'HT' : "90'"}
          </text>
        ))}
      </svg>
      <ul className="md-spells small">
        {spells.length === 0 && <li className="muted">No spell of dominance yet.</li>}
        {spells.map((s, i) => (
          <li key={i}>
            <Swatch colour={s.side === 'home' ? d.home.colour : d.away.colour} /> {s.side === 'home' ? d.home.code : d.away.code} on top {s.from}-{s.to}' <span className="muted">({Math.round(s.strength * 100)}%)</span>
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
          <b className="mono">{MAX_SUBS - made}</b>/{MAX_SUBS} subs
        </span>
        {mp && (
          <span>
            <b className="mono">{MAX_WINDOWS - windows}</b>/{MAX_WINDOWS} stoppages
          </span>
        )}
        {mp && d.hand?.editable && (
          <button type="button" className="btn sm md-dugout-btn" onClick={() => d.hand?.open('subs')} aria-haspopup="dialog">
            Make a change
          </button>
        )}
      </div>
      {fs.bench.length > 0 ? (
        <div className="md-bench">
          <div className="lbl">Bench</div>
          {fs.bench.map((id) => (
            <div key={id} className={`md-bench-row ${appeared.has(id) ? 'used' : unavailable.includes(id) ? 'unavailable' : ''}`}>
              <span>{name(id)}</span>
              <span className="muted">{appeared.has(id) ? 'on' : unavailable.includes(id) ? 'unavailable' : available.includes(id) ? 'ready' : ''}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="muted">The bench is not kept for a finished match.</div>
      )}
      {subs.length > 0 && (
        <div className="md-bench">
          <div className="lbl">Changes</div>
          {subs.map((s, i) => (
            <div key={i} className="md-bench-row">
              <span>
                <SubIcon /> {surname(name(s.on))} for {surname(name(s.off))}
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
  const tone = line?.kind === 'goal' ? 'goal' : line?.kind === 'card' ? 'card' : ''
  const moment = !!line && line.kind !== 'play'
  return (
    <div className={`md-banner ${tone} ${moment ? 'key' : ''}`}>
      <span className="min mono">{line && line.minute > 0 ? minuteLabel(line.minute) : "0'"}</span>
      <span className="txt" key={`${line?.minute}-${line?.text}`}>
        {line?.text ?? 'The teams are out.'}
      </span>
      <span className="sr-only" aria-live="polite">
        {key ? `${minuteLabel(key.minute)} ${key.text}` : ''}
      </span>
    </div>
  )
}
