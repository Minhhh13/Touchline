import { useEffect, useMemo, useState } from 'react'
import { useStore } from '@game/store'
import { cleanName } from '@engine/challenge'
import { useOnline } from '../../online/state'
import * as api from '../../online/api'
import { maskEmail, type NameVerdict } from '../../online/auth'
import { restorable } from '../../online/sync'
import type { CloudRow } from '../../online/transport'
import { countryFlag } from '../../online/core/country'
import { savedLine } from '../../online/core/status'
import { AUTH_MODES, authCopy, authOutcomeNote, type AuthMode } from '../../online/core/authCopy'
import { ClubBadge, Segmented } from '../components/bits'
import { COUNTRY_OPTIONS, countryName } from './countries'
import { ConflictCards } from './ConflictCard'
import { OnlineRecord } from './OnlineRecord'
import { onlineErrorText } from '../../online/postText'

const SLOT_LABEL: Record<string, string> = { quick: 'Quick Draft / Daily', season: 'Season', dynasty: 'Dynasty', h2h: 'Head-to-head' }

/** The account's promise, said the same way everywhere a guest is invited to sign in. */
export const ACCOUNT_PROMISE = 'Sign in to save your seasons, records and Dailies to your account.'

/** How long an emailed code works (Supabase Auth's OTP expiry, set to 900 s on the project). */
const CODE_LIFETIME_MS = 900_000
const RESEND_SECONDS = 60

/** A country picker: "No flag" plus every country, flags first (the boards' country filter). */
export function CountrySelect({ value, onChange, emptyLabel = 'No flag', testId }: { value: string | null; onChange: (c: string | null) => void; emptyLabel?: string; testId?: string }) {
  return (
    <select className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} aria-label="Country" data-testid={testId}>
      <option value="">{emptyLabel}</option>
      {COUNTRY_OPTIONS.map((c) => (
        <option key={c.code} value={c.code}>
          {c.label}
        </option>
      ))}
    </select>
  )
}

/** A country's drawn flag (public/flags) where there is one, its emoji otherwise. */
export function CountryFlag({ code, size = 20 }: { code: string; size?: number }) {
  const [drawn, setDrawn] = useState(true)
  if (!drawn) return <span aria-hidden="true">{countryFlag(code)}</span>
  const height = Math.round((size * 3) / 4)
  return <img className="flag" src={`${import.meta.env.BASE_URL}flags/${code.toLowerCase()}.svg`} alt="" aria-hidden="true" width={size} height={height} loading="lazy" onError={() => setDrawn(false)} style={{ width: size, height, objectFit: 'cover', borderRadius: 2, boxShadow: '0 0 0 1px rgba(128, 128, 128, 0.45)', verticalAlign: 'middle' }} />
}

/** A searchable list of countries with their flags, plus "No flag". */
function FlagPicker({ value, onChange }: { value: string | null; onChange: (c: string | null) => void }) {
  const [q, setQ] = useState('')
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return COUNTRY_OPTIONS.filter((c) => !t || countryName(c.code).toLowerCase().includes(t) || c.code.toLowerCase() === t)
  }, [q])
  return (
    <div className="field" data-testid="account-country">
      <span>
        Flag {value && <span className="small muted">· {countryName(value)}</span>}
      </span>
      <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a country" aria-label="Search a country" data-testid="account-country-search" />
      <div className="flag-list" role="listbox" aria-label="Countries">
        <button type="button" role="option" aria-selected={value === null} className={`flag-pick${value === null ? ' active' : ''}`} onClick={() => onChange(null)}>
          No flag
        </button>
        {shown.map((c) => (
          <button key={c.code} type="button" role="option" aria-selected={value === c.code} className={`flag-pick${value === c.code ? ' active' : ''}`} onClick={() => onChange(c.code)} data-testid={`flag-${c.code}`}>
            <CountryFlag code={c.code} /> {countryName(c.code)}
          </button>
        ))}
        {shown.length === 0 && <span className="small muted">No country matches.</span>}
      </div>
    </div>
  )
}

/** The optional favourite club, from the leagues loaded on this device. */
function ClubPicker() {
  const u = useStore((s) => s.universe)
  const value = useStore((s) => s.profile.favouriteClub ?? null)
  const setClub = useStore((s) => s.setFavouriteClub)
  const [q, setQ] = useState('')
  const clubs = useMemo(() => (u ? Object.values(u.clubById).sort((a, b) => a.name.localeCompare(b.name)) : []), [u])
  const t = q.trim().toLowerCase()
  const shown = t ? clubs.filter((c) => c.name.toLowerCase().includes(t)).slice(0, 12) : []
  const current = value && u ? u.clubById[value] : null
  return (
    <div className="field" data-testid="account-club">
      <span>
        Favourite club <span className="small muted">(optional)</span>
      </span>
      {current ? (
        <span className="row" style={{ gap: 8 }}>
          <ClubBadge clubId={current.id} size={22} /> <b>{current.name}</b>
          <button type="button" className="btn ghost sm" onClick={() => setClub(null)}>
            Change
          </button>
        </span>
      ) : (
        <>
          <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a club" aria-label="Search a club" data-testid="account-club-search" />
          {shown.length > 0 && (
            <div className="flag-list" role="listbox" aria-label="Clubs">
              {shown.map((c) => (
                <button key={c.id} type="button" role="option" aria-selected={false} className="flag-pick" onClick={() => setClub(c.id)}>
                  <ClubBadge clubId={c.id} size={18} /> {c.name}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

type Step = { at: 'email' } | { at: 'sending' } | { at: 'code'; sentAt: number } | { at: 'verifying'; sentAt: number }

/**
 * Sign in or create an account, by email: a two-option switch (Sign in, Create account), the address, then the
 * six-digit code (the email's link works too, on any device). Both options run the same flow (the first code for an
 * address creates the account); only the words differ. `onVerify` reports the option a code is checked under (null when
 * the check fails), so the screen can say when the address was the other kind once the account loads.
 */
function SignIn({ mode, onMode, onVerify }: { mode: AuthMode; onMode: (m: AuthMode) => void; onVerify: (m: AuthMode | null) => void }) {
  const copy = authCopy(mode)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<Step>({ at: 'email' })
  const [wait, setWait] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [msg, setMsg] = useState<string | null>(null)
  // Email works alone; Google shows only when the build forces it or the project has the provider switched on
  const [google, setGoogle] = useState(false)
  useEffect(() => {
    let live = true
    void api.googleSignInAvailable().then((on) => live && setGoogle(on))
    return () => {
      live = false
    }
  }, [])
  useEffect(() => {
    if (step.at !== 'code' && wait <= 0) return
    const t = setTimeout(() => {
      setNow(Date.now())
      if (wait > 0) setWait(wait - 1)
    }, 1000)
    return () => clearTimeout(t)
  }, [wait, step, now])
  const sentAt = step.at === 'code' || step.at === 'verifying' ? step.sentAt : 0
  const expired = step.at === 'code' && now - sentAt > CODE_LIFETIME_MS
  const send = async () => {
    setStep({ at: 'sending' })
    setMsg(null)
    const r = await api.emailCode(email)
    if (r.ok) {
      setStep({ at: 'code', sentAt: Date.now() })
      setNow(Date.now())
      setCode('')
      setWait(RESEND_SECONDS)
    } else {
      setStep(sentAt ? { at: 'code', sentAt } : { at: 'email' })
      setMsg(r.message)
    }
  }
  const verify = async () => {
    if (expired) return
    setStep({ at: 'verifying', sentAt })
    setMsg(null)
    onVerify(mode)
    const r = await api.emailVerify(email, code)
    if (!r.ok) {
      onVerify(null)
      setStep({ at: 'code', sentAt })
      setMsg(r.message)
    }
  }
  const signInGoogle = async () => {
    setMsg(null)
    const r = await api.googleSignIn()
    if (!r.ok) setMsg(r.message)
  }
  const onCodeStep = step.at === 'code' || step.at === 'verifying'
  return (
    <div className="col" data-testid="account-signin">
      <p className="account-promise" data-testid="account-promise">
        {ACCOUNT_PROMISE}
      </p>
      {!onCodeStep && (
        <div data-testid="auth-mode">
          <Segmented<AuthMode> value={mode} onChange={onMode} options={AUTH_MODES.map((m) => ({ value: m.value, label: m.label, testId: m.value === 'signin' ? 'auth-mode-signin' : 'auth-mode-create' }))} />
        </div>
      )}
      {!onCodeStep ? (
        <form
          className="col"
          onSubmit={(e) => {
            e.preventDefault()
            void send()
          }}
        >
          <label className="field">
            Email
            <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" data-testid="signin-email" />
          </label>
          <button type="submit" className="btn primary" disabled={step.at === 'sending' || !email.trim()} data-testid="signin-send">
            {step.at === 'sending' ? 'Sending…' : copy.submit}
          </button>
          <p className="help" data-testid="signin-help">
            {copy.emailHelp}
          </p>
        </form>
      ) : (
        <form
          className="col"
          onSubmit={(e) => {
            e.preventDefault()
            void verify()
          }}
          data-testid="signin-code-step"
        >
          <div className="notice" data-testid="signin-sent">
            {copy.codeLead} <b>{maskEmail(email) ?? email}</b>.
          </div>
          {expired ? (
            <div className="notice warn" data-testid="signin-expired">
              That code has expired. Send a new one.
            </div>
          ) : (
            <label className="field">
              Six-digit code
              <input className="input code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={10} value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, ''))} placeholder="123456" data-testid="signin-code" />
            </label>
          )}
          <div className="row wrap">
            {!expired && (
              <button type="submit" className="btn primary" disabled={step.at === 'verifying' || code.length < 6} data-testid="signin-verify">
                {step.at === 'verifying' ? (mode === 'create' ? 'Creating…' : 'Signing in…') : copy.verify}
              </button>
            )}
            <button type="button" className="btn ghost sm" disabled={wait > 0 && !expired} onClick={() => void send()} data-testid="signin-resend">
              {wait > 0 && !expired ? `Resend in ${wait} s` : 'Send a new code'}
            </button>
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => {
                setStep({ at: 'email' })
                setMsg(null)
              }}
            >
              Use another email
            </button>
          </div>
          <p className="help">The email also has a link: opening it on any device signs you in there.</p>
        </form>
      )}
      {msg && (
        <div className="notice warn" role="alert" data-testid="signin-error">
          {msg}
        </div>
      )}
      {google && !onCodeStep && (
        <button className="btn" onClick={() => void signInGoogle()} data-testid="signin-google">
          Continue with Google
        </button>
      )}
      <button className="btn ghost sm" onClick={() => useStore.getState().go('privacy')} data-testid="signin-privacy">
        What is stored
      </button>
    </div>
  )
}

/**
 * The name on the boards and the flag, with the live name check. On a new account it is the profile setup step
 * (`setup`), with the favourite club and a Continue button; afterwards it edits the same fields.
 */
function ProfileForm({ setup }: { setup: boolean }) {
  const managerName = useStore((s) => s.profile.managerName)
  const account = useOnline((s) => s.account)
  const [name, setName] = useState(account?.displayName ?? (cleanName(managerName).length >= 3 ? cleanName(managerName) : ''))
  const [country, setCountry] = useState<string | null>(account?.country ?? null)
  const [verdict, setVerdict] = useState<NameVerdict | null>(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => {
    if (account) {
      setName(account.displayName)
      setCountry(account.country)
    }
  }, [account])
  // The live check, half a second after typing stops; the account's own name needs no check
  useEffect(() => {
    if (!name.trim() || (account && name.trim() === account.displayName)) {
      setVerdict(null)
      return
    }
    let live = true
    const t = setTimeout(() => void api.checkName(name).then((v) => live && setVerdict(v)), 450)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [name, account])
  const save = async () => {
    setSaving(true)
    const r = await api.saveAccount(name, country)
    setSaving(false)
    setMsg(r.ok ? { ok: true, text: setup ? 'Welcome to TouchLine. Your profile is saved.' : 'Saved. New board rows carry this name and flag.' } : { ok: false, text: r.message })
  }
  const blocked = verdict?.state === 'invalid' || verdict?.state === 'taken'
  return (
    <div className="col" data-testid={setup ? 'account-setup' : 'account-profile'}>
      {setup && (
        <p className="help">
          <b>Your account is ready.</b> Pick the name and flag the World board shows.
        </p>
      )}
      <label className="field">
        Name on the leaderboards
        <input className="input" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} placeholder="3 to 24 characters" aria-describedby="account-name-check" data-testid="account-name" />
      </label>
      <span id="account-name-check" className={`small name-check ${verdict?.state ?? ''}`} aria-live="polite" data-testid="account-name-check">
        {verdict?.state === 'free' ? '✓ Available' : verdict?.state === 'taken' ? 'That name is taken: try another.' : verdict?.state === 'invalid' ? verdict.message : verdict?.state === 'unknown' ? 'Could not check just now: it is checked again when you save.' : ' '}
      </span>
      <FlagPicker value={country} onChange={setCountry} />
      <ClubPicker />
      <div className="row wrap">
        <button className="btn primary" disabled={saving || blocked || !name.trim()} onClick={() => void save()} data-testid="account-save">
          {saving ? 'Saving…' : setup ? 'Continue' : 'Save'}
        </button>
      </div>
      {msg && (
        <div className={`notice ${msg.ok ? '' : 'warn'}`} role={msg.ok ? undefined : 'alert'}>
          {msg.text}
        </div>
      )}
    </div>
  )
}

/** "Saved to your account ✓ · 2 min ago", or what the save is doing. Refreshes itself every 20 s. */
export function SavedStatus({ testId = 'sync-status' }: { testId?: string }) {
  const status = useOnline((s) => s.syncStatus)
  const last = useOnline((s) => s.lastSyncAt)
  const message = useOnline((s) => s.syncMessage)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20_000)
    return () => clearInterval(t)
  }, [])
  const line = savedLine(status, last, now)
  return (
    <span className={`saved-line ${line.tone}`} data-testid={testId}>
      {line.text}
      {message && line.tone === 'warn' && status !== 'offline' && <span className="muted"> · {message}</span>}
    </span>
  )
}

function CloudHistory() {
  const [rows, setRows] = useState<CloudRow[] | null>(null)
  const load = async () => {
    try {
      setRows(await api.cloudHistory())
    } catch (e) {
      useStore.getState().showToast(`Could not load the cloud history. ${onlineErrorText(e)}`)
    }
  }
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
                    void api.restorePrevious(r).then(
                      (ok) => useStore.getState().showToast(ok ? 'Restored the previous copy.' : 'Could not restore that copy.'),
                      (e: unknown) => useStore.getState().showToast(`Could not restore that copy. ${onlineErrorText(e)}`),
                    )
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

/** What is saved to the account: the status line, Sync now, questions waiting, history, and the two deletions. */
function CloudPanel({ setup }: { setup: boolean }) {
  const status = useOnline((s) => s.syncStatus)
  const parked = useStore((s) => Object.keys(s.parked).length)
  const hasGame = useStore((s) => !!s.game)
  const records = useStore((s) => s.profile.leaderboard.length)
  return (
    <section className="panel fit-panel" data-testid="account-cloud">
      <div className="panel-head">
        <h3>{setup ? 'Backing up this device' : 'Saved to your account'}</h3>
        <button className="btn sm" onClick={() => void api.syncNow()} disabled={status === 'syncing'} data-testid="sync-now">
          Sync now
        </button>
      </div>
      <div className="fit-scroll col">
        <SavedStatus />
        <ConflictCards />
        <ul className="plain-list small" data-testid="account-saves">
          <li>
            <b>Your games:</b> {hasGame || parked ? `${(hasGame ? 1 : 0) + parked} on this device` : 'none on this device yet'}, plus Quick Drafts, Dailies and the head-to-head.
          </li>
          <li>
            <b>Your records:</b> {records ? `${records} best season${records === 1 ? '' : 's'}` : 'your best seasons'}, the 38-0 bests, Daily results and streak, achievements and trophies.
          </li>
          <li>Your games stay on this device as well. Sign in on another device and they are there too.</li>
        </ul>
        <CloudHistory />
      </div>
      <div className="fit-foot row wrap">
        <button
          className="btn sm ghost danger"
          onClick={() => {
            if (!confirm('Delete every cloud save and the synced record of this account? The games on this device stay here, and this device stops syncing until you press Sync now. Other signed-in devices upload their own copies again on their next sync.')) return
            void api.deleteCloudData().then(
              (n) => useStore.getState().showToast(`Cloud data deleted (${n} file${n === 1 ? '' : 's'}).`),
              (e: unknown) => useStore.getState().showToast(`Nothing was deleted. ${onlineErrorText(e)}`),
            )
          }}
        >
          Delete my cloud data
        </button>
        <button
          className="btn sm ghost danger"
          onClick={() => {
            if (prompt('This deletes your account, its cloud saves and its leaderboard entries for good. The games on this device stay. Type DELETE to confirm.') !== 'DELETE') return
            void api.deleteAccount().then(
              (r) => useStore.getState().showToast(r.message),
              (e: unknown) => useStore.getState().showToast(`Your account was not deleted. ${onlineErrorText(e)}`),
            )
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
        <h3>What an account saves</h3>
      </div>
      <div className="fit-scroll col">
        <ul className="plain-list small">
          <li>
            <b>Your seasons.</b> Quick Drafts, Dailies, your Season and Dynasty and the head-to-head, saved as you play.
          </li>
          <li>
            <b>Your records.</b> Best seasons, the 38-0 bests, Daily results and streak, achievements and trophies.
          </li>
          <li>
            <b>Every device.</b> Sign in on another phone or computer and your games are there.
          </li>
          <li>
            <b>The World board.</b> Your Daily and the week's challenge post themselves, checked by the server's replay of your picks.
          </li>
          <li>
            <b>Nothing else changes.</b> Every mode plays offline and signed out, exactly as before.
          </li>
        </ul>
      </div>
      <div className="fit-foot row wrap">
        <button className="btn sm ghost" onClick={() => go('world')}>
          See the World board
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
 * Signed out: create an account or sign in by email, what an account saves, and the online record placeholder. The first
 * sign-in of an account: the profile setup step (name with a live check, flag, favourite club) while this device's
 * games and records back up. Afterwards: who you are, what is saved, your posted runs and short links.
 */
export function AccountScreen() {
  const configured = useOnline((s) => s.configured)
  const started = useOnline((s) => s.started)
  const session = useOnline((s) => s.session)
  const account = useOnline((s) => s.account)
  const accountLoaded = useOnline((s) => s.accountLoaded)
  const accountError = useOnline((s) => s.accountError)
  const go = useStore((s) => s.go)
  useEffect(() => {
    if (configured && !started) void api.startOnline()
  }, [configured, started])
  const setup = !!session && accountLoaded && !account
  // Sign in or Create account: the same email code underneath. The option a code was checked under is kept until the
  // account loads, then turned into a one-line note (frozen, so finishing the setup step does not change it).
  const [mode, setMode] = useState<AuthMode>('signin')
  const [attempt, setAttempt] = useState<AuthMode | null>(null)
  const [note, setNote] = useState<string | null>(null)
  useEffect(() => {
    if (!session) {
      setNote(null)
      return
    }
    if (!attempt) return
    const n = authOutcomeNote(attempt, accountLoaded, !!account)
    if (n === undefined) return
    setNote(n)
    setAttempt(null)
  }, [session, attempt, accountLoaded, account])
  return (
    <div className="page account-page" data-testid="account-panel">
      <div className="screen-head">
        <div className="screen-title">
          <h1>{session ? 'Your account' : 'Account'}</h1>
          <div className="screen-meta">
            <span>{session ? (account ? <>{account.country && <CountryFlag code={account.country} size={16} />} {account.displayName}</> : (session.maskedEmail ?? 'Signed in')) : 'Optional: every mode works signed out'}</span>
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
                <h3>{!session ? authCopy(mode).heading : setup ? 'Set up your profile' : 'You'}</h3>
                {session && (
                  <button className="btn sm ghost" onClick={() => void api.signOutOnline()} data-testid="signout">
                    Sign out
                  </button>
                )}
              </div>
              <div className="fit-scroll col">
                {!session ? (
                  <SignIn mode={mode} onMode={setMode} onVerify={setAttempt} />
                ) : (
                  <>
                    {note && (
                      <div className="notice" data-testid="auth-outcome">
                        {note}
                      </div>
                    )}
                    <span className="small muted" data-testid="account-email">
                      {session.maskedEmail ?? 'Your account'} · {session.provider === 'google' ? 'Google' : 'email'}
                    </span>
                    {accountLoaded ? (
                      <ProfileForm setup={setup} />
                    ) : accountError ? (
                      <div className="notice warn row between wrap" data-testid="account-load-error">
                        <span>Could not load your profile. {accountError}</span>
                        <button className="btn sm" onClick={() => void api.reloadAccount()} data-testid="account-retry">
                          Try again
                        </button>
                      </div>
                    ) : (
                      <span className="small muted">Loading your profile…</span>
                    )}
                  </>
                )}
              </div>
            </section>
            {session ? <CloudPanel setup={setup} /> : <WhatSigningInAdds />}
            <OnlineRecord />
          </div>
        </div>
      )}
    </div>
  )
}

/** The Profile screen's link to the Account screen: who is signed in, or an invitation to back up. */
export function AccountLink() {
  const session = useOnline((s) => s.session)
  const account = useOnline((s) => s.account)
  const go = useStore((s) => s.go)
  if (!api.onlineAvailable()) return null
  return (
    <div className="panel row between wrap" data-testid="account-link">
      <div>
        <h3>{session ? 'Your account' : 'Back up your saves'}</h3>
        <span className="small muted">{session ? <>{account ? `${account.displayName}: ` : ''}<SavedStatus testId="account-link-status" /></> : ACCOUNT_PROMISE}</span>
      </div>
      <button className={`btn ${session ? '' : 'primary'}`} onClick={() => go('account')} aria-label={session ? undefined : 'Sign in or create an account'} title={session ? undefined : 'Sign in or create an account'} data-testid="account-open">
        {session ? 'Open' : 'Sign in'}
      </button>
    </div>
  )
}
