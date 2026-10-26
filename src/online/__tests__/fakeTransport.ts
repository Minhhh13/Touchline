/**
 * An in-memory backend for the client tests: the same compare-and-set and idempotency contract as the SQL
 * (`save_claim`, `save_delete`, `profile_put`, `cloud_delete_all`, `create_challenge`, `get_challenge`), the private
 * `saves` bucket's object store, and a scripted Edge Function. Several clients (devices) share one FakeBackend and
 * each gets its own `FakeTransport` view of it.
 */
import type { ChallengePayload } from '@engine/challenge'
import type { SlotId } from '../core/slots'
import type { PuzzlePin } from '../server/dailyVerify'
import type { AccountProfile } from '../state'
import { OnlineError, type ChallengeRow, type ClaimArgs, type ClaimResult, type CloudRow, type FunctionReply, type OnlineTransport } from '../transport'

interface Row extends CloudRow {
  userId: string
}

export class FakeBackend {
  objects = new Map<string, Uint8Array>()
  rows = new Map<string, Row>()
  profiles = new Map<string, { revision: number; data: unknown }>()
  accounts = new Map<string, AccountProfile>()
  challenges = new Map<string, { owner: string; payload: ChallengePayload; createdAt: string }>()
  pins: PuzzlePin[] = []
  /** Every call, by name, for assertions. */
  calls: string[] = []
  /** Scripted Edge Function: answers by op. */
  fn: (body: Record<string, unknown>, userId: string | null) => FunctionReply = () => ({ status: 404, body: { code: 'not_found' } })
  /** Make the next calls fail (a network drop or a refusal). */
  failNext: OnlineError[] = []
  private clock = 0
  now = () => new Date(Date.UTC(2026, 9, 25, 12, 0, this.clock++)).toISOString()
}

const key = (uid: string, slot: string) => `${uid}|${slot}`

export class FakeTransport implements OnlineTransport {
  constructor(
    readonly b: FakeBackend,
    public userId: string | null,
  ) {}

  private gate(name: string): string {
    this.b.calls.push(name)
    const f = this.b.failNext.shift()
    if (f) throw f
    if (!this.userId) throw new OnlineError('auth', 'sign in first', 'PT401', 401)
    return this.userId
  }

  async listSaves(): Promise<CloudRow[]> {
    const uid = this.gate('listSaves')
    return [...this.b.rows.values()].filter((r) => r.userId === uid).map((r) => ({ ...r }))
  }

  async upload(path: string, bytes: Uint8Array): Promise<void> {
    const uid = this.gate('upload')
    if (!path.startsWith(`${uid}/`)) throw new OnlineError('bad', 'not your folder', '42501', 403)
    if (this.b.objects.has(path)) throw new OnlineError('bad', 'exists', '409', 409)
    if ([...this.b.objects.keys()].filter((k) => k.startsWith(`${uid}/`)).length >= 16) throw new OnlineError('bad', 'object cap', '42501', 403)
    this.b.objects.set(path, bytes)
  }

  async download(path: string): Promise<Uint8Array> {
    const uid = this.gate('download')
    const o = this.b.objects.get(path)
    if (!o || !path.startsWith(`${uid}/`)) throw new OnlineError('missing', 'no such object', '404', 404)
    return o
  }

  async remove(paths: string[]): Promise<void> {
    const uid = this.gate('remove')
    for (const p of paths) if (p.startsWith(`${uid}/`)) this.b.objects.delete(p)
  }

  async listFolder(userId: string): Promise<string[]> {
    this.gate('listFolder')
    return [...this.b.objects.keys()].filter((k) => k.startsWith(`${userId}/`))
  }

  async claim(a: ClaimArgs): Promise<ClaimResult> {
    const uid = this.gate('claim')
    if (!this.b.objects.has(a.objectPath)) throw new OnlineError('bad', 'upload the save before claiming it', '22023', 400)
    const k = key(uid, a.slot)
    const cur = this.b.rows.get(k)
    if (!cur) {
      if (a.baseRevision !== 0 || a.asPrevious) return { status: 'conflict', revision: 0, obsolete: [] }
      this.b.rows.set(k, { userId: uid, slot: a.slot, revision: 1, gameId: a.gameId, contentHash: a.contentHash, objectPath: a.objectPath, meta: a.meta, deviceId: a.deviceId, clientSavedAt: a.clientSavedAt, deletedAt: null, updatedAt: this.b.now(), prevGameId: null, prevObjectPath: null, prevMeta: null, prevSavedAt: null })
      return { status: 'ok', revision: 1, obsolete: [] }
    }
    if (cur.revision !== a.baseRevision) return { status: 'conflict', revision: cur.revision, obsolete: [] }
    if (a.asPrevious) {
      if (a.objectPath === cur.objectPath) throw new OnlineError('bad', 'that object is the current copy', '22023', 400)
      const obsolete = cur.prevObjectPath && cur.prevObjectPath !== cur.objectPath ? [cur.prevObjectPath] : []
      Object.assign(cur, { prevGameId: a.gameId, prevObjectPath: a.objectPath, prevMeta: a.meta, prevSavedAt: this.b.now() })
      return { status: 'archived', revision: cur.revision, obsolete }
    }
    if (!cur.deletedAt && cur.gameId === a.gameId && cur.contentHash === a.contentHash) return { status: 'unchanged', revision: cur.revision, obsolete: a.objectPath !== cur.objectPath ? [a.objectPath] : [] }
    const obsolete: string[] = []
    if (!cur.deletedAt) {
      if (cur.prevObjectPath) obsolete.push(cur.prevObjectPath)
      Object.assign(cur, { prevGameId: cur.gameId, prevObjectPath: cur.objectPath, prevMeta: cur.meta, prevSavedAt: cur.updatedAt })
    }
    Object.assign(cur, { revision: cur.revision + 1, gameId: a.gameId, contentHash: a.contentHash, objectPath: a.objectPath, meta: a.meta, deviceId: a.deviceId, clientSavedAt: a.clientSavedAt, deletedAt: null, updatedAt: this.b.now() })
    return { status: 'ok', revision: cur.revision, obsolete }
  }

  async deleteSlot(slot: SlotId, baseRevision: number, deviceId: string): Promise<ClaimResult> {
    const uid = this.gate('deleteSlot')
    const cur = this.b.rows.get(key(uid, slot))
    if (!cur || cur.deletedAt) return { status: 'unchanged', revision: cur?.revision ?? 0, obsolete: [] }
    if (cur.revision !== baseRevision) return { status: 'conflict', revision: cur.revision, obsolete: [] }
    const obsolete = cur.prevObjectPath ? [cur.prevObjectPath] : []
    Object.assign(cur, { prevGameId: cur.gameId, prevObjectPath: cur.objectPath, prevMeta: cur.meta, prevSavedAt: cur.updatedAt, revision: cur.revision + 1, objectPath: null, deletedAt: this.b.now(), deviceId, updatedAt: this.b.now() })
    return { status: 'ok', revision: cur.revision, obsolete }
  }

  async orphans(): Promise<string[]> {
    const uid = this.gate('orphans')
    const used = new Set([...this.b.rows.values()].filter((r) => r.userId === uid).flatMap((r) => [r.objectPath, r.prevObjectPath]))
    return [...this.b.objects.keys()].filter((k) => k.startsWith(`${uid}/`) && !used.has(k))
  }

  async deleteAll(): Promise<string[]> {
    const uid = this.gate('deleteAll')
    const out: string[] = []
    for (const [k, r] of [...this.b.rows]) {
      if (r.userId !== uid) continue
      if (r.objectPath) out.push(r.objectPath)
      if (r.prevObjectPath) out.push(r.prevObjectPath)
      this.b.rows.delete(k)
    }
    this.b.profiles.delete(uid)
    return out
  }

  async getProfileDoc(): Promise<{ revision: number; data: unknown } | null> {
    const uid = this.gate('getProfileDoc')
    const p = this.b.profiles.get(uid)
    return p ? { revision: p.revision, data: structuredClone(p.data) } : null
  }

  async putProfileDoc(baseRevision: number, data: unknown): Promise<{ status: string; revision: number; data?: unknown }> {
    const uid = this.gate('putProfileDoc')
    const cur = this.b.profiles.get(uid)
    if (cur) {
      if (JSON.stringify(cur.data) === JSON.stringify(data)) return { status: 'unchanged', revision: cur.revision }
      if (cur.revision !== baseRevision) return { status: 'conflict', revision: cur.revision, data: structuredClone(cur.data) }
      this.b.profiles.set(uid, { revision: cur.revision + 1, data: structuredClone(data) })
      return { status: 'ok', revision: cur.revision + 1 }
    }
    if (baseRevision !== 0) return { status: 'conflict', revision: 0, data: null }
    this.b.profiles.set(uid, { revision: 1, data: structuredClone(data) })
    return { status: 'ok', revision: 1 }
  }

  async getAccount(userId: string): Promise<AccountProfile | null> {
    this.gate('getAccount')
    return this.b.accounts.get(userId) ?? null
  }

  async saveAccount(userId: string, account: AccountProfile, exists: boolean): Promise<void> {
    this.gate('saveAccount')
    const lower = account.displayName.toLowerCase()
    for (const [id, a] of this.b.accounts) if (id !== userId && a.displayName.toLowerCase() === lower) throw new OnlineError('taken', 'duplicate key value', '23505', 409)
    if (exists !== this.b.accounts.has(userId)) throw new OnlineError('bad', exists ? 'no row to update' : 'row exists', '23505', 409)
    this.b.accounts.set(userId, account)
  }

  async pin(kind: 'daily' | 'weekly', k: string): Promise<PuzzlePin | null> {
    this.b.calls.push('pin')
    return this.b.pins.find((p) => p.kind === kind && p.key === k) ?? null
  }

  async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    this.b.calls.push(`rpc:${fn}`)
    const f = this.b.failNext.shift()
    if (f) throw f
    if (fn === 'get_challenge') {
      const c = this.b.challenges.get(String(args.p_code))
      return (c ? structuredClone(c.payload) : null) as T
    }
    if (fn === 'create_challenge') {
      if (!this.userId) throw new OnlineError('auth', 'sign in to make a short link', 'PT401', 401)
      const text = JSON.stringify(args.p_payload)
      for (const [code, c] of this.b.challenges) if (c.owner === this.userId && JSON.stringify(c.payload) === text) return code as T
      const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
      const n = this.b.challenges.size
      const code = `K7Q2MX${A[n % 24]}${A[Math.floor(n / 24) % 24]}`
      this.b.challenges.set(code, { owner: this.userId, payload: structuredClone(args.p_payload as ChallengePayload), createdAt: this.b.now() })
      return code as T
    }
    throw new OnlineError('missing', `no function ${fn}`, 'PGRST202', 404)
  }

  async invoke(body: Record<string, unknown>, opts: { guest?: boolean } = {}): Promise<FunctionReply> {
    this.b.calls.push(`invoke:${String(body.op)}`)
    const f = this.b.failNext.shift()
    if (f) throw f
    if (!this.userId && !opts.guest) return { status: 401, body: { code: 'signed_out' } }
    return this.b.fn(body, this.userId)
  }

  async myChallenges(): Promise<ChallengeRow[]> {
    const uid = this.gate('myChallenges')
    return [...this.b.challenges].filter(([, c]) => c.owner === uid).map(([code, c]) => ({ code, createdAt: c.createdAt, expiresAt: c.createdAt, payload: c.payload }))
  }

  async deleteChallenge(code: string): Promise<void> {
    const uid = this.gate('deleteChallenge')
    const c = this.b.challenges.get(code)
    if (c && c.owner === uid) this.b.challenges.delete(code)
  }
}

