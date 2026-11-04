import { Volume2, VolumeX } from 'lucide-react'
import { translator } from '../i18n'
import { common } from '../i18n/en/common'
import { useSoundOn, useSoundVolume } from '../sound/prefs'
import { unlockAudio } from '../sound/synth'
import './AudioControls.css'

const t = translator(common)

/** The same device-local master switch and volume as Profile, available while a game is playing. */
export function AudioControls() {
  const [on, setOn] = useSoundOn()
  const [volume, setVolume] = useSoundVolume()
  return (
    <div className="audio-controls" role="group" aria-label={t('audioSettings')} data-testid="audio-controls" data-sound="off">
      <button
        type="button"
        className="btn sm ghost audio-mute"
        aria-label={t('muteAudio')}
        aria-pressed={!on}
        title={t(on ? 'muteAudio' : 'unmuteAudio')}
        data-testid="audio-mute"
        onClick={() => {
          setOn(!on)
          if (!on) unlockAudio()
        }}
      >
        {on && volume > 0 ? <Volume2 size={16} aria-hidden="true" /> : <VolumeX size={16} aria-hidden="true" />}
      </button>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={volume}
        aria-label={t('audioVolume')}
        aria-valuetext={on ? String(volume) + '%' : t('audioVolumeMuted', { n: volume })}
        data-testid="audio-volume"
        onChange={(e) => {
          setVolume(Number(e.target.value))
          if (on) unlockAudio()
        }}
      />
      <span className="audio-level" data-testid="audio-level" aria-hidden="true">{on ? String(volume) + '%' : t('audioMuted')}</span>
    </div>
  )
}
