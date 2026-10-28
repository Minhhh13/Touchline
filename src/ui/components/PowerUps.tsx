import { useEffect, useState } from 'react'
import { useStore } from '@game/store'
import { isComplete, positionFirst, targetSlot, type DraftState } from '@engine/draft'
import { ICONS_SEASON } from '@engine/icons'
import type { PlayerSeason } from '@engine/types'
import type { LoadedUniverse } from '@engine/universe'
import { ARMBAND_BOOST, armbandId, canArmband, canLock, canPeek, canReroll, canSwap, lockedId, peekedSeason, powerUpUsed, rerollOptions, swapTargets, trayKinds } from '@engine/powerups'
import { Package } from 'lucide-react'
import { LOCKER_ICON, PowerUpIcon } from './icons'
import { canUpgrade, upgradeBaseRating, upgradeCandidates } from '@engine/upgrader'
import { draftTurnKey, openWindow, type TurnWindow } from '@game/logic/draftTurn'
import { Modal, Pos } from './bits'
import { PowerUpButton } from './PowerUpButton'
import { Upgrader } from './Upgrader'
import { seasonLabel } from '../format'
import { translator } from '../i18n'
import { draft } from '../i18n/en/draft'
import { rich, B } from '../i18n/rich'
import { powerUpLine, powerUpTitle } from '../i18n/engineText'

const t = translator(draft)

type Sheet = 'reroll' | 'swap' | 'armband' | 'lock'

/**
 * The power-up tray on a Quick Draft with power-ups: six one-use buttons (the Upgrader, Re-roll season, Peek, Swap,
 * Captain's armband, Lock), each with an Info tip, and a sheet for those that need a choice. Every decision is the
 * store's and the engine's (`src/engine/powerups.ts`); this only shows what each would do, with the odds first.
 * Every sheet belongs to the draft turn it was opened on (`draftTurnKey`): a spin, a pick or a Speedrun timeout closes
 * it, and its confirm button acts only while the store's draft is still on that turn.
 */
export function PowerUpTray({ u, d, get, hideRatings, busy, onRerolled, onRolling }: { u: LoadedUniverse; d: DraftState; get: (id: string) => PlayerSeason | undefined; hideRatings: boolean; /** The reel is running. */ busy: boolean; onRerolled: () => void; /** The Upgrader's dial is turning (the Speedrun clock waits for it as for the reel). */ onRolling?: (rolling: boolean) => void }) {
  const { game, upgradePlayer, rerollSeason, peekSpin, swapSlots, giveArmband, lockPlayer } = useStore()
  const turn = draftTurnKey(d)
  const [win, setWin] = useState<TurnWindow<Sheet> | null>(null)
  const sheet = openWindow(win, turn)
  const setSheet = (kind: Sheet) => setWin({ kind, turn })
  const [from, setFrom] = useState<string | null>(null)
  const [to, setTo] = useState<string | null>(null)
  const [who, setWho] = useState<string | null>(null)
  const drafting = game?.phase === 'draft'
  const complete = isComplete(d)
  const players = upgradeCandidates(d).flatMap((id) => get(id) ?? [])
  const options = rerollOptions(u, d)
  const peeked = peekedSeason(d)
  const lock = lockedId(d)
  const band = armbandId(d)
  const slotPos = (id: string) => d.formation.slots.find((s) => s.id === id)?.position
  const nameOf = (id: string) => get(id)?.name ?? t('yourPlayer')
  const close = () => {
    setWin(null)
    setFrom(null)
    setTo(null)
    setWho(null)
  }
  // A new turn (a spin, a pick, the assistant's pick on a Speedrun timeout) closes whatever was open on the last one
  useEffect(() => {
    setWin(null)
    setFrom(null)
    setTo(null)
    setWho(null)
  }, [turn])
  /** Whether the store's draft is still on the turn this sheet was opened on: a confirm on a later turn does nothing. */
  const onItsTurn = () => {
    const live = useStore.getState().game?.draft
    return !!win && !!live && draftTurnKey(live) === win.turn
  }

  const peekUse = d.powerUps?.find((x) => x.kind === 'peek')
  const rerollUse = d.powerUps?.find((x) => x.kind === 'reroll')
  const swapUse = d.powerUps?.find((x) => x.kind === 'swap')
  const status = {
    reroll: rerollUse && rerollUse.kind === 'reroll' ? `→ ${seasonLabel(rerollUse.to)}` : busy ? t('reelBusy') : !d.current ? t('afterSpin') : options.length ? t('seasonsCount', { n: options.length }) : t('noneLeft'),
    peek: peekUse && peekUse.kind === 'peek' ? (peeked !== null ? t('peekNext', { season: peeked === ICONS_SEASON ? t('icons') : seasonLabel(peeked) }) : t('peekSaw', { season: peekUse.season === ICONS_SEASON ? t('icons') : seasonLabel(peekUse.season) })) : t(complete ? 'draftDone' : d.current ? 'beforeSpin' : positionFirst(d) && !targetSlot(d) ? 'chooseSlot' : 'ready'),
    swap: swapUse && swapUse.kind === 'swap' ? `${slotPos(swapUse.from)} ⇄ ${slotPos(swapUse.to)}` : t(d.current ? 'betweenSpins' : canSwap(u, d) ? 'ready' : 'noMoveYet'),
    armband: band ? `${nameOf(band)} +${ARMBAND_BOOST}` : t(canArmband(d) ? 'ready' : 'draftAPlayer'),
    lock: lock ? nameOf(lock) : t(d.upgrade ? 'upgraderUsed' : canLock(d) ? 'ready' : 'draftAPlayer'),
  }
  const starters = d.formation.slots.filter((s) => d.lineup[s.id] && swapTargets(u, d, s.id).length)
  const targets = from ? swapTargets(u, d, from) : []
  // The whole tray, or only what was unpacked from the locker into a draft without it
  const kinds = trayKinds(d)
  const fromLocker = !d.rules.powerUps

  return (
    <div className="panel tight pu-tray" data-testid="power-ups">
      <div className="row between wrap pu-head" style={{ marginBottom: 8 }}>
        <b className="row" style={{ gap: 6 }}>
          {fromLocker ? <LOCKER_ICON size={16} aria-hidden="true" /> : <Package size={16} aria-hidden="true" />}
          {t(fromLocker ? 'fromLocker' : 'powerUps')}
        </b>
        <span className="small muted">{t('oneUseEach')}</span>
      </div>
      {peeked !== null && (
        <div className="notice small" data-testid="peek-notice" style={{ marginBottom: 8 }}>
          <PowerUpIcon kind="peek" size={14} /> {rich(t('peekNotice', { where: peeked === ICONS_SEASON ? t('theIconsCollection') : seasonLabel(peeked) }), B)}
        </div>
      )}
      <div className="pu-grid">
        {kinds.includes('upgrader') && (
          <Upgrader tray turn={turn} onRolling={onRolling} players={players} ratingOf={(id) => upgradeBaseRating(u, d, id) ?? 0} available={canUpgrade(d) && drafting} result={d.upgrade} hideRatings={hideRatings} lockedId={lock} onConfirm={(id, boost) => upgradePlayer(id, boost)} />
        )}
        {kinds.includes('reroll') && (
          <PowerUpButton icon={<PowerUpIcon kind="reroll" />} title={powerUpTitle('reroll')} short={t('rerollShort')} line={powerUpLine('reroll')} status={status.reroll} used={powerUpUsed(d, 'reroll')} disabled={!drafting || busy || !canReroll(u, d)} onClick={() => setSheet('reroll')} testId="pu-reroll" />
        )}
        {kinds.includes('peek') && (
          <PowerUpButton icon={<PowerUpIcon kind="peek" />} title={powerUpTitle('peek')} line={powerUpLine('peek')} status={status.peek} used={powerUpUsed(d, 'peek')} disabled={!drafting || busy || !canPeek(u, d)} onClick={() => peekSpin()} testId="pu-peek" />
        )}
        {kinds.includes('swap') && (
          <PowerUpButton icon={<PowerUpIcon kind="swap" />} title={powerUpTitle('swap')} line={powerUpLine('swap')} status={status.swap} used={powerUpUsed(d, 'swap')} disabled={!drafting || busy || !canSwap(u, d)} onClick={() => setSheet('swap')} testId="pu-swap" />
        )}
        {kinds.includes('armband') && (
          <PowerUpButton icon={<PowerUpIcon kind="armband" />} title={powerUpTitle('armband')} short={t('armbandShort')} line={powerUpLine('armband')} status={status.armband} used={powerUpUsed(d, 'armband')} disabled={!drafting || !canArmband(d)} onClick={() => setSheet('armband')} testId="pu-armband" />
        )}
        {kinds.includes('lock') && (
          <PowerUpButton icon={<PowerUpIcon kind="lock" />} title={powerUpTitle('lock')} line={powerUpLine('lock')} status={status.lock} used={powerUpUsed(d, 'lock')} disabled={!drafting || !canLock(d)} onClick={() => setSheet('lock')} testId="pu-lock" />
        )}
      </div>

      <Modal open={sheet === 'reroll'} onClose={close} title={t('rerollTitle')} sheet testId="reroll-sheet">
        <div className="col" style={{ gap: 10 }}>
          <div className="small muted">{t('rerollIntro')}</div>
          <div className="pu-odds" data-testid="reroll-odds">
            {options.map((cs) => (
              <span key={cs.season} className="pu-odd">
                {seasonLabel(cs.season)} <b>{t('oneIn', { n: options.length })}</b>
              </span>
            ))}
          </div>
          <button
            className="btn primary"
            disabled={!options.length}
            onClick={() => {
              if (onItsTurn()) {
                rerollSeason()
                onRerolled()
              }
              close()
            }}
            data-testid="reroll-confirm"
          >
            {options.length ? t('rerollConfirm', { n: options.length }) : t('noOtherSeason')}
          </button>
          <div className="tiny-note small muted">{t('inGameOnlyChances')}</div>
        </div>
      </Modal>

      <Modal open={sheet === 'swap'} onClose={close} title={t('swapTitle')} sheet testId="swap-sheet">
        <div className="col" style={{ gap: 10 }}>
          <div className="small muted">{from ? t('moveTo', { name: nameOf(d.lineup[from]) }) : t('swapIntro')}</div>
          <div className="upg-players" role="listbox" aria-label={t(from ? 'slots' : 'startersLabel')}>
            {!from &&
              starters.map((s) => {
                const p = get(d.lineup[s.id])
                return (
                  <button key={s.id} type="button" role="option" aria-selected={false} className="upg-player" onClick={() => setFrom(s.id)} data-testid="swap-from">
                    <Pos p={s.position} />
                    <span className="nm">{p?.name ?? '?'}</span>
                  </button>
                )
              })}
            {from &&
              targets.map((id) => {
                const occupant = d.lineup[id] ? get(d.lineup[id]) : undefined
                const pos = slotPos(id)
                return (
                  <button key={id} type="button" role="option" aria-selected={to === id} className={`upg-player${to === id ? ' on' : ''}`} onClick={() => setTo(id)} data-testid="swap-to">
                    {pos && <Pos p={pos} />}
                    <span className="nm">{occupant ? `⇄ ${occupant.name}` : t('openSlot')}</span>
                  </button>
                )
              })}
          </div>
          <div className="row between">
            <button className="btn sm ghost" disabled={!from} onClick={() => { setFrom(null); setTo(null) }}>
              {t('back')}
            </button>
            <button
              className="btn primary"
              disabled={!from || !to}
              onClick={() => {
                if (from && to && onItsTurn()) swapSlots(from, to)
                close()
              }}
              data-testid="swap-confirm"
            >
              {from && to ? t('moveToPos', { pos: slotPos(to) }) : t('chooseSlot')}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={sheet === 'armband' || sheet === 'lock'} onClose={close} title={t(sheet === 'lock' ? 'lockTitle' : 'armbandTitle')} sheet testId="pick-sheet">
        <div className="col" style={{ gap: 10 }}>
          <div className="small muted">{sheet === 'lock' ? t('lockIntro') : t('armbandIntro', { n: ARMBAND_BOOST })}</div>
          <div className="upg-players" role="listbox" aria-label={t('draftedPlayers')}>
            {players.map((p) => (
              <button key={p.id} type="button" role="option" aria-selected={who === p.id} className={`upg-player${who === p.id ? ' on' : ''}`} onClick={() => setWho(p.id)} data-testid="pu-player">
                <Pos p={p.positions[0]} />
                <span className="nm">{p.name}</span>
                {!hideRatings && <b>{p.overall}</b>}
              </button>
            ))}
          </div>
          <button
            className="btn primary"
            disabled={!who}
            onClick={() => {
              if (who && onItsTurn()) (sheet === 'lock' ? lockPlayer : giveArmband)(who)
              close()
            }}
            data-testid="pu-player-confirm"
          >
            {who ? t(sheet === 'lock' ? 'lockWho' : 'armbandWho', { name: nameOf(who) }) : t('choosePlayer')}
          </button>
        </div>
      </Modal>
    </div>
  )
}
