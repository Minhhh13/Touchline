/**
 * The store's handle on the rules chunk (`rules.ts`): `loadRules()` imports it once (a failed fetch is not kept, so
 * the next call tries again), `rules()` reads it once it is in and throws before, `rulesReady()` says which. Every lazy
 * screen loads it with its own chunk (App.tsx), so a screen's actions find it there; an action Home can reach first
 * loads it before it runs (the store's `withRules`). The tests load it once in `src/testSetup.ts`.
 */
import type * as RulesModule from './rules'

export type Rules = typeof RulesModule

let loaded: Rules | null = null
let pending: Promise<Rules> | null = null

export function loadRules(): Promise<Rules> {
  if (loaded) return Promise.resolve(loaded)
  if (!pending) {
    pending = import('./rules').then((m) => (loaded = m))
    pending.catch(() => {
      pending = null
    })
  }
  return pending
}

export function rulesReady(): boolean {
  return loaded !== null
}

export function rules(): Rules {
  if (!loaded) throw new Error('The game rules are still loading: try again in a moment')
  return loaded
}

/**
 * A function of the rules chunk called as if it were imported: `late('kickOff')` has `kickOff`'s type and runs the
 * loaded module's `kickOff`. Only for code that runs after `loadRules()` resolved.
 */
export function late<K extends keyof Rules>(name: K): Rules[K] {
  return ((...args: unknown[]) => (rules()[name] as (...a: unknown[]) => unknown)(...args)) as unknown as Rules[K]
}
