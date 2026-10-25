import { DISPLAY_TIER_INFO } from '@game/logic/rarity'
import { formatOdds, type TierOdds } from '@game/logic/odds'

/**
 * The odds panel by the reel: the exact chance of each rarity tier on the next spin, as a bar of tier-coloured
 * segments and a row of tier-coloured percentages. Computed by the game logic (`tierOdds`); this only draws it.
 */
export function SpinOdds({ odds, label }: { odds: readonly TierOdds[]; label: string }) {
  if (!odds.length) return null
  return (
    <div className="spin-odds" data-testid="spin-odds" aria-label={`${label}: ${odds.map((o) => `${DISPLAY_TIER_INFO[o.tier].colour} ${formatOdds(o.p)}`).join(', ')}`}>
      <div className="spin-odds-head">
        <span className="lbl">{label}</span>
        <span className="muted small">exact odds</span>
      </div>
      <div className="spin-odds-bar" aria-hidden="true">
        {odds.map((o) => (o.p > 0 ? <span key={o.tier} data-tier={o.tier} style={{ flexGrow: o.p }} /> : null))}
      </div>
      <div className="spin-odds-list">
        {odds.map((o) => (
          <span key={o.tier} className={`spin-odds-item${o.p > 0 ? '' : ' zero'}`} data-tier={o.tier} data-testid={`odds-${o.tier}`} title={`${DISPLAY_TIER_INFO[o.tier].colour} · ${DISPLAY_TIER_INFO[o.tier].label}`}>
            <i aria-hidden="true" />
            {DISPLAY_TIER_INFO[o.tier].colour} <b>{formatOdds(o.p)}</b>
          </span>
        ))}
      </div>
    </div>
  )
}
