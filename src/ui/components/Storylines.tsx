import { useMemo } from 'react'
import type { LoadedUniverse } from '@engine/universe'
import type { Game } from '@game/types'
import { matchPreview, nextLeagueFixture, nextTieFixture, storylines, summerReview, type FormLetter, type MatchPreview } from '@game/logic/storylines'
import { previewLines, previewTitle, storylineText, summerText } from '../storyText'
import { ordinal, outcomeClass } from '../format'
import { PREVIEW_ICON, STORY_ICON, SUMMER_ICON } from './icons'
import { ClubBadge, Info } from './bits'

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

function FormChips({ form, label }: { form: FormLetter[]; label: string }) {
  if (!form.length) return <span className="small muted">no league form</span>
  return (
    <span className="story-form" role="img" aria-label={`${label}: ${form.join(' ')}, oldest first`}>
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
            You {ordinal(p.table.ours)}, {p.table.oursPts} pts · them {ordinal(p.table.theirs)}, {p.table.theirsPts} pts
          </span>
        )}
      </div>
      <div className="story-form-row">
        <span className="small muted">You</span>
        <FormChips form={p.form.ours} label="Your form" />
        {p.comp === 'league' || p.form.theirs.length ? (
          <>
            <span className="small muted">Them</span>
            <FormChips form={p.form.theirs} label="Their form" />
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
          <h3>Match preview</h3>
          <Info label="About the preview">Form is the last five league games, oldest first. The player to watch is their top scorer who is fit, or their best player; yours is the starter in the best recent form.</Info>
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
    <span className="chip info story-chip" title={`${top.title}: ${top.text}`} data-testid="story-chip">
      <Icon size={13} aria-hidden="true" /> {top.chip}
    </span>
  )
}

/** The summer's headline for the Dugout's pre-season box, or nothing outside a Dynasty summer. */
export function SummerHeadline({ game, u }: { game: Game; u: LoadedUniverse }) {
  const r = summerReview(game)
  if (!r) return null
  const t = summerText(r, u, game.id)
  return (
    <div className="club-sub summer-headline" data-testid="summer-headline">
      <SUMMER_ICON size={14} aria-hidden="true" />
      <span>{t.headline}</span>
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
      <div className="story-box-head small muted">Storylines</div>
      <div className="news">
        {summer && (
          <div className="item story summer-card" data-testid="summer-card">
            <span className="news-icon award">
              <SUMMER_ICON size={15} aria-hidden="true" />
            </span>
            <span>
              <div className="t">The story of last season</div>
              <div className="b summer-head">{summer.headline}</div>
              <ul className="summer-lines">
                {summer.lines.map((l) => (
                  <li key={l.id}>{l.text}</li>
                ))}
              </ul>
            </span>
            <span className="news-mw">Summer</span>
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
              <span className="news-mw">Now</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
