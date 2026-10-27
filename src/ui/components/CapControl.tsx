import { affordable, BUDGET_FLOOR, capMoney, capPrice, capRefusal, capRoom, capSpent, type DraftState } from '@engine/draft'
import type { PlayerSeason } from '@engine/types'
import { CAP_CUSTOM_RANGE, CAP_CUSTOM_STEP, CAP_PRESETS, capBudget, capTotal, capXI, type CapChoice, type CapPreset } from '@game/logic/cap'
import { Segmented } from './bits'
import { translator } from '../i18n'
import { setup } from '../i18n/en/setup'

const t = translator(setup)

/** The salary cap setting (Setup and the arena setup): Off, the three presets or a custom cap, scaled to the squad drafted. */
export function CapControl({ value, onChange, squadSize, note }: { value: CapChoice; onChange: (c: CapChoice) => void; squadSize: number; note?: string }) {
  const budget = capBudget(value, squadSize)
  const xi = capXI(value)
  return (
    <div className="field" data-testid="cap-control">
      {t('salaryCap')}
      <Segmented<CapPreset> value={value.preset} onChange={(preset) => onChange({ ...value, preset })} options={CAP_PRESETS.map((p) => ({ value: p.value, label: p.label, hint: p.hint }))} />
      {value.preset === 'custom' && (
        <input type="range" min={CAP_CUSTOM_RANGE[0]} max={CAP_CUSTOM_RANGE[1]} step={CAP_CUSTOM_STEP} value={value.custom} onChange={(e) => onChange({ ...value, custom: Number(e.target.value) })} aria-label={t('capCustom')} data-testid="cap-custom" style={{ display: 'block', width: '100%' }} />
      )}
      <span className="help" data-testid="cap-help">
        {budget === undefined
          ? t('capOff')
          : t('capHelp', { total: capTotal(budget), n: squadSize, xi: squadSize > 11 ? t('capXi', { total: capTotal(xi ?? 0) }) : '', floor: capMoney(BUDGET_FLOOR) })}
        {note ? ` ${note}` : ''}
      </span>
    </div>
  )
}

/** The Draft header's cap chip: `£178M of £180M`, with what the next pick may cost in its tooltip. */
export function CapChip({ d }: { d: DraftState }) {
  if (d.rules.budget === undefined) return null
  return (
    <span className="chip" data-testid="cap-chip" title={t('capChipTip', { room: capMoney(Math.max(0, capRoom(d))) })}>
      {t('capOf', { spent: capTotal(capSpent(d)), budget: capTotal(d.rules.budget) })}
    </span>
  )
}

/** A squad row's price under the cap, and a `£` chip when he cannot be afforded (the reason in its tooltip). */
export function CapChips({ d, p, show }: { d: DraftState; p: PlayerSeason; show: boolean }) {
  if (d.rules.budget === undefined) return null
  const over = show && !affordable(d, p)
  return (
    <>
      <span className="chip" data-testid="cap-price">
        {capMoney(capPrice(p))}
      </span>
      {over && (
        <span className="chip bad" data-testid="cap-over" title={capRefusal(d, p) ?? ''}>
          £
        </span>
      )}
    </>
  )
}
