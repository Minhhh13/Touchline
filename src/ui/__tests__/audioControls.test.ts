import { Children, isValidElement, type ButtonHTMLAttributes, type ChangeEvent, type InputHTMLAttributes, type MouseEvent, type ReactElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The suite runs without a DOM. Read the real preference snapshots while retaining their setters and persistence,
// so these tests drive the component's own event handlers; browser smokes cover mounted subscriptions and focus.
function mockSnapshots() {
  vi.doMock('../sound/prefs', async (original) => {
    const prefs = await original<typeof import('../sound/prefs')>()
    return {
      ...prefs,
      useSoundOn: () => [prefs.soundOn(), prefs.setSoundOn],
      useSoundVolume: () => [prefs.soundVolume(), prefs.setSoundVolume],
    }
  })
}

let storage: Map<string, string>
beforeEach(() => {
  vi.resetModules()
  mockSnapshots()
  storage = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function controls() {
  const { AudioControls } = await import('../components/AudioControls')
  const element = AudioControls() as ReactElement<{ children: ReactNode }>
  const children = Children.toArray(element.props.children)
  const mute = children.find((child) => isValidElement(child) && child.type === 'button') as ReactElement<ButtonHTMLAttributes<HTMLButtonElement>>
  const volume = children.find((child) => isValidElement(child) && child.type === 'input') as ReactElement<InputHTMLAttributes<HTMLInputElement>>
  return {
    mute: mute.props,
    volume: volume.props,
    toggle: () => mute.props.onClick?.({} as MouseEvent<HTMLButtonElement>),
    changeVolume: (next: number) => volume.props.onChange?.({ target: { value: String(next) } } as ChangeEvent<HTMLInputElement>),
  }
}

describe('audio controls beside a season or match', () => {
  it('changes the persisted master gain, mutes without losing volume, and restores that volume on unmute', async () => {
    const prefs = await import('../sound/prefs')
    const synth = await import('../sound/synth')
    const unlock = vi.spyOn(synth, 'unlockAudio')
    let ui = await controls()
    expect(ui.mute['aria-label']).toBe('Mute audio')
    expect(ui.volume['aria-label']).toBe('Volume')
    expect(ui.volume).toMatchObject({ type: 'range', min: 0, max: 100, step: 5, value: 100 })

    ui.changeVolume(35)
    expect(prefs.soundVolume()).toBe(35)
    expect(storage.get(prefs.VOLUME_KEY)).toBe('35')
    expect(synth.gainNow()).toBeCloseTo(synth.MASTER_GAIN * prefs.volumeGain(35))
    expect(unlock).toHaveBeenCalledOnce()

    ui = await controls()
    expect(ui.volume.value).toBe(35)
    ui.toggle()
    expect(storage.get(prefs.SOUND_KEY)).toBe('off')
    expect(synth.gainNow()).toBe(0)
    expect(prefs.soundVolume()).toBe(35)
    ui = await controls()
    expect(ui.mute['aria-pressed']).toBe(true)
    expect(ui.mute.title).toBe('Unmute audio')
    expect(ui.volume['aria-valuetext']).toBe('35%, muted')

    ui.changeVolume(60)
    expect(prefs.soundVolume()).toBe(60)
    expect(prefs.soundOn()).toBe(false)
    expect(synth.gainNow()).toBe(0)
    expect(unlock).toHaveBeenCalledOnce()
    ui = await controls()
    ui.toggle()
    expect(storage.get(prefs.SOUND_KEY)).toBe('on')
    expect(synth.gainNow()).toBeCloseTo(synth.MASTER_GAIN * prefs.volumeGain(60))
    expect(unlock).toHaveBeenCalledTimes(2)

    vi.resetModules()
    mockSnapshots()
    ui = await controls()
    expect(ui.volume.value).toBe(60)
    expect(ui.mute['aria-pressed']).toBe(false)
  })

  it('keeps zero valid, restores a saved mute, and works when browser storage is blocked', async () => {
    storage.set('touchline-sound', 'off')
    storage.set('touchline-sound-volume', '25')
    let ui = await controls()
    const prefs = await import('../sound/prefs')
    const { gainNow } = await import('../sound/synth')
    expect(ui.mute['aria-pressed']).toBe(true)
    expect(ui.volume.value).toBe(25)
    ui.changeVolume(0)
    expect(storage.get(prefs.VOLUME_KEY)).toBe('0')
    ui = await controls()
    ui.toggle()
    expect(prefs.soundOn()).toBe(true)
    expect(gainNow()).toBe(0)

    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('Storage blocked') },
      setItem: () => { throw new Error('Storage blocked') },
    })
    ui = await controls()
    expect(() => ui.changeVolume(45)).not.toThrow()
    expect(prefs.soundVolume()).toBe(45)
    ui.toggle()
    expect(prefs.soundOn()).toBe(false)
    expect(gainNow()).toBe(0)
  })
})
