import type { TableRow } from '@engine/types'
import { USER_TEAM } from '@engine/season'
import { ClubBadge, FormDots, TeamBadge } from './bits'
import { useStore } from '@game/store'
import { zoneOf } from '@game/logic/liveTable'
import { translator } from '../i18n'
import { dugout } from '../i18n/en/dugout'

const t = translator(dugout)

/** `zones` draws the league's zones on the rows' left edge, as the quick season's live table does (`zoneOf`). */
export function TableView({ rows, teamName, teamCode, compact, highlightTop, nameOf, zones }: { rows: TableRow[]; teamName: string; teamCode?: string; compact?: boolean; highlightTop?: boolean; nameOf?: (clubId: string) => string; zones?: boolean }) {
  const u = useStore((s) => s.universe)
  // Your row carries your own code (TX), as the header, the fixtures and the match day do
  const savedCode = useStore((s) => s.game?.settings.shortName)
  const code = teamCode ?? savedCode
  return (
    <table className={`tbl${compact ? ' tv-compact' : ''}`}>
      <thead>
        <tr>
          <th>#</th>
          <th>{t('club')}</th>
          <th className="num">{t('colP')}</th>
          {!compact && <th className="num">{t('colW')}</th>}
          {!compact && <th className="num">{t('colD')}</th>}
          {!compact && <th className="num">{t('colL')}</th>}
          <th className="num">{t('colGD')}</th>
          <th className="num">{t('colPts')}</th>
          {!compact && <th>{t('form')}</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const me = r.teamId === USER_TEAM
          const name = me ? teamName : nameOf ? nameOf(r.teamId) : u?.clubById[r.teamId]?.name ?? r.teamId
          const zone = zones && rows.length >= 10 ? zoneOf(i + 1, rows.length) : null
          // A rule where one zone gives way to the next: under the top places, over the bottom three
          const edge = zone && zone !== 'releg' && zoneOf(i + 2, rows.length) !== zone ? 'zone-end' : zone === 'releg' && zoneOf(i, rows.length) !== 'releg' ? 'zone-start' : ''
          return (
            <tr key={r.teamId} className={`${me ? 'me' : ''} ${zone ? `zone-${zone}` : ''} ${edge}`} title={zone ? t(`zone_${zone}`) : undefined} style={highlightTop && i === 0 ? { fontWeight: 700 } : undefined}>
              <td>{i + 1}</td>
              <td className="tv-club" title={name}>
                <span className="row" style={{ gap: 8 }}>
                  {me ? <TeamBadge code={code} size={22} /> : <ClubBadge clubId={r.teamId} size={22} />}
                  <span className="tv-name">{name}</span>
                </span>
              </td>
              <td className="num">{r.played}</td>
              {!compact && <td className="num">{r.won}</td>}
              {!compact && <td className="num">{r.drawn}</td>}
              {!compact && <td className="num">{r.lost}</td>}
              <td className="num">{r.goalsFor - r.goalsAgainst > 0 ? '+' : ''}{r.goalsFor - r.goalsAgainst}</td>
              <td className="num" style={{ fontWeight: 700 }}>{r.points}</td>
              {!compact && (
                <td>
                  <FormDots form={r.form} />
                </td>
              )}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
