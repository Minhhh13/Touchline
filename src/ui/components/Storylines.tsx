import { useMemo } from 'react'
import type { LoadedUniverse } from '@engine/universe'
import type { Game } from '@game/types'
import { matchPreview, nextLeagueFixture, nextTieFixture, storylines, summerReview, type FormLetter, type MatchPreview } from '@game/logic/storylines'
import { previewLines, previewTitle, storylineText, summerText } from '../storyText'
import { outcomeClass } from '../format'
import { translator } from '../i18n'
import { story } from '../i18n/en/story'
import { PREVIEW_ICON, STORY_ICON, SUMMER_ICON } from './icons'
import { ClubBadge, Info } from './bits'
import { resultsLabel } from '../a11y'

const t = translator(story)

/** The key every storyline's wording hangs on: the game, its year and the week, so a week always reads the same. */
export function storyKey(game: Game): string {
  return `${game.id}|${game.year}|${game.season?.matchweek ?? 0}`
}

/** The running storylines in words, strongest first; memoised on the season and the squad. */
export function useStorylines(game: Game | null, u: LoadedUniverse | null) {
  return useMemo(() => {
    if (!game || !u || !game.season) return []
    const key = storyKey(game)
    return storylines(game, u).map((s) => ({ s, ...storylineText(s, u, game.settings.teamName, key) }))
  }, [game, u])
}

function FormChips({ form, who }: { form: FormLetter[]; who: 'ours' | 'theirs' }) {
  if (!form.length) return <span className="small muted">{t('noLeagueForm')}</span>
  return (
    <span className="story-form" role="img" aria-label={resultsLabel(form, t('formAria', { who }))}>
      {form.map((o, i) => (
        <span key={i} className={`chip ${outcomeClass(o)}`}>
          {o}
        </span>
      ))}
    </span>
  )
}

function PreviewBlock({ p, u, game }: { p: MatchPreview; u: LoadedUniverse; game: Game }) {
  const lines = previewLines(p, u, game.settings.teamName, storyKey(game))
  return (
    <div className="story-preview" data-testid={`preview-${p.comp}`}>
      <div className="story-preview-head">
        <ClubBadge clubId={p.opponentId} size={24} />
        <b>{previewTitle(p, u)}</b>
        {p.table && (
          <span className="small muted">
            {t('tablePair', { ours: p.table.ours, oursPts: p.table.oursPts, theirs: p.table.theirs, theirsPts: p.table.theirsPts })}
          </span>
        )}
      </div>
      <div className="story-form-row">
        <span className="small muted">{t('you')}</span>
        <FormChips form={p.form.ours} who="ours" />
        {p.comp === 'league' || p.form.theirs.length ? (
          <>
            <span className="small muted">{t('them')}</span>
            <FormChips form={p.form.theirs} who="theirs" />
          </>
        ) : null}
      </div>
      <ul className="story-lines">
        {lines.map((l) => {
          const Icon = PREVIEW_ICON[l.id]
          return (
            <li key={l.id} data-testid={`preview-line-${l.id}`}>
              <Icon size={15} aria-hidden="true" />
              <span>
                <span className="story-label">{l.label}</span> {l.text}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** The Next match tab's preview box: the league match, then the midweek tie when there is one. */
export function MatchPreviewPanel({ game, u }: { game: Game; u: LoadedUniverse }) {
  const previews = useMemo(() => {
    if (!game.season) return []
    const out: MatchPreview[] = []
    for (const f of [nextLeagueFixture(game), nextTieFixture(game)]) {
      const p = f ? matchPreview(game, u, f) : null
      if (p) out.push(p)
    }
    return out
  }, [game, u])
  if (!previews.length) return null
  return (
    <div className="panel" data-testid="match-preview">
      <div className="panel-head">
        <span className="head-title">
          <h3>{t('previewTitle')}</h3>
          <Info label={t('aboutPreview')}>{t('previewInfo')}</Info>
        </span>
      </div>
      {previews.map((p) => (
        <PreviewBlock key={`${p.comp}-${p.opponentId}`} p={p} u={u} game={game} />
      ))}
    </div>
  )
}

/** The Dugout's one chip: the strongest storyline, its sentence in the tooltip. */
export function StoryChip({ game, u }: { game: Game; u: LoadedUniverse }) {
  const stories = useStorylines(game, u)
  const top = stories[0]
  if (!top) return null
  const Icon = STORY_ICON[top.s.kind]
  return (
    <span className="chip info story-chip" title={t('chipTip', { title: top.title, text: top.text })} data-testid="story-chip">
      <Icon size={13} aria-hidden="true" /> {top.chip}
      {/* The tooltip's sentence for a screen reader, which never sees a title (round 4) */}
      <span className="sr-only">{t('chipSaid', { title: top.title, text: top.text })}</span>
    </span>
  )
}

/** The summer's headline for the Dugout's pre-season box, or nothing outside a Dynasty summer. */
export function SummerHeadline({ game, u }: { game: Game; u: LoadedUniverse }) {
  const r = summerReview(game)
  if (!r) return null
  const text = summerText(r, u, game.id)
  return (
    <div className="club-sub summer-headline" title={text.headline} data-testid="summer-headline">
      <SUMMER_ICON size={14} aria-hidden="true" />
      <span>{text.headline}</span>
    </div>
  )
}

/** The Inbox's Storylines box: a Dynasty summer's story of last season, then the running stories. */
export function InboxStorylines({ game, u }: { game: Game; u: LoadedUniverse }) {
  const stories = useStorylines(game, u)
  const review = summerReview(game)
  const summer = review ? summerText(review, u, game.id) : null
  if (!stories.length && !summer) return null
  return (
    <div className="story-box" data-testid="storylines">
      <div className="story-box-head small muted">{t('storylines')}</div>
      <div className="news">
        {summer && (
          <div className="item story summer-card" data-testid="summer-card">
            <span className="news-icon award">
              <SUMMER_ICON size={15} aria-hidden="true" />
            </span>
            <span>
              <div className="t">{t('lastSeason')}</div>
              <div className="b summer-head">{summer.headline}</div>
              <ul className="summer-lines">
                {summer.lines.map((l) => (
                  <li key={l.id}>{l.text}</li>
                ))}
              </ul>
            </span>
            <span className="news-mw">{t('summer')}</span>
          </div>
        )}
        {stories.map((x) => {
          const Icon = STORY_ICON[x.s.kind]
          return (
            <div key={x.s.id} className="item story" data-testid="storyline">
              <span className={`news-icon story-${x.s.kind}`}>
                <Icon size={15} aria-hidden="true" />
              </span>
              <span>
                <div className="t">{x.title}</div>
                <div className="b">{x.text}</div>
              </span>
              <span className="news-mw">{t('now')}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
