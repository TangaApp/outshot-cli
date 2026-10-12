import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from '../../dist/main.js'

export const SNAPSHOT = JSON.parse(readFileSync(new URL('../../operations.snapshot.json', import.meta.url), 'utf8'))
export const ORIGIN = 'https://api.test'
export const KEY = 'osk_' + 'a'.repeat(43)
export const VIDEO = '3f2b6c1e-8a4d-4e7b-9c1a-2d5e6f7a8b9c'

export const op = (name) => SNAPSHOT.operations.find((o) => o.name === name)

export const reply = (status, body, headers = {}) =>
  new Response(body === undefined ? '' : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

/**
 * A stand-in for the API: the operation list, then `routes` answers ("METHOD /path" → a body,
 * a Response, or a function of the request). Every request is recorded.
 */
export function fakeApi(routes = {}) {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url)
    const method = init.method ?? 'GET'
    const call = { method, path: u.pathname, query: u.search, headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : undefined }
    if (u.pathname === '/v1/operations') return reply(200, SNAPSHOT)
    calls.push(call)
    const answer = routes[`${method} ${u.pathname}`]
    if (answer === undefined) return reply(404, { error: { code: 'not_found', message: 'Not found.' } })
    const value = typeof answer === 'function' ? answer(call, calls) : answer
    return value instanceof Response ? value : reply(200, value)
  }
  return { fetchImpl, calls }
}

/** Runs the command line in-process with a fresh config folder; returns what it printed. */
export async function cli(argv, { env = {}, routes = {}, api, stdin = '', canPrompt = false } = {}) {
  const fake = api ?? fakeApi(routes)
  const out = []
  const err = []
  const configDir = env.OUTSHOT_CONFIG_DIR ?? mkdtempSync(join(tmpdir(), 'outshot-test-'))
  const code = await run(argv, {
    out: (t) => out.push(t),
    err: (t) => err.push(t),
    env: { OUTSHOT_API_URL: ORIGIN, OUTSHOT_CONFIG_DIR: configDir, ...env },
    isTTY: false,
    canPrompt,
    readSecret: async () => stdin,
    fetchImpl: fake.fetchImpl,
    sleep: async () => {},
  }, async () => stdin)
  const parse = (lines) => lines.map((l) => { try { return JSON.parse(l) } catch { return l } })
  return { code, out: parse(out), err: parse(err), text: out.join('\n'), calls: fake.calls, configDir }
}
