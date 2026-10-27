import { useState } from 'react'
import { useStore } from '@game/store'
import type { Game } from '@game/types'
import { perfectTarget, recordLabel } from '@game/logic/perfect'
import { postKey, useOnline } from '../../online/state'
import { rankedBoardOf } from '../../online/daily'
import { chaseCodeOfSeed, chaseUnrankedReason, isChaseGame } from '../../online/chase'
import { countryName } from './countries'
import * as api from '../../online/api'
import { ordinal } from '../format'
import { APP_NAME } from '../brand'
import { rememberWorldTab } from './WorldBoard'
import { sentence } from '../../online/postText'

/**
 * The 38-0 chase line on a Quick Draft Summary (online builds only): "Submit to the 38-0 chase" for an eligible chase
 * run, then where it ranks; for any other Quick Draft, why it is not on the chase. The Daily and the week's challenge
 * have `RankedStatus` instead.
 */
export function ChaseStatus({ game }: { game: Game }) {
  const configured = useOnline((s) => s.configured)
  const session = useOnline((s) => s.session)
  const code = chaseCodeOfSeed(game.settings.seed)
  const post = useOnline((s) => (code ? s.posts[postKey('chase', code)] : undefined))
  const go = useStore((s) => s.go)
  const showToast = useStore((s) => s.showToast)
  const u = useStore((s) => s.universe)
  const [busy, setBusy] = useState(false)
  if (!configured || !u || game.settings.mode !== 'quick' || game.settings.challenge || rankedBoardOf(game.settings)) return null
  const q = game.quickResult
  const games = q ? q.won + q.drawn + q.lost : 0
  const record = q ? `${recordLabel(q.won, q.drawn, q.lost)} (${q.points} pts)` : ''
  const reason = isChaseGame(game.settings) ? chaseUnrankedReason(game, u) : null
  let line: React.ReactNode
  let share: string | null = null
  let action: React.ReactNode = null
  if (!isChaseGame(game.settings)) line = <>38-0 chase: only a run started from the World leaderboard counts, on a wheel the server issues.</>
  else if (reason) line = <>Not on the 38-0 chase: {reason}.</>
  else if (!post && !session) {
    line = <>Sign in to submit {record} to the 38-0 chase.</>
    action = (
      <button className="btn sm primary" onClick={() => go('account')} data-testid="chase-signin">
        Sign in
      </button>
    )
  } else if (!post) {
    line = <>Submit {record} to the 38-0 chase: one post per run, replayed by the server.</>
    action = (
      <button
        className="btn sm primary"
        disabled={busy}
        data-testid="chase-submit"
        onClick={() => {
          setBusy(true)
          void api.submitChase(game).then((r) => {
            setBusy(false)
            if (!r.ok && r.message) showToast(r.message)
          })
        }}
      >
        Submit to the 38-0 chase
      </button>
    )
  } else if (post.state === 'waiting') line = post.reason === 'sign_in' && !session ? <>Sign in to post {record} to the 38-0 chase.</> : <>Posting to the 38-0 chase…</>
  else if (post.state === 'posted') {
    const flawless = post.perfect ? `${perfectTarget(games)}, flawless! ` : ''
    const week = post.weekPosition ? ` · ${ordinal(post.weekPosition)} of ${(post.weekTotal ?? 0).toLocaleString()} this week` : ''
    const country = post.country && post.countryPosition ? ` · ${ordinal(post.countryPosition)} in ${countryName(post.country)}` : ''
    share = `${recordLabel(q?.won ?? 0, q?.drawn ?? 0, q?.lost ?? 0)}: ${ordinal(post.position)} of ${post.total.toLocaleString()} on the 38-0 chase in ${APP_NAME}`
    line = (
      <>
        {post.already ? 'This run was posted already: ' : `${flawless}On the 38-0 chase: `}
        {ordinal(post.position)} of {post.total.toLocaleString()} all time{week}
        {country}
        {post.claimMatched ? '.' : ' (official result from the server’s replay).'}
      </>
    )
  } else if (post.state === 'unranked') line = <>Not on the 38-0 chase: {sentence(post.reason)}</>
  else if (post.state === 'rejected') line = <>Not ranked: {sentence(post.reason)}</>
  else line = <>This chase run closed before it was posted.</>
  return (
    <div className={`notice row between wrap ${post?.state === 'rejected' ? 'warn' : ''}`} style={{ marginTop: 12 }} data-testid="chase-status">
      <span>{line}</span>
      <span className="row">
        {action}
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
            rememberWorldTab('chase')
            go('world')
          }}
          data-testid="open-chase"
        >
          38-0 chase
        </button>
      </span>
    </div>
  )
}
