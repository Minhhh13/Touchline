import type { ReactNode } from 'react'
import type { PlayerSeason, Tactics } from '@engine/types'
import { LINE_HELP, MENTALITY_HELP, PASSING_HELP, PRESSING_HELP, TEMPO_HELP, WIDTH_HELP } from '@engine/tactics'
import { Segmented } from './bits'
import { translator } from '../i18n'
import { dugout } from '../i18n/en/dugout'

const t = translator(dugout)

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
export function TeamInstructions({ t: tac, onChange }: { t: Tactics; onChange: (patch: Partial<Tactics>) => void }) {
  return (
    <div className="col" data-testid="team-instructions">
      <Instruction label={t('mentality')} help={MENTALITY_HELP[tac.mentality]}>
        <Segmented label={t('mentality')} value={tac.mentality} onChange={(v) => onChange({ mentality: v })} options={[{ value: 'defensive', label: t('defensive') }, { value: 'balanced', label: t('balancedOpt') }, { value: 'attacking', label: t('attacking') }]} />
      </Instruction>
      <Instruction label={t('tempo')} help={TEMPO_HELP[tac.tempo]}>
        <Segmented label={t('tempo')} value={tac.tempo} onChange={(v) => onChange({ tempo: v })} options={[{ value: 'slow', label: t('slow') }, { value: 'standard', label: t('standard') }, { value: 'fast', label: t('fast') }]} />
      </Instruction>
      <Instruction label={t('pressing')} help={PRESSING_HELP[tac.pressing]}>
        <Segmented label={t('pressing')} value={tac.pressing} onChange={(v) => onChange({ pressing: v })} options={[{ value: 'low', label: t('lowBlock') }, { value: 'mid', label: t('mid') }, { value: 'high', label: t('highPress') }]} />
      </Instruction>
      <Instruction label={t('defLine')} help={LINE_HELP[tac.defensiveLine]}>
        <Segmented label={t('defLine')} value={tac.defensiveLine} onChange={(v) => onChange({ defensiveLine: v })} options={[{ value: 'deep', label: t('deep') }, { value: 'standard', label: t('standard') }, { value: 'high', label: t('high') }]} />
      </Instruction>
      <Instruction label={t('width')} help={WIDTH_HELP[tac.width]}>
        <Segmented label={t('width')} value={tac.width} onChange={(v) => onChange({ width: v })} options={[{ value: 'narrow', label: t('narrow') }, { value: 'standard', label: t('standard') }, { value: 'wide', label: t('wide') }]} />
      </Instruction>
      <Instruction label={t('passing')} help={PASSING_HELP[tac.passing]}>
        <Segmented label={t('passing')} value={tac.passing} onChange={(v) => onChange({ passing: v })} options={[{ value: 'short', label: t('short') }, { value: 'mixed', label: t('mixed') }, { value: 'direct', label: t('direct') }]} />
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
      <Instruction label={t('captain')} help={t('captainHelp')}>
        <select className="input" style={{ width: 'auto' }} value={captainId && xi.some((p) => p.id === captainId) ? captainId : ''} onChange={(e) => onCaptain(e.target.value || undefined)} data-testid="captain-select" aria-label={t('captain')}>
          <option value="">{t('autoArmband')}</option>
          {leaders.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {score(p.attributes.mentality, 'mentality')}
            </option>
          ))}
        </select>
      </Instruction>
      <Instruction label={t('penalties')} help={t('penaltiesHint')}>
        <select className="input" style={{ width: 'auto' }} value={penalties && xi.some((p) => p.id === penalties) ? penalties : ''} onChange={(e) => onPenalties(e.target.value || undefined)} data-testid="penalty-select" aria-label={t('penaltyTaker')}>
          <option value="">{t('autoBest')}</option>
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
