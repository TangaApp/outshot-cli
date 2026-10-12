import { keyPrefix } from './config.js'
import { CliError, EXIT } from './errors.js'
import type { Operation } from './operations.js'
import { VERSION } from './version.js'

export interface Reply {
  status: number
  body: any
}

export interface CallOptions {
  origin: string
  key: string
  id?: string
  input?: Record<string, unknown> | null
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

const RETRY_CAP_S = 60
const TIMEOUT_MS = 120_000
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** The full address of an operation: the path already holds `/v1`, and `{id}` is the id. */
export function urlFor(op: Operation, origin: string, id?: string, input?: Record<string, unknown> | null): string {
  let path = op.path
  // Paths come from the API's own list; anything else is never followed.
  if (!/^\/v1\/[A-Za-z0-9_\-/{}]*$/.test(path)) throw new CliError('bad_listing', `The API listed an odd path for ${op.name}.`)
  if (path.includes('{id}')) {
    if (!id) throw new CliError('usage', `${op.name.replace(/_/g, '-')} needs an id.`, EXIT.usage)
    path = path.replace('{id}', encodeURIComponent(id))
  }
  const url = new URL(origin + path)
  if (url.origin !== origin) throw new CliError('bad_listing', `The API listed an odd path for ${op.name}.`)
  if (input && (op.method === 'GET' || op.method === 'DELETE')) {
    for (const [k, v] of Object.entries(input)) {
      if (v === null || v === undefined) continue
      for (const item of Array.isArray(v) ? v : [v]) url.searchParams.append(k, String(item))
    }
  }
  return url.toString()
}

async function readBody(res: Response): Promise<any> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return { error: { code: 'bad_reply', message: `The API answered ${res.status} with something that isn't JSON.` } }
  }
}

/** Calls one operation. A 429 is waited out once (its Retry-After, at most a minute), then retried. */
export async function call(op: Operation, opts: CallOptions): Promise<Reply> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const sleep = opts.sleep ?? realSleep
  const url = urlFor(op, opts.origin, opts.id, opts.input)
  const sendsBody = op.method !== 'GET' && op.method !== 'DELETE' && op.input_schema
  const init: RequestInit = {
    method: op.method,
    headers: {
      Authorization: `Bearer ${opts.key}`,
      Accept: 'application/json',
      'User-Agent': `outshot-cli/${VERSION}`,
      ...(sendsBody ? { 'Content-Type': 'application/json' } : {}),
    },
    body: sendsBody ? JSON.stringify(opts.input ?? {}) : undefined,
  }
  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
    } catch (e) {
      // Never repeat the key, even when the error quotes the header it was in.
      const why = String((e as Error).message ?? e).replaceAll(opts.key, keyPrefix(opts.key))
      // A change that got no answer may still have happened.
      const exit = op.method === 'GET' ? EXIT.failed : EXIT.unknown
      const check = op.method === 'GET' ? '' : ' It may still have gone through: check before running it again.'
      throw new CliError('unreachable', `No answer from ${opts.origin} (${why}).${check}`, exit)
    }
    if (res.status === 429 && attempt === 0) {
      const wait = Math.min(Number(res.headers.get('retry-after')) || 5, RETRY_CAP_S)
      await res.text()
      await sleep(wait * 1000)
      continue
    }
    return { status: res.status, body: await readBody(res) }
  }
}
