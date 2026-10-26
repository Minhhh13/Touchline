import { useEffect, useMemo, useState } from 'react'
import { Gift } from 'lucide-react'
import { useStore } from '@game/store'
import type { Game } from '@game/types'
import type { LoadedUniverse } from '@engine/universe'
import { CASE_ITEMS, CASE_RARITIES, caseRarityOdds } from '@engine/endCase'
import { POWER_UP_INFO } from '@engine/powerups'
import { ratingHidden } from '@game/logic/ratingVisibility'
import { CASE_RARITY_LABEL, CASE_TIER, caseIconChoices, lockerCount } from '@game/logic/endCase'
import { caseGuide } from '@game/logic/caseGuide'
import { caseDropCard, caseFillers, caseItemCard, dealItems, type ItemDeal } from '@game/logic/itemReel'
import { playerLookup } from '@game/logic/players'
import { armAudio, unlockAudio } from '../sound/synth'
import { FULL_TIMING, QUICK_TIMING } from '../reelCurve'
import { quickSpinPref, usePref } from '../viewerPrefs'
import { clubName, seasonLabel } from '../format'
import { ItemReel } from './ItemReel'
import { SoundToggle, TierChip } from './CaseReel'
import { Pos, Rating } from './bits'
import { CaseItemIcon, isCaseItemKey, LOCKER_ICON, PowerUpIcon } from './icons'

/**
 * The end-of-draft case (`DraftRules.endCase`): the odds of each rarity first, then one case reel landing on what the
 * game already rolled (`game.endCase`, from a fork of its stream). A power-up goes into the locker for a later Quick
 * Draft; an Icon may come into the XI in place of a drafted starter, in a slot he can cover, or be passed up. Every
 * decision is the store's (`openCase`, `subCaseIcon`, `finishCase`). Beside the reel, the locker's counts; under the
 * odds, what each item does (`caseGuide`).
 */
export function EndCase({ u, game }: { u: LoadedUniverse; game: Game }) {
  const { openCase, subCaseIcon, finishCase, profile } = useStore()
  const c = game.endCase!
  const [quick] = usePref(quickSpinPref)
  // 0: not opened in this view; 1: the reel is running or has landed
  const [run, setRun] = useState(0)
  const [landed, setLanded] = useState(false)
  const [skip, setSkip] = useState(0)
  useEffect(armAudio, [])
  const deal = useMemo<ItemDeal | null>(() => (run ? dealItems(caseDropCard(c.drop), caseFillers(), Math.random) : null), [run, c.drop])
  // Opened before this view (a reload): the result shows at once
  const revealed = (c.opened && run === 0) || landed
  const spinning = run > 0 && !landed
  const odds = caseRarityOdds()
  const get = playerLookup(game, u)
  const icon = c.drop.kind === 'icon' ? get(c.drop.id) : undefined
  const choices = c.drop.kind === 'icon' ? caseIconChoices(game, u) : []
  // The Icon is still on offer; the starter making way is in the squad
  const hide = ratingHidden(game.settings.rules, 'offer')
  const card = caseDropCard(c.drop)
  const guide = caseGuide(profile)
  useEffect(() => {
    if (!spinning) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== ' ' && e.key !== 'Enter') || e.repeat) return
      e.preventDefault()
      setSkip((n) => n + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [spinning])

  return (
    <div className="page fit" data-testid="end-case">
      <div className="fit-head screen-head">
        <div className="col" style={{ gap: 4 }}>
          <h1>Your end-of-draft case</h1>
          <span className="small muted">One case per casual draft: a power-up for your locker, or with luck an Icon for this XI.</span>
        </div>
        <span className="mspin-sound">
          <SoundToggle />
        </span>
      </div>
      <div className="case-grid">
        <div className="col case-left">
        <div className="panel col case-main" onClick={() => spinning && setSkip((n) => n + 1)}>
          {run > 0 && deal ? (
            <ItemReel deal={deal} timing={quick ? QUICK_TIMING : FULL_TIMING} skip={skip} onSettled={() => setLanded(true)} testId="case-reel" />
          ) : (
            <div className="reel-run item-reel idle" data-testid="case-idle">
              <div className="reel-window" aria-hidden="true">
                <div className="reel-marker" />
                <div className="mspin-idle">{revealed && isCaseItemKey(card.key) ? <CaseItemIcon item={card.key} size="1em" /> : <Gift size="1em" aria-hidden="true" />}</div>
              </div>
            </div>
          )}
          {!c.opened && (
            <button type="button" className="btn primary big display" onClick={() => { unlockAudio(); openCase(); setRun(1) }} data-testid="case-open">
              Open the case
            </button>
          )}
          {spinning && (
            <button type="button" className="reel-skip" onClick={(e) => { e.stopPropagation(); setSkip((n) => n + 1) }} data-testid="case-skip">
              Tap to skip
            </button>
          )}
          {revealed && c.drop.kind === 'powerup' && (
            <div className="col case-result" data-testid="case-result" data-tier={card.tier} style={{ gap: 8 }}>
              <div className="row wrap" style={{ gap: 8 }}>
                <span className="case-face" aria-hidden="true">
                  <PowerUpIcon kind={c.drop.powerUp} size="1em" />
                </span>
                <b className="case-name">{POWER_UP_INFO[c.drop.powerUp].title}</b>
                <TierChip tier={card.tier} />
                <span className="chip">{CASE_RARITY_LABEL[c.drop.rarity]}</span>
              </div>
              <span className="help">{POWER_UP_INFO[c.drop.powerUp].line}</span>
              <span className="small" data-testid="case-locker">
                Into your locker: you hold {lockerCount(profile, c.drop.powerUp)}. Unpack it in a later Quick Draft played without the power-up tray.
              </span>
              <button type="button" className="btn primary" onClick={() => finishCase()} data-testid="case-done">
                On to kick-off
              </button>
            </div>
          )}
          {revealed && c.drop.kind === 'icon' && icon && (
            <div className="col case-result" data-testid="case-result" data-tier="icons" style={{ gap: 8 }}>
              <div className="row wrap" style={{ gap: 8 }}>
                <span className="case-face icon" aria-hidden="true">
                  <CaseItemIcon item="icon" size="1em" />
                </span>
                <b className="case-name" data-testid="case-icon-name">{icon.name}</b>
                <Rating value={icon.overall} hidden={hide} />
                {icon.positions.slice(0, 3).map((p) => (
                  <Pos key={p} p={p} />
                ))}
                <TierChip tier="icons" />
              </div>
              <span className="help">
                {clubName(u, icon.clubId)} {seasonLabel(icon.season)}, at his peak. Bring him in for one of your drafted starters in a slot he can cover: the man making way sits this season out, and the season counts as non-standard.
              </span>
              <div className="case-slots row wrap" style={{ gap: 6 }}>
                {choices.map((x) => (
                  <button key={x.slotId} type="button" className={`chip slot-chip ${x.fit === 'fits' ? 'good' : 'warn'}`} onClick={() => subCaseIcon(x.slotId)} data-testid="case-slot">
                    <b>{x.label}</b> {hide ? '?' : x.rating} · {x.fit} · for {x.outName.split(/\s+/).slice(-1)[0]}{ratingHidden(game.settings.rules, 'squad') ? '' : ` (${x.outRating})`}
                  </button>
                ))}
              </div>
              <button type="button" className="btn ghost" onClick={() => subCaseIcon(null)} data-testid="case-keep">
                Keep my XI
              </button>
            </div>
          )}
        </div>
        <div className="panel col case-locker" data-testid="case-locker-panel">
          <h3 className="icon-title">
            <LOCKER_ICON size={18} aria-hidden="true" /> Your locker
          </h3>
          <div className="case-locker-grid">
            {guide
              .filter((r) => r.held !== null)
              .map((r) => (
                <span key={r.item} className={`case-locker-item${r.held ? '' : ' empty'}`} data-tier={CASE_TIER[r.rarity]} title={r.line} data-testid={`case-held-${r.item}`}>
                  <CaseItemIcon item={r.item} size={16} />
                  <span className="name">{r.title}</span>
                  <b className="n">×{r.held}</b>
                </span>
              ))}
          </div>
          <span className="help">Power-ups wait here between drafts: unpack one in a later Quick Draft played without the power-up tray, and it is gone once used. An Icon never goes in the locker: he plays this season or not at all.</span>
        </div>
        </div>
        <div className="panel col case-odds" data-testid="case-odds">
          <h3>What's inside</h3>
          <div className="case-odds-bar" aria-hidden="true">
            {CASE_RARITIES.map((r) => (
              <span key={r} data-tier={CASE_TIER[r]} style={{ flexGrow: odds[r] }} />
            ))}
          </div>
          <table className="case-odds-table">
            <tbody>
              {[...CASE_RARITIES].reverse().map((r) => (
                <tr key={r} data-testid={`case-odds-${r}`} data-tier={CASE_TIER[r]}>
                  <td>
                    <i className="tier-dot" data-tier={CASE_TIER[r]} />
                  </td>
                  <td>
                    <b>{CASE_RARITY_LABEL[r]}</b>
                  </td>
                  <td className="mono">{odds[r]}%</td>
                  <td className="small">
                    {CASE_ITEMS.filter((x) => x.rarity === r).map((x, i) => (
                      <span key={x.item} className="case-odds-item">
                        {i > 0 && ' · '}
                        <CaseItemIcon item={x.item} size={13} /> {caseItemCard(x.item).label} {x.weight}%
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <span className="help">Exact odds: one roll of 100.</span>
          <h3>What each one does</h3>
          <ul className="case-guide" data-testid="case-guide">
            {guide.map((r) => (
              <li key={r.item} data-tier={CASE_TIER[r.rarity]}>
                <span className="case-guide-face" aria-hidden="true">
                  <CaseItemIcon item={r.item} size={16} />
                </span>
                <span className="col" style={{ gap: 1, minWidth: 0 }}>
                  <b>{r.title}</b>
                  <span className="small muted">{r.line}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
