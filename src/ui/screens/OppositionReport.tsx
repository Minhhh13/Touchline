import { useMemo, useState } from 'react'
import { Bandage, ChevronDown } from 'lucide-react'
import { useStore } from '@game/store'
import { staffTier } from '@engine/staff'
import { seasonTable, type AiClub } from '@engine/season'
import { opponentInput } from '@game/logic/squadDisplay'
import { computeTeamStrength } from '@engine/ratings'
import { STYLE_LABEL } from '@engine/tactics'
import { FormDots, Rating, Pos } from '../components/bits'
import { LeagueFlag } from '../components/Flag'
import { translator } from '../i18n'
import { dugout } from '../i18n/en/dugout'

const t = translator(dugout)

/**
 * Scouting summary of the next opponent with a suggested approach. A league
 * or Continental opponent is found in the season; an arena opponent is passed
 * in as `club` with its `aiOffset`, and has no table position or form.
 */
export function OppositionReport({ clubId, home, club: given, aiOffset, neutral, open }: { clubId: string; home: boolean; club?: AiClub; aiOffset?: number; neutral?: boolean; /** Start open whatever the window (the Dugout's Next match tab, where it is the subject). */ open?: boolean }) {
  const { universe: u, game, setMarkTarget } = useStore()
  // Open on a tall desktop; folded on a phone or a short window, where it would push the squad out of sight
  const [startOpen] = useState(() => !!open || typeof window === 'undefined' || !window.matchMedia || window.matchMedia('(min-width: 721px) and (min-height: 900px)').matches)
  const data = useMemo(() => {
    if (!u || !game || (!game.season && !given)) return null
    const club = given ?? game.season?.ai[clubId] ?? game.season?.continental?.clubs[clubId]
    if (!club) return null
    const input = opponentInput(game, u, club, aiOffset ?? game.season?.aiOffset ?? 0)
    const strength = computeTeamStrength(club.tactics, input.lineup, input.getPlayer, input.getState)
    const xi = Object.values(input.lineup).map((id) => u.index[id]).filter(Boolean)
    const stars = [...xi].sort((a, b) => b.overall - a.overall).slice(0, 3)
    const weak = staffTier(game.staff, 'scout') >= 2 ? [...xi].filter((p) => p.positions[0] !== 'GK').sort((a, b) => a.overall - b.overall)[0] : undefined
    const table = game.season && !given ? seasonTable(game.season) : []
    const row = table.find((r) => r.teamId === clubId) ?? { teamId: clubId, points: 0, form: [] as Array<'W' | 'D' | 'L'> }
    const pos = table.indexOf(row as (typeof table)[number]) + 1
    const injured = club.squad.filter((id) => club.state[id]?.injury).length
    const cbPace = xi.filter((p) => p.positions[0] === 'CB').reduce((s, p) => s + p.attributes.pace, 0) / Math.max(1, xi.filter((p) => p.positions[0] === 'CB').length)
    const midPassing = xi.filter((p) => ['DM', 'CM', 'AM'].includes(p.positions[0])).reduce((s, p) => s + p.attributes.passing, 0) / Math.max(1, xi.filter((p) => ['DM', 'CM', 'AM'].includes(p.positions[0])).length)
    const composure = xi.reduce((s, p) => s + p.attributes.mentality, 0) / Math.max(1, xi.length)
    const tips: string[] = []
    if (cbPace < 72) tips.push(t('tipSlowCbs'))
    if (composure < 72) tips.push(t('tipNervy'))
    else if (composure > 80) tips.push(t('tipComposed'))
    if (midPassing > 80) tips.push(t('tipTechnical'))
    if (club.tactics.passing === 'direct' && club.tactics.tempo === 'fast') tips.push(t('tipCounter'))
    if (club.tactics.mentality === 'defensive') tips.push(t('tipDeep'))
    if (strength.attack > strength.defence + 4) tips.push(t('tipFrontHeavy'))
    if (strength.defence > strength.attack + 4) tips.push(t('tipDrilled'))
    if (weak) tips.push(t('tipWeakLink', { name: weak.name, overall: weak.overall, pos: weak.positions[0] }))
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
                  <FormDots form={row.form} />
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
