import { describe, expect, it } from 'vitest'
import { checkDisplayName, consumeAuthRedirect, maskEmail, sendEmailCode, sessionOf, signInWithGoogle, signOut, verifyEmailCode, type AuthLike, type SessionLike } from '../auth'
import { parseAuthRedirect } from '../core/authUrl'

/** A fake of the supabase-js auth slice: records calls, answers as scripted. */
function fakeAuth(script: { error?: { message: string; status?: number } | null; session?: SessionLike | null } = {}) {
  const calls: Array<[string, unknown]> = []
  let session: SessionLike | null = script.session ?? null
  const answer = () => Promise.resolve({ error: script.error ?? null })
  const auth: AuthLike = {
    signInWithOtp: (a) => (calls.push(['otp', a]), answer()),
    verifyOtp: (a) => {
      calls.push(['verify', a])
      if (!script.error) session = { user: { id: 'u1', email: 'minh@gmail.com' } }
      return answer()
    },
    signInWithOAuth: (a) => (calls.push(['oauth', a]), answer()),
    signOut: (a) => (calls.push(['signOut', a]), answer()),
    getSession: () => Promise.resolve({ data: { session } }),
  }
  return { auth, calls, session: () => session }
}

describe('sign-in', () => {
  it('goes from idle to code sent to signed in with an email code', async () => {
    const f = fakeAuth()
    expect(await sendEmailCode(f.auth, ' minh@gmail.com ', 'https://touchline.quest/')).toEqual({ ok: true })
    expect(f.calls[0]).toEqual(['otp', { email: 'minh@gmail.com', options: { emailRedirectTo: 'https://touchline.quest/', shouldCreateUser: true } }])
    expect(await verifyEmailCode(f.auth, 'minh@gmail.com', '123 456')).toEqual({ ok: true })
    expect(f.calls[1]).toEqual(['verify', { email: 'minh@gmail.com', token: '123456', type: 'email' }])
    expect(sessionOf(f.session())).toEqual({ userId: 'u1', maskedEmail: 'm•••@gmail.com', provider: 'email' })
  })

  it('refuses a bad address or code before calling, and words server errors for people', async () => {
    const f = fakeAuth()
    expect(await sendEmailCode(f.auth, 'not-an-email', 'https://touchline.quest/')).toMatchObject({ ok: false })
    expect(await verifyEmailCode(f.auth, 'a@b.co', '12')).toMatchObject({ ok: false, message: expect.stringMatching(/six digits/) })
    expect(f.calls).toEqual([])
    const limited = fakeAuth({ error: { message: 'For security purposes, you can only request this after 42 seconds', status: 429 } })
    expect(await sendEmailCode(limited.auth, 'a@b.co', 'https://touchline.quest/')).toEqual({ ok: false, message: 'Too many requests: wait a minute, then try again.' })
    const expired = fakeAuth({ error: { message: 'Token has expired or is invalid' } })
    expect(await verifyEmailCode(expired.auth, 'a@b.co', '123456')).toMatchObject({ ok: false, message: expect.stringMatching(/wrong or has expired/) })
  })

  it('starts Google with the page as the way back, and signs out on this device only', async () => {
    const f = fakeAuth()
    await signInWithGoogle(f.auth, 'http://localhost:5173/')
    await signOut(f.auth)
    expect(f.calls).toEqual([
      ['oauth', { provider: 'google', options: { redirectTo: 'http://localhost:5173/' } }],
      ['signOut', { scope: 'local' }],
    ])
  })

  it('finishes every redirect shape and strips only the auth parameters, keeping the game link', async () => {
    const shapes = [
      ['https://touchline.quest/?token_hash=abc&type=email#c=XYZ', 'https://touchline.quest/#c=XYZ', { ok: true }],
      ['https://touchline.quest/?code=pkce123#s=K7Q2MX9A', 'https://touchline.quest/#s=K7Q2MX9A', { ok: true }],
      ['https://touchline.quest/#error=access_denied&error_description=Denied', 'https://touchline.quest/', { ok: false, message: 'Sign-in did not finish: Denied' }],
      ['https://touchline.quest/?error=server_error&error_description=Oops#h=K7Q2MX9A', 'https://touchline.quest/#h=K7Q2MX9A', { ok: false, message: 'Sign-in did not finish: Oops' }],
    ] as const
    for (const [href, clean, out] of shapes) {
      const f = fakeAuth({ session: href.includes('code=') ? { user: { id: 'g1', email: 'x@y.z', app_metadata: { provider: 'google' } } } : null })
      let replaced = ''
      const res = await consumeAuthRedirect(f.auth, parseAuthRedirect(href), (h) => (replaced = h), () => href)
      expect(res).toEqual(out)
      expect(replaced).toBe(clean)
      if (href.includes('token_hash')) expect(f.calls).toEqual([['verify', { token_hash: 'abc', type: 'email' }]])
    }
    expect(await consumeAuthRedirect(fakeAuth().auth, null, () => undefined, () => '')).toBeNull()
  })

  it('masks the email, and never treats a guest session as signed in', () => {
    expect(maskEmail('minh@gmail.com')).toBe('m•••@gmail.com')
    expect(maskEmail(null)).toBeNull()
    expect(sessionOf({ user: { id: 'anon', is_anonymous: true } })).toBeNull()
    expect(sessionOf({ user: { id: 'g', email: 'a@b.c', app_metadata: { provider: 'google' } } })?.provider).toBe('google')
  })

  it('checks display names the way the profiles table does', () => {
    expect(checkDisplayName('  The   Gaffer ')).toEqual({ ok: true, name: 'The Gaffer' })
    expect(checkDisplayName('ab')).toMatchObject({ ok: false })
    expect(checkDisplayName('x'.repeat(25))).toMatchObject({ ok: false, message: expect.stringMatching(/24/) })
    expect(checkDisplayName('<script>')).toMatchObject({ ok: false })
    expect(checkDisplayName('Ad​min')).toMatchObject({ ok: false })
    expect(checkDisplayName('Minh‮')).toMatchObject({ ok: false })
    expect(checkDisplayName('Nguyễn Minh')).toEqual({ ok: true, name: 'Nguyễn Minh' })
  })
})
