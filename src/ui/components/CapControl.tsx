import { affordable, BUDGET_FLOOR, capMoney, capPrice, capRefusal, capRoom, capSpent, type DraftState } from '@engine/draft'
import type { PlayerSeason } from '@engine/types'
import { CAP_CUSTOM_RANGE, CAP_CUSTOM_STEP, CAP_PRESETS, capBudget, capTotal, capXI, type CapChoice, type CapPreset } from '@game/logic/cap'
import { Segmented } from './bits'

/** The salary cap setting (Setup and the arena setup): Off, the three presets or a custom cap, scaled to the squad drafted. */
export function CapControl({ value, onChange, squadSize }: { value: CapChoice; onChange: (c: CapChoice) => void; squadSize: number }) {
  const budget = capBudget(value, squadSize)
  const xi = capXI(value)
  return (
    <div className="field" data-testid="cap-control">
      Salary cap
      <Segmented<CapPreset> value={value.preset} onChange={(preset) => onChange({ ...value, preset })} options={CAP_PRESETS.map((p) => ({ value: p.value, label: p.label, hint: p.hint }))} />
      {value.preset === 'custom' && (
        <input type="range" min={CAP_CUSTOM_RANGE[0]} max={CAP_CUSTOM_RANGE[1]} step={CAP_CUSTOM_STEP} value={value.custom} onChange={(e) => onChange({ ...value, custom: Number(e.target.value) })} aria-label="Custom cap for an XI" data-testid="cap-custom" />
      )}
      <span className="help" data-testid="cap-help">
        {budget === undefined
          ? 'Off: draft anyone the wheel lands on. With a cap every player carries a price by rating and position (never age), and the draft may not spend more.'
          : `${capTotal(budget)} for ${squadSize} picks${squadSize > 11 ? ` (${capTotal(xi ?? 0)} for an XI, plus 8% a pick beyond eleven)` : ''}. Every player carries a price by rating and position, never age; ${capMoney(BUDGET_FLOOR)} is kept for each pick still to make, so the wheel never runs dry.`}
      </span>
    </div>
  )
}

/** The Draft header's cap chip: `£178M of £180M`, with what the next pick may cost in its tooltip. */
export function CapChip({ d }: { d: DraftState }) {
  if (d.rules.budget === undefined) return null
  return (
    <span className="chip" data-testid="cap-chip" title={`Salary cap: up to ${capMoney(Math.max(0, capRoom(d)))} on the next pick`}>
      {capTotal(capSpent(d))} of {capTotal(d.rules.budget)}
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
