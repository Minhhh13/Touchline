import { Capacitor } from '@capacitor/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyText, hasShareSheet, shareGameResult, shareMessage, shareOrCopy } from '../shareSheet'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the share sheet', () => {
  const input = { title: 'TouchLine head-to-head', text: 'Ana invites you', url: 'https://touchline.quest/#h=K7Q2MX9A' }
  it('sends a public result invite from the native app and keeps a web preview on its own path', async () => {
    const native = vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true)
    const share = vi.fn().mockResolvedValue(undefined)
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('location', { origin: 'capacitor://localhost', pathname: '/index.html' })
    vi.stubGlobal('navigator', { share })
    expect(await shareGameResult('TouchLine', 'Play my season')).toBe('shared')
    expect(share).toHaveBeenCalledWith({ title: 'TouchLine', text: 'Play my season', url: 'https://touchline.quest/' })

    vi.stubGlobal('navigator', { clipboard: { writeText } })
    expect(await shareGameResult('TouchLine', 'Play my season')).toBe('copied')
    expect(writeText).toHaveBeenLastCalledWith('Play my season\nhttps://touchline.quest/')

    native.mockReturnValue(false)
    vi.stubGlobal('location', { origin: 'https://preview.example', pathname: '/touchline/' })
    expect(await shareGameResult('TouchLine', 'Play my season')).toBe('copied')
    expect(writeText).toHaveBeenLastCalledWith('Play my season\nhttps://preview.example/touchline/')
  })

  it('shares where there is a sheet, takes a closed sheet as an answer, and copies everywhere else', async () => {
    const shared: unknown[] = []
    const copied: string[] = []
    const clipboard = { writeText: async (t: string) => void copied.push(t) }
    expect(await shareOrCopy(input, { share: async (d) => void shared.push(d), clipboard })).toBe('shared')
    expect(shared).toEqual([input])
    const abort = Object.assign(new Error('closed'), { name: 'AbortError' })
    expect(await shareOrCopy(input, { share: async () => Promise.reject(abort), clipboard })).toBe('dismissed')
    expect(copied).toEqual([])
    // a sheet that would not open falls back to the clipboard
    expect(await shareOrCopy(input, { share: async () => Promise.reject(new Error('NotAllowedError')), clipboard })).toBe('copied')
    expect(await shareOrCopy(input, { clipboard })).toBe('copied')
    expect(copied).toEqual([shareMessage(input), shareMessage(input)])
    expect(shareMessage(input)).toBe('Ana invites you\nhttps://touchline.quest/#h=K7Q2MX9A')
    expect(await shareOrCopy(input, {})).toBe('failed')
    expect(await copyText('x', { clipboard: { writeText: async () => Promise.reject(new Error('denied')) } })).toBe('failed')
    expect(hasShareSheet({ share: async () => {}, canShare: () => false })).toBe(false)
    expect(hasShareSheet(undefined)).toBe(false)
  })
})
