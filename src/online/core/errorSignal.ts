/**
 * How the screen boundary (`src/ui/lazyScreens.tsx`) hands an error it caught to the optional error reporter without
 * importing the online layer: a `touchline-error` event on `window`, and the last few kept until a reporter takes
 * them (the online layer loads after the first render, so an early error would otherwise go unseen). A build with no
 * online layer has no listener; the buffer stays at most `BUFFER_CAP` long. Import-free, safe in every build.
 */
export type SignalKind = 'boundary' | 'chunk'

export interface ErrorSignal {
  kind: SignalKind
  error: unknown
}

export const ERROR_EVENT = 'touchline-error'
const BUFFER_CAP = 5
const buffer: ErrorSignal[] = []
let taken = false

export function signalError(kind: SignalKind, error: unknown): void {
  const s: ErrorSignal = { kind, error }
  if (!taken) {
    buffer.push(s)
    if (buffer.length > BUFFER_CAP) buffer.shift()
  }
  if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') window.dispatchEvent(new CustomEvent<ErrorSignal>(ERROR_EVENT, { detail: s }))
}

/** The signals sent before any reporter listened; called once by the reporter as it starts listening. */
export function takeEarlySignals(): ErrorSignal[] {
  taken = true
  return buffer.splice(0)
}
