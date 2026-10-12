import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { CACHE_MS, loadListing } from '../../dist/operations.js'
import { ORIGIN, SNAPSHOT, reply } from './helpers.mjs'

const fresh = () => ({ OUTSHOT_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'outshot-ops-')) })
const live = { ...SNAPSHOT, operations: SNAPSHOT.operations.slice(0, 3) }
const counting = (answer) => {
  const f = async () => { f.calls++; return typeof answer === 'function' ? answer() : answer }
  f.calls = 0
  return f
}

test('fetched live, then cached for 5 minutes, then fetched again', async () => {
  const env = fresh()
  const fetchImpl = counting(() => reply(200, live))
  const first = await loadListing(ORIGIN, { fetchImpl, env, now: 1000 })
  const second = await loadListing(ORIGIN, { fetchImpl, env, now: 1000 + CACHE_MS - 1 })
  const third = await loadListing(ORIGIN, { fetchImpl, env, now: 1000 + CACHE_MS + 1 })
  assert.deepEqual([first.source, second.source, third.source, fetchImpl.calls], ['live', 'cache', 'live', 2])
  assert.equal(second.listing.operations.length, 3)
})

test('the API down: an old cached copy, else the copy bundled with the package', async () => {
  const env = fresh()
  await loadListing(ORIGIN, { fetchImpl: counting(reply(200, live)), env, now: 0 })
  const down = counting(() => { throw new Error('offline') })
  const stale = await loadListing(ORIGIN, { fetchImpl: down, env, now: CACHE_MS * 10 })
  assert.deepEqual([stale.source, stale.listing.operations.length], ['cache', 3])
  const bundled = await loadListing(ORIGIN, { fetchImpl: down, env: fresh(), now: 0 })
  assert.deepEqual([bundled.source, bundled.listing.operations.length], ['bundled', SNAPSHOT.operations.length])
  const broken = await loadListing(ORIGIN, { fetchImpl: counting(reply(500, {})), env: fresh(), now: 0 })
  assert.equal(broken.source, 'bundled')
})

test('a cache made for another API is not used', async () => {
  const env = fresh()
  await loadListing('https://other.test', { fetchImpl: counting(reply(200, live)), env, now: 0 })
  const fetchImpl = counting(reply(200, SNAPSHOT))
  const r = await loadListing(ORIGIN, { fetchImpl, env, now: 1 })
  assert.deepEqual([r.source, fetchImpl.calls], ['live', 1])
})
