import { readFileSync, statSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { CliError, EXIT, usage } from './errors.js'
import { call, type Reply } from './http.js'
import type { Listing } from './operations.js'
import { waitUntilDone, type WaitOptions } from './wait.js'

const TYPES: Record<string, string> = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm' }
const MAX_BYTES = 250 * 1024 * 1024
const UPLOAD_TIMEOUT_MS = 10 * 60 * 1000

export interface UploadOptions extends WaitOptions {
  file: string
  line?: string
  cut?: boolean
  wait?: boolean
}

function op(listing: Listing, name: string) {
  const found = listing.operations.find((o) => o.name === name)
  if (!found) throw new CliError('unavailable', `The API doesn't offer ${name} right now.`)
  return found
}

/**
 * A product demo, start to finish: ask where to upload, upload the file there, say it's done,
 * and (with --line, or --wait) follow it until it's ready.
 */
export async function uploadDemo(listing: Listing, o: UploadOptions): Promise<Reply> {
  const ext = extname(o.file).toLowerCase()
  if (!TYPES[ext]) throw usage('A demo is an .mp4, .mov or .webm file.')
  let size: number
  try {
    size = statSync(o.file).size
  } catch {
    throw usage(`There's no file at ${o.file}.`)
  }
  if (size === 0) throw usage(`${o.file} is empty.`)
  if (size > MAX_BYTES) throw usage('A demo is at most 250 MB.')
  const base = { origin: o.origin, key: o.key, fetchImpl: o.fetchImpl, sleep: o.sleep }

  const started = await call(op(listing, 'create_demo_upload'), { ...base, input: { filename: basename(o.file), size_bytes: size } })
  if (started.status >= 400) return started
  const { demo, upload } = started.body
  const fetchImpl = o.fetchImpl ?? fetch
  let put: Response
  try {
    // The upload address carries its own permission: the Outshot key is never sent there.
    put = await fetchImpl(upload.url, {
      method: 'PUT',
      headers: { 'Content-Type': upload.content_type || TYPES[ext] },
      body: readFileSync(o.file),
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    })
  } catch (e) {
    throw new CliError('upload_failed', `The upload didn't go through: ${(e as Error).message}`, EXIT.failed, { demo_id: demo.id })
  }
  if (!put.ok) {
    throw new CliError('upload_failed', `The upload was refused (${put.status}).`, EXIT.failed, { demo_id: demo.id })
  }

  const done = await call(op(listing, 'complete_demo_upload'), { ...base, id: demo.id, input: { cut: Boolean(o.cut) } })
  if (done.status >= 400 || (!o.wait && o.line === undefined)) return done
  const ready = await waitUntilDone(done, listing, o)
  if (ready.status >= 400 || o.line === undefined) return ready
  return call(op(listing, 'set_demo_line'), { ...base, id: demo.id, input: { line: o.line } })
}
