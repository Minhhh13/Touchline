/**
 * The manager's hand on the match: one object the top bar, the drawers, the
 * squad strip and the dugout share. It knows where a change lands (now, at the
 * stop, queued for the next stop, too late, a replay), routes a change there
 * (a cut in play through `interveneLive`, or the stop's pending changes), and
 * pauses the clock while a drawer is open.
 */
import { useState } from 'react'
import { benchAt, onPitch, onPitchAtMinute, subsMade, type Shout } from '@engine/match'
import { appearancesAt, tacticsAt, type MatchFeed } from '@engine/matchFeed'
import type { SquadPlayer, Tactics } from '@engine/types'
import type { LiveMatch } from '@game/types'
import { appliedText, canEdit, closeDrawer, CLOSED_DRAWER, landing, openDrawer, queueIntoDraft, refusalText, shoutsOpen, stopSubCap, type DrawerId, type DrawerState, type Landing, type StopDraft, type Sub } from './controls'
import type { LiveControl, MatchClockApi } from './types'

export interface ManagerHand {
  landing: Landing
  /** A change can be made now, at the stop or queued for it. */
  editable: boolean
  minute: number
  side: 'home' | 'away'
  /** What the drawers start from: the pending tactics at a stop or in the queue, else the tactics in force. */
  tactics: Tactics
  /** The shout in force on the pitch. */
  shout?: Shout
  /** The shout pending at the 70th-minute stop. */
  pendingShout?: Shout
  shoutsOpen: boolean
  subsLeft: number
  windowsLeft: number
  /** In play, a change was already made at this minute: its stoppage is open, and more changes now spend no new one. */
  windowOpen: boolean
  /** How many more substitutions this window or stop can take. */
  subCap: number
  /** Substitutions waiting for the stop. */
  pendingSubs: Sub[]
  /** Who is on the pitch for us at the minute (less the men a pending change takes off). */
  onPitch: string[]
  /** Who can still come on. */
  bench: string[]
  markTarget?: string
  /** The formation slot a man on the pitch stands in. */
  slotOf(psId: string): string | undefined
  drawer: DrawerId | null
  open(id: DrawerId): void
  close(): void
  /** Send a change where it lands; true when it was taken (made, or added to the stop's changes). */
  submit(change: { tactics?: Tactics; substitutions?: Sub[]; shout?: Shout }): boolean
}

export function useManagerHand(o: {
  feed: MatchFeed
  live: LiveMatch | null
  control: LiveControl | null
  clock: MatchClockApi
  side: 'home' | 'away'
  draft: StopDraft
  setDraft: (d: StopDraft) => void
  squad: Record<string, SquadPlayer>
  name: (id: string) => string | undefined
  toast: (text: string) => void
}): ManagerHand {
  const { feed, live, control, clock, side, draft, setDraft, name, toast } = o
  const [drawer, setDrawer] = useState<DrawerState>(CLOSED_DRAWER)
  const minute = clock.clock
  const where = landing({ replay: !live || !control, atStop: clock.atStop, stopAt: clock.stopAt, check: control?.can ?? null })
  const mp = live?.mp
  const made = mp ? subsMade(mp, side) : 0
  const pendingSubs = where.kind === 'stop' || where.kind === 'queue' ? draft.subs : []
  const subCap = !control ? 0 : where.kind === 'stop' || where.kind === 'queue' ? Math.max(0, stopSubCap(where.stop ?? 70, made) - pendingSubs.length) : control.subsLeft
  const pendingOff = new Set(pendingSubs.map((s) => s.off))
  const pendingOn = new Set(pendingSubs.map((s) => s.on))
  const atStop = where.kind === 'stop'
  const fs = side === 'home' ? feed.home : feed.away
  const men: Array<{ psId: string; slotId: string }> = mp ? (atStop ? onPitch(mp, side) : onPitchAtMinute(mp, side, minute)) : appearancesAt(fs.appearances, Math.max(0, minute))
  const slots = new Map(men.map((p) => [p.psId, p.slotId]))
  const bench = mp ? benchAt(mp, side, minute, (id) => o.squad[id]).filter((id) => !pendingOn.has(id)) : []
  const inForce = control?.tactics ?? tacticsAt(feed, side, Math.max(0, minute) + 1)
  const tactics = (where.kind === 'stop' || where.kind === 'queue') && draft.tactics ? draft.tactics : inForce

  const open = (id: DrawerId) => {
    setDrawer(openDrawer(drawer, id, clock.running))
    clock.pause()
  }
  const close = () => {
    const r = closeDrawer(drawer)
    setDrawer(r.state)
    if (r.resume) clock.resume()
  }

  const submit = (change: { tactics?: Tactics; substitutions?: Sub[]; shout?: Shout }): boolean => {
    if (!control || !canEdit(where)) return false
    if (where.kind === 'now') {
      const out = control.apply(change)
      if (!out) {
        toast('The change could not be made.')
        return false
      }
      const refused = refusalText(out, name)
      if (out.applied) toast(refused ? `${appliedText(out, minute, name)} ${refused}` : appliedText(out, minute, name))
      else if (refused) toast(refused)
      return out.applied
    }
    const cap = stopSubCap(where.stop ?? 70, made)
    const r = queueIntoDraft(draft, change, cap)
    setDraft(r.draft)
    if (r.dropped.length) toast(`No room for ${r.dropped.length === 1 ? 'that change' : 'those changes'} at this stop.`)
    else if (where.kind === 'queue') toast(`Queued: ${where.stop === 45 ? 'changes wait for half time' : 'changes wait for the 70th minute'}.`)
    return true
  }

  const snap = mp ? (side === 'home' ? mp.home : mp.away) : null
  // The engine's own test for an open window (a manager's change at this minute, half time aside)
  const windowOpen = !!mp && where.kind === 'now' && minute !== 45 && (side === 'home' ? mp.hSubs : mp.aSubs).some((s) => s.minute === minute && (s.reason === 'manager' || s.reason === '70th minute'))
  return {
    landing: where,
    editable: canEdit(where),
    minute,
    side,
    tactics,
    shout: control?.shout,
    pendingShout: where.kind === 'stop' || where.kind === 'queue' ? draft.shout : undefined,
    shoutsOpen: shoutsOpen(minute, where),
    subsLeft: control?.subsLeft ?? 0,
    windowsLeft: control?.windowsLeft ?? 0,
    windowOpen,
    subCap,
    pendingSubs,
    onPitch: men.map((p) => p.psId).filter((id) => !pendingOff.has(id)),
    bench,
    markTarget: snap?.markTarget,
    slotOf: (psId) => slots.get(psId),
    drawer: drawer.open,
    open,
    close,
    submit,
  }
}
