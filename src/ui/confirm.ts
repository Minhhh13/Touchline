import { useSyncExternalStore } from 'react'
import { translator } from './i18n'
import { common } from './i18n/en/common'

// The default buttons' words, in the viewer's language (English: OK and Cancel)
const t = translator(common)

/**
 * The game's own yes-or-no question, in place of the browser's `window.confirm` (a grey box headed with the site's
 * address, and in an iOS web view a system alert): `askConfirm` queues a question and resolves true on the yes, false
 * on the no, Escape or the backdrop. `ConfirmHost` (components/ConfirmDialog.tsx, mounted once in App.tsx) draws the
 * first question waiting. Presentation only: the store actions a yes leads to are the ones the old confirm led to.
 */
export interface ConfirmRequest {
  id: number
  message: string
  /** The yes button's words; "OK" when left out. */
  ok: string
  /** The no button's words; "Cancel" when left out. */
  cancel: string
  /** The yes loses something (abandon, discard, delete): drawn in the danger colour. */
  danger: boolean
  resolve: (yes: boolean) => void
}

export interface ConfirmOptions {
  ok?: string
  cancel?: string
  danger?: boolean
}

let queue: ConfirmRequest[] = []
let nextId = 1
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function askConfirm(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  return new Promise((resolve) => {
    queue = [...queue, { id: nextId++, message, ok: options.ok ?? t('confirmOk'), cancel: options.cancel ?? t('confirmCancel'), danger: !!options.danger, resolve }]
    emit()
  })
}

/** Answers the question on screen (the first queued) and shows the next one, if any. */
export function answerConfirm(id: number, yes: boolean): void {
  const req = queue.find((r) => r.id === id)
  if (!req) return
  queue = queue.filter((r) => r.id !== id)
  emit()
  req.resolve(yes)
}

export function currentConfirm(): ConfirmRequest | null {
  return queue[0] ?? null
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useConfirmRequest(): ConfirmRequest | null {
  return useSyncExternalStore(subscribe, currentConfirm, () => null)
}
