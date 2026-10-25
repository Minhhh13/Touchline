import { Crown, Users, Smile } from 'lucide-react'
import { useStore } from '@game/store'
import { surnameOf } from '@game/logic/talks'
import { atmosphereOf, hierarchy, squadGroups, TIER_LABEL, TIER_ORDER } from '@game/logic/dynamics'
import { happinessOf } from '@game/logic/happiness'
import { personalityOf } from '@game/logic/personality'
import { playerLookup } from '@game/logic/players'
import { Bar, Info } from '../components/bits'
import { moraleClass, signed } from '../components/Happiness'

const surname = surnameOf

/**
 * The Dressing room tab: the hierarchy, the groups with the atmosphere, and
 * every player's happiness. A view only; every number comes from
 * `src/game/logic/dynamics.ts` and `happiness.ts`.
 */
export function DressingRoomTab({ onPlayer }: { onPlayer: (id: string) => void }) {
  const { universe: u, game } = useStore()
  if (!u || !game) return null
  const get = playerLookup(game, u)
  const rows = hierarchy(game, u)
  const groups = squadGroups(game, u)
  const atmos = atmosphereOf(game, u)
  const mood = rows.map((r) => ({ r, h: happinessOf(game.squad[r.id]) })).sort((a, b) => a.h.morale - b.h.morale || a.r.id.localeCompare(b.r.id))
  const atmosColour = atmos.value >= 65 ? 'var(--good)' : atmos.value >= 50 ? 'var(--meter-mid)' : 'var(--bad)'
  return (
    <div className="grid three fill squad-views" data-testid="dressing-room">
      <div className="panel" data-testid="hierarchy">
        <div className="panel-head">
          <span className="head-title">
            <h3 className="icon-title">
              <Crown size={18} aria-hidden="true" /> Hierarchy
            </h3>
            <Info label="About the hierarchy">Who carries weight in the dressing room: mentality, age, reputation, time at the club, apps and squad status. The captain leads it.</Info>
          </span>
          <span className="small muted">{rows.length} players</span>
        </div>
        {TIER_ORDER.map((tier) => {
          const list = rows.filter((r) => r.tier === tier)
          if (!list.length) return null
          return (
            <div key={tier} className="room-tier">
              <div className="eyebrow">{TIER_LABEL[tier]}</div>
              {list.map((r) => {
                const p = get(r.id)
                return (
                  <button key={r.id} type="button" className="room-row" onClick={() => onPlayer(r.id)}>
                    <span className="who">
                      <b>{r.name}</b>
                      <span className="small muted">{[...r.reasons, p ? personalityOf(p).label : ''].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className={`chip ${moraleClass(r.morale)}`} title="Morale">
                      {r.morale}
                    </span>
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
      <div className="panel" data-testid="groups">
        <div className="panel-head">
          <span className="head-title">
            <h3 className="icon-title">
              <Users size={18} aria-hidden="true" /> Atmosphere
            </h3>
            <Info label="About the atmosphere">Morale weighted by influence (leaders count three times), with the XI's chemistry. A read-out for now: it does not change results.</Info>
          </span>
          <span className="chip">{atmos.label}</span>
        </div>
        <div className="atmos" data-testid="atmosphere">
          <span className="atmos-value">{atmos.value}</span>
          <Bar value={atmos.value} colour={atmosColour} thick />
        </div>
        <ul className="atmos-lines small muted">
          {atmos.lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <h4 className="head-title room-sub">
          Groups <Info label="About groups">Players drafted from the same club-season stick together, then old club-mates, then countrymen, then by age.</Info>
        </h4>
        <div className="room-groups">
          {groups.map((g) => (
            <div key={g.id} className="room-group">
              <div className="row between" style={{ gap: 'var(--space-2)' }}>
                <b className="one-line">{g.label}</b>
                <span className={`chip ${moraleClass(g.morale)}`} title="Average morale">
                  {g.morale}
                </span>
              </div>
              <div className="small muted">
                {g.members.map((id, i) => (
                  <span key={id}>
                    {i ? ', ' : ''}
                    <button type="button" className="link-btn" onClick={() => onPlayer(id)}>
                      {surname(get(id)?.name ?? id)}
                    </button>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="panel" data-testid="happiness-list">
        <div className="panel-head">
          <span className="head-title">
            <h3 className="icon-title">
              <Smile size={18} aria-hidden="true" /> Happiness
            </h3>
            <Info label="About happiness">Unhappiest first, with the biggest recent cause. Tap a player for his full log and a word with him.</Info>
          </span>
        </div>
        <div className="plist lined">
          {mood.map(({ r, h }) => (
            <button key={r.id} type="button" className="room-row" onClick={() => onPlayer(r.id)} data-testid="mood-row">
              <span className="who">
                <b>{r.name}</b>
                <span className="small muted one-line">{h.main ? `${h.main.text} ${signed(h.main.delta)}` : 'Nothing recorded yet'}</span>
              </span>
              <span className={`chip ${moraleClass(h.morale)}`}>{h.morale}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
