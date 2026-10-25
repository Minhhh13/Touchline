import { CircleUserRound, LogIn } from 'lucide-react'
import { useOnline } from '../../online/state'

/**
 * The top bar's sign-in entry, shown only in an online build: a round button beside the theme switch and the
 * hide-bar toggle, in their style (`.theme-switch`). "Sign in" while signed out, the account (the name on the
 * leaderboards, or the masked email) once signed in; both open the Account screen. The words are its accessible
 * name and tooltip.
 */
export function AccountChip({ onOpen, active }: { onOpen: () => void; active: boolean }) {
  const session = useOnline((s) => s.session)
  const account = useOnline((s) => s.account)
  const syncing = useOnline((s) => s.syncStatus === 'syncing')
  const who = account?.displayName ?? session?.maskedEmail ?? 'your account'
  const label = session ? `Account: ${who}` : 'Sign in'
  return (
    <button
      type="button"
      className={`theme-switch account-chip${session ? ' signed-in' : ''}${syncing ? ' syncing' : ''}${active ? ' active' : ''}`}
      onClick={onOpen}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      title={session ? `${label} · cloud saves and your posted runs` : 'Sign in: keep your games on every device and post to the world leaderboard'}
      data-testid="account-chip"
    >
      {session ? <CircleUserRound size={18} /> : <LogIn size={18} />}
    </button>
  )
}
