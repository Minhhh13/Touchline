import type { ReactNode, Ref } from 'react'
import { CircleCheck, Dices, Hourglass, Trophy, type LucideIcon } from 'lucide-react'
import { getFormation } from '@engine/formations'
import { isComplete, picksMade, suggestSlot } from '@engine/draft'
import type { H2HDraft } from '@engine/h2h'
import type { ClubSeason, PlayerSeason } from '@engine/types'
import type { LoadedUniverse } from '@engine/universe'
import type { DisplayTier } from '@game/logic/rarity'
import type { H2HManager } from '@game/logic/h2h'
import { ratingHidden } from '@game/logic/ratingVisibility'
import { TierChip } from './CaseReel'
import { Pitch } from './Pitch'
import { PlayerRow } from './PlayerRow'
import { ClubBadge, EstimatedChip } from './bits'
import { FormationPicker } from './FormationPicker'
import { LeagueFlag } from './Flag'
import { TeamNameField } from './SetupBits'
import { clubName, formationName, ordinal, seasonLabel } from '../format'
import { translator } from '../i18n'
import { h2h as h2hText } from '../i18n/en/h2h'
import { formationBlurb } from '../i18n/engineText'
import { logicLine } from '../i18n/logicText'

/**
 * The head-to-head's boxes, one set for both ways to play: the hot-seat (screens/H2H.tsx) and the online room
 * (online/Rooms.tsx) build their setup, draft and messages from these, so the two read as one product. Display only:
 * every decision (who picks, which slot, what a pick sends) stays with the screen that passes it in.
 */
const t = translator(h2hText)

/** The head of every head-to-head screen: the title, a chip (the room's code, the hot-seat's seed), the league season, the rules' chips, the way back. */
export function H2HHead({ title, chip, league, extra, actions }: { title: string; chip?: ReactNode; league?: { u: LoadedUniverse; id: string; season: number }; extra?: ReactNode; actions: ReactNode }) {
  return (
    <div className="screen-head">
      <div className="screen-title">
        <h1>{title}</h1>
        <div className="screen-meta">
          {chip}
          {league && (
            <span>
              <LeagueFlag leagueId={league.id} /> {league.u.leagues.find((l) => l.id === league.id)?.name ?? league.u.available.find((l) => l.id === league.id)?.name ?? t('leagueFallback')} {seasonLabel(league.season)}
            </span>
          )}
          {extra}
        </div>
      </div>
      <div className="toolbar">{actions}</div>
    </div>
  )
}

/** How it works, as four pictures with a line each. */
export function H2HSteps({ label, steps }: { label: string; steps: Array<{ Icon: LucideIcon; title: string; line: string }> }) {
  return (
    <ol className="steps" aria-label={label}>
      {steps.map(({ Icon, title, line }) => (
        <li key={title}>
          <span className="step-icon" aria-hidden="true">
            <Icon size={20} />
          </span>
          <span>
            <b>{title}</b>
            <span className="small muted">{line}</span>
          </span>
        </li>
      ))}
    </ol>
  )
}

/** One box in the middle of the screen: a picture, a title, a line and a way on (loading, ended, not found). */
export function BoardMessage({ icon, title, line, action, testId }: { icon: ReactNode; title: ReactNode; line?: ReactNode; action?: ReactNode; testId?: string }) {
  return (
    <div className="screen-body fill">
      <div className="panel col room-message" data-testid={testId}>
        <div className="empty-state">
          <span className="empty-icon" aria-hidden="true">
            {icon}
          </span>
          <h3>{title}</h3>
          {line && <p className="muted small">{line}</p>}
          {action}
        </div>
      </div>
    </div>
  )
}

/** A manager as the room shows him: the club badge, the name, the shape and the club replaced; an empty seat when there is none yet. */
export function ManagerCard({ u, m, you, turn, testId }: { u: LoadedUniverse; m: H2HManager | null; you?: boolean; turn?: boolean; testId?: string }) {
  if (!m)
    return (
      <div className="club-head room-manager empty" data-testid={testId}>
        <span className="badge" style={{ width: 36, height: 36, background: 'var(--raised)', color: 'var(--text-2)' }}>?</span>
        <div className="muted">{t('waitingOther')}</div>
      </div>
    )
  return (
    <div className={`club-head room-manager ${turn ? 'turn' : ''}`} data-testid={testId}>
      {m.hostClubId ? <ClubBadge clubId={m.hostClubId} size={36} /> : null}
      <div>
        <b>{m.name}</b>
        {you && <span className="chip info" style={{ marginLeft: 8 }}>{t('you')}</span>}
        <div className="muted small">{m.hostClubId ? t('inPlaceOf', { formation: formationName(m.formationId), club: clubName(u, m.hostClubId) }) : formationName(m.formationId)}</div>
      </div>
    </div>
  )
}

/** A manager's own choices: the name, the formation and the club whose place he takes. */
export function ManagerFields({ u, name, onName, nameLabel, fallback, taken, formationId, onFormation, formationLabel, blurb = true, clubs, clubId, onClub, testIds }: { u: LoadedUniverse; name: string; onName: (v: string) => void; nameLabel: string; fallback: string; taken?: readonly string[]; formationId: string; onFormation: (id: string) => void; formationLabel: string; blurb?: boolean; clubs: string[]; clubId: string | undefined; onClub: (id: string) => void; testIds: { name: string; formation: string; club?: string } }) {
  return (
    <>
      <TeamNameField label={nameLabel} value={name} onChange={onName} fallback={fallback} maxLength={24} testId={testIds.name} taken={taken} />
      <div className="field formation-field">
        {t('formation')}
        <FormationPicker value={formationId} onChange={onFormation} label={formationLabel} testId={testIds.formation} />
        {blurb && <span className="help">{formationBlurb(getFormation(formationId))}</span>}
      </div>
      <label className="field">
        {t('hostClub')}
        <select className="input" value={clubId ?? ''} onChange={(e) => onClub(e.target.value)} data-testid={testIds.club}>
          {clubs.map((c) => (
            <option key={c} value={c}>
              {clubName(u, c)}
            </option>
          ))}
        </select>
      </label>
    </>
  )
}

/** Whose turn it is, in a band that lights up when the turn is this device's. */
export function TurnBanner({ mine, line, testId }: { mine: boolean; line: ReactNode; testId: string }) {
  return (
    <div className={`room-turn ${mine ? 'mine' : ''}`} data-testid={testId} aria-live="polite">
      {mine ? <CircleCheck size={18} aria-hidden="true" /> : <Hourglass size={18} aria-hidden="true" />} {line}
    </div>
  )
}

/** On a phone the turn scrolls out of sight under the squad list: a pill fixed at the foot keeps it (and a clock) in view. */
export function TurnPill({ mine, line, clock, testId }: { mine: boolean; line: string; clock?: string | null; testId: string }) {
  return (
    <div className={`room-turn-pill ${mine ? 'mine' : ''}`} aria-hidden="true" data-testid={testId}>
      {mine ? <CircleCheck size={16} /> : <Hourglass size={16} />}
      <span className="grow">{line}</span>
      {clock && <span className="mono">{clock}</span>}
    </div>
  )
}

/** The draft log, newest first. */
export function DraftLog({ lines }: { lines: string[] }) {
  if (!lines.length) return null
  return (
    <div className="panel tight">
      <div className="eyebrow">{t('draftLog')}</div>
      <ol className="h2h-log">
        {[...lines].reverse().slice(0, 30).map((l, i) => (
          <li key={i}>{logicLine(l)}</li>
        ))}
      </ol>
    </div>
  )
}

/** The middle box: the club-season on the wheel and its squad, or what comes next while there is none. */
export function OfferPanel({ u, current, tier, spinning, revealed, complete, waitingTitle, waitingLine, notice, headRef, rows, testId }: { u: LoadedUniverse; current: ClubSeason | null; tier?: DisplayTier; spinning: boolean; revealed: boolean; complete: boolean; waitingTitle: string; waitingLine?: string; notice?: ReactNode; headRef?: Ref<HTMLHeadingElement>; rows: ReactNode; testId?: string }) {
  return (
    <div className="panel col">
      {!current && (
        <div className="empty-state">
          <span className="empty-icon" aria-hidden="true">
            {complete ? <CircleCheck size={26} /> : <Dices size={26} />}
          </span>
          <h3>{complete ? t('bothComplete') : waitingTitle}</h3>
          {!complete && waitingLine && <p className="muted small">{waitingLine}</p>}
        </div>
      )}
      {current && spinning && !revealed && (
        <div className="club-head">
          <span className="badge" style={{ width: 44, height: 44, background: 'var(--raised)', color: 'var(--text)', fontSize: 18 }}>?</span>
          <div>
            <h2>{t('opening')}</h2>
            <div className="muted small">{t('landing')}</div>
          </div>
        </div>
      )}
      {current && (!spinning || revealed) && (
        <>
          <div className="club-head">
            <ClubBadge clubId={current.clubId} size={44} />
            <div>
              <h2 ref={headRef} tabIndex={headRef ? -1 : undefined}>
                {clubName(u, current.clubId)}
              </h2>
              <div className="club-sub">
                <span>{seasonLabel(current.season)}</span>
                {!current.complete ? (
                  <span>{t('inProgress')}</span>
                ) : current.champions ? (
                  <span className="chip gold icon-chip">
                    <Trophy size={12} aria-hidden="true" /> {t('champions')}
                  </span>
                ) : current.position > 0 ? (
                  <span>{ordinal(current.position)}</span>
                ) : (
                  <span>{t('noTable')}</span>
                )}
                {tier && <TierChip tier={tier} />}
                {current.estimated && <EstimatedChip compact />}
              </div>
            </div>
          </div>
          {revealed && notice}
          {revealed && (
            <div className="plist lined draft-list" data-testid={testId}>
              {rows}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** The squad on the wheel as rows, best first, each marked with the manager who took him. */
export function OfferRows({ current, managers, takenBy, usableIds, selectedId, hide, onPick, draftTestId }: { current: ClubSeason; managers: readonly H2HManager[]; takenBy: (p: PlayerSeason) => number; usableIds: Set<string>; selectedId: string | null; hide: boolean; onPick: (id: string) => void; draftTestId?: string }) {
  return (
    <>
      {[...current.squad]
        .sort((a, b) => b.overall - a.overall)
        .map((p) => {
          const by = takenBy(p)
          return <PlayerRow key={p.id} p={p} hideRatings={hide} hideChampion={current.champions} dim={!usableIds.has(p.id)} selected={selectedId === p.id} onClick={() => onPick(p.id)} extra={by >= 0 ? <span className="chip info">{managers[by].shortName}</span> : null} right={usableIds.has(p.id) ? <span className={`btn sm ${selectedId === p.id ? 'primary' : ''}`} data-testid={draftTestId}>{t('draft')}</span> : null} />
        })}
    </>
  )
}

/** Both managers' squads on their pitches, side by side in the third box; the manager on the clock gets the bigger one. */
export function SquadPitches({ u, d, managers, picking, you, placing, selected, eligible, slotClick, onSlot }: { u: LoadedUniverse; d: H2HDraft; managers: readonly [H2HManager, H2HManager]; picking: 0 | 1 | null; you?: 0 | 1 | null; placing: 0 | 1 | null; selected: PlayerSeason | undefined; eligible: string[]; slotClick: (i: 0 | 1) => ((slotId: string) => void) | undefined; onSlot: (i: 0 | 1, slotId: string) => void }) {
  return (
    <div className="col draft-pitch">
      {([0, 1] as const).map((i) => {
        const suggested = selected && placing === i ? suggestSlot(d.drafts[i], selected) : null
        return (
          <div key={i} className={`panel ${picking === i ? 'emphasis' : ''}`}>
            <div className="panel-head">
              <span className="club-head">
                <ClubBadge clubId={managers[i].hostClubId} size={24} />
                <h3>
                  {managers[i].name}
                  {you === i ? t('youSuffix') : ''} · {formationName(managers[i].formationId)}
                </h3>
              </span>
              <span className={`chip icon-chip ${isComplete(d.drafts[i]) ? 'good' : ''}`}>
                {isComplete(d.drafts[i]) && <CircleCheck size={12} aria-hidden="true" />}
                {picksMade(d.drafts[i])}/{d.drafts[i].rules.squadSize}
              </span>
            </div>
            <div className="h2h-pitch-box">
              <Pitch formation={d.drafts[i].formation} lineup={d.drafts[i].lineup} getPlayer={(id) => u.index[id]} onSlotClick={slotClick(i)} eligibleSlots={placing === i ? eligible : []} hideRatings={ratingHidden(d.drafts[i].rules, 'squad')} />
            </div>
            {selected && suggested && suggested !== 'bench' && (
              <button className="btn block" style={{ marginTop: 8 }} onClick={() => onSlot(i, suggested)}>
                {t('putAt', { name: selected.name, pos: d.drafts[i].formation.slots.find((s) => s.id === suggested)?.position })}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** The draft's three boxes: the wheel and whose turn (with the log under it), the squad on the wheel, both pitches. */
export function DraftBoard({ controls, log, offer, pitches, testId, turn }: { controls: ReactNode; log: string[]; offer: ReactNode; pitches: ReactNode; testId?: string; turn?: string }) {
  return (
    <div className="grid draft fill" data-testid={testId} data-turn={turn}>
      <div className="col">
        <div className="panel col">{controls}</div>
        <DraftLog lines={log} />
      </div>
      {offer}
      {pitches}
    </div>
  )
}
