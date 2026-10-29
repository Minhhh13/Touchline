import { useMemo, useState } from 'react'
import { Bandage, ChevronDown } from 'lucide-react'
import { useStorePick } from '../useStorePick'
import { seasonTable, type AiClub } from '@engine/season'
import type { PlayerSeason } from '@engine/types'
import { scoutOpposition, type OppositionTip } from '@game/logic/oppositionReport'
import { STYLE_LABEL } from '@engine/tactics'
import { FormDots, Rating, Pos } from '../components/bits'
import { LeagueFlag } from '../components/Flag'
import { translator } from '../i18n'
import { dugout } from '../i18n/en/dugout'

const t = translator(dugout)

/** One of the assistant's notes in words. */
function tipText(n: OppositionTip, weak: PlayerSeason | undefined): string {
  switch (n) {
    case 'slowCbs':
      return t('tipSlowCbs')
    case 'nervy':
      return t('tipNervy')
    case 'composed':
      return t('tipComposed')
    case 'technical':
      return t('tipTechnical')
    case 'counter':
      return t('tipCounter')
    case 'deep':
      return t('tipDeep')
    case 'frontHeavy':
      return t('tipFrontHeavy')
    case 'drilled':
      return t('tipDrilled')
    case 'weakLink':
      return t('tipWeakLink', { name: weak?.name ?? '', overall: weak?.overall ?? 0, pos: weak?.positions[0] ?? '' })
  }
}

/**
 * Scouting summary of the next opponent with a suggested approach. A league
 * or Continental opponent is found in the season; an arena opponent is passed
 * in as `club` with its `aiOffset`, and has no table position or form.
 */
export function OppositionReport({ clubId, home, club: given, aiOffset, neutral, open }: { clubId: string; home: boolean; club?: AiClub; aiOffset?: number; neutral?: boolean; /** Start open whatever the window (the Dugout's Next match tab, where it is the subject). */ open?: boolean }) {
  const { universe: u, game, setMarkTarget } = useStorePick('universe', 'game', 'setMarkTarget')
  // Open on a tall desktop; folded on a phone or a short window, where it would push the squad out of sight
  const [startOpen] = useState(() => !!open || typeof window === 'undefined' || !window.matchMedia || window.matchMedia('(min-width: 721px) and (min-height: 900px)').matches)
  const data = useMemo(() => {
    if (!u || !game || (!game.season && !given)) return null
    const club = given ?? game.season?.ai[clubId] ?? game.season?.continental?.clubs[clubId]
    if (!club) return null
    const { strength, stars, weak, injured, tips: notes } = scoutOpposition(game, u, club, aiOffset ?? game.season?.aiOffset ?? 0)
    const table = game.season && !given ? seasonTable(game.season) : []
    const row = table.find((r) => r.teamId === clubId) ?? { teamId: clubId, points: 0, form: [] as Array<'W' | 'D' | 'L'> }
    const pos = table.indexOf(row as (typeof table)[number]) + 1
    const tips = notes.map((n) => tipText(n, weak))
    return { club, strength, stars, row, pos, injured, tips }
  }, [u, game, clubId, given, aiOffset])
  if (!u || !data) return null
  const { club, strength, stars, row, pos, injured, tips } = data
  return (
    <details className="panel opposition" open={startOpen} style={{ marginBottom: 'var(--space-4)' }}>
      <summary className="panel-head">
        <h3>
          {t('oppReport')}<span className="opp-of">{t('oppOf', { club: club.name })}</span>
        </h3>
        <span className="small muted">
          {t(neutral ? 'venue_neutral' : home ? 'venue_home' : 'venue_away')} · {STYLE_LABEL[u.clubById[clubId]?.style ?? 'balanced']} · {pos > 0 ? t('posPts', { pos, points: row.points }) : <><LeagueFlag leagueId={u.clubById[clubId]?.leagueId ?? 'europe'} /> {u.leagues.find((l) => l.id === u.clubById[clubId]?.leagueId)?.name ?? t('contOpponent')}</>}
          <ChevronDown size={16} className="fold-chevron" aria-hidden="true" />
        </span>
      </summary>
      {/* Three columns where the box is wide; in a narrow box (the arena hub's) the notes take the full width under the
          units and the danger men, so no column runs into the next */}
      <div className="grid three opp-grid">
        <div className="col opp-units" style={{ gap: 6 }}>
          <div className="eyebrow">{t('units')}</div>
          <dl className="kv">
            <dt>{t('rating')}</dt>
            <dd>{strength.overall.toFixed(1)}</dd>
            <dt>{t('gkDef')}</dt>
            <dd>
              {strength.goalkeeping.toFixed(0)} / {strength.defence.toFixed(0)}
            </dd>
            <dt>{t('midAtt')}</dt>
            <dd>
              {strength.midfield.toFixed(0)} / {strength.attack.toFixed(0)}
            </dd>
            {!given && (
              <>
                <dt>{t('form')}</dt>
                <dd>
                  {row.form.length ? <FormDots form={row.form} /> : <span className="muted">{t('noFormYet')}</span>}
                </dd>
              </>
            )}
            <dt>{t('injured')}</dt>
            <dd className="icon-title" style={{ gap: 'var(--space-1)' }}>
              {injured > 0 && <Bandage size={13} className="ic-injury" aria-hidden="true" />}
              {injured}
            </dd>
          </dl>
        </div>
        <div className="col opp-danger" style={{ gap: 6 }}>
          <div className="eyebrow">{t('dangerMen')}</div>
          {stars.map((p) => (
            <div key={p.id} className="row danger-row" style={{ gap: 8 }} data-testid="danger-row">
              <Rating value={p.overall} />
              <span className="danger-name" title={p.name}>{p.name}</span>
              <Pos p={p.positions[0]} />
              {p.positions[0] !== 'GK' && (
                <button type="button" className={`btn sm ${game?.markTarget === p.id ? 'primary' : 'ghost'}`} title={t('manMarkTip')} onClick={() => setMarkTarget(game?.markTarget === p.id ? undefined : p.id)}>
                  {t(game?.markTarget === p.id ? 'marked' : 'manMark')}
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="col opp-notes" style={{ gap: 6 }}>
          <div className="eyebrow">{t('assistantNotes')}</div>
          <ul className="notes-list small">
            {tips.length ? tips.map((tip, i) => <li key={i}>{tip}</li>) : <li>{t('nothingStands')}</li>}
          </ul>
        </div>
      </div>
    </details>
  )
}
