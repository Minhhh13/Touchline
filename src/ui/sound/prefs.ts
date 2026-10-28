import { usePref, viewerPref } from '../viewerPrefs'

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
