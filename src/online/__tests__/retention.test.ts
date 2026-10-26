import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { RETENTION } from '../core/retention'
import { SUPABASE_REGION } from '../config'
import { AUTH_KEY, ONLINE_KEY, PROMPTS_KEY } from '../localState'
import { logId } from '../server/validate'

// The privacy page states these figures; each one is checked against the code or SQL that enforces it, so the
// page cannot drift from what the backend does.
const dir = path.resolve(__dirname, '../../../supabase/migrations')
const sql = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(path.join(dir, f), 'utf8'))
  .join('\n')

describe('the privacy page figures', () => {
  it('names the project region the client calls', () => {
    expect(RETENTION.region).toContain(SUPABASE_REGION)
  })

  it('matches the cloud-save cap and the one previous copy', () => {
    expect(sql).toContain(`private.save_object_count((select auth.uid()))) < ${RETENTION.saveObjectCap}`)
    expect(RETENTION.previousCopies).toBe(1)
    expect(sql).toMatch(/prev_object_path text,/)
    expect(sql).not.toMatch(/prev2_|prev_prev_/)
  })

  it('matches the clean-up of rate-limit windows and the challenge-code lifetime', () => {
    expect(sql).toContain(`window_start < now() - interval '${RETENTION.rateLimitDays} days'`)
    expect(RETENTION.challengeCodeDays).toBe(365)
    expect(sql).toContain("expires_at timestamptz not null default (now() + interval '1 year')")
  })

  it('lists every device key the online layer writes', () => {
    expect([...RETENTION.deviceKeys].sort()).toEqual([AUTH_KEY, ONLINE_KEY, PROMPTS_KEY].sort())
  })

  it('logs no more of an account id than the page says', () => {
    const id = '0123456789abcdef-0123-4567-89ab-cdef01234567'
    const logged = String(logId(id))
    expect(logged.length).toBeLessThanOrEqual(RETENTION.logUserIdChars)
    expect(id.startsWith(logged)).toBe(true)
  })
})
