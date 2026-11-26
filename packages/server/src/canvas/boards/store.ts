import { z } from 'zod'

// Server-side canvas boards. A board belongs to one account and carries a revision
// number; a save names the revision it replaces and is rejected if the board has moved
// on, the same contract the canvas applies to objects (`expectedRevision`). Revision 0
// means "create": the board must not exist yet.

export const MAX_BOARD_BYTES = 10 * 1024 * 1024
export const KEEP_REVISIONS = 50
/** The newest revisions always kept; older ones are thinned (see revisionsToKeep). */
export const KEEP_RECENT = 20
export const THIN_SLOT_MS = 15 * 60_000

/**
 * Which revisions a board keeps. Sync saves after every pause in editing, so keeping only
 * the newest 50 covered a few minutes of work. This keeps the newest KEEP_RECENT, then the
 * newest revision in each older 15-minute slot of wall-clock time, KEEP_REVISIONS in all.
 * Slots are fixed, so a revision kept for its slot stays kept as new saves arrive.
 */
export function revisionsToKeep(history: { revision: number; savedAt: string }[]): Set<number> {
  const newestFirst = [...history].sort((a, b) => b.revision - a.revision)
  const keep = new Set<number>()
  const slots = new Set<number>()
  for (const [i, h] of newestFirst.entries()) {
    if (keep.size >= KEEP_REVISIONS) break
    const slot = Math.floor(Date.parse(h.savedAt) / THIN_SLOT_MS)
    if (i < KEEP_RECENT || !slots.has(slot)) {
      keep.add(h.revision)
      slots.add(slot)
    }
  }
  return keep
}
/**
 * Boards one account may keep. Well above normal use (sync adds a board only when it
 * cannot merge), and with the 10 MB and 50-revision caps it bounds one account's storage.
 * Saving an existing board is never limited; only creating one past the cap is refused.
 */
export const MAX_BOARDS_PER_ACCOUNT = 50
export type BoardLimits = { maxBoards: number }
export const defaultLimits: BoardLimits = { maxBoards: MAX_BOARDS_PER_ACCOUNT }

export const boardIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'Board IDs are 1–64 letters, digits, - or _')
/** The tldraw document: store records keyed by ID, and the schema they were written with. */
export const snapshotSchema = z
  .object({
    store: z.record(z.string(), z.object({ id: z.string(), typeName: z.string() }).passthrough()),
    schema: z.object({ schemaVersion: z.number() }).passthrough(),
  })
  .strict()
export const saveSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    name: z.string().trim().min(1).max(200).optional(),
    snapshot: snapshotSchema,
  })
  .strict()

export type Snapshot = z.infer<typeof snapshotSchema>
export type BoardSummary = { id: string; name: string; revision: number; sizeBytes: number; updatedAt: string }
export type Board = BoardSummary & { snapshot: Snapshot }
export type RevisionSummary = { revision: number; sizeBytes: number; savedAt: string }
export type SaveInput = { expectedRevision: number; name?: string; snapshot: Snapshot }
export type SaveResult =
  | { ok: true; board: BoardSummary }
  | { ok: false; reason: 'stale'; current: BoardSummary }
  | { ok: false; reason: 'missing' }
  | { ok: false; reason: 'limit'; limit: number }
export type RemoveResult = { ok: true } | { ok: false; reason: 'stale'; current: BoardSummary } | { ok: false; reason: 'missing' }

export interface BoardStore {
  list(userId: string): Promise<BoardSummary[]>
  get(userId: string, id: string): Promise<Board | null>
  save(userId: string, id: string, input: SaveInput): Promise<SaveResult>
  remove(userId: string, id: string, expectedRevision: number): Promise<RemoveResult>
  revisions(userId: string, id: string): Promise<RevisionSummary[] | null>
  revision(userId: string, id: string, revision: number): Promise<(RevisionSummary & { snapshot: Snapshot }) | null>
}

/** The name stored in the tldraw document record, if any. */
export function documentName(snapshot: Snapshot): string | undefined {
  const doc = snapshot.store['document:document'] as { name?: unknown } | undefined
  return typeof doc?.name === 'string' && doc.name.trim() ? doc.name.trim().slice(0, 200) : undefined
}

export const byteSize = (snapshot: Snapshot) => Buffer.byteLength(JSON.stringify(snapshot))

type Stored = Board & { history: (RevisionSummary & { snapshot: Snapshot })[] }

/** In-memory store with the same semantics as the Postgres store; used by tests. */
export class MemoryBoardStore implements BoardStore {
  private boards = new Map<string, Stored>()
  constructor(
    private now: () => Date = () => new Date(),
    private limits: BoardLimits = defaultLimits,
  ) {}
  /** The same boards under different limits (tests). */
  withLimits(limits: BoardLimits) {
    const view = new MemoryBoardStore(this.now, limits)
    view.boards = this.boards
    return view
  }
  private key = (userId: string, id: string) => `${userId}\u0000${id}`
  private summary = ({ id, name, revision, sizeBytes, updatedAt }: Stored): BoardSummary => ({ id, name, revision, sizeBytes, updatedAt })

  async list(userId: string) {
    return [...this.boards.entries()]
      .filter(([k]) => k.startsWith(`${userId}\u0000`))
      .map(([, b]) => this.summary(b))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
  }
  async get(userId: string, id: string) {
    const b = this.boards.get(this.key(userId, id))
    return b ? { ...this.summary(b), snapshot: structuredClone(b.snapshot) } : null
  }
  async save(userId: string, id: string, input: SaveInput): Promise<SaveResult> {
    const k = this.key(userId, id)
    const current = this.boards.get(k)
    const at = this.now().toISOString(), sizeBytes = byteSize(input.snapshot)
    const name = input.name ?? documentName(input.snapshot)
    if (!current) {
      if (input.expectedRevision !== 0) return { ok: false, reason: 'missing' }
      // Counted synchronously, so concurrent creates cannot interleave past the cap.
      const owned = [...this.boards.keys()].filter((key) => key.startsWith(`${userId}\u0000`)).length
      if (owned >= this.limits.maxBoards) return { ok: false, reason: 'limit', limit: this.limits.maxBoards }
      const board: Stored = { id, name: name ?? 'Untitled exploration', revision: 1, sizeBytes, updatedAt: at, snapshot: structuredClone(input.snapshot), history: [] }
      board.history.push({ revision: 1, sizeBytes, savedAt: at, snapshot: board.snapshot })
      this.boards.set(k, board)
      return { ok: true, board: this.summary(board) }
    }
    if (current.revision !== input.expectedRevision) return { ok: false, reason: 'stale', current: this.summary(current) }
    const revision = current.revision + 1
    Object.assign(current, { revision, sizeBytes, updatedAt: at, snapshot: structuredClone(input.snapshot), ...(name ? { name } : {}) })
    current.history.push({ revision, sizeBytes, savedAt: at, snapshot: current.snapshot })
    const keep = revisionsToKeep(current.history)
    current.history = current.history.filter((h) => keep.has(h.revision))
    return { ok: true, board: this.summary(current) }
  }
  async remove(userId: string, id: string, expectedRevision: number): Promise<RemoveResult> {
    const k = this.key(userId, id), current = this.boards.get(k)
    if (!current) return { ok: false, reason: 'missing' }
    if (current.revision !== expectedRevision) return { ok: false, reason: 'stale', current: this.summary(current) }
    this.boards.delete(k)
    return { ok: true }
  }
  async revisions(userId: string, id: string) {
    const b = this.boards.get(this.key(userId, id))
    return b ? b.history.map(({ revision, sizeBytes, savedAt }) => ({ revision, sizeBytes, savedAt })).reverse() : null
  }
  async revision(userId: string, id: string, revision: number) {
    const r = this.boards.get(this.key(userId, id))?.history.find((h) => h.revision === revision)
    return r ? { ...r, snapshot: structuredClone(r.snapshot) } : null
  }
}
