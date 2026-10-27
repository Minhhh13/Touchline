import { useMemo } from 'react'
import { useStore } from '@game/store'
import type { Game } from '@game/types'
import { postKey, useOnline } from '../../online/state'
import { CASUAL_BOARD_NAME, casualBoardOf, casualUnrankedReason } from '../../online/casual'
import { countryFlag } from '../../online/core/country'
import { ordinal } from '../format'
import { APP_NAME } from '../brand'
import { rememberWorldTab } from './WorldBoard'
import { sentence } from '../../online/postText'

/**
 * One line on the summary of a casual board's run (online builds only): the Daily Arena, the Weekly Challenge (mode
 * weekly) or the Run-in of the week. Posted and where it ranks, waiting for sign-in, or why it is not on the board
 * (a run managed by hand, something outside the puzzle). Any other arena run or run-in shows nothing.
 */
export function CasualStatus({ game }: { game: Game }) {
  const configured = useOnline((s) => s.configured)
  const session = useOnline((s) => s.session)
  const board = casualBoardOf(game.settings)
  const post = useOnline((s) => (board ? s.posts[postKey(board.board, board.key)] : undefined))
  const go = useStore((s) => s.go)
  const showToast = useStore((s) => s.showToast)
  const u = useStore((s) => s.universe)
  // Only while nothing was filed: the reason is the verifier's own checks (a run-in replays itself, once)
  const boardKey = board ? `${board.board}:${board.key}` : null
  const reason = useMemo(() => (configured && boardKey && !post && u ? casualUnrankedReason(game, u) : null), [configured, boardKey, post, u, game])
  if (!configured || !board) return null
  const where = CASUAL_BOARD_NAME[board.board]
  let line: React.ReactNode
  let share: string | null = null
  if (reason) line = <>Not on {where}: {sentence(reason)}</>
  else if (!post) line = <>Filing this run for {where}…</>
  else if (post.state === 'waiting' && post.reason === 'sign_in' && !session)
    line = (
      <>
        Sign in to post this run to {where}.{' '}
        <button className="btn sm primary" onClick={() => go('account')} data-testid="casual-signin">
          Sign in
        </button>
      </>
    )
  else if (post.state === 'waiting' && post.reason === 'retry') line = <>Waiting to post: the server did not answer, so this device tries again shortly.</>
  else if (post.state === 'waiting') line = <>Posting to {where}…</>
  else if (post.state === 'posted') {
    const country = post.country && post.countryPosition ? ` · ${ordinal(post.countryPosition)} of ${post.countryTotal ?? 0} in ${countryFlag(post.country)}` : ''
    const result = post.detail && !/^[A-Z_ ]+$/.test(post.detail) ? post.detail : `${post.points} pts`
    share = `${ordinal(post.position)} of ${post.total.toLocaleString()} on ${where} in ${APP_NAME} (${result})`
    line = (
      <>
        {post.already ? 'Your first posted run counts: ' : `On ${where}: `}
        {ordinal(post.position)} of {post.total.toLocaleString()} ({result}){country}
        {post.claimMatched ? '.' : ' (official result from the server’s replay).'}
      </>
    )
  } else if (post.state === 'unranked') line = <>Not on {where}: {sentence(post.reason)}</>
  else if (post.state === 'rejected') line = <>Not ranked: {sentence(post.reason)}</>
  else line = <>That board has closed.</>
  return (
    <div className={`notice row between wrap ${post?.state === 'rejected' ? 'warn' : ''}`} style={{ marginTop: 12 }} data-testid="casual-status">
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
        <button
          className="btn sm"
          onClick={() => {
            rememberWorldTab(board.board)
            go('world')
          }}
          data-testid="open-casual-board"
        >
          World leaderboard
        </button>
      </span>
    </div>
  )
}
