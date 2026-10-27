import type { ReactNode } from 'react'
import type { PlayerSeason, Tactics } from '@engine/types'
import { LINE_HELP, MENTALITY_HELP, PASSING_HELP, PRESSING_HELP, TEMPO_HELP, WIDTH_HELP } from '@engine/tactics'
import { Segmented } from './bits'

function Instruction({ label, help, children }: { label: string; help: string; children: ReactNode }) {
  return (
    <div className="col" style={{ gap: 4 }}>
      <div className="row between wrap">
        <span style={{ fontWeight: 600 }}>{label}</span>
        {children}
      </div>
      <div className="help">{help}</div>
    </div>
  )
}

/** The six team instructions with the Dugout's labels and help lines, for the quick season's tactics step and its January pause. */
export function TeamInstructions({ t, onChange }: { t: Tactics; onChange: (patch: Partial<Tactics>) => void }) {
  return (
    <div className="col" data-testid="team-instructions">
      <Instruction label="Mentality" help={MENTALITY_HELP[t.mentality]}>
        <Segmented value={t.mentality} onChange={(v) => onChange({ mentality: v })} options={[{ value: 'defensive', label: 'Defensive' }, { value: 'balanced', label: 'Balanced' }, { value: 'attacking', label: 'Attacking' }]} />
      </Instruction>
      <Instruction label="Tempo" help={TEMPO_HELP[t.tempo]}>
        <Segmented value={t.tempo} onChange={(v) => onChange({ tempo: v })} options={[{ value: 'slow', label: 'Slow' }, { value: 'standard', label: 'Standard' }, { value: 'fast', label: 'Fast' }]} />
      </Instruction>
      <Instruction label="Pressing" help={PRESSING_HELP[t.pressing]}>
        <Segmented value={t.pressing} onChange={(v) => onChange({ pressing: v })} options={[{ value: 'low', label: 'Low block' }, { value: 'mid', label: 'Mid' }, { value: 'high', label: 'High press' }]} />
      </Instruction>
      <Instruction label="Defensive line" help={LINE_HELP[t.defensiveLine]}>
        <Segmented value={t.defensiveLine} onChange={(v) => onChange({ defensiveLine: v })} options={[{ value: 'deep', label: 'Deep' }, { value: 'standard', label: 'Standard' }, { value: 'high', label: 'High' }]} />
      </Instruction>
      <Instruction label="Width" help={WIDTH_HELP[t.width]}>
        <Segmented value={t.width} onChange={(v) => onChange({ width: v })} options={[{ value: 'narrow', label: 'Narrow' }, { value: 'standard', label: 'Standard' }, { value: 'wide', label: 'Wide' }]} />
      </Instruction>
      <Instruction label="Passing" help={PASSING_HELP[t.passing]}>
        <Segmented value={t.passing} onChange={(v) => onChange({ passing: v })} options={[{ value: 'short', label: 'Short' }, { value: 'mixed', label: 'Mixed' }, { value: 'direct', label: 'Direct' }]} />
      </Instruction>
    </div>
  )
}

/** Captain and penalty taker from the XI; "Auto" leaves the choice to the match engine, as in the Dugout. */
export function CaptainAndPenalties({ xi, captainId, penalties, onCaptain, onPenalties, hideRatings }: { xi: PlayerSeason[]; captainId?: string; penalties?: string; onCaptain: (id: string | undefined) => void; onPenalties: (id: string | undefined) => void; hideRatings?: boolean }) {
  // With ratings hidden (Hard, blind) the lists keep the XI's order: sorting by the attributes would give them away
  const takers = xi.filter((p) => p.positions[0] !== 'GK').sort((a, b) => (hideRatings ? 0 : b.attributes.shooting + b.attributes.mentality - (a.attributes.shooting + a.attributes.mentality)))
  const leaders = [...xi].sort((a, b) => (hideRatings ? 0 : b.attributes.mentality - a.attributes.mentality))
  // Each number says what it measures: beside a name a bare figure read as his overall rating
  const score = (n: number, what: string) => (hideRatings ? '' : ` (${what} ${n})`)
  return (
    <div className="col">
      <Instruction label="Captain" help="A leader on the pitch steadies the side in big games. The number is his mentality.">
        <select className="input" style={{ width: 'auto' }} value={captainId && xi.some((p) => p.id === captainId) ? captainId : ''} onChange={(e) => onCaptain(e.target.value || undefined)} data-testid="captain-select" aria-label="Captain">
          <option value="">Auto: no armband</option>
          {leaders.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {score(p.attributes.mentality, 'mentality')}
            </option>
          ))}
        </select>
      </Instruction>
      <Instruction label="Penalties" help="Takes every penalty while he is on the pitch. The number is his penalty skill, from his shooting and mentality.">
        <select className="input" style={{ width: 'auto' }} value={penalties && xi.some((p) => p.id === penalties) ? penalties : ''} onChange={(e) => onPenalties(e.target.value || undefined)} data-testid="penalty-select" aria-label="Penalty taker">
          <option value="">Auto: best on the pitch</option>
          {takers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {score(Math.round((p.attributes.shooting + p.attributes.mentality) / 2), 'pens')}
            </option>
          ))}
        </select>
      </Instruction>
    </div>
  )
}
