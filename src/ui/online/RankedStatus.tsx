import { useStore } from '@game/store'
import type { Game } from '@game/types'
import { postKey, useOnline } from '../../online/state'
import { rankedBoardOf, unrankedReason } from '../../online/daily'
import { countryFlag } from '../../online/core/country'
import { APP_NAME } from '../brand'
import { sentence } from '../../online/postText'
import { translator } from '../i18n'
import { online } from '../i18n/en/online'

const t = translator(online)

/** One line on a Daily or weekly Summary: posted and where it ranks, waiting for sign-in, or why it is unranked. */
export function RankedStatus({ game }: { game: Game }) {
  const configured = useOnline((s) => s.configured)
  const session = useOnline((s) => s.session)
  const board = rankedBoardOf(game.settings)
  const post = useOnline((s) => (board ? s.posts[postKey(board.kind, board.key)] : undefined))
  const go = useStore((s) => s.go)
  const showToast = useStore((s) => s.showToast)
  const u = useStore((s) => s.universe)
  if (!configured || !board) return null
  const extra = !post && u ? unrankedReason(game, u) : null
  const where = t(board.kind === 'daily' ? 'whereDaily' : 'whereWeekly')
  const points = game.quickResult?.points ?? 0
  let line: React.ReactNode
  let share: string | null = null
  if (extra) line = <>{t('unrankedExtra', { reason: extra })}</>
  else if (!post) line = <>{t('beforePosts')}</>
  else if (post.state === 'waiting' && post.reason === 'sign_in' && !session)
    line = (
      <>
        {t('signInToPost', { n: post.points ?? points, where })}{' '}
        <button className="btn sm primary" onClick={() => go('account')} data-testid="ranked-signin">
          {t('signIn')}
        </button>
      </>
    )
  else if (post.state === 'waiting' && post.reason === 'retry') line = <>{t('waitingRetry', { n: post.points ?? points })}</>
  else if (post.state === 'waiting') line = <>{t('posting')}</>
  else if (post.state === 'posted') {
    const country = post.country && post.countryPosition ? t('countryRank', { pos: post.countryPosition, total: post.countryTotal ?? 0, flag: countryFlag(post.country) }) : ''
    share = t('shareRank', { pos: post.position, total: post.total.toLocaleString(), where, app: APP_NAME })
    line = post.already ? (
      <>
        {t('firstRunCounts', { n: post.points, pos: post.position, total: post.total.toLocaleString(), country })}
      </>
    ) : (
      <>
        {t(post.claimMatched ? 'posted' : 'postedOfficial', { pos: post.position, total: post.total.toLocaleString(), where, country })}
      </>
    )
  } else if (post.state === 'unranked') line = <>{t('unranked', { reason: sentence(post.reason) })}</>
  else if (post.state === 'rejected') line = <>{t('notRanked', { reason: sentence(post.reason) })}</>
  else line = <>{t('boardClosed')}</>
  return (
    <div className={`notice row between wrap ${post?.state === 'rejected' ? 'warn' : ''}`} style={{ marginTop: 12 }} data-testid="ranked-status">
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
        <button className="btn sm" onClick={() => go('world')} data-testid="open-world">
          {t('worldLeaderboard')}
        </button>
      </span>
    </div>
  )
}
