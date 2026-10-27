import { Check, Compass, Crosshair, History, Sparkles, Trophy, UserPlus } from 'lucide-react'
import type { DraftRecap as Recap } from '@game/logic/draftRecap'
import type { Hindsight } from '@game/logic/hindsight'
import type { PickGrade } from '@game/logic/pickGrades'
import type { PlayerSeason } from '@engine/types'
import { fixed, seasonLabel } from '../format'
import { Tip } from './bits'
import { useEffect } from 'react'
import { prefersReducedMotion, useFirstReveal } from '../motion'
import { playSound } from '../sound/synth'
import { translator } from '../i18n'
import { draft } from '../i18n/en/draft'

const t = translator(draft)

const GRADE_CLASS: Record<PickGrade, string> = { A: 'good', B: 'info', C: 'warn', D: 'bad' }
const GRADES: PickGrade[] = ['A', 'B', 'C', 'D']
/** Seconds from the recap's mount to the grade's pop at its fullest (`recap-pop`: 60 ms stagger, then a 400 ms spring). */
const GRADE_SOUND_DELAY = 0.24

/**
 * The Draft's middle box once every pick is made: the draft's grade and verdict, the grade tally, the best pick, the one
 * that got away and how far the wheel travelled, and the Hindsight XI (the best XI the same spins held). The button on
 * to the next step is the left box's, so the screen's main action is in one place. Display only (`draftRecap`).
 */
export function DraftRecap({ recap, get, slotName }: { recap: Recap; get: (id: string) => PlayerSeason | undefined; slotName: (slotId: string) => string }) {
  const r = recap
  const best = r.best ? get(r.best.pickedId) : undefined
  const missed = r.miss ? get(r.miss.pickedId) : undefined
  const span = r.seasons ? (r.seasons[0] === r.seasons[1] ? seasonLabel(r.seasons[0]) : t('seasonRange', { from: seasonLabel(r.seasons[0]), to: seasonLabel(r.seasons[1]) })) : null
  // The grade lands with a stamp and its chord, on the pop's peak (the stagger and half the spring), once per visit
  const first = useFirstReveal(`draft-grade:${r.grade}:${r.picks}:${r.clubs}:${r.nations}:${r.xiRating}`, false)
  useEffect(() => {
    if (!first || !r.grade) return
    const reduced = prefersReducedMotion()
    playSound({ id: 'grade', grade: r.grade, reduced }, reduced ? 0 : GRADE_SOUND_DELAY)
  }, [])
  return (
    <div className="draft-recap" data-testid="draft-recap">
      <div className="recap-head">
        {r.grade && (
          <span className={`recap-grade ${GRADE_CLASS[r.grade]}`} data-testid="draft-grade" role="img" aria-label={t('recapGradeLabel', { grade: r.grade })}>
            {r.grade}
          </span>
        )}
        <div className="col" style={{ gap: 4, minWidth: 0 }}>
          <span className="eyebrow">{t(r.grade ? 'yourDraft' : 'allPicksMade')}</span>
          <h3 className="recap-verdict" data-testid="draft-verdict">
            {r.verdict}
          </h3>
          {r.grade && (
            <div className="row wrap recap-tally" style={{ gap: 6 }}>
              {GRADES.filter((g) => r.tally[g] > 0).map((g) => (
                <span key={g} className={`chip pick-grade ${GRADE_CLASS[g]}`} data-testid={`recap-tally-${g}`}>
                  {g} × {r.tally[g]}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      {r.grade && <Tip id="draft-recap">{t('recapTip')}</Tip>}
      <div className="recap-cards">
        {r.best && best && (
          <div className="recap-card" data-testid="recap-best">
            <span className="recap-icon good" aria-hidden>
              <Trophy size={18} />
            </span>
            <div className="col" style={{ gap: 2, minWidth: 0 }}>
              <span className="eyebrow">{t('bestPick')}</span>
              <b>{best.name}</b>
              <span className="small muted">
                {t('bestLine', { rating: r.best.rating, slot: slotName(r.best.slotId), spin: r.best.spin + 1, season: seasonLabel(best.season) })}
              </span>
            </div>
          </div>
        )}
        {r.miss && missed && (
          <div className="recap-card" data-testid="recap-miss">
            <span className="recap-icon warn" aria-hidden>
              <Sparkles size={18} />
            </span>
            <div className="col" style={{ gap: 2, minWidth: 0 }}>
              <span className="eyebrow">{t('gotAway')}</span>
              <b>{r.miss.bestName}</b>
              <span className="small muted">
                {t(r.miss.bestName === missed.name ? 'missSame' : 'missOther', { best: r.miss.best, bestSlot: slotName(r.miss.bestSlotId), spin: r.miss.spin + 1, slot: slotName(r.miss.slotId), rating: r.miss.rating, name: missed.name, left: r.miss.left })}
              </span>
            </div>
          </div>
        )}
        <div className="recap-card" data-testid="recap-travel">
          <span className="recap-icon" aria-hidden>
            <Compass size={18} />
          </span>
          <div className="col" style={{ gap: 2, minWidth: 0 }}>
            <span className="eyebrow">{t('wheelWent')}</span>
            <b>
              {t('clubsNations', { clubs: r.clubs, nations: r.nations })}
            </b>
            <span className="small muted">
              {t('recapPicks', { n: r.picks })}
              {span ? `, ${span}` : ''}
              {r.xiRating !== null ? t('xiInSlots', { r: fixed(r.xiRating, 1) }) : ''}
            </span>
          </div>
        </div>
      </div>
      {!r.grade && r.ungraded.length > 0 && <Signings picks={r.ungraded} get={get} />}
      {r.hindsight && <HindsightXI h={r.hindsight} slotName={slotName} bestPlays={r.bestPlays ?? []} />}
    </div>
  )
}

/** The best XI the same spins could have given, slot by slot, your own picks ticked, and the gap to your XI. */
function HindsightXI({ h, slotName, bestPlays }: { h: Hindsight; slotName: (slotId: string) => string; bestPlays: string[] }) {
  const perfect = h.gap <= 0
  const marked = new Set(bestPlays)
  return (
    <div className="recap-hindsight" data-testid="recap-hindsight">
      <div className="hs-head">
        <span className="recap-icon" aria-hidden>
          <History size={18} />
        </span>
        <div className="col" style={{ gap: 2, minWidth: 0 }}>
          <span className="eyebrow">{t('hindsightXI')}</span>
          <b data-testid="hindsight-line">{perfect ? t('mostOfEverySpin') : t('withWhatWheelGave', { r: fixed(h.rating, 1) })}</b>
          <span className="small muted">
            {perfect ? t('hindsightPerfect', { yours: fixed(h.yours, 1) }) : t('hindsightGap', { yours: fixed(h.yours, 1), gap: fixed(h.gap, 1), kept: h.kept, n: h.xi.length, marked: marked.size ? 'yes' : 'no' })}
          </span>
        </div>
      </div>
      {!perfect && (
        <ol className="hs-grid" aria-label={t('hindsightXI')}>
          {h.xi.map((p) => (
            <li key={p.slotId} className={`hs-man${p.yours ? ' yours' : ''}${marked.has(p.slotId) ? ' best-play' : ''}`} title={p.yours ? t('yourPickInSlot') : t(marked.has(p.slotId) ? 'fromSpinBest' : 'fromSpin', { n: p.spin + 1 })}>
              <span className="hs-pos">{slotName(p.slotId)}</span>
              <span className="hs-name">{p.name}</span>
              {marked.has(p.slotId) && <Crosshair size={12} className="hs-best" role="img" aria-label={t('bestPlayOnSpin')} data-testid="hs-best-play" />}
              <span className="hs-rating">{p.rating}</span>
              {p.yours ? <Check size={13} className="hs-tick" role="img" aria-label={t('yourPick')} /> : <span className="hs-spin">{t('spinShort', { n: p.spin + 1 })}</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

/** A draft with no grade (a run-in's reinforcements, grades hidden): the men it brought, so the box is not empty. */
function Signings({ picks, get }: { picks: Recap['ungraded']; get: (id: string) => PlayerSeason | undefined }) {
  return (
    <div className="recap-hindsight" data-testid="recap-signings">
      <div className="hs-head">
        <span className="recap-icon good" aria-hidden>
          <UserPlus size={18} />
        </span>
        <div className="col" style={{ gap: 2, minWidth: 0 }}>
          <span className="eyebrow">{t('yourPicks')}</span>
          <b>{t('playersFromWheel', { n: picks.length })}</b>
        </div>
      </div>
      <ol className="hs-grid" aria-label={t('yourPicks')}>
        {picks.map((x) => {
          const p = get(x.id)
          if (!p) return null
          return (
            <li key={x.spin} className="hs-man">
              <span className="hs-pos">{p.positions[0]}</span>
              <span className="hs-name">{p.name}</span>
              {x.rating !== null ? <span className="hs-rating">{x.rating}</span> : <span />}
              <span className="hs-spin">{seasonLabel(p.season)}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
