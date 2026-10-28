import { useOnline, type SyncConflict } from '../../online/state'
import type { SaveMeta } from '../../online/core/slots'
import * as api from '../../online/api'
import { askConfirm } from '../confirm'
import { translator } from '../i18n'
import { saving } from '../i18n/en/saving'

const t = translator(saving)

const SLOT_LABEL: Record<string, () => string> = { quick: () => t('slotQuick'), season: () => t('slotSeason'), dynasty: () => t('slotDynasty'), h2h: () => t('slotH2H') }

function describe(m: SaveMeta | null): string {
  if (!m) return t('aGame')
  const where = m.phase === 'draft' ? t('drafting') : m.phase === 'summary' ? t('seasonComplete') : m.matchweek ? t('matchweekLower', { n: m.matchweek }) : m.phase
  return t('describeSave', { team: m.teamName, where, year: m.mode === 'dynasty' ? t('yearSuffix', { year: m.year }) : '', device: m.deviceLabel ? t('onDevice', { device: m.deviceLabel }) : '' })
}

function Card({ c }: { c: SyncConflict }) {
  const label = SLOT_LABEL[c.slot]?.() ?? c.slot
  if (c.kind === 'newer')
    return (
      <div className="notice row between wrap" data-testid="conflict-newer">
        <span>{t('newerProgress', { label, from: describe(c.remote) })}</span>
        <button className="btn sm primary" onClick={() => void api.resolveConflict({ slot: c.slot, choice: 'load' })}>
          {t('loadIt')}
        </button>
      </div>
    )
  if (c.kind === 'abandoned')
    return (
      <div className="notice warn col" data-testid="conflict-abandoned">
        <span>
          {t(c.at ? 'abandonedOn' : 'abandoned', { label, date: c.at?.slice(0, 10) })}
        </span>
        <div className="row wrap">
          <button className="btn sm" onClick={() => void api.resolveConflict({ slot: c.slot, choice: 'keep' })}>
            {t('keepHere')}
          </button>
          <button className="btn sm ghost danger" onClick={() => void api.resolveConflict({ slot: c.slot, choice: 'remove' })}>
            {t('removeHere')}
          </button>
        </div>
      </div>
    )
  return (
    <div className="notice warn col" data-testid="conflict-different">
      <span>
        {t('twoGames', { label, local: describe(c.local), remote: describe(c.remote) })}
      </span>
      <div className="row wrap">
        <button className="btn sm" onClick={() => void api.resolveConflict({ slot: c.slot, choice: 'keep_local' })}>
          {t('keepDevice')}
        </button>
        <button className="btn sm" onClick={() => void api.resolveConflict({ slot: c.slot, choice: 'use_cloud' })}>
          {t('useCloud')}
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
          <span>{t('accountSwitch')}</span>
          <div className="row wrap">
            <button className="btn sm" onClick={() => void api.chooseAccount('upload')}>
              {t('uploadThem')}
            </button>
            <button className="btn sm" onClick={() => void api.chooseAccount('keep')}>
              {t('keepThem')}
            </button>
            <button className="btn sm ghost danger" onClick={() => void askConfirm(t('replaceConfirm'), { ok: t('replaceOk'), danger: true }).then((ok) => { if (ok) void api.chooseAccount('replace') })}>
              {t('replaceThem')}
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
