import { DISPLAY_TIER_INFO } from '@game/logic/rarity'
import type { TierOdds } from '@game/logic/tierOdds'
import { shownOdds } from '@game/logic/oddsDisplay'

/**
 * The odds panel by the reel: the chance of each rarity tier on the next spin, as a bar of tier-coloured segments
 * and a row of tier-coloured percentages. Computed by the game logic (`tierOdds`, the manager spin's and the January
 * case's); printed through `shownOdds`, so the figures add up to exactly 100.0% and the note says "exact odds" only
 * when they are the exact chances, "odds (rounded)" otherwise.
 */
export function SpinOdds({ odds, label }: { odds: readonly TierOdds[]; label: string }) {
  if (!odds.length) return null
  const shown = shownOdds(odds.map((o) => o.p))
  return (
    <div className="spin-odds" data-testid="spin-odds" data-exact={shown.exact ? 'yes' : 'no'} role="img" aria-label={`${label}, ${shown.note}: ${odds.map((o, i) => `${DISPLAY_TIER_INFO[o.tier].colour} ${shown.labels[i]}`).join(', ')}`}>
      <div className="spin-odds-head">
        <span className="lbl">{label}</span>
        <span className="muted small" data-testid="spin-odds-note" title={shown.exact ? 'These are the exact chances' : 'Each chance rounded to a tenth of a per cent; together they make exactly 100%'}>
          {shown.note}
        </span>
      </div>
      <div className="spin-odds-bar" aria-hidden="true">
        {odds.map((o) => (o.p > 0 ? <span key={o.tier} data-tier={o.tier} style={{ flexGrow: o.p }} /> : null))}
      </div>
      <div className="spin-odds-list">
        {odds.map((o, i) => (
          <span key={o.tier} className={`spin-odds-item${o.p > 0 ? '' : ' zero'}`} data-tier={o.tier} data-testid={`odds-${o.tier}`} title={`${DISPLAY_TIER_INFO[o.tier].colour} · ${DISPLAY_TIER_INFO[o.tier].label}`}>
            <i aria-hidden="true" />
            {DISPLAY_TIER_INFO[o.tier].colour} <b>{shown.labels[i]}</b>
          </span>
        ))}
      </div>
    </div>
  )
}
