import { useEffect, useRef, useState } from 'react'
import { CircleUserRound, LogIn } from 'lucide-react'
import { useOnline } from '../../online/state'
import * as api from '../../online/api'
import { CountryFlag, SavedStatus } from './AccountPanel'

/**
 * The top bar's account entry, shown only in an online build, beside the theme switch and the hide-bar toggle.
 * Signed out: a round "Sign in" button in their style (`.theme-switch`) that opens the Account screen. Signed in: the
 * flag and the name on the boards, opening a small menu with the save status ("Saved to your account ✓ · 2 min ago"),
 * the Account screen and Sign out. No modal; Escape or a click elsewhere closes the menu.
 */
export function AccountChip({ onOpen, active }: { onOpen: () => void; active: boolean }) {
  const session = useOnline((s) => s.session)
  const account = useOnline((s) => s.account)
  const syncing = useOnline((s) => s.syncStatus === 'syncing')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
  if (!session)
    return (
      <button type="button" className={`theme-switch account-chip${active ? ' active' : ''}`} onClick={onOpen} aria-label="Sign in" aria-current={active ? 'page' : undefined} title="Sign in to save your seasons, records and Dailies to your account" data-testid="account-chip">
        <LogIn size={18} />
      </button>
    )
  const name = account?.displayName ?? session.maskedEmail ?? 'Your account'
  return (
    <div className="account-menu-wrap" ref={ref}>
      <button type="button" className={`account-chip signed-in${syncing ? ' syncing' : ''}${active || open ? ' active' : ''}`} onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} aria-label={`Account: ${name}`} title={name} data-testid="account-chip">
        {account?.country ? <CountryFlag code={account.country} size={18} /> : <CircleUserRound size={18} />}
        <span className="account-chip-name">{name}</span>
      </button>
      {open && (
        <div className="account-menu" role="menu" data-testid="account-menu">
          <div className="account-menu-head">
            <b>{name}</b>
            <SavedStatus testId="account-menu-status" />
          </div>
          <button
            type="button"
            role="menuitem"
            className="account-menu-item"
            onClick={() => {
              setOpen(false)
              onOpen()
            }}
          >
            Your account
          </button>
          <button
            type="button"
            role="menuitem"
            className="account-menu-item"
            onClick={() => {
              setOpen(false)
              void api.syncNow()
            }}
          >
            Sync now
          </button>
          <button
            type="button"
            role="menuitem"
            className="account-menu-item"
            onClick={() => {
              setOpen(false)
              void api.signOutOnline()
            }}
            data-testid="account-menu-signout"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
