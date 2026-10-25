import { useStore } from '@game/store'
import type { Game } from '@game/types'
import { postKey, useOnline } from '../../online/state'
import { rankedBoardOf } from '../../online/daily'
import { countryFlag } from '../../online/core/country'
import { ordinal } from '../format'
import { APP_NAME } from '../brand'

/** One line on a Daily or weekly Summary: posted and where it ranks, waiting for sign-in, or why it is unranked. */
export function RankedStatus({ game }: { game: Game }) {
  const configured = useOnline((s) => s.configured)
  const session = useOnline((s) => s.session)
  const board = rankedBoardOf(game.settings)
  const post = useOnline((s) => (board ? s.posts[postKey(board.kind, board.key)] : undefined))
  const go = useStore((s) => s.go)
  const showToast = useStore((s) => s.showToast)
  if (!configured || !board) return null
  const where = board.kind === 'daily' ? "today's Daily" : "this week's challenge"
  const points = game.quickResult?.points ?? 0
  let line: React.ReactNode
  let share: string | null = null
  if (!post) line = <>Finished before this device kept ranked posts: it is not on the board.</>
  else if (post.state === 'waiting' && post.reason === 'sign_in' && !session)
    line = (
      <>
        Sign in to post {post.points ?? points} pts to the board for {where}.{' '}
        <button className="btn sm primary" onClick={() => go('profile')} data-testid="ranked-signin">
          Sign in
        </button>
      </>
    )
  else if (post.state === 'waiting') line = <>Posting to the world leaderboard…</>
  else if (post.state === 'posted') {
    const country = post.country && post.countryPosition ? ` · ${ordinal(post.countryPosition)} of ${post.countryTotal ?? 0} in ${countryFlag(post.country)}` : ''
    share = `${ordinal(post.position)} of ${post.total.toLocaleString()} on ${where} in ${APP_NAME}`
    line = post.already ? (
      <>
        Your first finished run counts: {post.points} pts, {ordinal(post.position)} of {post.total.toLocaleString()}
        {country}.
      </>
    ) : (
      <>
        Posted: {ordinal(post.position)} of {post.total.toLocaleString()} on {where}
        {country}
        {post.claimMatched ? '.' : ' (official result from the server’s replay).'}
      </>
    )
  } else if (post.state === 'unranked') line = <>Unranked: {post.reason}</>
  else if (post.state === 'rejected') line = <>Not ranked: {post.reason}</>
  else line = <>That board has closed.</>
  return (
    <div className={`notice row between wrap ${post?.state === 'rejected' ? 'warn' : ''}`} style={{ marginTop: 12 }} data-testid="ranked-status">
      <span>{line}</span>
      <span className="row">
        {share && (
          <button
            className="btn sm ghost"
            onClick={() => {
              void navigator.clipboard?.writeText(share!).then(
                () => showToast('Copied.'),
                () => showToast(share!),
              )
            }}
          >
            Copy
          </button>
        )}
        <button className="btn sm" onClick={() => go('world')} data-testid="open-world">
          World leaderboard
        </button>
      </span>
    </div>
  )
}
