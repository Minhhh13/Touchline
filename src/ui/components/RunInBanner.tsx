import { useStore } from '@game/store'
import { briefStanding, gapLine, RUN_IN_TEMPLATE_LABEL, takeoverTable } from '@game/logic/runin'
import { positionOf, USER_TEAM } from '@engine/season'
import { translator } from '../i18n'
import { runin } from '../i18n/en/runin'

const t = translator(runin)

/** The Dugout's run-in banner: where the job was taken over (projected), the brief, and where it stands now. Renders nothing outside a run-in. */
export function RunInBanner() {
  const game = useStore((s) => s.game)
  const season = game?.season
  const b = game ? briefStanding(game) : null
  const start = season ? takeoverTable(season) : null
  if (!game || !season || !b || !start) return null
  const from = positionOf(start, USER_TEAM)
  const brief = season.objectives?.[0]?.label ?? ''
  const state = b.settled === 'met' ? t('briefMet') : b.settled === 'missed' ? t('briefGone') : t('toPlay', { n: b.toPlay })
  return (
    <div className={`notice ${b.settled === 'missed' ? 'danger' : b.position > b.target ? 'warn' : ''}`} data-testid="runin-banner" style={{ marginBottom: 12 }}>
      <div style={{ fontWeight: 700 }}>
        {t('bannerHead', { template: RUN_IN_TEMPLATE_LABEL[b.template], brief })}
      </div>
      <div className="small">
        {t('bannerLine', { week: season.takeoverAt, from, fromPts: start[from - 1].points, pos: b.position, pts: b.points, gap: gapLine(b.template, b.target, b.position, b.gap), state })}
      </div>
    </div>
  )
}
