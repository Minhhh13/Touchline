/**
 * The Account panel's sign-in words in the viewer's language: the screen's mirror of `src/online/core/authCopy.ts`,
 * whose English stays with the online layer (held equal by `src/ui/__tests__/onlineScreens.test.ts`).
 */
import { NOTE_CREATED, NOTE_EXISTING, type AuthCopy, type AuthMode } from '../../online/core/authCopy'
import { translator } from '../i18n'
import { online } from '../i18n/en/online'

const tr = translator(online)

/** The two options of the switch, in order (Sign in first). */
export const authModes = (): Array<{ value: AuthMode; label: string }> => [
  { value: 'signin', label: tr('authModeSignin') },
  { value: 'create', label: tr('authModeCreate') },
]

/** `authCopy(mode)` in the viewer's language. */
export function authText(mode: AuthMode): AuthCopy {
  return mode === 'create'
    ? { heading: tr('authHeadingCreate'), emailHelp: tr('authEmailHelpCreate'), submit: tr('authSubmitCreate'), codeLead: tr('authCodeLead'), verify: tr('authVerifyCreate') }
    : { heading: tr('authHeadingSignin'), emailHelp: tr('authEmailHelpSignin'), submit: tr('authSubmitSignin'), codeLead: tr('authCodeLead'), verify: tr('authVerifySignin') }
}

/** `authOutcomeNote`'s English note in the viewer's language (any other text passes through). */
export function authNoteText(note: string): string {
  return note === NOTE_CREATED ? tr('authNoteCreated') : note === NOTE_EXISTING ? tr('authNoteExisting') : note
}
