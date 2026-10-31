import { useMemo, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Cake, Crown, Hourglass, Shield, TrendingUp, Trophy, Users } from 'lucide-react'
import type { PlayerSeason } from '@engine/types'
import { useStore } from '@game/store'
import { isEstimated } from '@game/logic/era'
import { leagueTrivia, STAR_RATING } from '@game/logic/exploreRecords'
import { useExploreIndex, useLast } from '../useExploreIndex'
import { ClubBadge, EstimatedChip, Info, Rating } from '../components/bits'
import { NationFlag } from '../components/Flag'
import { clubName, clubShort, seasonLabel } from '../format'
import { translator } from '../i18n'
import { playerCard } from '../i18n/en/playerCard'

const t = translator(playerCard)

/**
 * Explore's Records view (display only, every list from `exploreRecords.ts`): one league's trivia derived from the
 * data, labelled as such, in three boxes that scroll inside themselves on the desktop shell (Clubs, Players, Ages).
 */

function Section({ icon, title, help, children, testId }: { icon: ReactNode; title: string; help?: string; children: ReactNode; testId: string }) {
  return (
    <section className="trivia-section" data-testid={testId}>
      <h4 className="icon-title sub-head">
        {icon} {title}
      </h4>
      {help && <p className="small muted trivia-help">{help}</p>}
      {children}
    </section>
  )
}

function Empty() {
  return <p className="small muted">{t('none')}</p>
}

function Club({ clubId, onClub }: { clubId: string; onClub: (id: string) => void }) {
  const u = useStore((s) => s.universe)
  return (
    <button type="button" className="link-btn trivia-who" onClick={() => onClub(clubId)} title={clubName(u, clubId)}>
      <ClubBadge clubId={clubId} size={18} /> <span className="ellipsis">{clubName(u, clubId)}</span>
    </button>
  )
}

function Player({ playerId, name, nation, onPlayer }: { playerId: string; name: string; nation?: string; onPlayer: (id: string) => void }) {
  return (
    <button type="button" className="link-btn trivia-who" onClick={() => onPlayer(playerId)} title={name}>
      {nation && <NationFlag nation={nation} />} <span className="ellipsis">{name}</span>
    </button>
  )
}

function AgeList({ list, onPlayer }: { list: PlayerSeason[]; onPlayer: (id: string) => void }) {
  const u = useStore((s) => s.universe)
  if (!u || !list.length) return <Empty />
  return (
    <ol className="trivia-list">
      {list.map((p) => (
        <li key={p.id}>
          <span className="trivia-fig age mono">{t('ageYears', { n: p.age })}</span>
          <span className="trivia-main">
            <Player playerId={p.playerId} name={p.name} nation={p.nationality} onPlayer={onPlayer} />
            <span className="trivia-meta">
              {clubShort(u, p.clubId)} {seasonLabel(p.season)}
              {isEstimated(u, p) && <> <EstimatedChip compact /></>}
            </span>
          </span>
          <Rating value={p.overall} />
        </li>
      ))}
    </ol>
  )
}

export function RecordsView({ leagueId, onClub, onPlayer }: { leagueId: string; onClub: (id: string) => void; onPlayer: (playerId: string) => void }) {
  const u = useStore((s) => s.universe)
  const indexed = useExploreIndex(u)
  const trivia = useLast(useMemo(() => (u && indexed ? leagueTrivia(u, leagueId) : null), [u, indexed, leagueId]), null)
  if (!u || !trivia) return null
  const c = trivia.coverage
  const league = u.available.find((l) => l.id === leagueId)?.name ?? leagueId
  const noTables = c.withTable === 0
  return (
    <div className="explore-records-wrap fill">
      <p className="help trivia-derived" data-testid="records-derived">
        <span className="chip info">{t('recordsDerived')}</span>
        <span>{t('recordsFacts', { league, seasons: c.seasons, from: seasonLabel(c.from), to: seasonLabel(c.to), players: c.playerSeasons })}</span>
        {c.estimatedSeasons > 0 && (
          <span className="trivia-est">
            <EstimatedChip compact /> {t('recordsEstimated', { n: c.estimatedSeasons })}
          </span>
        )}
        <Info label={t('recordsAboutLabel')}>{t('recordsAbout')}</Info>
      </p>
      <div className="grid three fill explore-records" data-testid="explore-records">
        <div className="panel">
          <div className="panel-head">
            <h3 className="icon-title">
              <Shield size={16} aria-hidden="true" /> {t('recordsClubs')}
            </h3>
          </div>
          <div className="trivia-scroll">
            {noTables ? (
              <p className="small muted">{t('noTables')}</p>
            ) : (
              <>
                <Section icon={<ArrowUp size={14} aria-hidden="true" />} title={t('climbs')} help={t('climbsHelp')} testId="trivia-climbs">
                  {trivia.climbs.length ? (
                    <ol className="trivia-list">
                      {trivia.climbs.map((m) => (
                        <li key={`${m.clubId}@${m.season}`}>
                          <span className="trivia-fig good">{t('places', { n: m.change })}</span>
                          <span className="trivia-main">
                            <Club clubId={m.clubId} onClub={onClub} />
                            <span className="trivia-meta">
                              {t('moveLine', { before: m.before, after: m.after })} · {seasonLabel(m.season)}
                              {m.estimated && <> <EstimatedChip compact /></>}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <Empty />
                  )}
                </Section>
                <Section icon={<ArrowDown size={14} aria-hidden="true" />} title={t('falls')} help={t('fallsHelp')} testId="trivia-falls">
                  {trivia.falls.length ? (
                    <ol className="trivia-list">
                      {trivia.falls.map((m) => (
                        <li key={`${m.clubId}@${m.season}`}>
                          <span className="trivia-fig bad">{t('placesDown', { n: -m.change })}</span>
                          <span className="trivia-main">
                            <Club clubId={m.clubId} onClub={onClub} />
                            <span className="trivia-meta">
                              {t('moveLine', { before: m.before, after: m.after })} · {seasonLabel(m.season)}
                              {m.estimated && <> <EstimatedChip compact /></>}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <Empty />
                  )}
                </Section>
                <Section icon={<Crown size={14} aria-hidden="true" />} title={t('streaks')} testId="trivia-streaks">
                  {trivia.streaks.length ? (
                    <ol className="trivia-list">
                      {trivia.streaks.map((s) => (
                        <li key={`${s.clubId}@${s.from}`}>
                          <span className="trivia-fig gold">{t('streakCount', { n: s.length })}</span>
                          <span className="trivia-main">
                            <Club clubId={s.clubId} onClub={onClub} />
                            <span className="trivia-meta">
                              {t('streakLine', { from: seasonLabel(s.from), to: seasonLabel(s.to) })}
                              {s.estimated && <> <EstimatedChip compact /></>}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <Empty />
                  )}
                </Section>
              </>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h3 className="icon-title">
              <Users size={16} aria-hidden="true" /> {t('recordsPlayers')}
            </h3>
          </div>
          <div className="trivia-scroll">
            <Section icon={<Hourglass size={14} aria-hidden="true" />} title={t('serving')} help={t('servingHelp')} testId="trivia-serving">
              {trivia.serving.length ? (
                <ol className="trivia-list">
                  {trivia.serving.map((s) => (
                    <li key={`${s.playerId}@${s.clubId}`}>
                      <span className="trivia-fig">{t('seasonsCount', { n: s.seasons })}</span>
                      <span className="trivia-main">
                        <Player playerId={s.playerId} name={s.name} onPlayer={onPlayer} />
                        <span className="trivia-meta">
                          <ClubBadge clubId={s.clubId} size={14} /> {clubShort(u, s.clubId)} · {t('streakLine', { from: seasonLabel(s.from), to: seasonLabel(s.to) })}
                          {s.estimated && <> <EstimatedChip compact /></>}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <Empty />
              )}
            </Section>
            <Section icon={<Trophy size={14} aria-hidden="true" />} title={t('titles')} testId="trivia-titles">
              {trivia.titles.length ? (
                <ol className="trivia-list">
                  {trivia.titles.map((h) => (
                    <li key={h.playerId}>
                      <span className="trivia-fig gold">{t('titleCount', { n: h.titles })}</span>
                      <span className="trivia-main">
                        <Player playerId={h.playerId} name={h.name} onPlayer={onPlayer} />
                        <span className="trivia-meta">
                          {h.clubs.map((id) => clubShort(u, id)).join(', ')}
                          {h.estimated && <> <EstimatedChip compact /></>}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <Empty />
              )}
            </Section>
            <Section icon={<TrendingUp size={14} aria-hidden="true" />} title={t('risers')} help={t('risersHelp')} testId="trivia-risers">
              {trivia.risers.length ? (
                <ol className="trivia-list">
                  {trivia.risers.map((r) => (
                    <li key={r.playerId}>
                      <span className="trivia-fig good">+{r.change}</span>
                      <span className="trivia-main">
                        <Player playerId={r.playerId} name={r.name} nation={r.after.nationality} onPlayer={onPlayer} />
                        <span className="trivia-meta">
                          {t('riseLine', { before: r.before.overall, after: r.after.overall, season: seasonLabel(r.after.season) })} · {clubShort(u, r.after.clubId)}
                          {r.estimated && <> <EstimatedChip compact /></>}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <Empty />
              )}
            </Section>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h3 className="icon-title">
              <Cake size={16} aria-hidden="true" /> {t('recordsAges')}
            </h3>
          </div>
          <div className="trivia-scroll">
            <Section icon={<ArrowDown size={14} aria-hidden="true" />} title={t('youngest', { n: STAR_RATING })} testId="trivia-youngest">
              <AgeList list={trivia.youngest} onPlayer={onPlayer} />
            </Section>
            <Section icon={<ArrowUp size={14} aria-hidden="true" />} title={t('oldest', { n: STAR_RATING })} testId="trivia-oldest">
              <AgeList list={trivia.oldest} onPlayer={onPlayer} />
            </Section>
          </div>
        </div>
      </div>
    </div>
  )
}
