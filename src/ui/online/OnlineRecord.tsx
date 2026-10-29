import { useEffect, useState } from 'react'
import { useStore } from '@game/store'
import { TIER_LABEL } from '@engine/season'
import { tierText } from '../i18n/tierText'
import type { SeasonTier } from '@engine/types'
import { useOnline } from '../../online/state'
import * as api from '../../online/api'
import type { CasualMine, MyEntry } from '../../online/boards'
import type { ChallengeRow } from '../../online/transport'
import { formatCode } from '../../online/core/codes'
import { shortLinkUrl } from '../../online/challengeLinks'
import { devicePostsText } from './statusText'
import { askConfirm } from '../confirm'
import { translator } from '../i18n'
import { online } from '../i18n/en/online'
import { B, rich } from '../i18n/rich'
import { formatDate } from '../format'

const t = translator(online)

/** "Your dailies", "Your weekly challenges", the casual boards' posts and "Your challenges": the Account screen's third panel (a placeholder signed out). */
export function OnlineRecord() {
  const session = useOnline((s) => s.session)
  const showToast = useStore((s) => s.showToast)
  const go = useStore((s) => s.go)
  const [dailies, setDailies] = useState<MyEntry[] | null>(null)
  const [weeklies, setWeeklies] = useState<MyEntry[] | null>(null)
  const [codes, setCodes] = useState<ChallengeRow[] | null>(null)
  // The casual boards' posts (Daily Arena, Weekly Challenge, Run-in of the week); a project without their tables reads as none
  const [casual, setCasual] = useState<CasualMine[] | null>(null)
  const [failed, setFailed] = useState(false)
  const posts = useOnline((s) => s.posts)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!session) return
    let live = true
    setFailed(false)
    void Promise.all([api.mine('daily'), api.mine('weekly'), api.myChallenges()]).then(
      ([d, w, c]) => {
        if (!live) return
        setDailies(d)
        setWeeklies(w)
        setCodes(c)
      },
      // Offline, or the server did not answer: say so (never "Loading…" for ever) and offer a retry
      () => {
        if (live) setFailed(true)
      },
    )
    void api.casualMine(null).then(
      (c) => live && setCasual(c),
      () => live && setCasual([]),
    )
    return () => {
      live = false
    }
  }, [session, attempt])
  const fromDevice = devicePostsText(posts, !!session)
  const deviceList = fromDevice.length > 0 && (
    <div className="col" data-testid="device-posts">
      <b>{t('fromDevice')}</b>
      {fromDevice.map((p) => (
        <div key={p.key} className="row between wrap small" data-testid="device-post">
          <span>{p.label}</span>
          <span className={p.tone === 'good' ? 'res-w' : p.tone === 'wait' ? '' : 'muted'}>{p.line}</span>
        </div>
      ))}
    </div>
  )
  if (!session)
    return (
      <section className="panel fit-panel" data-testid="online-record">
        <div className="panel-head">
          <h3>{t('onlineRecord')}</h3>
        </div>
        <div className="fit-scroll col">
          <p className="help">{t('onlineRecordHelp')}</p>
          {deviceList}
        </div>
      </section>
    )
  const loading = failed ? (
    <span className="small muted">
      {t('couldNotLoad')}{' '}
      <button className="btn sm ghost" onClick={() => setAttempt((n) => n + 1)} data-testid="online-record-retry">
        {t('tryAgain')}
      </button>
    </span>
  ) : (
    <span className="small muted">{t('loading')}</span>
  )
  const list = (title: string, rows: MyEntry[] | null, testId: string) => (
    <div className="col" data-testid={testId}>
      <b>{title}</b>
      {!rows && loading}
      {rows && rows.length === 0 && <span className="small muted">{t('nothingPosted')}</span>}
      {rows?.map((e) => (
        <div key={e.key} className="row between small">
          <span>
            {e.key} · {e.team}
          </span>
          <span>
            {rich(t('entryLine', { n: e.points, record: `${e.won}-${e.drawn}-${e.lost}`, tier: e.tier in TIER_LABEL ? tierText(e.tier as SeasonTier) : e.tier, pos: e.position, total: e.total }), B)}
          </span>
        </div>
      ))}
    </div>
  )
  return (
    <section className="panel fit-panel" data-testid="online-record">
      <div className="panel-head">
        <h3>{t('onlineRecord')}</h3>
        <button className="btn sm" onClick={() => go('world')}>
          {t('worldLeaderboard')}
        </button>
      </div>
      <div className="fit-scroll col">
      {deviceList}
      {list(t('yourDailies'), dailies, 'my-dailies')}
      {list(t('yourWeeklies'), weeklies, 'my-weeklies')}
      {casual && casual.length > 0 && (
        <div className="col" data-testid="my-casual">
          <b>{t('yourCasual')}</b>
          {casual.map((e) => (
            <div key={`${e.board}-${e.key}`} className="row between small">
              <span>
                {t('casualTitle', { board: e.board })} · {e.key}{e.team ? ` · ${e.team}` : ''}
              </span>
              <span>{rich(t('casualEntryLine', { board: e.board, n: e.score, pos: e.position, total: e.total }), B)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="col" data-testid="my-challenges">
        <b>{t('yourChallenges')}</b>
        {!codes && loading}
        {codes && codes.length === 0 && <span className="small muted">{t('noLinks')}</span>}
        {codes?.map((c) => (
          <div key={c.code} className="row between wrap small">
            <span>
              {rich(t('linkLine', { code: formatCode(c.code), name: c.payload?.name ?? '', pts: c.payload?.c?.pts ?? '?', until: formatDate(c.expiresAt) }), B)}
            </span>
            <span className="row">
              <button
                className="btn sm ghost"
                onClick={() => {
                  const url = shortLinkUrl(c.code, location.origin, location.pathname)
                  void navigator.clipboard?.writeText(url).then(
                    () => showToast(t('linkCopied')),
                    () => showToast(url),
                  )
                }}
              >
                {t('copyLink')}
              </button>
              <button
                className="btn sm ghost danger"
                onClick={async () => {
                  if (!(await askConfirm(t('deleteLinkConfirm', { code: formatCode(c.code) }), { ok: t('deleteOk'), danger: true }))) return
                  void api.deleteChallenge(c.code).then(
                    () => setCodes((codes ?? []).filter((x) => x.code !== c.code)),
                    () => showToast(t('deleteFailed')),
                  )
                }}
              >
                {t('delete')}
              </button>
            </span>
          </div>
        ))}
      </div>
      </div>
    </section>
  )
}
