import { gameLabel, type SeasonStory } from '@game/logic/story'
import type { QuickGameResult } from '@game/types'

const CELL: Record<'W' | 'D' | 'L', string> = { W: 'var(--accent)', D: '#cfd8d2', L: 'var(--danger)' }

/** Season Story on the summary: the moment, the game-by-game strip and the records of the season. */
export function SeasonStoryPanel({ story, opponentName }: { story: SeasonStory; opponentName: (teamId: string) => string }) {
  const game = (r: QuickGameResult | null) => (r ? gameLabel(r, opponentName) : '—')
  const run = (r: SeasonStory['winRun']) => (r ? `${r.length} (MW ${r.from}-${r.to})` : '—')
  return (
    <div className="panel" data-testid="season-story">
      <div className="panel-head">
        <h3>Season story</h3>
        <span className="small muted">{story.results.length} games, in the order they were played</span>
      </div>
      <div className="notice" data-testid="story-moment">
        {story.moment}
      </div>
      <div className="blocks" data-testid="story-strip" role="img" aria-label={`Results in order: ${story.strip.join(' ')}`}>
        {story.strip.map((o, i) => (
          <span key={i} data-outcome={o} title={`MW ${story.results[i]?.matchweek ?? i + 1}: ${o}`} style={{ background: CELL[o] }} />
        ))}
      </div>
      <dl className="kv" style={{ marginTop: 12 }}>
        {story.clinchedAt != null && (
          <>
            <dt>Title sealed</dt>
            <dd>MW {story.clinchedAt}</dd>
          </>
        )}
        {story.doomedAt != null && (
          <>
            <dt>Relegated</dt>
            <dd>MW {story.doomedAt}</dd>
          </>
        )}
        <dt>Longest winning run</dt>
        <dd>{run(story.winRun)}</dd>
        <dt>Longest unbeaten run</dt>
        <dd>{run(story.unbeatenRun)}</dd>
        {story.startEnded && (
          <>
            <dt>Winning start</dt>
            <dd>
              {story.startEnded.wins} until {game(story.startEnded.game)}
            </dd>
          </>
        )}
        <dt>Clean sheets</dt>
        <dd>{story.cleanSheets}</dd>
        <dt>Failed to score</dt>
        <dd>{story.blanks}</dd>
        <dt>Best win</dt>
        <dd>{game(story.best)}</dd>
        <dt>Heaviest defeat</dt>
        <dd>{game(story.worst)}</dd>
      </dl>
    </div>
  )
}
