import { describe, expect, it } from 'vitest'
import { copyText, hasShareSheet, shareMessage, shareOrCopy } from '../shareSheet'

describe('the share sheet', () => {
  const input = { title: 'TouchLine head-to-head', text: 'Ana invites you', url: 'https://touchline.quest/#h=K7Q2MX9A' }
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
