import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { ENGINE_VERSION } from '@engine/version'
import { isForbiddenClientKey, onlineConfig, onlineConfigFrom, SUPABASE_REGION } from '../config'
import { buildInfoFrom } from '../buildInfo'
import { initialOnlineState, onlineStore } from '../state'

const URL_ = 'https://yvqpmyqomkwtudxmkeou.supabase.co'
// Built at run time, like the fake secret below, so no key-shaped literal sits in the tree
const KEY = ['sb', 'publishable', 'abcdefghijklmnop'].join('_')

function jwt(claims: Record<string, unknown>): string {
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b({ alg: 'HS256', typ: 'JWT' })}.${b(claims)}.c2lnbmF0dXJlLXNpZ25hdHVyZQ`
}

describe('online configuration', () => {
  it('is off unless both variables are set', () => {
    expect(onlineConfigFrom({})).toBeNull()
    expect(onlineConfigFrom({ VITE_SUPABASE_URL: URL_ })).toBeNull()
    expect(onlineConfigFrom({ VITE_SUPABASE_ANON_KEY: KEY })).toBeNull()
    expect(onlineConfigFrom({ VITE_SUPABASE_URL: '  ', VITE_SUPABASE_ANON_KEY: KEY })).toBeNull()
  })

  it('is off in the test build, which carries no variables', () => {
    expect(onlineConfig()).toBeNull()
  })

  it('names the function after the engine version and pins the project region', () => {
    const c = onlineConfigFrom({ VITE_SUPABASE_URL: `${URL_}/`, VITE_SUPABASE_ANON_KEY: KEY })
    expect(c).toEqual({ url: URL_, key: KEY, functionName: `touchline-e${ENGINE_VERSION}`, region: 'ap-southeast-2' })
    expect(SUPABASE_REGION).toBe('ap-southeast-2')
  })

  it('refuses a secret key, a service_role JWT and a non-https URL, but takes a legacy anon JWT and localhost', () => {
    expect(onlineConfigFrom({ VITE_SUPABASE_URL: URL_, VITE_SUPABASE_ANON_KEY: 'sb_secret_abc' })).toBeNull()
    expect(onlineConfigFrom({ VITE_SUPABASE_URL: URL_, VITE_SUPABASE_ANON_KEY: jwt({ role: 'service_role' }) })).toBeNull()
    expect(onlineConfigFrom({ VITE_SUPABASE_URL: 'http://evil.example', VITE_SUPABASE_ANON_KEY: KEY })).toBeNull()
    expect(onlineConfigFrom({ VITE_SUPABASE_URL: URL_, VITE_SUPABASE_ANON_KEY: jwt({ role: 'anon' }) })).not.toBeNull()
    expect(onlineConfigFrom({ VITE_SUPABASE_URL: 'http://localhost:54321', VITE_SUPABASE_ANON_KEY: KEY })?.url).toBe('http://localhost:54321')
    expect(isForbiddenClientKey('eyJhbGciOi.eyJnot-json.sig')).toBe(true)
  })

  it('starts the online store switched off', () => {
    expect(onlineStore.getState()).toEqual(initialOnlineState)
    expect(initialOnlineState.configured).toBe(false)
  })
})

describe('build.json', () => {
  it('reads the engine version and the data stamp from the source text', () => {
    const info = buildInfoFrom("export const ENGINE_VERSION = '4'\n", '{"version":2,"generatedAt":"2026-10-25","leagues":[]}', '2026-10-25T00:00:00.000Z')
    expect(info).toEqual({ engine: '4', data: '2026-10-25', builtAt: '2026-10-25T00:00:00.000Z' })
    expect(() => buildInfoFrom('const x = 1', '{"generatedAt":"x"}', 'now')).toThrow(/ENGINE_VERSION/)
    expect(() => buildInfoFrom("export const ENGINE_VERSION = '4'", '{}', 'now')).toThrow(/generatedAt/)
  })
})

describe('check:dist-keys', () => {
  const script = path.resolve(__dirname, '..', '..', '..', 'scripts', 'online', 'check-dist-keys.mjs')
  const run = (files: Record<string, string>) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'tl-dist-'))
    try {
      for (const [name, text] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(dir, name)), { recursive: true })
        writeFileSync(path.join(dir, name), text)
      }
      return spawnSync(process.execPath, [script, dir], { encoding: 'utf8' }).status
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  it('passes publishable and anon keys, fails on a secret key or a service_role JWT', () => {
    expect(run({ 'index.html': '<html></html>', 'assets/a.js': `const k="${KEY}";const j="${jwt({ role: 'anon', iss: 'supabase' })}"` })).toBe(0)
    // a key-shaped fake built at run time, so no secret-looking literal sits in the repository for scanners to flag
    expect(run({ 'assets/a.js': `const k="${['sb', 'secret', 'X'.repeat(16) + '-' + 'y'.repeat(15)].join('_')}"` })).toBe(1)
    // supabase-js tells key types apart by their prefixes: the bare prefix is not a key
    expect(run({ 'assets/runtime.js': 'const t=r=>r.startsWith("sb_publishable_")||r.startsWith("sb_secret_")' })).toBe(0)
    expect(run({ 'assets/b.js': `const j="${jwt({ role: 'service_role', iss: 'supabase' })}"` })).toBe(1)
  })
})
