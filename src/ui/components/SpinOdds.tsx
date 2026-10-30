import type { TierOdds } from '@game/logic/tierOdds'
import { shownOdds } from '@game/logic/oddsDisplay'
import { translator } from '../i18n'
import { draft } from '../i18n/en/draft'
import { oddsNote, reelTierName, tierColour, tierWord } from '../i18n/engineText'

const t = translator(draft)

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
    <div className="spin-odds" data-testid="spin-odds" data-exact={shown.exact ? 'yes' : 'no'} role="img" aria-label={`${label}, ${oddsNote(shown.exact)}: ${odds.map((o, i) => `${tierColour(o.tier)} ${shown.labels[i]}`).join(', ')}`}>
      <div className="spin-odds-head">
        <span className="lbl">{label}</span>
        <span className="muted small" data-testid="spin-odds-note" title={t(shown.exact ? 'oddsExactTip' : 'oddsRoundedTip')}>
          {oddsNote(shown.exact)}
        </span>
      </div>
      <div className="spin-odds-bar" aria-hidden="true">
        {odds.map((o) => (o.p > 0 ? <span key={o.tier} data-tier={o.tier} style={{ flexGrow: o.p }} /> : null))}
      </div>
      <div className="spin-odds-list">
        {odds.map((o, i) => (
          <span key={o.tier} className={`spin-odds-item${o.p > 0 ? '' : ' zero'}`} data-tier={o.tier} data-testid={`odds-${o.tier}`} title={reelTierName(o.tier)}>
            <i aria-hidden="true" />
            {tierColour(o.tier)} <b>{shown.labels[i]}</b>
          </span>
        ))}
      </div>
      {/* The colours are the club-seasons' strength, strongest first: a phone has no hover for each one's name */}
      {odds.length > 1 && (
        <div className="muted small spin-odds-key" data-testid="spin-odds-key" aria-hidden="true">
          {t('oddsKey', { top: tierColour(odds[0].tier), topWord: tierWord(odds[0].tier), bottom: tierColour(odds[odds.length - 1].tier), bottomWord: tierWord(odds[odds.length - 1].tier) })}
        </div>
      )}
    </div>
  )
}
