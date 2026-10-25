import type { Manager } from '@engine/managers'
import { MANAGER_STYLE_HELP, MANAGER_STYLE_LABEL } from '@engine/managers'
import { ClubBadge } from './bits'
import { clubName, seasonLabel } from '../format'
import { useStore } from '@game/store'

/** Where a manager comes from: the club-season he ran that the draft landed on, or an invented archetype. */
function origin(m: Manager, name: (id: string) => string): string {
  return m.archetype || !m.clubId || m.season === undefined ? 'Invented: no record for your clubs' : `${name(m.clubId)} · ${seasonLabel(m.season)}`
}

/**
 * The Quick Draft's manager pick: the real managers of the club-seasons drafted (archetypes when the record runs
 * short) as cards, the one picked lit. Before a pick the first card is the default the season would take.
 */
export function ManagerPick({ options, picked, onPick }: { options: Manager[]; picked: string | null; onPick: (id: string) => void }) {
  const u = useStore((s) => s.universe)
  if (!u || !options.length) return null
  const current = picked ?? options[0].id
  return (
    <div className="col manager-pick" data-testid="manager-pick" style={{ gap: 8 }}>
      <div className="panel-head">
        <h3>Pick your manager</h3>
        <span className="small muted">{picked ? 'Picked' : 'Default: the first'}</span>
      </div>
      <div className="manager-cards" role="radiogroup" aria-label="Manager">
        {options.map((m) => (
          <button key={m.id} type="button" role="radio" aria-checked={m.id === current} className={`choice-card manager-card ${m.id === current ? 'active' : ''}`} onClick={() => onPick(m.id)} data-testid={`manager-${m.id}`}>
            <span className="row" style={{ gap: 8 }}>
              {m.clubId && !m.archetype ? <ClubBadge clubId={m.clubId} size={24} /> : <span className="manager-mono" aria-hidden="true">?</span>}
              <span className="ctitle manager-name">{m.name}</span>
            </span>
            <span className="cline">{origin(m, (id) => clubName(u, id))}</span>
            <span className="chip manager-style">{MANAGER_STYLE_LABEL[m.style]}</span>
            <span className="cline manager-help">{MANAGER_STYLE_HELP[m.style]}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/** The manager in one line, for the season and summary headers: "Manager Arsène Wenger · Youth". */
export function ManagerChip({ manager }: { manager: Manager | undefined }) {
  if (!manager) return null
  return (
    <span className="chip manager-chip" data-testid="manager-chip" title={MANAGER_STYLE_HELP[manager.style]}>
      👔 {manager.name} · {MANAGER_STYLE_LABEL[manager.style]}
    </span>
  )
}
