/**
 * The match charts: a momentum bar and an xG race that fill as the clock runs
 * (live and on the report), and the report's shot map, possession and
 * territory pair and tactics overlay. All SVG, all cheap: a few dozen shapes.
 */
import { useMemo } from 'react'
import type { Appearance, FullMatchResult } from '@engine/match'
import { binOf, MOMENTUM_BINS } from '@engine/matchDetail'
import { ROLE_BY_ID } from '@engine/roles'
import type { MatchEvent, PlayerSeason, Tactics } from '@engine/types'
import { placeSide, toShared, type Side } from '../match/pitchGeometry'
import { territory as territoryOf, xgSeries } from '../match/charts'
import { shotXg } from '@engine/matchStats'
import { PitchSvg, pitchMapper, useMediaQuery, type PitchSide } from './LivePitch'
import { minuteLabel, textColourFor } from '../format'

const GOAL_TYPES = new Set<MatchEvent['type']>(['goal', 'penalty', 'own_goal'])
const SHOT_TYPES = new Set<MatchEvent['type']>(['goal', 'penalty', 'own_goal', 'chance', 'save'])

/** The home side's share of the pressure per five-minute bin: up for the home side, down for the away side, filled to the clock. */
export function MomentumBar({ momentum, clock, events, home, away, strip = false }: { momentum: number[]; clock: number; events: MatchEvent[]; home: PitchSide; away: PitchSide; strip?: boolean }) {
  // The strip variant runs the full width of the dashboard's centre column, a little over a third as tall
  const W = strip ? 760 : 360
  const H = strip ? 50 : 76
  const mid = strip ? 25 : 40
  const step = strip ? 40.5 : 19
  const bw = strip ? 37 : 17
  const x0 = 10
  const amp = strip ? 19 : 30
  const goals = events.filter((e) => GOAL_TYPES.has(e.type) && e.minute <= clock)
  return (
    <div className={`mchart ${strip ? 'momentum-strip' : ''}`} data-testid="momentum-bar">
      <div className="row between small">
        <span className="row" style={{ gap: 6 }}>
          <span className="swatch" style={{ background: home.colour }} />
          {home.shortName}
        </span>
        <span className="muted">Momentum</span>
        <span className="row" style={{ gap: 6 }}>
          {away.shortName}
          <span className="swatch" style={{ background: away.colour }} />
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Momentum by five-minute spell">
        <line x1={x0} y1={mid} x2={x0 + MOMENTUM_BINS * step} y2={mid} stroke="var(--line-2)" strokeWidth="1" />
        <line x1={x0 + 9 * step - 1} y1={strip ? 2 : 6} x2={x0 + 9 * step - 1} y2={H - (strip ? 2 : 6)} stroke="var(--line-2)" strokeDasharray="2 2" />
        <text x={x0 + 9 * step + 2} y={H - 2} fontSize={strip ? 7 : 8} fill="var(--text-3)">
          HT
        </text>
        {momentum.slice(0, MOMENTUM_BINS).map((m, i) => {
          const frac = Math.max(0, Math.min(1, (clock - i * 5) / 5))
          if (frac <= 0) return null
          const h = (m - 0.5) * 2 * amp * frac
          const x = x0 + i * step
          return <rect key={i} x={x} y={h >= 0 ? mid - h : mid} width={bw} height={Math.max(0.5, Math.abs(h))} rx="2" fill={h >= 0 ? home.colour : away.colour} stroke="var(--text-3)" strokeWidth="0.75" opacity={0.95}>
            <title>{`${i * 5 + 1}-${i * 5 + 5}': ${Math.round(m * 100)}% ${home.shortName}`}</title>
          </rect>
        })}
        {goals.map((g, i) => {
          const b = binOf(g.minute)
          const x = x0 + b * step + bw / 2
          const y = g.side === 'home' ? (strip ? 4 : 7) : H - (strip ? 4 : 7)
          return (
            <g key={i}>
              <circle cx={x} cy={y} r={strip ? 3.4 : 4} fill={g.side === 'home' ? home.colour : away.colour} stroke="var(--panel)" strokeWidth="1.5" />
              <title>{`${minuteLabel(g.minute)} ${g.playerName ?? 'Goal'}`}</title>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

export function XgRace({ momentum, xg, clock, events, home, away }: { momentum: number[]; xg: { home: number; away: number }; clock: number; events: MatchEvent[]; home: PitchSide; away: PitchSide }) {
  const W = 360
  const H = 130
  const px = 30
  const py = 10
  const pw = W - px - 12
  const ph = H - py - 20
  const hs = useMemo(() => xgSeries(momentum, xg.home, 'home'), [momentum, xg.home])
  const as = useMemo(() => xgSeries(momentum, xg.away, 'away'), [momentum, xg.away])
  const upto = Math.max(0, Math.min(90, clock))
  const yMax = Math.max(0.5, Math.ceil(Math.max(xg.home, xg.away) * 2) / 2)
  const X = (m: number) => px + (m / 90) * pw
  const Y = (v: number) => py + ph - (v / yMax) * ph
  const line = (s: number[]) => s.slice(0, upto + 1).map((v, m) => `${X(m).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')
  const goals = events.filter((e) => GOAL_TYPES.has(e.type) && e.minute <= clock)
  const ticks = [0, yMax / 2, yMax]
  return (
    <div className="mchart" data-testid="xg-race">
      <div className="row between small">
        <span className="row" style={{ gap: 6 }}>
          <span className="swatch" style={{ background: home.colour }} />
          {home.shortName} <b className="mono">{hs[upto].toFixed(2)}</b>
        </span>
        <span className="muted">xG race</span>
        <span className="row" style={{ gap: 6 }}>
          <b className="mono">{as[upto].toFixed(2)}</b> {away.shortName}
          <span className="swatch" style={{ background: away.colour }} />
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Expected goals race">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={px} y1={Y(t)} x2={px + pw} y2={Y(t)} stroke="var(--line)" strokeWidth="1" />
            <text x={px - 4} y={Y(t) + 3} fontSize="8" textAnchor="end" fill="var(--text-3)">
              {String(+t.toFixed(2))}
            </text>
          </g>
        ))}
        {[0, 45, 90].map((m) => (
          <text key={m} x={X(m)} y={H - 6} fontSize="8" textAnchor={m === 0 ? 'start' : m === 90 ? 'end' : 'middle'} fill="var(--text-3)">
            {m === 0 ? "0'" : m === 45 ? 'HT' : 'FT'}
          </text>
        ))}
        {upto > 0 && <polyline points={line(hs)} fill="none" stroke="var(--text-3)" strokeWidth="3.5" strokeLinejoin="round" opacity="0.6" />}
        {upto > 0 && <polyline points={line(as)} fill="none" stroke="var(--text-3)" strokeWidth="3.5" strokeLinejoin="round" opacity="0.6" />}
        {upto > 0 && <polyline points={line(hs)} fill="none" stroke={home.colour} strokeWidth="2" strokeLinejoin="round" />}
        {upto > 0 && <polyline points={line(as)} fill="none" stroke={away.colour} strokeWidth="2" strokeLinejoin="round" />}
        {goals.map((g, i) => {
          const m = Math.min(90, g.minute)
          const s = g.side === 'home' ? hs : as
          return (
            <g key={i}>
              <circle cx={X(m)} cy={Y(s[m])} r="3.5" fill={g.side === 'home' ? home.colour : away.colour} stroke="var(--panel)" strokeWidth="1.5" />
              <title>{`${minuteLabel(g.minute)} ${g.playerName ?? 'Goal'}`}</title>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/** Every shot of the match: the home side's at the right-hand goal, the away side's at the left. */
export function ShotMap({ events, home, away, upTo = Infinity, sizeByXg = false }: { events: MatchEvent[]; home: PitchSide; away: PitchSide; upTo?: number; sizeByXg?: boolean }) {
  const map = pitchMapper(false)
  const shots = events.filter((e) => SHOT_TYPES.has(e.type) && e.position && e.minute <= upTo)
  // Marker size by expected goals: from a speculative effort to a tap-in
  const size = (e: MatchEvent, base: number) => (sizeByXg ? base * (0.7 + Math.sqrt(shotXg(e)) * 1.1) : base)
  return (
    <div className="shot-map" data-testid="shot-map">
      <PitchSvg label="Shot map">
        {shots.map((e, i) => {
          const p = toShared(e.position!, e.side)
          const [cx, cy] = map(p.x, p.y)
          const colour = e.side === 'home' ? home.colour : away.colour
          const goal = GOAL_TYPES.has(e.type)
          return (
            <g key={i} transform={`translate(${cx.toFixed(2)} ${cy.toFixed(2)})`}>
              <title>{`${minuteLabel(e.minute)} ${e.text}`}</title>
              {goal ? <circle r={size(e, 2.6)} fill={colour} stroke="#fff" strokeWidth="0.6" /> : e.type === 'save' ? <circle r={size(e, 2.2)} fill="rgba(0,0,0,0.25)" stroke={colour} strokeWidth="0.9" /> : <circle r={size(e, 2.2)} fill="none" stroke={colour} strokeWidth="0.9" strokeDasharray="1.4 1" />}
              {e.type === 'save' && <circle r="0.7" fill={colour} />}
            </g>
          )
        })}
      </PitchSvg>
      <div className="live-legend small">
        <span className="row" style={{ gap: 6 }}>
          <span className="swatch" style={{ background: home.colour }} />
          {home.shortName} <span className="muted">→</span>
        </span>
        <span className="muted">● goal · ◉ saved · ◌ chance</span>
        <span className="row" style={{ gap: 6 }}>
          <span className="muted">←</span> {away.shortName}
          <span className="swatch" style={{ background: away.colour }} />
        </span>
      </div>
    </div>
  )
}

/** Two split bars: the ball, and the pitch. Territory is the mean of the momentum series. */
export function PossessionTerritory({ res, home, away, possession }: { res: FullMatchResult; home: PitchSide; away: PitchSide; possession?: { home: number; away: number } }) {
  const territory = territoryOf(res.momentum ?? [])
  const row = (label: string, h: number, a: number) => (
    <div className="split-row" key={label}>
      <span className="mono num">{h}%</span>
      <div>
        <div className="small muted" style={{ textAlign: 'center' }}>
          {label}
        </div>
        <div className="split-bar" role="img" aria-label={`${label}: ${home.shortName} ${h}%, ${away.shortName} ${a}%`}>
          <span style={{ width: `${h}%`, background: home.colour }} />
          <span style={{ width: `${a}%`, background: away.colour }} />
        </div>
      </div>
      <span className="mono">{a}%</span>
    </div>
  )
  return (
    <div className="col" style={{ gap: 8 }} data-testid="possession-territory">
      {row('Possession', possession?.home ?? res.homeReport.possession, possession?.away ?? res.awayReport.possession)}
      {territory !== null && row('Territory', territory, 100 - territory)}
    </div>
  )
}

/** A side's shape with role labels and arrows for its pressing height, width and tempo. */
export function TacticsOverlay({ side, attack, getPlayer }: { side: PitchSide & { tactics: Tactics; appearances: Appearance[] }; attack: Side; getPlayer: (id: string) => PlayerSeason | undefined }) {
  // Stood up on a phone, like the live pitch, so the role labels stay legible
  const portrait = useMediaQuery('(max-width: 720px)')
  const map = pitchMapper(portrait)
  const t = side.tactics
  const starters = placeSide(side.appearances.filter((a) => a.onAt === 0), t, attack)
  const dir = attack === 'home' ? 1 : -1
  const press = t.pressing === 'high' ? 68 : t.pressing === 'low' ? 38 : 53
  const pressX = attack === 'home' ? press : 100 - press
  const [lx1, ly1] = map(pressX, 4)
  const [lx2, ly2] = map(pressX, 96)
  const tempoLen = t.tempo === 'fast' ? 18 : t.tempo === 'slow' ? 7 : 12
  const [tx1, ty1] = map(50 - (dir * tempoLen) / 2, 91)
  const [tx2, ty2] = map(50 + (dir * tempoLen) / 2, 91)
  const label = `${cap(t.mentality)} · ${cap(t.pressing)} press · ${cap(t.tempo)} tempo · ${cap(t.width)} width · ${cap(t.defensiveLine)} line · ${cap(t.passing)} passing`
  return (
    <div className="tactics-overlay" data-testid="tactics-overlay">
      <div className="row between small" style={{ marginBottom: 4 }}>
        <span className="row" style={{ gap: 6 }}>
          <span className="swatch" style={{ background: side.colour }} />
          <b>{side.shortName}</b> {t.formationId}
        </span>
        <span className="muted">{portrait ? (attack === 'home' ? 'attacking up' : 'attacking down') : attack === 'home' ? 'attacking right' : 'attacking left'}</span>
      </div>
      <PitchSvg portrait={portrait} label={`${side.name} shape: ${label}`}>
        <line x1={lx1} y1={ly1} x2={lx2} y2={ly2} stroke="#fff" strokeWidth="0.5" strokeDasharray="1.5 1.2" opacity="0.8" />
        <text x={portrait ? lx1 + 0.5 : lx1 + (attack === 'home' ? 1 : -1)} y={portrait ? ly1 - 1 : ly1 + 1.6} fontSize="2.4" fill="#fff" textAnchor={portrait || attack === 'home' ? 'start' : 'end'} opacity="0.9">
          {cap(t.pressing)} press
        </text>
        <Arrow x1={tx1} y1={ty1} x2={tx2} y2={ty2} colour="#fff" width={0.6} />
        <text x={portrait ? tx1 + 1.5 : (tx1 + tx2) / 2} y={portrait ? Math.max(ty1, ty2) + 3 : ty1 - 2} fontSize="2.4" fill="#fff" textAnchor={portrait ? 'end' : 'middle'} opacity="0.9">
          {cap(t.tempo)} tempo
        </text>
        {starters.map((p) => {
          const [cx, cy] = map(p.x, p.y)
          const role = ROLE_BY_ID[t.roles[p.slotId] ?? '']
          const wide = Math.abs(p.y - 50) > 22 && p.position !== 'GK'
          const out = t.width === 'wide' ? 1 : t.width === 'narrow' ? -1 : 0
          const towards = p.y < 50 ? -1 : 1
          // The width arrow points out to the touchline (in), in screen units from the dot
          const off = (k: number) => {
            const [qx, qy] = map(p.x, p.y + towards * out * k)
            return [qx - cx, qy - cy]
          }
          const [w1x, w1y] = off(5.3)
          const [w2x, w2y] = off(10.6)
          return (
            <g key={p.psId} transform={`translate(${cx.toFixed(2)} ${cy.toFixed(2)})`}>
              <title>{`${getPlayer(p.psId)?.name ?? p.psId}: ${role?.name ?? p.position}`}</title>
              <circle r="2.6" fill={side.colour} stroke="rgba(0,0,0,0.55)" strokeWidth="0.4" />
              <text y="0.8" textAnchor="middle" fontSize="2.1" fontWeight="700" fill={textColourFor(side.colour)}>
                {p.position}
              </text>
              <text y="5.6" textAnchor="middle" fontSize="2.2" fill="#fff" stroke="rgba(0,0,0,0.6)" strokeWidth="0.3" paintOrder="stroke">
                {/* Standing up, the pitch is narrow: a two-word role goes on two lines */}
                {portrait
                  ? roleLines(role?.name ?? p.position).map((l, k) => (
                      <tspan key={k} x="0" dy={k ? 2.4 : 0}>
                        {l}
                      </tspan>
                    ))
                  : role?.name ?? p.position}
              </text>
              {wide && out !== 0 && <Arrow x1={w1x} y1={w1y} x2={w2x} y2={w2y} colour="#fff" width={0.5} />}
            </g>
          )
        })}
      </PitchSvg>
      <div className="small muted" style={{ marginTop: 4 }}>
        {label}
      </div>
    </div>
  )
}

function Arrow({ x1, y1, x2, y2, colour, width }: { x1: number; y1: number; x2: number; y2: number; colour: string; width: number }) {
  const a = Math.atan2(y2 - y1, x2 - x1)
  const h = width * 3.2
  const p1 = `${x2},${y2}`
  const p2 = `${x2 - h * Math.cos(a - 0.5)},${y2 - h * Math.sin(a - 0.5)}`
  const p3 = `${x2 - h * Math.cos(a + 0.5)},${y2 - h * Math.sin(a + 0.5)}`
  return (
    <g opacity="0.9">
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={colour} strokeWidth={width} strokeLinecap="round" />
      <polygon points={`${p1} ${p2} ${p3}`} fill={colour} />
    </g>
  )
}

/** A role name split for a narrow pitch: the first word, then the rest. */
function roleLines(name: string): string[] {
  const i = name.indexOf(' ')
  return i < 0 ? [name] : [name.slice(0, i), name.slice(i + 1)]
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

