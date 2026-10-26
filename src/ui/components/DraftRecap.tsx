import { Check, Compass, History, Sparkles, Trophy, UserPlus } from 'lucide-react'
import type { DraftRecap as Recap } from '@game/logic/draftRecap'
import type { Hindsight } from '@game/logic/hindsight'
import type { PickGrade } from '@game/logic/pickGrades'
import type { PlayerSeason } from '@engine/types'
import { countPhrase } from '../screenText'
import { seasonLabel } from '../format'
import { Tip } from './bits'

const GRADE_CLASS: Record<PickGrade, string> = { A: 'good', B: 'info', C: 'warn', D: 'bad' }
const GRADES: PickGrade[] = ['A', 'B', 'C', 'D']

/**
 * The Draft's middle box once every pick is made: the draft's grade and verdict, the grade tally, the best pick, the one
 * that got away and how far the wheel travelled, and the Hindsight XI (the best XI the same spins held). The button on
 * to the next step is the left box's, so the screen's main action is in one place. Display only (`draftRecap`).
 */
export function DraftRecap({ recap, get, slotName }: { recap: Recap; get: (id: string) => PlayerSeason | undefined; slotName: (slotId: string) => string }) {
  const r = recap
  const best = r.best ? get(r.best.pickedId) : undefined
  const missed = r.miss ? get(r.miss.pickedId) : undefined
  const span = r.seasons ? (r.seasons[0] === r.seasons[1] ? seasonLabel(r.seasons[0]) : `${seasonLabel(r.seasons[0])} to ${seasonLabel(r.seasons[1])}`) : null
  return (
    <div className="draft-recap" data-testid="draft-recap">
      <div className="recap-head">
        {r.grade && (
          <span className={`recap-grade ${GRADE_CLASS[r.grade]}`} data-testid="draft-grade" aria-label={`Draft grade ${r.grade}`}>
            {r.grade}
          </span>
        )}
        <div className="col" style={{ gap: 4, minWidth: 0 }}>
          <span className="eyebrow">{r.grade ? 'Your draft' : 'All picks made'}</span>
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
      {r.grade && <Tip id="draft-recap">Each pick is graded by the number on his pitch disc, against the best play his spin held for your open slots, counting the spins that came after: A is the best play, B to D left up to 2, 4 or more XI points. The Hindsight XI is the best XI your spins held; a tick is your pick where you put him, S5 the spin a man came from.</Tip>}
      <div className="recap-cards">
        {r.best && best && (
          <div className="recap-card" data-testid="recap-best">
            <span className="recap-icon good" aria-hidden>
              <Trophy size={18} />
            </span>
            <div className="col" style={{ gap: 2, minWidth: 0 }}>
              <span className="eyebrow">Best pick</span>
              <b>{best.name}</b>
              <span className="small muted">
                {r.best.rating} at {slotName(r.best.slotId)}, spin {r.best.spin + 1} · {seasonLabel(best.season)}
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
              <span className="eyebrow">The one that got away</span>
              <b>{r.miss.bestName}</b>
              <span className="small muted">
                {r.miss.best} at {slotName(r.miss.bestSlotId)} on spin {r.miss.spin + 1}; you took {missed.name} ({r.miss.rating} at {slotName(r.miss.slotId)}), {countPhrase(r.miss.left, 'XI points')} left
              </span>
            </div>
          </div>
        )}
        <div className="recap-card" data-testid="recap-travel">
          <span className="recap-icon" aria-hidden>
            <Compass size={18} />
          </span>
          <div className="col" style={{ gap: 2, minWidth: 0 }}>
            <span className="eyebrow">Where the wheel went</span>
            <b>
              {countPhrase(r.clubs, 'clubs')} · {countPhrase(r.nations, 'nations')}
            </b>
            <span className="small muted">
              {countPhrase(r.picks, 'picks')}
              {span ? `, ${span}` : ''}
              {r.xiRating !== null ? ` · XI ${r.xiRating.toFixed(1)} in its slots` : ''}
            </span>
          </div>
        </div>
      </div>
      {!r.grade && r.ungraded.length > 0 && <Signings picks={r.ungraded} get={get} />}
      {r.hindsight && <HindsightXI h={r.hindsight} slotName={slotName} />}
    </div>
  )
}

/** The best XI the same spins could have given, slot by slot, your own picks ticked, and the gap to your XI. */
function HindsightXI({ h, slotName }: { h: Hindsight; slotName: (slotId: string) => string }) {
  const perfect = h.gap <= 0
  return (
    <div className="recap-hindsight" data-testid="recap-hindsight">
      <div className="hs-head">
        <span className="recap-icon" aria-hidden>
          <History size={18} />
        </span>
        <div className="col" style={{ gap: 2, minWidth: 0 }}>
          <span className="eyebrow">Hindsight XI</span>
          <b data-testid="hindsight-line">{perfect ? 'You made the most of every spin' : `${h.rating.toFixed(1)} with what the wheel gave you`}</b>
          <span className="small muted">
            {perfect ? `Your XI, ${h.yours.toFixed(1)} in its slots, is the best these spins held` : `Yours ${h.yours.toFixed(1)}, ${h.gap.toFixed(1)} short. Ticked: your pick where you put him (${h.kept} of ${h.xi.length}); S5: the spin he was on`}
          </span>
        </div>
      </div>
      {!perfect && (
        <ol className="hs-grid" aria-label="Hindsight XI">
          {h.xi.map((p) => (
            <li key={p.slotId} className={`hs-man${p.yours ? ' yours' : ''}`} title={p.yours ? 'Your pick, in your slot' : `From spin ${p.spin + 1}`}>
              <span className="hs-pos">{slotName(p.slotId)}</span>
              <span className="hs-name">{p.name}</span>
              <span className="hs-rating">{p.rating}</span>
              {p.yours ? <Check size={13} className="hs-tick" aria-label="your pick" /> : <span className="hs-spin">S{p.spin + 1}</span>}
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
          <span className="eyebrow">Your picks</span>
          <b>{countPhrase(picks.length, 'players')} from the wheel</b>
        </div>
      </div>
      <ol className="hs-grid" aria-label="Your picks">
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
