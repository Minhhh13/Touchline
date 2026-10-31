import { gameLabel, type SeasonStory } from '@game/logic/story'
import type { QuickGameResult } from '@game/types'
import { resultsLabel } from '../a11y'
import { translator } from '../i18n'
import { summary } from '../i18n/en/summary'
import { logicLine } from '../i18n/logicText'

const t = translator(summary)

const CELL: Record<'W' | 'D' | 'L', string> = { W: 'var(--good)', D: 'var(--draw)', L: 'var(--bad)' }

/** Season Story on the summary: the moment, the game-by-game strip and the records of the season. */
export function SeasonStoryPanel({ story, opponentName }: { story: SeasonStory; opponentName: (teamId: string) => string }) {
  const game = (r: QuickGameResult | null) => (r ? gameLabel(r, opponentName) : '—')
  const run = (r: SeasonStory['winRun']) => (r ? t('storyRun', { n: r.length, from: r.from, to: r.to }) : '—')
  return (
    <div className="panel" data-testid="season-story">
      <div className="panel-head">
        <h3>{t('seasonStory')}</h3>
        <span className="small muted">{t('storyGames', { n: story.results.length })}</span>
      </div>
      <div className="notice" data-testid="story-moment">
        {logicLine(story.moment)}
      </div>
      <div className="blocks" data-testid="story-strip" role="img" aria-label={resultsLabel(story.strip, t('resultsInOrder'))}>
        {story.strip.map((o, i) => (
          <span key={i} data-outcome={o} title={t('storyCell', { week: story.results[i]?.matchweek ?? i + 1, outcome: o })} style={{ background: CELL[o] }} />
        ))}
      </div>
      <dl className="kv" style={{ marginTop: 12, marginBottom: '1em' }}>
        {story.clinchedAt != null && (
          <>
            <dt>{t('titleSealed')}</dt>
            <dd>{t('mw', { week: story.clinchedAt })}</dd>
          </>
        )}
        {story.doomedAt != null && (
          <>
            <dt>{t('relegated')}</dt>
            <dd>{t('mw', { week: story.doomedAt })}</dd>
          </>
        )}
        <dt>{t('longestWinRun')}</dt>
        <dd>{run(story.winRun)}</dd>
        <dt>{t('longestUnbeatenRun')}</dt>
        <dd>{run(story.unbeatenRun)}</dd>
        {story.startEnded && (
          <>
            <dt>{t('winningStart')}</dt>
            <dd>{t('winsUntil', { n: story.startEnded.wins, game: game(story.startEnded.game) })}</dd>
          </>
        )}
        <dt>{t('cleanSheets')}</dt>
        <dd>{story.cleanSheets}</dd>
        <dt>{t('failedToScore')}</dt>
        <dd>{story.blanks}</dd>
        <dt>{t('bestWin')}</dt>
        <dd>{game(story.best)}</dd>
        <dt>{t('heaviestDefeat')}</dt>
        <dd>{game(story.worst)}</dd>
      </dl>
    </div>
  )
}
