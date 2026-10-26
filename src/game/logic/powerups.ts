/**
 * The words for the power-ups a draft used (`src/engine/powerups.ts`): one line each for the draft log, and one line
 * of icons for the share text. Pure: names and seasons come in through the callers' formatters.
 */
import type { DraftState } from '@engine/draft'
import { ICONS_SEASON } from '@engine/icons'
import { ARMBAND_BOOST, POWER_UP_INFO, POWER_UPS, POWER_UPS_ICON, powerUpUsed, type PowerUp } from '@engine/powerups'

export interface PowerUpLogLine {
  /** The history row it belongs to (0-based), for ordering beside the draft log. */
  at: number
  /** Which power-up, for the screen's picture. */
  kind: PowerUp
  /** Its emoji, for text. */
  icon: string
  text: string
}

/** One line per power-up used, in the order used (the Upgrader by its pick's row), for the draft log. */
export function powerUpLog(d: DraftState, nameOf: (playerSeasonId: string) => string, seasonText: (season: number) => string): PowerUpLogLine[] {
  const slotName = (id: string) => d.formation.slots.find((s) => s.id === id)?.position ?? id
  const lines: PowerUpLogLine[] = (d.powerUps ?? []).map((x) => {
    const icon = POWER_UP_INFO[x.kind].icon
    const kind = x.kind
    switch (x.kind) {
      case 'reroll':
        return { at: x.at, kind, icon, text: `Spin ${x.at + 1}: season re-rolled, ${seasonText(x.from)} to ${seasonText(x.to)} (1 in ${x.options})` }
      case 'peek':
        return { at: x.at, kind, icon, text: `Peeked at spin ${x.at + 1}: ${x.season === ICONS_SEASON ? 'the Icons collection' : seasonText(x.season)}` }
      case 'swap':
        return { at: x.at, kind, icon, text: `Swapped ${slotName(x.from)} and ${slotName(x.to)}` }
      case 'armband':
        return { at: x.at, kind, icon, text: `Armband to ${nameOf(x.id)} (+${ARMBAND_BOOST})` }
      case 'lock':
        return { at: x.at, kind, icon, text: `Locked ${nameOf(x.id)}` }
    }
  })
  const up = d.upgrade
  if (up) {
    const at = Math.max(0, d.history.findIndex((h) => h.pickedId === up.id))
    const outcome = up.won ? `won, +${up.delta}` : up.locked ? 'lost, the lock held' : `lost, ${up.delta}`
    lines.push({ at, kind: 'upgrader', icon: POWER_UP_INFO.upgrader.icon, text: `Upgrader +${up.boost} on ${nameOf(up.id)}: ${outcome} (${up.chance}%)` })
  }
  return lines
}

/** "🧰 ⬆️+5 🔁 👁️ 🔀 ©️ 🔒" for the share text: the tray's icon and each power-up used, in tray order. Null when none was. */
export function powerUpsShareLine(d: DraftState | null | undefined): string | null {
  // A draft without the tray that unpacked power-ups from the locker: "🎒 Locker 🔀 👁️", those it used
  if (d && !d.rules.powerUps && d.locker?.length) {
    const used = POWER_UPS.filter((k) => d.locker!.includes(k) && powerUpUsed(d, k)).map((k) => (k === 'upgrader' && d.upgrade ? `${POWER_UP_INFO.upgrader.icon}${d.upgrade.won ? `+${d.upgrade.delta}` : d.upgrade.locked ? '±0🔒' : d.upgrade.delta}` : POWER_UP_INFO[k].icon))
    return used.length ? `🎒 Locker ${used.join(' ')}` : '🎒 Locker unpacked, unused'
  }
  if (!d?.rules.powerUps) return null
  const used = POWER_UPS.filter((k) => powerUpUsed(d, k)).map((k) => (k === 'upgrader' && d.upgrade ? `${POWER_UP_INFO.upgrader.icon}${d.upgrade.won ? `+${d.upgrade.delta}` : d.upgrade.locked ? '±0🔒' : d.upgrade.delta}` : POWER_UP_INFO[k].icon))
  return used.length ? `${POWER_UPS_ICON} Power-ups ${used.join(' ')}` : `${POWER_UPS_ICON} Power-ups unused`
}
