import { chainAllows, chainBroken, type DraftState } from '@engine/draft'
import { sharedClubSeasons } from '@engine/teammates'
import type { PlayerSeason } from '@engine/types'
import type { LoadedUniverse } from '@engine/universe'
import { clubName, seasonLabel } from '../format'

/** `Real Madrid 2017-18` from a club-season key. */
function clubSeasonName(u: LoadedUniverse, key: string): string {
  const at = key.lastIndexOf('@')
  return `${clubName(u, key.slice(0, at))} ${seasonLabel(Number(key.slice(at + 1)))}`
}

/** The name of the pick the chain follows from. */
function anchorName(u: LoadedUniverse, d: DraftState): string {
  return (d.chainFrom && u.index[d.chainFrom]?.name) || 'your last pick'
}

/** The Teammate Chain setting (Setup, under Wheel rules). */
export function ChainToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle" title="Every club-season the wheel lands on holds a former teammate of your last pick, and you draft one of them. When no club-season has one left, the next spin is free and the chain starts again." data-testid="chain-toggle">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      Teammate chain: every pick played beside the one before
    </label>
  )
}

/** The wheel column's line on the chain: who the next pick must have played with, or that it broke (`due`: `chainBreakDue` before a spin). */
export function ChainStatus({ u, d, due }: { u: LoadedUniverse; d: DraftState; due: boolean }) {
  if (!d.rules.chain || !d.chainFrom) return null
  const name = anchorName(u, d)
  if (d.current ? chainBroken(d) : due)
    return (
      <div className="notice warn" data-testid="chain-broken">
        🔗 Chain broken: no teammate of {name} left on the wheel. {d.current ? 'This spin is free' : 'The next spin is free'}, and the chain starts again from that pick.
      </div>
    )
  return (
    <div className="notice" data-testid="chain-status">
      🔗 Teammate chain: {d.current ? 'draft' : 'the wheel lands on a squad holding'} a former teammate of <b>{name}</b>.
    </div>
  )
}

/** A squad row's chain chip: the club-season he shared with the last pick, or "not a teammate" (the row is dimmed). */
export function ChainChip({ u, d, p, show }: { u: LoadedUniverse; d: DraftState; p: PlayerSeason; show: boolean }) {
  if (!d.rules.chain || !d.chainMates || !d.chainFrom || !show) return null
  if (!chainAllows(d, p))
    return (
      <span className="chip" data-testid="chain-stranger" title={`${p.name} never shared a dressing room with ${anchorName(u, d)} on this wheel`}>
        not a teammate
      </span>
    )
  const from = u.index[d.chainFrom]
  const link = from && sharedClubSeasons(u, d.rules.leagues, from.playerId, p.playerId)[0]
  if (!from || !link) return null
  return (
    <span className="chip" data-testid="chain-link" title={`With ${from.name} at ${clubSeasonName(u, link)}`}>
      🔗 {clubSeasonName(u, link)}
    </span>
  )
}

/** The draft log's chain note on a pick: `Kroos → Modrić, Real Madrid 2017-18`, or the break before it. */
export function ChainLogNote({ u, h, prevName, name }: { u: LoadedUniverse; h: DraftState['history'][number]; prevName?: string; name: string }) {
  if (h.chainBroken)
    return (
      <span className="muted" data-testid="chain-log-broken">
        🔗 chain broken{prevName ? `: no teammate of ${prevName} left` : ''}
      </span>
    )
  if (!h.chainLink || !prevName) return null
  return (
    <span className="muted" data-testid="chain-log-link">
      🔗 {prevName} → {name}, {clubSeasonName(u, h.chainLink)}
    </span>
  )
}
