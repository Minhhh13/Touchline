import { useShallow } from 'zustand/react/shallow'
import { useStore } from '@game/store'

/** The store's state and actions, as `useStore.getState()` returns them. */
export type StoreState = ReturnType<typeof useStore.getState>

/** The named keys of an object, in a new object (pure; what `useStorePick` selects). */
export function pickKeys<T extends object, K extends keyof T>(state: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>
  for (const k of keys) out[k] = state[k]
  return out
}

/**
 * A screen's slice of the store: the component re-renders only when one of these keys changes (a shallow compare),
 * not on every write, as a bare `useStore()` does (a toast, a profile tick, the busy flags of another screen).
 * Actions never change, so listing them costs nothing.
 */
export function useStorePick<K extends keyof StoreState>(...keys: K[]): Pick<StoreState, K> {
  return useStore(useShallow((s: StoreState) => pickKeys(s, keys)))
}
