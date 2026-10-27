/**
 * The Boxes control: a small "Boxes" button in a screen's head that opens a checklist of that screen's boxes. Unticking
 * a box hides it and the boxes left reflow into the freed room (`grid()` hands a grid its new columns). Per viewer, per
 * screen, in localStorage (`touchline-boxes-<screen>`), never in the save. The pure rules are in `../boxes.ts`.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { ChevronDown, LayoutGrid } from 'lucide-react'
import { canHide, gridTemplate, popPlacement, presentBoxes, readHidden, toggleBox, visibleIds, writeHidden, type BoxDef, type BoxSet, type GridCol } from '../boxes'
import { translator } from '../i18n'
import { shell } from '../i18n/en/shell'

const t = translator(shell)
/** A box's or a set's words from its screen and id; a label built at run time (a match-day slot) shows as it comes. */
const boxText = (key: string, english: string) => (t.has(key) ? t(key) : english)

interface HiddenStore {
  get(): string[]
  set(next: string[]): void
  subscribe(l: () => void): () => void
}

// One store per screen, shared by every control on the page (the menu and the grids read the same list)
const stores = new Map<string, HiddenStore>()

function storeFor(set: BoxSet): HiddenStore {
  const known = stores.get(set.screen)
  if (known) return known
  let value: string[] | null = null
  const listeners = new Set<() => void>()
  const s: HiddenStore = {
    get() {
      if (value === null) value = readHidden(set)
      return value
    },
    set(next) {
      value = next
      writeHidden(set, next)
      listeners.forEach((l) => l())
    },
    subscribe(l) {
      listeners.add(l)
      return () => {
        listeners.delete(l)
      }
    },
  }
  stores.set(set.screen, s)
  return s
}

export interface Boxes {
  set: BoxSet
  /** The boxes on the page now, in order. */
  present: BoxDef[]
  hidden: string[]
  visible: string[]
  on(id: string): boolean
  toggle(id: string): void
  showAll(): void
  /** A grid's class and style for its shown columns: nothing at all while every column shows. */
  grid(cols: readonly GridCol[]): { className: string; style?: CSSProperties }
  /** The same boxes with only `present` on the page (for a screen that knows what it has after its early return). */
  only(present: readonly string[]): Boxes
}

function makeBoxes(set: BoxSet, store: HiddenStore, hidden: string[], present?: readonly string[]): Boxes {
  const visible = visibleIds(set, hidden, present)
  return {
    set,
    present: presentBoxes(set, present),
    hidden,
    visible,
    on: (id) => visible.includes(id) || !set.boxes.some((b) => b.id === id),
    toggle: (id) => store.set(toggleBox(set, store.get(), id, present)),
    showAll: () => store.set([]),
    grid: (cols) => {
      const { template, count } = gridTemplate(cols, visible)
      if (template === null) return { className: '' }
      return { className: `boxes-reflow${count === 1 ? ' boxes-one' : ''}`, style: { '--boxes-cols': template } as CSSProperties }
    },
    only: (next) => makeBoxes(set, store, hidden, next),
  }
}

/** A screen's boxes as React state. `present` lists the boxes that exist on the page today (all of them if left out). */
export function useBoxes(set: BoxSet, present?: readonly string[]): Boxes {
  const store = storeFor(set)
  const hidden = useSyncExternalStore(store.subscribe, store.get, store.get)
  return makeBoxes(set, store, hidden, present)
}

/** Show every box of these screens again (Reset: every tab of a screen, not only the one open). */
export function resetBoxes(sets: readonly BoxSet[]): void {
  for (const s of sets) storeFor(s).set([])
}

/**
 * The button and its checklist. `groups` are the boxes of what is on screen now (the Dugout: its head and the open
 * tab); Show all turns those back on, Reset every set in `resets` (default: the groups).
 */
export function BoxesMenu({ groups, resets, className = '', iconOnly = false }: { groups: Boxes[]; resets?: readonly BoxSet[]; className?: string; /** Just the icon (and the count), for a line with no room for a label. */ iconOnly?: boolean }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const wrap = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<CSSProperties | null>(null)
  // Fixed to the window beside the button, so a box that scrolls or clips never cuts the checklist off
  useLayoutEffect(() => {
    if (!open) return
    const measure = () => {
      const r = button.current?.getBoundingClientRect()
      if (!r) return
      const p = popPlacement(r, window.innerWidth, document.documentElement.clientHeight || window.innerHeight)
      setPlace({ left: p.left, width: p.width, top: p.top, bottom: p.bottom, maxHeight: p.maxHeight })
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [open])
  const listed = groups.filter((g) => g.present.length > 0)
  const off = listed.reduce((n, g) => n + g.present.filter((b) => !g.visible.includes(b.id)).length, 0)
  useEffect(() => {
    if (!open) return
    pop.current?.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus()
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      button.current?.focus()
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])
  if (listed.length === 0) return null
  return (
    <div className={`boxes ${className}`} ref={wrap}>
      <button ref={button} type="button" className={`btn sm ghost boxes-btn ${off ? 'has-off' : ''}`} aria-expanded={open} aria-controls={`${id}-pop`} aria-haspopup="dialog" aria-label={iconOnly ? (off ? t('boxesOff', { n: off }) : t('boxes')) : undefined} onClick={() => setOpen((v) => !v)} data-testid="boxes-menu" title={t('boxesTip')}>
        <LayoutGrid size={14} aria-hidden="true" />
        {!iconOnly && <span>{t('boxes')}</span>}
        {off > 0 && (
          <span className="boxes-off" data-testid="boxes-off">
            {t('off', { n: off })}
          </span>
        )}
        {!iconOnly && <ChevronDown size={14} aria-hidden="true" className="boxes-chevron" />}
      </button>
      {open && (
        <div ref={pop} id={`${id}-pop`} className="boxes-pop" style={place ?? { visibility: 'hidden' }} role="dialog" aria-label={t('showOrHide')} data-testid="boxes-pop">
          {listed.map((g) => (
            <fieldset key={g.set.screen} className="boxes-group">
              <legend className="eyebrow">{boxText(`boxes_${g.set.screen}`, g.set.title)}</legend>
              {g.present.map((b) => {
                const on = g.visible.includes(b.id)
                const locked = on && !canHide(g.set, g.hidden, b.id, g.present.map((x) => x.id))
                return (
                  <label key={b.id} className={`boxes-item ${locked ? 'locked' : ''}`} title={locked ? t('oneStays') : undefined}>
                    <input type="checkbox" checked={on} disabled={locked} onChange={() => g.toggle(b.id)} data-testid={`boxes-toggle-${b.id}`} />
                    <span>{boxText(`box_${g.set.screen}_${b.id}`, b.label)}</span>
                  </label>
                )
              })}
            </fieldset>
          ))}
          <p className="small muted boxes-note">{t('boxesNote')}</p>
          <div className="boxes-actions">
            <button type="button" className="btn sm" onClick={() => listed.forEach((g) => g.showAll())} disabled={off === 0} data-testid="boxes-show-all">
              {t('showAll')}
            </button>
            <button type="button" className="btn sm ghost" onClick={() => resetBoxes(resets ?? listed.map((g) => g.set))} data-testid="boxes-reset">
              {t('reset')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
