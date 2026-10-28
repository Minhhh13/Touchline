import { useMemo } from 'react'
import { useStore } from '@game/store'
import type { Game } from '@game/types'
import { postKey, useOnline } from '../../online/state'
import { casualBoardOf, casualUnrankedReason } from '../../online/casual'
import { countryName } from './countries'
import { APP_NAME } from '../brand'
import { rememberWorldTab } from './WorldBoard'
import { sentence } from '../../online/postText'
import { translator } from '../i18n'
import { online } from '../i18n/en/online'

const t = translator(online)

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
  const where = t(`casualWhere_${board.board}`)
  let line: React.ReactNode
  let share: string | null = null
  if (reason) line = <>{t('casualNotOn', { where, reason: sentence(reason) })}</>
  else if (!post) line = <>{t('casualFiling', { where })}</>
  else if (post.state === 'waiting' && post.reason === 'sign_in' && !session)
    line = (
      <>
        {t('casualSignIn', { where })}{' '}
        <button className="btn sm primary" onClick={() => go('account')} data-testid="casual-signin">
          {t('signIn')}
        </button>
      </>
    )
  else if (post.state === 'waiting' && post.reason === 'retry') line = <>{t('casualRetry')}</>
  else if (post.state === 'waiting') line = <>{t('casualPosting', { where })}</>
  else if (post.state === 'posted') {
    const country = post.country && post.countryPosition ? t('countryRank', { pos: post.countryPosition, total: post.countryTotal ?? 0, country: countryName(post.country) }) : ''
    const result = post.detail && !/^[A-Z_ ]+$/.test(post.detail) ? post.detail : t('casualPts', { n: post.points })
    const total = post.total.toLocaleString()
    share = t('shareRank', { pos: post.position, total, where, app: APP_NAME })
    line = <>{t(post.already ? 'casualFirst' : post.claimMatched ? 'casualPosted' : 'casualPostedOfficial', { where, pos: post.position, total, result, country })}</>
  } else if (post.state === 'unranked') line = <>{t('casualNotOn', { where, reason: sentence(post.reason) })}</>
  else if (post.state === 'rejected') line = <>{t('notRanked', { reason: sentence(post.reason) })}</>
  else line = <>{t('boardClosed')}</>
  return (
    <div className={`notice row between wrap ${post?.state === 'rejected' ? 'warn' : ''}`} style={{ marginTop: 12 }} data-testid="casual-status">
      <span>{line}</span>
      <span className="row">
        {share && (
          <button
            className="btn sm ghost"
            onClick={() => {
              void navigator.clipboard?.writeText(share!).then(
                () => showToast(t('copied')),
                () => showToast(share!),
              )
            }}
          >
            {t('copy')}
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
          {t('worldLeaderboard')}
        </button>
      </span>
    </div>
  )
}
