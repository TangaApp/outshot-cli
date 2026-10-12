import assert from 'node:assert/strict'
import { test } from 'node:test'
import { call, urlFor } from '../../dist/http.js'
import { KEY, ORIGIN, VIDEO, fakeApi, op, reply } from './helpers.mjs'

test('addresses are the origin plus the path, which already holds /v1', () => {
  assert.equal(urlFor(op('get_brand'), ORIGIN), `${ORIGIN}/v1/brand`)
  assert.equal(urlFor(op('edit_video'), ORIGIN, VIDEO), `${ORIGIN}/v1/videos/${VIDEO}/edit`)
  assert.equal(urlFor(op('list_calendar'), ORIGIN, undefined, { past_days: 90 }), `${ORIGIN}/v1/calendar?past_days=90`)
  assert.throws(() => urlFor(op('get_video'), ORIGIN), /needs an id/)
})

test('the key goes in the Authorization header; bodies only where the API takes input', async () => {
  const api = fakeApi({
    [`POST /v1/videos/${VIDEO}/regenerate`]: { queued: true },
    [`POST /v1/demos/${VIDEO}/complete`]: { id: VIDEO, status: 'normalizing' },
    [`POST /v1/videos/${VIDEO}/edit`]: { queued: false },
  })
  await call(op('regenerate_video'), { origin: ORIGIN, key: KEY, id: VIDEO, input: null, fetchImpl: api.fetchImpl })
  await call(op('complete_demo_upload'), { origin: ORIGIN, key: KEY, id: VIDEO, input: {}, fetchImpl: api.fetchImpl })
  await call(op('edit_video'), { origin: ORIGIN, key: KEY, id: VIDEO, input: { caption: 'x' }, fetchImpl: api.fetchImpl })
  const [regen, complete, edit] = api.calls
  assert.equal(regen.headers.Authorization, `Bearer ${KEY}`)
  assert.match(regen.headers['User-Agent'], /^outshot-cli\//)
  assert.equal(regen.body, undefined)
  assert.deepEqual(complete.body, {})
  assert.deepEqual(edit.body, { caption: 'x' })
  assert.equal(edit.query, '') // the key is never in the address
})

test('a 429 is waited out once, for its Retry-After', async () => {
  const waits = []
  const api = fakeApi({
    'GET /v1/credits': (_c, calls) => (calls.length === 1 ? reply(429, { error: { code: 'rate_limited' } }, { 'retry-after': '7' }) : { balance: 40 }),
  })
  const r = await call(op('get_credits'), { origin: ORIGIN, key: KEY, fetchImpl: api.fetchImpl, sleep: async (ms) => waits.push(ms) })
  assert.deepEqual([r.status, r.body.balance, waits, api.calls.length], [200, 40, [7000], 2])
})

test('a second 429 is handed back', async () => {
  const api = fakeApi({ 'GET /v1/credits': () => reply(429, { error: { code: 'rate_limited' } }, { 'retry-after': '1' }) })
  const r = await call(op('get_credits'), { origin: ORIGIN, key: KEY, fetchImpl: api.fetchImpl, sleep: async () => {} })
  assert.deepEqual([r.status, api.calls.length], [429, 2])
})

test('an unreachable API is a plain error', async () => {
  await assert.rejects(
    call(op('get_credits'), { origin: ORIGIN, key: KEY, fetchImpl: async () => { throw new Error('connect ECONNREFUSED') } }),
    (e) => e.code === 'unreachable' && /ECONNREFUSED/.test(e.message),
  )
})
