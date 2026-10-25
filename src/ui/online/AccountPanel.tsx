import { useEffect, useState } from 'react'
import { useStore } from '@game/store'
import { cleanName } from '@engine/challenge'
import { useOnline } from '../../online/state'
import * as api from '../../online/api'
import { restorable } from '../../online/sync'
import type { CloudRow } from '../../online/transport'
import { countryFlag } from '../../online/core/country'
import { COUNTRY_OPTIONS } from './countries'
import { ConflictCards } from './ConflictCard'
import { OnlineRecord } from './OnlineRecord'

const SLOT_LABEL: Record<string, string> = { quick: 'Quick Draft / Daily', season: 'Season', dynasty: 'Dynasty', h2h: 'Head-to-head' }

/** A country picker: "No flag" plus every country, flags first. */
export function CountrySelect({ value, onChange, emptyLabel = 'No flag', testId }: { value: string | null; onChange: (c: string | null) => void; emptyLabel?: string; testId?: string }) {
  return (
    <select className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} data-testid={testId}>
      <option value="">{emptyLabel}</option>
      {COUNTRY_OPTIONS.map((c) => (
        <option key={c.code} value={c.code}>
          {c.label}
        </option>
      ))}
    </select>
  )
}

function SignIn() {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [wait, setWait] = useState(0)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => {
    if (wait <= 0) return
    const t = setTimeout(() => setWait(wait - 1), 1000)
    return () => clearTimeout(t)
  }, [wait])
  const send = async () => {
    setBusy(true)
    setMsg(null)
    const r = await api.emailCode(email)
    setBusy(false)
    if (r.ok) {
      setSent(true)
      setWait(60)
    } else setMsg(r.message)
  }
  const verify = async () => {
    setBusy(true)
    setMsg(null)
    const r = await api.emailVerify(email, code)
    setBusy(false)
    if (!r.ok) setMsg(r.message)
  }
  const google = async () => {
    setMsg(null)
    const r = await api.googleSignIn()
    if (!r.ok) setMsg(r.message)
  }
  return (
    <div className="col" data-testid="account-signin">
      <p className="help">Optional. Signing in keeps your games on every device, posts verified Daily and weekly scores to the world leaderboard and makes short challenge links. Everything works without it.{' '}
        <button className="btn ghost sm" onClick={() => useStore.getState().go('privacy')} data-testid="signin-privacy">
          What is stored
        </button>
      </p>
      <button className="btn" onClick={() => void google()} data-testid="signin-google">
        Continue with Google
      </button>
      <label className="field">
        Email
        <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" data-testid="signin-email" />
      </label>
      {!sent ? (
        <button className="btn primary" disabled={busy || !email.trim()} onClick={() => void send()} data-testid="signin-send">
          Email me a sign-in code
        </button>
      ) : (
        <>
          <label className="field">
            Code from the email
            <input className="input" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" data-testid="signin-code" />
          </label>
          <div className="row wrap">
            <button className="btn primary" disabled={busy || code.trim().length < 6} onClick={() => void verify()} data-testid="signin-verify">
              Sign in
            </button>
            <button className="btn ghost sm" disabled={busy || wait > 0} onClick={() => void send()}>
              {wait > 0 ? `Resend in ${wait} s` : 'Resend the code'}
            </button>
          </div>
          <p className="help">The email also has a link: opening it on any device signs you in there.</p>
        </>
      )}
      {msg && <div className="notice warn">{msg}</div>}
    </div>
  )
}

function NameAndFlag() {
  const managerName = useStore((s) => s.profile.managerName)
  const account = useOnline((s) => s.account)
  const [name, setName] = useState(account?.displayName ?? (cleanName(managerName).length >= 3 ? cleanName(managerName) : ''))
  const [country, setCountry] = useState<string | null>(account?.country ?? null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => {
    if (account) {
      setName(account.displayName)
      setCountry(account.country)
    }
  }, [account])
  const save = async () => {
    const r = await api.saveAccount(name, country)
    setMsg(r.ok ? { ok: true, text: 'Saved. New board rows carry this name and flag.' } : { ok: false, text: r.message })
  }
  return (
    <div className="col">
      <label className="field">
        Name on the leaderboards
        <input className="input" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} placeholder="3 to 24 characters" data-testid="account-name" />
      </label>
      <div className="field">
        Flag
        <CountrySelect value={country} onChange={setCountry} testId="account-country" />
      </div>
      <div className="row wrap">
        <button className="btn primary sm" onClick={() => void save()} data-testid="account-save">
          Save
        </button>
        {!account && <span className="small muted">Without a name, your first post is filed as "Manager" and a code.</span>}
      </div>
      {msg && <div className={`notice ${msg.ok ? '' : 'warn'}`}>{msg.text}</div>}
    </div>
  )
}

function CloudHistory() {
  const [rows, setRows] = useState<CloudRow[] | null>(null)
  const load = async () => setRows(await api.cloudHistory())
  if (!rows)
    return (
      <button className="btn sm ghost" onClick={() => void load()} data-testid="cloud-history">
        Cloud history
      </button>
    )
  return (
    <div className="col" data-testid="cloud-history-list">
      <b className="small">Cloud history</b>
      {rows.length === 0 && <span className="small muted">Nothing in the cloud yet.</span>}
      {rows.map((r) => (
        <div key={r.slot} className="small">
          <b>{SLOT_LABEL[r.slot]}</b>: {r.deletedAt ? 'removed on a device' : `${r.meta.teamName ?? ''} · ${r.meta.phase ?? ''}${r.meta.matchweek ? ` · matchweek ${r.meta.matchweek}` : ''} · ${r.meta.deviceLabel ?? ''}`}
          {r.prevMeta && (
            <div className="row wrap" style={{ gap: 6 }}>
              <span className="muted">
                Previous copy: {r.prevMeta.teamName ?? ''} · {r.prevMeta.phase ?? ''} {r.prevSavedAt ? `· ${r.prevSavedAt.slice(0, 10)}` : ''}
              </span>
              {restorable(r) && (
                <button
                  className="btn sm"
                  onClick={() => {
                    if (!confirm('Put the previous copy on this device? It replaces the game in this slot here.')) return
                    void api.restorePrevious(r).then((ok) => useStore.getState().showToast(ok ? 'Restored the previous copy.' : 'Could not restore that copy.'))
                  }}
                >
                  Restore
                </button>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

/** The sync line, Sync now, the questions waiting and the cloud history: the middle panel of the Account screen. */
function CloudPanel() {
  const status = useOnline((s) => s.syncStatus)
  const message = useOnline((s) => s.syncMessage)
  const last = useOnline((s) => s.lastSyncAt)
  return (
    <section className="panel fit-panel" data-testid="account-cloud">
      <div className="panel-head">
        <h3>Cloud saves</h3>
        <button className="btn sm" onClick={() => void api.syncNow()} disabled={status === 'syncing'} data-testid="sync-now">
          Sync now
        </button>
      </div>
      <div className="fit-scroll col">
        <span className="small" data-testid="sync-status">
          {status === 'syncing' ? 'Syncing…' : status === 'offline' ? 'Offline' : status === 'error' ? 'Sync error' : status === 'paused' ? 'Sync paused' : last ? `Synced ${new Date(last).toLocaleTimeString()}` : 'Not synced yet'}
          {message && <span className="muted"> · {message}</span>}
        </span>
        <ConflictCards />
        <p className="help">Every game syncs: Quick Drafts and Dailies, your Season, your Dynasty, the head-to-head, your record and shortlist. The games on this device stay here whatever happens in the cloud.</p>
        <CloudHistory />
      </div>
      <div className="fit-foot row wrap">
        <button
          className="btn sm ghost danger"
          onClick={() => {
            if (!confirm('Delete every cloud save and the synced record of this account? The games on this device stay here, and this device stops syncing until you press Sync now. Other signed-in devices upload their own copies again on their next sync.')) return
            void api.deleteCloudData().then((n) => useStore.getState().showToast(`Cloud data deleted (${n} file${n === 1 ? '' : 's'}).`))
          }}
        >
          Delete my cloud data
        </button>
        <button
          className="btn sm ghost danger"
          onClick={() => {
            if (prompt('This deletes your account, its cloud saves and its leaderboard entries. The games on this device stay. Type DELETE to confirm.') !== 'DELETE') return
            void api.deleteAccount().then((r) => useStore.getState().showToast(r.message))
          }}
          data-testid="delete-account"
        >
          Delete account
        </button>
      </div>
    </section>
  )
}

/** What an account adds, beside the sign-in panel while signed out. */
function WhatSigningInAdds() {
  const go = useStore((s) => s.go)
  return (
    <section className="panel fit-panel" data-testid="account-benefits">
      <div className="panel-head">
        <h3>What an account adds</h3>
      </div>
      <div className="fit-scroll col">
        <ul className="plain-list small">
          <li>
            <b>Your games on every device.</b> Quick Drafts, Dailies, your Season and Dynasty, the head-to-head, your record and shortlist sync in the background. The games on this device always stay here.
          </li>
          <li>
            <b>The world leaderboard.</b> Your Daily and the week's challenge post themselves when you finish, checked by the server's own replay of your picks.
          </li>
          <li>
            <b>Short challenge links.</b> An eight-letter code instead of a long link.
          </li>
          <li>
            <b>Nothing else changes.</b> Every mode plays offline and signed out, exactly as before.
          </li>
        </ul>
      </div>
      <div className="fit-foot row wrap">
        <button className="btn sm ghost" onClick={() => go('world')}>
          See the world leaderboard
        </button>
        <button className="btn sm ghost" onClick={() => go('privacy')}>
          Privacy and fair play
        </button>
      </div>
    </section>
  )
}

/**
 * The Account screen (screen `account`, opened from the top bar's sign-in entry and from Profile): a shell screen of
 * three boxed panels side by side with no page scroll on a desktop, each scrolling inside itself; stacked on a phone.
 * Signed out: sign in, what an account adds, and the online record placeholder. Signed in: who you are with the name
 * and flag on the boards, the cloud saves, and your posted runs and short links.
 */
export function AccountScreen() {
  const configured = useOnline((s) => s.configured)
  const started = useOnline((s) => s.started)
  const session = useOnline((s) => s.session)
  const account = useOnline((s) => s.account)
  const go = useStore((s) => s.go)
  useEffect(() => {
    if (configured && !started) void api.startOnline()
  }, [configured, started])
  return (
    <div className="page account-page" data-testid="account-panel">
      <div className="screen-head">
        <div className="screen-title">
          <h1>Account</h1>
          <div className="screen-meta">
            <span>{session ? (account?.displayName ?? session.maskedEmail ?? 'Signed in') : 'Optional: every mode works signed out'}</span>
          </div>
        </div>
        <button className="btn ghost" onClick={() => go('profile')}>
          ← Profile
        </button>
      </div>
      {!api.onlineAvailable() ? (
        <div className="panel">
          <p className="help">Online features are not available in this build. Everything you play is saved in this browser.</p>
        </div>
      ) : (
        <div className="screen-body fill">
        <div className="grid three account-grid">
          <section className="panel fit-panel" data-testid="account-identity">
            <div className="panel-head">
              <h3>{session ? 'Signed in' : 'Sign in'}</h3>
              {session && (
                <button className="btn sm ghost" onClick={() => void api.signOutOnline()} data-testid="signout">
                  Sign out
                </button>
              )}
            </div>
            <div className="fit-scroll col">
              {!session ? (
                <SignIn />
              ) : (
                <>
                  <span data-testid="account-email">
                    {session.maskedEmail ?? 'Your account'} {account?.country ? countryFlag(account.country) : ''}
                    <span className="small muted"> · {session.provider === 'google' ? 'Google' : 'email'}</span>
                  </span>
                  <NameAndFlag />
                </>
              )}
            </div>
          </section>
          {session ? <CloudPanel /> : <WhatSigningInAdds />}
          <OnlineRecord />
        </div>
        </div>
      )}
    </div>
  )
}

/** The Profile screen's link to the Account screen: who is signed in, or an invitation to sign in. */
export function AccountLink() {
  const session = useOnline((s) => s.session)
  const account = useOnline((s) => s.account)
  const go = useStore((s) => s.go)
  if (!api.onlineAvailable()) return null
  return (
    <div className="panel row between wrap" data-testid="account-link">
      <div>
        <h3>Account</h3>
        <span className="small muted">{session ? `Signed in${account ? ` as ${account.displayName}` : ''}: cloud saves, your posted runs and short links.` : 'Optional: keep your games on every device and post to the world leaderboard.'}</span>
      </div>
      <button className={`btn ${session ? '' : 'primary'}`} onClick={() => go('account')} data-testid="account-open">
        {session ? 'Open' : 'Sign in'}
      </button>
    </div>
  )
}
