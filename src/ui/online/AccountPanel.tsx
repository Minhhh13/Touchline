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

/** The Account panel on the Record page: sign in, the name and flag on the boards, cloud sync, sign out and deletion. */
export function AccountPanel() {
  const configured = useOnline((s) => s.configured)
  const started = useOnline((s) => s.started)
  const session = useOnline((s) => s.session)
  const account = useOnline((s) => s.account)
  const status = useOnline((s) => s.syncStatus)
  const message = useOnline((s) => s.syncMessage)
  const last = useOnline((s) => s.lastSyncAt)
  useEffect(() => {
    if (configured && !started) void api.startOnline()
  }, [configured, started])
  if (!api.onlineAvailable())
    return (
      <div className="panel col" data-testid="account-panel">
        <h3>Account</h3>
        <p className="help">Online features are not available in this build. Everything you play is saved in this browser.</p>
      </div>
    )
  return (
    <div className="panel col" data-testid="account-panel">
      <h3>Account</h3>
      {!session ? (
        <SignIn />
      ) : (
        <>
          <div className="row between wrap">
            <span data-testid="account-email">
              Signed in{session.maskedEmail ? ` as ${session.maskedEmail}` : ''} {account?.country ? countryFlag(account.country) : ''}
              <span className="small muted"> · {session.provider === 'google' ? 'Google' : 'email'}</span>
            </span>
            <button className="btn sm ghost" onClick={() => void api.signOutOnline()} data-testid="signout">
              Sign out
            </button>
          </div>
          <NameAndFlag />
          <ConflictCards />
          <div className="row between wrap">
            <span className="small" data-testid="sync-status">
              {status === 'syncing' ? 'Syncing…' : status === 'offline' ? 'Offline' : status === 'error' ? 'Sync error' : status === 'paused' ? 'Sync paused' : last ? `Synced ${new Date(last).toLocaleTimeString()}` : 'Not synced yet'}
              {message && <span className="muted"> · {message}</span>}
            </span>
            <button className="btn sm" onClick={() => void api.syncNow()} disabled={status === 'syncing'} data-testid="sync-now">
              Sync now
            </button>
          </div>
          <p className="help">Every game syncs: Quick Drafts and Dailies, your Season, your Dynasty, the head-to-head, your record and shortlist. The games on this device stay here whatever happens in the cloud.</p>
          <CloudHistory />
          <div className="row wrap">
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
        </>
      )}
    </div>
  )
}
