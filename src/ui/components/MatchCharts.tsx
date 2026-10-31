/**
 * The match charts: a momentum bar and an xG race that fill as the clock runs
 * (live and on the report), and the report's shot map, possession and
 * territory pair and tactics overlay. All SVG, all cheap: a few dozen shapes.
 */
import type { Appearance, FullMatchResult } from '@engine/match'
import { binOf, MOMENTUM_BINS } from '@engine/matchDetail'
import { ROLE_BY_ID } from '@engine/roles'
import type { MatchEvent, PlayerSeason, Tactics } from '@engine/types'
import { placeSide, toShared, type Side } from '../match/pitchGeometry'
import { momentumScale, territory as territoryOf } from '../match/charts'
import { momentumSpells } from '../matchday/model'
import { ROLE_CODE } from '../match/shirts'
import { shotXg } from '@engine/matchStats'
import { PitchSvg, pitchMapper, useMediaQuery, type PitchSide } from './LivePitch'
import { formationName, minuteLabel, textColourFor } from '../format'
import { translator } from '../i18n'
import { match } from '../i18n/en/match'
import { eventLine } from '../i18n/commentaryText'

const tx = translator(match)
/** A tactic's setting in words, capitalised ("High"). */
const setting = (v: Tactics['mentality'] | Tactics['pressing'] | Tactics['tempo'] | Tactics['width'] | Tactics['defensiveLine'] | Tactics['passing']) => tx(`val_${v}`)

const GOAL_TYPES = new Set<MatchEvent['type']>(['goal', 'penalty', 'own_goal'])
const SHOT_TYPES = new Set<MatchEvent['type']>(['goal', 'penalty', 'own_goal', 'chance', 'save'])

/** The home side's share of the pressure per five-minute bin: up for the home side, down for the away side, filled to the clock. */
export function MomentumBar({ momentum, clock, events, home, away, strip = false }: { momentum: number[]; clock: number; events: MatchEvent[]; home: PitchSide; away: PitchSide; strip?: boolean }) {
  // The strip variant runs the full width of the dashboard's centre column, a little over a third as tall
  const W = strip ? 760 : 360
  const H = strip ? 54 : 92
  const mid = strip ? 25 : 42
  // A gutter on the left for the scale, the minutes along the bottom
  const x0 = strip ? 34 : 30
  const step = (W - x0 - 4) / MOMENTUM_BINS
  const bw = step * 0.84
  const amp = strip ? 17 : 30
  const fs = 9
  // The bars are scaled to the biggest swing so far, and the axis says what a full bar means
  const scale = momentumScale(momentum, clock)
  const top = Math.round((0.5 + scale) * 100)
  const goals = events.filter((e) => GOAL_TYPES.has(e.type) && e.minute <= clock)
  const spells = strip ? [] : momentumSpells(momentum, clock)
  const htX = x0 + 9 * step - (step - bw) / 2
  return (
    <div className={`mchart ${strip ? 'momentum-strip' : ''}`} data-testid="momentum-bar">
      <div className="row between wrap small">
        <span className="row" style={{ gap: 6 }}>
          <span className="swatch" style={{ background: home.colour }} />
          {home.shortName}
        </span>
        <span className="muted">{tx('momentum')}</span>
        <span className="row" style={{ gap: 6 }}>
          {away.shortName}
          <span className="swatch" style={{ background: away.colour }} />
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={tx('momentumAria', { home: home.shortName, away: away.shortName, top })}>
        <line x1={x0} y1={mid - amp} x2={W - 4} y2={mid - amp} stroke="var(--line)" strokeDasharray="1 3" />
        <line x1={x0} y1={mid + amp} x2={W - 4} y2={mid + amp} stroke="var(--line)" strokeDasharray="1 3" />
        <line x1={x0} y1={mid} x2={W - 4} y2={mid} stroke="var(--line-2)" strokeWidth="1" />
        <text x={x0 - 4} y={mid - amp + 3} fontSize={fs} fill="var(--text-2)" textAnchor="end">
          {top}%
        </text>
        <text x={x0 - 4} y={mid + 3} fontSize={fs} fill="var(--text-3)" textAnchor="end">
          50
        </text>
        <text x={x0 - 4} y={mid + amp + 3} fontSize={fs} fill="var(--text-2)" textAnchor="end">
          {top}%
        </text>
        <line x1={htX} y1={2} x2={htX} y2={mid + amp + 2} stroke="var(--text-3)" strokeDasharray="2 2" />
        {[0, 45, 90].map((m) => (
          <text key={m} x={m === 45 ? htX : x0 + (m / 5) * step} y={H - 2} fontSize={fs} fill="var(--text-3)" textAnchor={m === 0 ? 'start' : m === 90 ? 'end' : 'middle'}>
            {m === 0 ? "0'" : m === 45 ? tx('ht') : "90'"}
          </text>
        ))}
        {momentum.slice(0, MOMENTUM_BINS).map((m, i) => {
          const frac = Math.max(0, Math.min(1, (clock - i * 5) / 5))
          if (frac <= 0) return null
          const h = Math.max(-1, Math.min(1, (m - 0.5) / scale)) * amp * frac
          const x = x0 + i * step
          const share = Math.round((h >= 0 ? m : 1 - m) * 100)
          return (
            <rect key={i} x={x} y={h >= 0 ? mid - h : mid} width={bw} height={Math.max(0.5, Math.abs(h))} rx="2" fill={h >= 0 ? home.colour : away.colour} stroke="var(--text-2)" strokeWidth="0.6" strokeOpacity="0.6">
              <title>{`${i * 5 + 1}-${i * 5 + 5}': ${h >= 0 ? home.shortName : away.shortName} ${share}%`}</title>
            </rect>
          )
        })}
        {goals.map((g, i) => {
          const b = binOf(g.minute)
          const x = x0 + b * step + bw / 2
          const y = g.side === 'home' ? mid - amp - (strip ? 4 : 6) : mid + amp + (strip ? 4 : 6)
          return (
            <g key={i}>
              <circle cx={x} cy={y} r={strip ? 3.4 : 4} fill={g.side === 'home' ? home.colour : away.colour} stroke="var(--text)" strokeWidth="1.2" />
              <title>{`${minuteLabel(g.minute)} ${g.playerName ?? tx('goal')}`}</title>
            </g>
          )
        })}
      </svg>
      {!strip && (
        <div className="momentum-spells small" data-testid="momentum-spells">
          {spells.length === 0 ? (
            <span className="muted">{tx('noSpellDot')}</span>
          ) : (
            spells.map((sp, i) => (
              <span key={i} className="row" style={{ gap: 4 }}>
                <span className="swatch" style={{ background: sp.side === 'home' ? home.colour : away.colour }} />
                {tx('onTop', { code: sp.side === 'home' ? home.shortName : away.shortName, from: sp.from, to: sp.to })} <span className="muted">({Math.round(sp.strength * 100)}%)</span>
              </span>
            ))
          )}
        </div>
      )}
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
      <PitchSvg label={tx('shotMap')}>
        {shots.map((e, i) => {
          const p = toShared(e.position!, e.side)
          const [cx, cy] = map(p.x, p.y)
          const colour = e.side === 'home' ? home.colour : away.colour
          const goal = GOAL_TYPES.has(e.type)
          return (
            <g key={i} transform={`translate(${cx.toFixed(2)} ${cy.toFixed(2)})`}>
              <title>{`${minuteLabel(e.minute)} ${eventLine(e.text)}`}</title>
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
        <span className="shot-key muted">
          <ShotKey kind="goal" /> {tx('keyGoal')} <ShotKey kind="save" /> {tx('keySaved')} <ShotKey kind="chance" /> {tx('keyChance')}
        </span>
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
        <div className="split-bar" role="img" aria-label={tx('splitAria', { label, home: home.shortName, h, away: away.shortName, a })}>
          <span style={{ width: `${h}%`, background: home.colour }} />
          <span style={{ width: `${a}%`, background: away.colour }} />
        </div>
      </div>
      <span className="mono">{a}%</span>
    </div>
  )
  return (
    <div className="col" style={{ gap: 8 }} data-testid="possession-territory">
      {row(tx('possession'), possession?.home ?? res.homeReport.possession, possession?.away ?? res.awayReport.possession)}
      {territory !== null && row(tx('territory'), territory, 100 - territory)}
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
  const label = tx('overlayLabel', { mentality: setting(t.mentality), pressing: setting(t.pressing), tempo: setting(t.tempo), width: setting(t.width), line: setting(t.defensiveLine), passing: setting(t.passing) })
  return (
    <div className="tactics-overlay" data-testid="tactics-overlay">
      <div className="row between wrap small" style={{ marginBottom: 4 }}>
        <span className="row" style={{ gap: 6 }}>
          <span className="swatch" style={{ background: side.colour }} />
          <b>{side.shortName}</b> {formationName(t.formationId)}
        </span>
        <span className="muted">{tx(portrait ? (attack === 'home' ? 'attackingUp' : 'attackingDown') : attack === 'home' ? 'attackingRightWord' : 'attackingLeft')}</span>
      </div>
      <PitchSvg portrait={portrait} label={tx('shapeAria', { name: side.name, label })}>
        <line x1={lx1} y1={ly1} x2={lx2} y2={ly2} stroke="#fff" strokeWidth="0.5" strokeDasharray="1.5 1.2" opacity="0.8" />
        <text x={portrait ? lx1 + 0.5 : lx1 + (attack === 'home' ? 1 : -1)} y={portrait ? ly1 - 1 : ly1 + 1.6} fontSize="2.4" fill="#fff" stroke="rgba(0,0,0,0.6)" strokeWidth="0.3" paintOrder="stroke" textAnchor={portrait || attack === 'home' ? 'start' : 'end'} opacity="0.9">
          {tx('press', { v: setting(t.pressing) })}
        </text>
        <Arrow x1={tx1} y1={ty1} x2={tx2} y2={ty2} colour="#fff" width={0.6} />
        <text x={portrait ? tx1 + 1.5 : (tx1 + tx2) / 2} y={portrait ? Math.max(ty1, ty2) + 3 : ty1 - 2} fontSize="2.4" fill="#fff" stroke="rgba(0,0,0,0.6)" strokeWidth="0.3" paintOrder="stroke" textAnchor={portrait ? 'end' : 'middle'} opacity="0.9">
          {tx('tempoWord', { v: setting(t.tempo) })}
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
              {/* Under the dot, or over it at the bottom touchline so it is never clipped */}
              <text y={!portrait && cy + 5.6 > 66.5 ? -3.6 : 5.6} textAnchor="middle" fontSize="2.2" fill="#fff" stroke="rgba(0,0,0,0.6)" strokeWidth="0.3" paintOrder="stroke">
                {/* Standing up, the pitch is narrow: a two-word role goes on two lines. Lying down, the role code (the full role is in the tooltip), so labels clear the press and tempo lines and each other */}
                {portrait
                  ? roleLines(role?.name ?? p.position).map((l, k) => (
                      <tspan key={k} x="0" dy={k ? 2.4 : 0}>
                        {l}
                      </tspan>
                    ))
                  : ROLE_CODE[t.roles[p.slotId] ?? ''] ?? role?.name ?? p.position}
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

/** The shot map's legend markers, drawn like the markers on the map (not text glyphs). */
function ShotKey({ kind }: { kind: 'goal' | 'save' | 'chance' }) {
  return (
    <svg className="shot-key-mark" width="12" height="12" viewBox="-6 -6 12 12" aria-hidden="true">
      {kind === 'goal' ? <circle r="4.5" fill="currentColor" /> : kind === 'save' ? <><circle r="4.2" fill="none" stroke="currentColor" strokeWidth="1.4" /><circle r="1.4" fill="currentColor" /></> : <circle r="4.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2.2 1.6" />}
    </svg>
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

