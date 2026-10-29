import type { NewsItem } from '@engine/season'
import type { Game } from '@game/types'
import type { BriefingAction } from '@game/logic/briefing'
import { inboxActions } from '@game/logic/inboxActions'
import { logicLine } from '../i18n/logicText'

/** The buttons under an Inbox item: each opens the screen where the manager can act on it. */
export function InboxActions({ item, game, onAction }: { item: NewsItem; game: Game; onAction: (a: BriefingAction) => void }) {
  const acts = inboxActions(item, game)
  if (!acts.length) return null
  return (
    <div className="news-actions" data-testid="inbox-actions">
      {acts.map((a) => (
        <button key={a.label} type="button" className="btn sm" onClick={() => onAction(a)}>
          {logicLine(a.label)}
        </button>
      ))}
    </div>
  )
}
