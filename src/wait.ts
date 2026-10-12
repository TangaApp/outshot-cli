import { CliError, EXIT } from './errors.js'
import { call, type Reply } from './http.js'
import type { Listing } from './operations.js'

const WORKING_VIDEO = new Set(['being_made', 'being_changed'])
const WORKING_DEMO = new Set(['uploaded', 'normalizing'])

export interface WaitOptions {
  origin: string
  key: string
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  everyMs?: number
  timeoutMs?: number
  now?: () => number
  note?: (message: string) => void
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** What a reply is still working on: a video being made or changed, or a demo being made ready. */
export function pending(body: any): { kind: 'video' | 'demo'; id: string } | null {
  if (body?.video?.id && WORKING_VIDEO.has(body.video.state)) return { kind: 'video', id: body.video.id }
  if (body?.id && WORKING_VIDEO.has(body.state)) return { kind: 'video', id: body.id }
  if (body?.id && WORKING_DEMO.has(body.status)) return { kind: 'demo', id: body.id }
  return null
}

/**
 * Follows a change until it's done: a video with `get_video` until it's ready, a demo with
 * `list_demos` until it's ready or failed. Gives up after 10 minutes, with the last state.
 */
export async function waitUntilDone(reply: Reply, listing: Listing, opts: WaitOptions): Promise<Reply> {
  const target = pending(reply.body)
  if (!target) {
    if (reply.body?.trend_id) {
      opts.note?.('The new video is being made: it shows first in `outshot list-videos` in about half a minute.')
    }
    return reply
  }
  const opName = target.kind === 'video' ? 'get_video' : 'list_demos'
  const op = listing.operations.find((o) => o.name === opName)
  if (!op) return reply
  const sleep = opts.sleep ?? realSleep
  const now = opts.now ?? Date.now
  const every = opts.everyMs ?? 5000
  const end = now() + (opts.timeoutMs ?? 10 * 60 * 1000)
  let last: any = reply.body
  // A change that fails leaves the video as it was, with `change_failed` saying why.
  const failedBefore = (reply.body?.video ?? reply.body)?.change_failed ?? null
  while (now() < end) {
    await sleep(every)
    const r = await call(op, { origin: opts.origin, key: opts.key, id: target.kind === 'video' ? target.id : undefined, fetchImpl: opts.fetchImpl, sleep })
    if (r.status !== 200) return r
    if (target.kind === 'video') {
      last = r.body
      if (WORKING_VIDEO.has(r.body?.state)) continue
      if (r.body?.change_failed && r.body.change_failed !== failedBefore) {
        throw new CliError('change_failed', `The change didn't work, and the video is as it was: ${r.body.change_failed}`, EXIT.failed, { video: r.body })
      }
      return r
    } else {
      last = (r.body?.demos ?? []).find((d: any) => d.id === target.id)
      if (!last) return { status: 404, body: { error: { code: 'not_found', message: 'The demo is gone.' } } }
      if (WORKING_DEMO.has(last.status)) continue
      if (last.status === 'failed') {
        throw new CliError('demo_failed', 'The demo couldn\'t be made ready. Check it plays, and is 5 to 20 seconds long.', EXIT.failed, { demo: last })
      }
      return { status: 200, body: last }
    }
  }
  const minutes = Math.round((opts.timeoutMs ?? 600000) / 60000)
  throw new CliError('still_working', `Still being made after ${minutes} minutes. Check later with \`outshot ${target.kind === 'video' ? `get-video ${target.id}` : 'list-demos'}\`; don't run the change again.`, EXIT.unknown, { last })
}
