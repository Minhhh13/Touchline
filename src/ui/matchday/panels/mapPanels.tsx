/**
 * The widgets drawn from where the dots went: a player's heat map, average
 * positions, pass maps, action zones and the shot map. All read the same ball
 * path and dot movement the live pitch shows (heat.ts), so a map shows what
 * the pitch did.
 */
import { useMemo, useState } from 'react'
import { shotXg } from '@engine/matchStats'
import { PitchSvg, pitchMapper } from '../../components/LivePitch'
import { ShotMap } from '../../components/MatchCharts'
import { textColourFor } from '../../format'
import { actionZones, averagePositions, heatGrid, passNetwork } from '../../match/heat'
import { surname } from '../../match/shirts'
import { VerticalPitch } from '../VerticalPitch'
import type { MatchdayData, PanelProps } from '../types'
import { Empty, SideToggle, Swatch } from './bits'

type Side = 'home' | 'away'

/** The samples up to the clock (each minute's are timed inside it). */
function samplesTo(samples: MatchdayData['samples'], minute: number) {
  return samples.filter((s) => s.t < minute + 1)
}

/** The man the heat map follows: the selected one, else our centre-forward (the most advanced starter). */
export function heatSubject(d: MatchdayData): string | null {
  if (d.selected) return d.selected
  const side = d.userSide ?? 'home'
  const fs = side === 'home' ? d.feed.home : d.feed.away
  const order = ['ST', 'AM', 'LW', 'RW', 'CM', 'DM', 'LB', 'RB', 'CB', 'GK']
  const starters = fs.appearances.filter((a) => a.onAt === 0).sort((a, b) => order.indexOf(a.position) - order.indexOf(b.position))
  return starters[0]?.psId ?? null
}

export function HeatMap({ d }: PanelProps) {
  const subject = heatSubject(d)
  const side: Side | null = subject ? (d.feed.home.appearances.some((a) => a.psId === subject) ? 'home' : 'away') : null
  const samples = useMemo(() => samplesTo(d.samples, d.minute), [d.samples, d.minute])
  const grid = useMemo(() => (subject ? heatGrid(samples, subject) : null), [samples, subject])
  const people = [...d.feed.home.appearances.map((a) => ({ a, side: 'home' as const })), ...d.feed.away.appearances.map((a) => ({ a, side: 'away' as const }))].filter((x) => x.a.onAt <= Math.max(0, d.minute))
  const view = side === 'away' ? d.away : d.home
  const H = 68 * 1.18
  return (
    <div className="md-heat">
      <VerticalPitch
        label={`Heat map for ${subject ? (d.getName(subject) ?? 'a player') : 'nobody yet'}`}
        overlay={
          grid && grid.max > 0 ? (
            <g>
              {grid.cells.map((v, i) => {
                if (v < 0.04) return null
                const c = i % grid.cols
                const r = Math.floor(i / grid.cols)
                // Attacking up: the home side's x runs up the pitch, the away side's down
                const along = side === 'away' ? grid.cols - 1 - c : c
                const across = side === 'away' ? grid.rows - 1 - r : r
                const w = 68 / grid.rows
                const h = H / grid.cols
                const x = across * w
                const y = H - (along + 1) * h
                return (
                  <g key={i}>
                    <rect x={x} y={y} width={w + 0.05} height={h + 0.05} fill="var(--heat-warm)" opacity={Math.min(0.85, v * 0.85)} />
                    {v > 0.55 && <rect x={x} y={y} width={w + 0.05} height={h + 0.05} fill="var(--heat-hot)" opacity={(v - 0.55) * 1.8} />}
                  </g>
                )
              })}
            </g>
          ) : null
        }
      />
      <div className="md-heat-side">
        <label className="small">
          <span className="sr-only">Player</span>
          <select className="md-select" value={subject ?? ''} onChange={(e) => d.select(e.target.value)}>
            {/* Grouped by side, so the team code is the group's label and each option is just the number and the name */}
            {(['home', 'away'] as const).map((s) => (
              <optgroup key={s} label={(s === 'home' ? d.home : d.away).code}>
                {people
                  .filter((x) => x.side === s)
                  .map(({ a }) => (
                    <option key={a.psId} value={a.psId}>
                      {(s === 'home' ? d.home : d.away).numbers[a.psId] ?? ''} {surname(d.getName(a.psId))}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        <div className="md-heat-legend small">
          <span>Low</span>
          <span className="md-heat-scale" aria-hidden />
          <span>High</span>
        </div>
        <div className="small muted">
          <span aria-hidden>↑</span> attacking up
        </div>
        {subject && (
          <div className="small">
            <Swatch colour={view.colour} /> {d.getName(subject)}
          </div>
        )}
        {(!grid || grid.max === 0) && <div className="small muted">No touches yet.</div>}
      </div>
    </div>
  )
}

const BOTH = [
  { value: 'both' as const, label: 'Both' },
  { value: 'home' as const, label: 'Home' },
  { value: 'away' as const, label: 'Away' },
]

export function AveragePositions({ d }: PanelProps) {
  const [which, setWhich] = useState<'both' | Side>('both')
  const samples = useMemo(() => samplesTo(d.samples, d.minute), [d.samples, d.minute])
  const map = pitchMapper(false)
  const sides: Side[] = which === 'both' ? ['home', 'away'] : [which]
  const marks = sides.flatMap((s) => averagePositions(samples, s).map((p) => ({ ...p, side: s })))
  return (
    <div className="md-map">
      <SideToggle value={which} options={BOTH.map((o) => ({ ...o, label: o.value === 'home' ? d.home.code : o.value === 'away' ? d.away.code : 'Both' }))} onChange={setWhich} label="Sides" />
      <PitchSvg label="Average positions">
        {marks.map((p) => {
          const [cx, cy] = map(p.x, p.y)
          const view = p.side === 'home' ? d.home : d.away
          const keeper = d.feed[p.side].appearances.find((a) => a.psId === p.psId)?.position === 'GK'
          const colour = keeper ? view.keeper : view.colour
          return (
            <g key={p.psId} transform={`translate(${cx.toFixed(2)} ${cy.toFixed(2)})`} className="md-avg">
              <title>{`${d.getName(p.psId) ?? p.psId}: ${p.minutes} minutes`}</title>
              <circle r="2.8" fill={colour} stroke="rgba(0,0,0,0.55)" strokeWidth="0.4" />
              <text y="0.9" textAnchor="middle" fontSize="2.6" fontWeight="700" fill={textColourFor(colour)}>
                {view.numbers[p.psId] ?? ''}
              </text>
            </g>
          )
        })}
      </PitchSvg>
      {marks.length === 0 && <div className="small muted">Positions build up from kick-off.</div>}
    </div>
  )
}

export function PassMaps({ d }: PanelProps) {
  const [side, setSide] = useState<Side>(d.userSide ?? 'home')
  const samples = useMemo(() => samplesTo(d.samples, d.minute), [d.samples, d.minute])
  const net = useMemo(() => passNetwork(d.mpath, side, d.minute), [d.mpath, side, d.minute])
  const nodes = new Map(averagePositions(samples, side).map((p) => [p.psId, p]))
  const map = pitchMapper(false)
  const view = side === 'home' ? d.home : d.away
  const top = net.passes[0]?.count ?? 1
  return (
    <div className="md-map">
      <SideToggle value={side} options={[{ value: 'home', label: d.home.code }, { value: 'away', label: d.away.code }]} onChange={setSide} label="Side" />
      <PitchSvg label={`${view.name} pass map`}>
        {net.passes.map((p) => {
          const a = nodes.get(p.from)
          const b = nodes.get(p.to)
          if (!a || !b) return null
          const [x1, y1] = map(a.x, a.y)
          const [x2, y2] = map(b.x, b.y)
          return <line key={`${p.from}>${p.to}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#fff" strokeOpacity={0.25 + 0.6 * (p.count / top)} strokeWidth={0.3 + 1.6 * (p.count / top)} strokeLinecap="round" />
        })}
        {[...nodes.values()].map((p) => {
          const [cx, cy] = map(p.x, p.y)
          return (
            <g key={p.psId} transform={`translate(${cx.toFixed(2)} ${cy.toFixed(2)})`}>
              <circle r="2.6" fill={view.colour} stroke="rgba(0,0,0,0.55)" strokeWidth="0.4" />
              <text y="0.9" textAnchor="middle" fontSize="2.5" fontWeight="700" fill={textColourFor(view.colour)}>
                {view.numbers[p.psId] ?? ''}
              </text>
            </g>
          )
        })}
      </PitchSvg>
      <div className="small muted md-links">
        {net.total === 0 ? 'No passing moves on the ball path yet.' : net.passes.slice(0, 3).map((p) => `${surname(d.getName(p.from))} → ${surname(d.getName(p.to))} ${p.count}`).join(' · ')}
      </div>
    </div>
  )
}

export function ActionZones({ d }: PanelProps) {
  const [side, setSide] = useState<Side>(d.userSide ?? 'home')
  const zones = useMemo(() => actionZones(d.mpath, d.minute), [d.mpath, d.minute])
  const z = zones[side]
  const view = side === 'home' ? d.home : d.away
  const thirds = [z.thirds.defensive, z.thirds.middle, z.thirds.attacking]
  // Drawn attacking right for either side
  return (
    <div className="md-map">
      <SideToggle value={side} options={[{ value: 'home', label: d.home.code }, { value: 'away', label: d.away.code }]} onChange={setSide} label="Side" />
      <PitchSvg label={`${view.name} action zones: own third ${Math.round(thirds[0])}%, middle ${Math.round(thirds[1])}%, final third ${Math.round(thirds[2])}%`}>
        {thirds.map((v, i) => (
          <g key={i}>
            <rect x={i * 35} y={0} width={35} height={68} fill={view.colour} opacity={z.samples ? 0.12 + (v / 100) * 0.7 : 0.08} />
            <text x={i * 35 + 17.5} y={37} textAnchor="middle" fontSize="7" fontWeight="700" fill="#fff" stroke="rgba(0,0,0,0.55)" strokeWidth="0.4" paintOrder="stroke">
              {z.samples ? `${Math.round(v)}%` : '–'}
            </text>
          </g>
        ))}
      </PitchSvg>
      <div className="md-channels small">
        {(['left', 'centre', 'right'] as const).map((k) => (
          <span key={k}>
            {k === 'left' ? 'Left' : k === 'centre' ? 'Centre' : 'Right'} <b className="mono">{z.samples ? Math.round(z.channels[k]) : 0}%</b>
          </span>
        ))}
        <span className="muted">attacking →</span>
      </div>
    </div>
  )
}

export function ShotMapWidget({ d }: PanelProps) {
  const shots = d.feed.events.filter((e) => ['goal', 'penalty', 'chance', 'save'].includes(e.type) && e.minute <= d.minute)
  const best = shots.reduce((m, e) => Math.max(m, shotXg(e)), 0)
  return (
    <div className="md-map">
      <ShotMap events={d.feed.events} upTo={d.minute} sizeByXg home={{ name: d.home.name, shortName: d.home.code, colour: d.home.colour }} away={{ name: d.away.name, shortName: d.away.code, colour: d.away.colour }} />
      {shots.length === 0 ? <Empty>No shots yet.</Empty> : <div className="small muted">{shots.length} attempts · best chance {best.toFixed(2)} xG · size by xG</div>}
    </div>
  )
}
