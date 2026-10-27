import { useOnline, type SyncConflict } from '../../online/state'
import type { SaveMeta } from '../../online/core/slots'
import * as api from '../../online/api'
import { askConfirm } from '../confirm'

const SLOT_LABEL: Record<string, string> = { quick: 'Quick Draft', season: 'Season', dynasty: 'Dynasty', h2h: 'head-to-head' }

function describe(m: SaveMeta | null): string {
  if (!m) return 'a game'
  const where = m.phase === 'draft' ? 'drafting' : m.phase === 'summary' ? 'season complete' : m.matchweek ? `matchweek ${m.matchweek}` : m.phase
  return `${m.teamName} (${where}${m.mode === 'dynasty' ? `, year ${m.year}` : ''})${m.deviceLabel ? ` on ${m.deviceLabel}` : ''}`
}

function Card({ c }: { c: SyncConflict }) {
  const label = SLOT_LABEL[c.slot] ?? c.slot
  if (c.kind === 'newer')
    return (
      <div className="notice row between wrap" data-testid="conflict-newer">
        <span>Newer progress of this {label} from {describe(c.remote)}.</span>
        <button className="btn sm primary" onClick={() => void api.resolveConflict({ slot: c.slot, choice: 'load' })}>
          Load it
        </button>
      </div>
    )
  if (c.kind === 'abandoned')
    return (
      <div className="notice warn col" data-testid="conflict-abandoned">
        <span>
          This {label} was abandoned on another device{c.at ? ` on ${c.at.slice(0, 10)}` : ''}.
        </span>
        <div className="row wrap">
          <button className="btn sm" onClick={() => void api.resolveConflict({ slot: c.slot, choice: 'keep' })}>
            Keep it here
          </button>
          <button className="btn sm ghost danger" onClick={() => void api.resolveConflict({ slot: c.slot, choice: 'remove' })}>
            Remove it here
          </button>
        </div>
      </div>
    )
  return (
    <div className="notice warn col" data-testid="conflict-different">
      <span>
        Two different {label} games: this device has {describe(c.local)}; the cloud has {describe(c.remote)}. The one you do not keep stays in Cloud history.
      </span>
      <div className="row wrap">
        <button className="btn sm" onClick={() => void api.resolveConflict({ slot: c.slot, choice: 'keep_local' })}>
          Keep this device's
        </button>
        <button className="btn sm" onClick={() => void api.resolveConflict({ slot: c.slot, choice: 'use_cloud' })}>
          Use the cloud's
        </button>
      </div>
    </div>
  )
}

/** Sync questions waiting for the player (Home and the Account screen): never blocking, one card each. */
export function ConflictCards() {
  const conflicts = useOnline((s) => s.conflicts)
  const accountSwitch = useOnline((s) => s.accountSwitch)
  if (!conflicts.length && !accountSwitch) return null
  return (
    <div className="col" style={{ marginBottom: 14 }}>
      {accountSwitch && (
        <div className="notice warn col" data-testid="account-switch">
          <span>Another account synced the games on this device before. What should happen to them?</span>
          <div className="row wrap">
            <button className="btn sm" onClick={() => void api.chooseAccount('upload')}>
              Upload them to this account
            </button>
            <button className="btn sm" onClick={() => void api.chooseAccount('keep')}>
              Keep them on this device only
            </button>
            <button className="btn sm ghost danger" onClick={() => void askConfirm("Replace this device's games with this account's cloud saves?", { ok: 'Replace', danger: true }).then((ok) => { if (ok) void api.chooseAccount('replace') })}>
              Replace them with this account's
            </button>
          </div>
        </div>
      )}
      {conflicts.map((c) => (
        <Card key={`${c.kind}-${c.slot}`} c={c} />
      ))}
    </div>
  )
}
