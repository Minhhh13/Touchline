import { useStore } from '@game/store'
import { briefStanding, gapLine, RUN_IN_TEMPLATE_LABEL, takeoverTable } from '@game/logic/runin'
import { positionOf, USER_TEAM } from '@engine/season'
import { ordinal } from '../format'

/** The Dugout's run-in banner: where the job was taken over (projected), the brief, and where it stands now. Renders nothing outside a run-in. */
export function RunInBanner() {
  const game = useStore((s) => s.game)
  const season = game?.season
  const b = game ? briefStanding(game) : null
  const start = season ? takeoverTable(season) : null
  if (!game || !season || !b || !start) return null
  const from = positionOf(start, USER_TEAM)
  const brief = season.objectives?.[0]?.label ?? ''
  const state = b.settled === 'met' ? 'Brief met' : b.settled === 'missed' ? 'Brief gone' : `${b.toPlay} to play`
  return (
    <div className={`notice ${b.settled === 'missed' ? 'danger' : b.position > b.target ? 'warn' : ''}`} data-testid="runin-banner" style={{ marginBottom: 12 }}>
      <div style={{ fontWeight: 700 }}>
        Run-in · {RUN_IN_TEMPLATE_LABEL[b.template]} · {brief}
      </div>
      <div className="small">
        Took over after MW {season.takeoverAt}: {ordinal(from)} on {start[from - 1].points} pts (projected from the final table). Now {ordinal(b.position)} on {b.points}, {gapLine(b.template, b.target, b.position, b.gap)} · {state}
      </div>
    </div>
  )
}
