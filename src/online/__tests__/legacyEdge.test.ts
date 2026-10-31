import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { ENGINE_VERSION } from '@engine/version'
import { EDGE_GLOBAL } from '../../../scripts/online/edgeBundle.mjs'

// An outgoing engine's edge bundle, served byte for byte from public/edge/ so its deployed loader (which fetches
// edge/verifier-<hash16>.js from the live site and refuses any other SHA-256) keeps working for its last 7 days
// after the site moves to the next engine (docs/ONLINE.md section 7, "Release engine 5", "Release engine 6" and "Release engine 7"). Each entry is the exact
// SHA-256 that function's loader pins. Remove the file and its entry when that function is deleted.
const LEGACY: Record<string, { engine: string; sha256: string; retireOnOrAfter: string }> = {
  // touchline-e4: built from main at c897f2c (#80), the bundle the live site served before engine 5
  'verifier-37d256f009b3b3e9.js': { engine: '4', sha256: '37d256f009b3b3e942b3d6d8a6685a03e3c8f8946fa4646d378cf182d7379b82', retireOnOrAfter: '2026-11-03' },
  // touchline-e5: built from engine-e5 at ec520f3 (main 234d9d2), the bundle the live site served before engine 6
  'verifier-603b905d0570f641.js': { engine: '5', sha256: '603b905d0570f641629e73e1c319899a0a346fb6211c54363da513c67c73524d', retireOnOrAfter: '2026-11-04' },
  // touchline-e6: built from release-e6 at 45e3093 (PR #84, QA's Moneyball fix in src/engine/draft.ts included), the bundle
  // the engine 6 site serves (its build.json names it); check it against the live build.json before engine 7 ships
  // (ONLINE.md section 7, "Release engine 7")
  'verifier-f088fc41409257f9.js': { engine: '6', sha256: 'f088fc41409257f94d55ebb2194386d87476c618abaf70869f7b66f4a736591d', retireOnOrAfter: "7 days after engine 7's release" },
}

const dir = path.resolve(__dirname, '../../../public/edge')

describe("the previous engine's edge bundle in public/edge", () => {
  it('holds only the pinned files, each with the exact SHA-256 its loader checks', () => {
    expect(readdirSync(dir).sort()).toEqual(Object.keys(LEGACY).sort())
    for (const [name, pin] of Object.entries(LEGACY)) {
      const sha = createHash('sha256').update(readFileSync(path.join(dir, name))).digest('hex')
      expect(sha, name).toBe(pin.sha256)
      expect(name).toBe(`verifier-${sha.slice(0, 16)}.js`)
    }
  })

  it("is an older engine's bundle, never this build's", () => {
    for (const [name, pin] of Object.entries(LEGACY)) {
      expect(pin.engine, name).not.toBe(ENGINE_VERSION)
      const g = globalThis as Record<string, unknown>
      delete g[EDGE_GLOBAL]
      new Function(readFileSync(path.join(dir, name), 'utf8'))()
      const edge = g[EDGE_GLOBAL] as { ENGINE_VERSION: string }
      delete g[EDGE_GLOBAL]
      expect(edge.ENGINE_VERSION, name).toBe(pin.engine)
    }
  })
})
