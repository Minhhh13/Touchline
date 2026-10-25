import { CircleUserRound, LogIn } from 'lucide-react'
import { useOnline } from '../../online/state'
import { countryFlag } from '../../online/core/country'

/**
 * The top bar's sign-in entry, shown only in an online build: "Sign in" while signed out, the name on the
 * leaderboards (or the masked email) once signed in. Both open the Account screen.
 */
export function AccountChip({ onOpen, active }: { onOpen: () => void; active: boolean }) {
  const session = useOnline((s) => s.session)
  const account = useOnline((s) => s.account)
  const syncing = useOnline((s) => s.syncStatus === 'syncing')
  const label = session ? (account?.displayName ?? session.maskedEmail ?? 'Account') : 'Sign in'
  const flag = session && account?.country ? countryFlag(account.country) : ''
  return (
    <button type="button" className={`account-chip${session ? ' signed-in' : ''}${syncing ? ' syncing' : ''}${active ? ' active' : ''}`} onClick={onOpen} title={session ? 'Your account and cloud saves' : 'Sign in to keep your games on every device and post to the world leaderboard'} data-testid="account-chip">
      {session ? <CircleUserRound size={16} /> : <LogIn size={16} />}
      <span className="nav-label">
        {flag && <span aria-hidden>{flag} </span>}
        {label}
      </span>
    </button>
  )
}
