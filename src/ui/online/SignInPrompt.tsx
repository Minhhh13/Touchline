import { useState } from 'react'
import { useStore } from '@game/store'
import { useOnline } from '../../online/state'
import { dismissPrompt, promptDismissed } from '../../online/localState'
import { translator } from '../i18n'
import { online } from '../i18n/en/online'

const t = translator(online)

/**
 * A soft, dismissible line, never a wall: "Sign in to keep this season on every device". Shown at the start of a
 * Season or a Dynasty in a build with the online layer, to a player who is signed out; remembered per device.
 */
export function SignInPrompt({ id, text }: { id: string; text: string }) {
  const configured = useOnline((s) => s.configured)
  const session = useOnline((s) => s.session)
  const go = useStore((s) => s.go)
  const [hidden, setHidden] = useState(() => promptDismissed(id))
  if (!configured || session || hidden) return null
  return (
    <div className="notice row between wrap" style={{ marginBottom: 12 }} data-testid={`signin-prompt-${id}`}>
      <span>{text}</span>
      <span className="row">
        <button className="btn sm primary" onClick={() => go('account')}>
          {t('signIn')}
        </button>
        <button
          className="btn sm ghost"
          onClick={() => {
            dismissPrompt(id)
            setHidden(true)
          }}
        >
          {t('notNow')}
        </button>
      </span>
    </div>
  )
}
