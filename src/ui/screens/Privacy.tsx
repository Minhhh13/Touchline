import { useStore } from '@game/store'
import { RETENTION } from '../../online/core/retention'
import { onlineAvailable } from '../../online/api'
import { APP_NAME } from '../brand'
import { translator } from '../i18n'
import { privacy } from '../i18n/en/privacy'
import { B, rich } from '../i18n/rich'

const t = translator(privacy)

/** Privacy and fair play: what TouchLine keeps, where, for how long, how to delete it, and the leaderboard rules. */
export function Privacy() {
  const go = useStore((s) => s.go)
  const online = onlineAvailable()
  return (
    <div className="page privacy" data-testid="privacy-page">
      <div className="screen-head">
        <div className="screen-title">
          <h1>{t('title')}</h1>
          <div className="screen-meta">
            <span>{t('meta')}</span>
          </div>
        </div>
        <button className="btn ghost" onClick={() => go('home')}>
          {t('home')}
        </button>
      </div>
      {/* One screen on a desktop (a shell screen): the boxes flow into columns and scroll together inside the body */}
      <div className="screen-body scroll-whole fill">
      <div className="privacy-grid">
        <div className="panel">
          <h3>{t('shortTitle')}</h3>
          <p>{t('short', { app: APP_NAME })}</p>
          {!online && <p className="help">{t('shortOffline')}</p>}
        </div>
        <div className="panel">
          <h3>{t('deviceTitle')}</h3>
          <p>{t('device')}</p>
          <p className="muted small">{t('deviceExtra', { deviceKeys: RETENTION.deviceKeys.join(', '), seatKeepDays: RETENTION.seatKeepDays })}</p>
        </div>
        <div className="panel">
          <h3>{t('signInTitle')}</h3>
          <p>{t('signInWhere', { region: RETENTION.region })}</p>
          <ul>
            <li>{rich(t('signInAuth', { app: APP_NAME }), B)}</li>
            <li>{rich(t('signInName'), B)}</li>
            <li>{rich(t('signInSaves', { previousCopies: RETENTION.previousCopies, saveObjectCap: RETENTION.saveObjectCap }), B)}</li>
            <li>{rich(t('signInBoards'), B)}</li>
            <li>{rich(t('signInLinks', { challengeCodeDays: RETENTION.challengeCodeDays }), B)}</li>
            <li>{rich(t('signInHousekeeping', { logUserIdChars: RETENTION.logUserIdChars, rateLimitDays: RETENTION.rateLimitDays }), B)}</li>
          </ul>
          <p className="muted small">{t('signInNothing', { app: APP_NAME })}</p>
        </div>
        <div className="panel" data-testid="privacy-rooms">
          <h3>{t('roomsTitle')}</h3>
          <p>{t('rooms')}</p>
          <ul>
            <li>{t('roomsWait', { roomIdleMinutes: RETENTION.roomIdleMinutes, roomWaitMinutes: RETENTION.roomWaitMinutes })}</li>
            <li>{t('roomsDeleted', { roomKeepHours: RETENTION.roomKeepHours })}</li>
            <li>{t('roomsCounters', { rateLimitDays: RETENTION.rateLimitDays })}</li>
          </ul>
        </div>
        <div className="panel">
          <h3>{t('deleteTitle')}</h3>
          <ul>
            <li>{rich(t('deleteCloud'), B)}</li>
            <li>{rich(t('deleteAccount'), B)}</li>
            <li>{rich(t('deleteSignOut'), B)}</li>
          </ul>
          <p className="muted small">{t('deleteContact')}</p>
        </div>
        <div className="panel" data-testid="fair-play">
          <h3>{t('fairTitle')}</h3>
          <ul>
            <li>{t('fairReplay')}</li>
            <li>{t('fairFirst')}</li>
            <li>{t('fairSeeds')}</li>
            <li>{t('fairChase')}</li>
            <li>{t('fairOne')}</li>
            <li>{t('fairFree')}</li>
          </ul>
        </div>
        <div className="panel">
          <h3>{t('dataTitle')}</h3>
          <p>{t('data', { app: APP_NAME })}</p>
        </div>
      </div>
      </div>
    </div>
  )
}
