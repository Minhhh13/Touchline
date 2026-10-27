/**
 * The language setting: per viewer, in its own localStorage key (`touchline-language`), never in the save. `auto`
 * (the default) follows `navigator.languages` to the first language TouchLine has, else English. A translation is a
 * `locales/<id>.ts` file, fetched as its own chunk only when chosen; until it arrives the screen reads in English.
 * The pseudo-locale is offered in development builds; a stored `en-XA` works in any build, so QA can use it on the
 * preview site.
 */
import { useSyncExternalStore } from 'react'
import { setFormatLocale } from '../format'
import { setLocaleMessages, type LoadedLocale } from './index'
import { PSEUDO_LOCALE } from './pseudo'
import type { Translation } from './locales/types'

export const LANGUAGE_KEY = 'touchline-language'

/** `auto`, or a language id ('en', 'en-XA', a translation's id). */
export type LanguagePref = string

export interface LanguageOption {
  id: string
  /** The language's own name ("English", "Deutsch"). */
  name: string
}

const ENGLISH: LanguageOption = { id: 'en', name: 'English' }
const PSEUDO: LanguageOption = { id: PSEUDO_LOCALE, name: 'Pseudo (en-XA)' }

// Every translation the owner adds under ./locales: each its own chunk, loaded on demand
const LOADERS = import.meta.glob<{ default: Translation }>(['./locales/*.ts', '!./locales/types.ts'])
const idOf = (path: string) => path.replace(/^.*\/([^/]+)\.ts$/, '$1')
/** Each translation's id and name, read from its file name and `LOCALE_NAMES` without loading it. */
export const TRANSLATED: readonly string[] = Object.keys(LOADERS).map(idOf).sort()

/** The languages' own names, for the Profile's list before a translation loads. Add one with its `locales/<id>.ts`. */
export const LOCALE_NAMES: Readonly<Record<string, string>> = { en: 'English', [PSEUDO_LOCALE]: 'Pseudo (en-XA)' }

const isDev = (): boolean => {
  try {
    return !!import.meta.env?.DEV
  } catch {
    return false
  }
}

/** The languages the Profile lists: English, every translation, and the pseudo-locale in development (or once chosen). */
export function languageOptions(pref: LanguagePref = readPref(), dev = isDev()): LanguageOption[] {
  const out = [ENGLISH, ...TRANSLATED.filter((id) => id !== 'en').map((id) => ({ id, name: LOCALE_NAMES[id] ?? id }))]
  if (dev || pref === PSEUDO_LOCALE) out.push(PSEUDO)
  return out
}

/**
 * The language a preference gives: an exact language, else `auto` matched against the device's languages (an exact
 * tag first, then its primary subtag: `de-AT` finds `de`), else English. Pure.
 */
export function resolveLanguage(pref: LanguagePref, device: readonly string[], available: readonly string[]): string {
  if (pref !== 'auto' && (pref === 'en' || pref === PSEUDO_LOCALE || available.includes(pref))) return pref
  const have = new Map(available.map((a) => [a.toLowerCase(), a]))
  for (const tag of device) {
    const lower = tag.toLowerCase()
    if (lower === 'en' || lower.startsWith('en-')) return 'en'
    const hit = have.get(lower) ?? have.get(lower.split('-')[0])
    if (hit) return hit
  }
  return 'en'
}

function readPref(): LanguagePref {
  try {
    return localStorage.getItem(LANGUAGE_KEY) || 'auto'
  } catch {
    return 'auto'
  }
}

function deviceLanguages(): readonly string[] {
  try {
    return typeof navigator === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : navigator.language ? [navigator.language] : []
  } catch {
    return []
  }
}

interface LanguageState {
  pref: LanguagePref
  /** The language on screen now (English while a translation is still loading). */
  locale: string
}
let state: LanguageState = { pref: 'auto', locale: 'en' }
let started = false
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

function show(id: string, messages: LoadedLocale['messages']): void {
  setLocaleMessages({ id, messages })
  setFormatLocale(id)
  try {
    if (typeof document !== 'undefined') document.documentElement.lang = id
  } catch {
    // No document (a test)
  }
  state = { ...state, locale: id }
  emit()
}

async function apply(pref: LanguagePref): Promise<void> {
  const want = resolveLanguage(pref, deviceLanguages(), TRANSLATED)
  if (want === 'en' || want === PSEUDO_LOCALE) return show(want, {})
  const load = Object.entries(LOADERS).find(([path]) => idOf(path) === want)?.[1]
  if (!load) return show('en', {})
  try {
    const mod = await load()
    // A later choice while this one loaded wins
    if (state.pref !== pref) return
    show(want, mod.default.messages as LoadedLocale['messages'])
  } catch {
    show('en', {})
  }
}

/** Read the stored choice and show it (`main.tsx`, once). */
export function startLanguage(): void {
  if (started) return
  started = true
  state = { ...state, pref: readPref() }
  void apply(state.pref)
}

/** Choose a language ('auto' to follow the device); kept on this device only. */
export function setLanguage(pref: LanguagePref): void {
  try {
    if (pref === 'auto') localStorage.removeItem(LANGUAGE_KEY)
    else localStorage.setItem(LANGUAGE_KEY, pref)
  } catch {
    // Storage blocked: the choice lasts for this page load
  }
  state = { ...state, pref }
  emit()
  void apply(pref)
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}
const snapshot = () => state

/** The language preference and the language on screen, re-rendering on a change. */
export function useLanguage(): LanguageState {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
