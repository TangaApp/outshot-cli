import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { configDir } from './config.js'

export type JsonSchema = Record<string, any>

/** One operation of the public API, as `GET /v1/operations` describes it. */
export interface Operation {
  name: string
  scope: 'read' | 'write' | 'publish'
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  summary: string
  credits: string | null
  destructive: boolean
  id: string | null
  mcp_tool: string
  input_schema: JsonSchema | null
  output_schema: JsonSchema | null
}

export interface Listing {
  api_url: string
  mcp_url: string
  costs: Record<string, number>
  operations: Operation[]
}

export type ListingSource = 'live' | 'cache' | 'bundled'

/** Matches the API's own Cache-Control (5 minutes). */
export const CACHE_MS = 5 * 60 * 1000
const FETCH_TIMEOUT_MS = 10_000

const SNAPSHOT = new URL('../operations.snapshot.json', import.meta.url)

export function bundledListing(): Listing {
  return JSON.parse(readFileSync(SNAPSHOT, 'utf8'))
}

interface Cached {
  origin: string
  fetched_at: number
  listing: Listing
}

function readCache(file: string): Cached | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/**
 * The API's operations: fetched live (so a new operation works without a new release of this
 * package), cached for 5 minutes, and the copy bundled with the package when the API can't be
 * reached.
 */
export async function loadListing(
  origin: string,
  opts: { fetchImpl?: typeof fetch; now?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<{ listing: Listing; source: ListingSource }> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const now = opts.now ?? Date.now()
  const dir = configDir(opts.env)
  const file = join(dir, 'operations.json')
  const cached = readCache(file)
  const ours = cached && cached.origin === origin ? cached : null
  if (ours && now - ours.fetched_at < CACHE_MS) return { listing: ours.listing, source: 'cache' }
  try {
    const res = await fetchImpl(`${origin}/v1/operations`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`status ${res.status}`)
    const listing = (await res.json()) as Listing
    if (!Array.isArray(listing.operations)) throw new Error('no operations')
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      writeFileSync(file, JSON.stringify({ origin, fetched_at: now, listing }), { mode: 0o600 })
    } catch {
      // A read-only home folder only costs the cache.
    }
    return { listing, source: 'live' }
  } catch {
    if (ours) return { listing: ours.listing, source: 'cache' }
    return { listing: bundledListing(), source: 'bundled' }
  }
}

/** `edit_video` → `edit-video`: the command for an operation. */
export const commandName = (op: Operation) => op.name.replace(/_/g, '-')

export function findOperation(listing: Listing, command: string): Operation | undefined {
  const name = command.replace(/-/g, '_')
  return listing.operations.find((op) => op.name === name)
}

/** Publish operations post to the person's real TikTok, so they need --yes. */
export const needsYes = (op: Operation) => op.scope === 'publish'

/** The operation takes an id in its path (`/v1/videos/{id}/edit`). */
export const takesId = (op: Operation) => op.path.includes('{id}')
