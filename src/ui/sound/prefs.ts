import { useSyncExternalStore } from 'react'
import { usePref, viewerPref } from '../viewerPrefs'
import type { SoundCategory } from './scores'

/** Sound on or off, per viewer, on by default: its own localStorage key (not the save). */
export const SOUND_KEY = 'touchline-sound'
const pref = viewerPref(SOUND_KEY, true)

export const soundOn = pref.get
export const setSoundOn = pref.set
export const subscribeSound = pref.subscribe

/** The sound setting as React state, shared by every toggle on the page. */
export function useSoundOn(): [boolean, (next: boolean) => void] {
  return usePref(pref)
}

/** Match sounds (the whistle, the crowd, the net, cards and substitutions) on or off, per viewer, on by default. Under the master switch: off there silences these too. */
export const MATCH_SOUND_KEY = 'touchline-match-sound'
const matchPref = viewerPref(MATCH_SOUND_KEY, true)

export const matchSoundOn = matchPref.get
export const setMatchSoundOn = matchPref.set

export function useMatchSoundOn(): [boolean, (next: boolean) => void] {
  return usePref(matchPref)
}

/** Draft sounds (the reel, a pick, the Upgrader, the grade, the Hindsight XI, Squad complete, the manager spin, the case, a bonus spin, a head-to-head turn) on or off, per viewer, on by default. */
export const DRAFT_SOUND_KEY = 'touchline-draft-sound'
const draftPref = viewerPref(DRAFT_SOUND_KEY, true)

export const draftSoundOn = draftPref.get
export const setDraftSoundOn = draftPref.set

export function useDraftSoundOn(): [boolean, (next: boolean) => void] {
  return usePref(draftPref)
}

/** Interface sounds (a primary button's click, a tab, a toast, an error, a dialog's confirm) on or off, per viewer, on by default. */
export const UI_SOUND_KEY = 'touchline-ui-sound'
const uiPref = viewerPref(UI_SOUND_KEY, true)

export const uiSoundOn = uiPref.get
export const setUiSoundOn = uiPref.set

export function useUiSoundOn(): [boolean, (next: boolean) => void] {
  return usePref(uiPref)
}

/** Whether a sound of this category may play under the master: rewards (the fanfares, a badge, a rung) follow the master alone. */
export function categoryOn(category: SoundCategory): boolean {
  if (category === 'match') return matchSoundOn()
  if (category === 'draft') return draftSoundOn()
  if (category === 'ui') return uiSoundOn()
  return true
}

/** The volume, per viewer, in whole per cent of the master gain (0 to 100, 100 by default), stored as its figure. */
export const VOLUME_KEY = 'touchline-sound-volume'

/** A stored volume read back: a whole number from 0 to 100, or the default for anything else. */
export function parseVolume(raw: string | null): number {
  if (raw === null || raw.trim() === '') return 100
  const n = Number(raw)
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 100
}

let volume: number | null = null
const volumeListeners = new Set<() => void>()

export function soundVolume(): number {
  if (volume === null) {
    try {
      volume = parseVolume(localStorage.getItem(VOLUME_KEY))
    } catch {
      volume = 100
    }
  }
  return volume
}

export function setSoundVolume(next: number): void {
  volume = parseVolume(String(next))
  try {
    localStorage.setItem(VOLUME_KEY, String(volume))
  } catch {
    // Storage blocked: the choice lasts for this page load
  }
  volumeListeners.forEach((l) => l())
}

export function subscribeVolume(l: () => void): () => void {
  volumeListeners.add(l)
  return () => {
    volumeListeners.delete(l)
  }
}

export function useSoundVolume(): [number, (next: number) => void] {
  return [useSyncExternalStore(subscribeVolume, soundVolume, soundVolume), setSoundVolume]
}
