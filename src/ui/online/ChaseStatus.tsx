import { useState } from 'react'
import { useStore } from '@game/store'
import type { Game } from '@game/types'
import { perfectTarget, recordLabel } from '@game/logic/perfect'
import { postKey, useOnline } from '../../online/state'
import { rankedBoardOf } from '../../online/daily'
import { chaseCodeOfSeed, chaseUnrankedReason, isChaseGame } from '../../online/chase'
import { countryName } from './countries'
import * as api from '../../online/api'
import { APP_NAME } from '../brand'
import { rememberWorldTab } from './WorldBoard'
import { sentence } from '../../online/postText'
import { translator } from '../i18n'
import { online } from '../i18n/en/online'

const t = translator(online)

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
  const record = q ? t('chaseRecord', { record: recordLabel(q.won, q.drawn, q.lost), pts: q.points }) : ''
  const reason = isChaseGame(game.settings) ? chaseUnrankedReason(game, u) : null
  let line: React.ReactNode
  let share: string | null = null
  let action: React.ReactNode = null
  if (!isChaseGame(game.settings)) line = <>{t('chaseOnlyIssued')}</>
  else if (reason) line = <>{t('chaseNotOn', { reason })}</>
  else if (!post && !session) {
    line = <>{t('chaseSignInSubmit', { record })}</>
    action = (
      <button className="btn sm primary" onClick={() => go('account')} data-testid="chase-signin">
        {t('signIn')}
      </button>
    )
  } else if (!post) {
    line = <>{t('chaseSubmitLine', { record })}</>
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
        {t('chaseSubmit')}
      </button>
    )
  } else if (post.state === 'waiting') line = post.reason === 'sign_in' && !session ? <>{t('chaseSignInPost', { record })}</> : <>{t('chasePosting')}</>
  else if (post.state === 'posted') {
    const flawless = post.perfect ? t('chaseFlawless', { target: perfectTarget(games) }) : ''
    const week = post.weekPosition ? t('chaseWeekRank', { pos: post.weekPosition, total: (post.weekTotal ?? 0).toLocaleString() }) : ''
    const country = post.country && post.countryPosition ? t('chaseCountry', { pos: post.countryPosition, country: countryName(post.country) }) : ''
    const total = post.total.toLocaleString()
    share = t('chaseShare', { record: recordLabel(q?.won ?? 0, q?.drawn ?? 0, q?.lost ?? 0), pos: post.position, total, app: APP_NAME })
    line = <>{t(post.already ? 'chaseAlready' : 'chasePosted', { flawless, pos: post.position, total, week, country, official: post.claimMatched ? 'no' : 'yes' })}</>
  } else if (post.state === 'unranked') line = <>{t('chaseNotOnReason', { reason: sentence(post.reason) })}</>
  else if (post.state === 'rejected') line = <>{t('notRanked', { reason: sentence(post.reason) })}</>
  else line = <>{t('chaseClosed')}</>
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
            rememberWorldTab('chase')
            go('world')
          }}
          data-testid="open-chase"
        >
          {t('chaseBoard')}
        </button>
      </span>
    </div>
  )
}
