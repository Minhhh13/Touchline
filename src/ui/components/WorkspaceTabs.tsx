import { useRef } from 'react'
import { workspaceTabKey } from '../workspaceTabs'

/** Phone-only navigation between the same panels that sit side by side on a desktop. */
export function WorkspaceTabs<T extends string>({ id, label, tabs, value, onChange }: { id: string; label: string; tabs: Array<{ id: T; label: string }>; value: T; onChange: (tab: T) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  if (!tabs.length) return null
  return (
    <div className="phone-tabs" role="tablist" aria-label={label} ref={ref}>
      {tabs.map((tab) => (
        <button key={tab.id} type="button" role="tab" id={`${id}-${tab.id}`} aria-controls={`${id}-panel-${tab.id}`} aria-selected={value === tab.id} tabIndex={value === tab.id ? 0 : -1} data-testid={`${id}-${tab.id}`} className={value === tab.id ? 'active' : ''} onClick={() => onChange(tab.id)} onKeyDown={(event) => {
          const next = workspaceTabKey(tabs.map((t) => t.id), value, event.key)
          if (!next) return
          event.preventDefault()
          onChange(next)
          ref.current?.querySelector<HTMLButtonElement>(`[id="${id}-${next}"]`)?.focus()
        }}>
          {tab.label}
        </button>
      ))}
    </div>
  )
}
