import { describe, expect, it } from 'vitest'
import { canonicalJson, fingerprint } from '../core/canonical'
import { gunzipText, gzipText, sha256Hex } from '../core/bytes'
import { formatCode, normaliseCode, parseGameHash } from '../core/codes'
import { cleanAuthParams, parseAuthRedirect } from '../core/authUrl'
import { countryFlag, normaliseCountry } from '../core/country'

describe('canonical JSON', () => {
  it('gives equal text for equal values whatever the key order, and keeps array order', () => {
    const a = { b: 1, a: { d: [3, 1, 2], c: 'x' }, e: undefined }
    const b = { a: { c: 'x', d: [3, 1, 2] }, b: 1 }
    expect(canonicalJson(a)).toBe(canonicalJson(b))
    expect(canonicalJson(a)).toBe('{"a":{"c":"x","d":[3,1,2]},"b":1}')
    expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]))
    expect(canonicalJson([undefined, null, true, 'é'])).toBe('[null,null,true,"é"]')
  })

  it('agrees with JSON.stringify on a value whose keys are already sorted', () => {
    const v = { a: [1, { b: 2, c: [true, false, null] }], d: 'quote " and \\ backslash', e: -0.5 }
    expect(canonicalJson(v)).toBe(JSON.stringify(v))
  })

  it('refuses what JSON cannot hold', () => {
    const cyc: Record<string, unknown> = {}
    cyc.self = cyc
    expect(() => canonicalJson(cyc)).toThrow(/cycle/)
    expect(() => canonicalJson({ n: Number.NaN })).toThrow(/non-finite/)
    expect(() => canonicalJson({ f: () => 1 })).toThrow(/function/)
  })

  it('fingerprints a literal value to a literal hash', () => {
    expect(fingerprint({ seed: 'daily-2026-10-25', f: '4-3-3' })).toBe(fingerprint({ f: '4-3-3', seed: 'daily-2026-10-25' }))
    expect(fingerprint({ seed: 'daily-2026-10-25', f: '4-3-3' })).toBe('21h8hhafnsj')
    expect(fingerprint([1, 2])).not.toBe(fingerprint([2, 1]))
  })
})

describe('bytes', () => {
  it('round-trips a 4 MB string through gzip and shrinks it', async () => {
    const text = JSON.stringify(Array.from({ length: 90000 }, (_, i) => ({ id: `s${i}`, name: `Player ${i % 977}`, ovr: 60 + (i % 30) })))
    expect(text.length).toBeGreaterThan(4_000_000)
    const gz = await gzipText(text)
    expect(gz[0]).toBe(0x1f)
    expect(gz[1]).toBe(0x8b)
    expect(gz.length).toBeLessThan(text.length / 5)
    expect(await gunzipText(gz)).toBe(text)
  }, 60000)

  it('refuses bytes that are not gzip', async () => {
    await expect(gunzipText(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow()
  })

  it('hashes known SHA-256 vectors', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(await sha256Hex('abc'))
  })
})

describe('short codes', () => {
  it('normalises typed codes and refuses look-alike characters', () => {
    expect(normaliseCode('k7q2-mx9a')).toBe('K7Q2MX9A')
    expect(normaliseCode(' K7Q2 MX9A ')).toBe('K7Q2MX9A')
    for (const bad of ['K7Q2MX9I', 'K7Q2MX9O', 'K7Q2MX90', 'K7Q2MX91', 'K7Q2MX9', 'K7Q2MX9AA', 'x'.repeat(30)]) expect(normaliseCode(bad)).toBeNull()
    expect(formatCode('K7Q2MX9A')).toBe('K7Q2-MX9A')
  })

  it('parses the game link fragments', () => {
    expect(parseGameHash('#s=k7q2-mx9a')).toEqual({ kind: 's', code: 'K7Q2MX9A' })
    expect(parseGameHash('#h=K7Q2MX9A')).toEqual({ kind: 'h', code: 'K7Q2MX9A' })
    expect(parseGameHash('#c=eyJ2IjoxfQ')).toEqual({ kind: 'c', payload: 'eyJ2IjoxfQ' })
    expect(parseGameHash('#s=K7Q2MX91')).toBeNull()
    expect(parseGameHash('#x=K7Q2MX9A')).toBeNull()
    expect(parseGameHash('')).toBeNull()
  })
})

describe('auth redirects', () => {
  const base = 'https://touchline.quest/'
  const hashes = ['', '#c=eyJ2IjoxfQ', '#s=K7Q2MX9A', '#h=K7Q2MX9A']

  it('parses every redirect shape, each with every game fragment, and cleaning keeps the fragment', () => {
    for (const h of hashes) {
      const th = `${base}?token_hash=pkce_abc123&type=email${h}`
      expect(parseAuthRedirect(th)).toEqual({ kind: 'token_hash', tokenHash: 'pkce_abc123', type: 'email' })
      expect(cleanAuthParams(th)).toBe(`${base}${h}`)
      const code = `${base}?code=9f8e7d${h}`
      expect(parseAuthRedirect(code)).toEqual({ kind: 'code', code: '9f8e7d' })
      expect(cleanAuthParams(code)).toBe(`${base}${h}`)
      const qerr = `${base}?error=access_denied&error_description=Email+link+is+invalid${h}`
      expect(parseAuthRedirect(qerr)).toEqual({ kind: 'error', error: 'access_denied', description: 'Email link is invalid' })
      expect(cleanAuthParams(qerr)).toBe(`${base}${h}`)
      expect(parseAuthRedirect(`${base}${h}`)).toBeNull()
      expect(cleanAuthParams(`${base}${h}`)).toBe(`${base}${h}`)
    }
  })

  it('reads an error fragment and drops it, and keeps unrelated query parameters', () => {
    const href = `${base}#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`
    expect(parseAuthRedirect(href)).toEqual({ kind: 'error', error: 'access_denied', description: 'Email link is invalid or has expired' })
    expect(cleanAuthParams(href)).toBe(base)
    expect(cleanAuthParams(`${base}?ref=home&code=abc#s=K7Q2MX9A`)).toBe(`${base}?ref=home#s=K7Q2MX9A`)
    expect(parseAuthRedirect(`${base}?token_hash=x&type=bogus`)).toBeNull()
  })
})

describe('countries', () => {
  it('normalises alpha-2 codes and draws flags', () => {
    expect(normaliseCountry(' gb ')).toBe('GB')
    expect(normaliseCountry('GBR')).toBeNull()
    expect(normaliseCountry('')).toBeNull()
    expect(normaliseCountry(null)).toBeNull()
    expect(countryFlag('vn')).toBe('🇻🇳')
    expect(countryFlag('x1')).toBe('')
  })
})
