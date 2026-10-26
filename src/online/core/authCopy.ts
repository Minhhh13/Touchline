/**
 * The words of the signed-out Account panel's two options. Both run the same email -> six-digit code flow (the first
 * code for an address creates the account), so only the copy differs, plus a one-line note once the account loads
 * when the address turned out to be the other kind.
 */
export type AuthMode = 'signin' | 'create'

export interface AuthCopy {
  /** The panel's heading. */
  heading: string
  /** The help line under the email field. */
  emailHelp: string
  /** The email step's submit button. */
  submit: string
  /** The code step's lead, before the masked address. */
  codeLead: string
  /** The code step's submit button. */
  verify: string
}

export const AUTH_MODES: Array<{ value: AuthMode; label: string }> = [
  { value: 'signin', label: 'Sign in' },
  { value: 'create', label: 'Create account' },
]

export function authCopy(mode: AuthMode): AuthCopy {
  return mode === 'create'
    ? { heading: 'Create your account', emailHelp: "We'll email you a 6-digit code to create your account; no password.", submit: 'Create account', codeLead: 'Enter the code we sent to', verify: 'Create account' }
    : { heading: 'Sign in', emailHelp: "We'll email you a 6-digit code.", submit: 'Email me a code', codeLead: 'Enter the code we sent to', verify: 'Sign in' }
}

export const NOTE_CREATED = 'No account with that email yet, so we created one.'
export const NOTE_EXISTING = "You already have an account: you're signed in."

/**
 * The note after a code signs someone in, from the option they chose and the account state once it has loaded (no
 * network call: a new address has no profile yet, which is the setup step). `undefined` while the account is loading;
 * `null` when the address was what the option expected.
 */
export function authOutcomeNote(mode: AuthMode, accountLoaded: boolean, hasAccount: boolean): string | null | undefined {
  if (!accountLoaded) return undefined
  if (mode === 'signin' && !hasAccount) return NOTE_CREATED
  if (mode === 'create' && hasAccount) return NOTE_EXISTING
  return null
}
