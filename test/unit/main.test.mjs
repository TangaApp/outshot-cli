import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { KEY, SNAPSHOT, VIDEO, cli, fakeApi, reply } from './helpers.mjs'

const withKey = { OUTSHOT_API_KEY: KEY }
const commandOf = (o) => o.name.replace(/_/g, '-')

test('every publish operation needs --yes, decided by its scope, and nothing is sent without it', async () => {
  const publish = SNAPSHOT.operations.filter((o) => o.scope === 'publish')
  assert.ok(publish.length >= 2)
  for (const o of publish) {
    const r = await cli([commandOf(o), VIDEO], { env: withKey })
    assert.equal(r.code, 2, o.name)
    assert.match(r.err[0].error.message, /--yes/)
    assert.equal(r.calls.length, 0, `${o.name} sent a request`)
  }
  const kept = await cli(['approve-video', VIDEO, '--yes'], { env: withKey, routes: { [`POST /v1/videos/${VIDEO}/approve`]: { id: VIDEO, state: 'ready' } } })
  assert.deepEqual([kept.code, kept.calls.length], [0, 1])
})

test('no other operation asks for --yes', async () => {
  for (const o of SNAPSHOT.operations.filter((x) => x.scope !== 'publish')) {
    const argv = [commandOf(o), ...(o.path.includes('{id}') ? [VIDEO] : [])]
    const r = await cli(argv, { env: withKey })
    const message = r.err[0]?.error?.message ?? ''
    assert.doesNotMatch(message, /--yes/, o.name)
  }
})

test('each kind of refusal has its exit code', async () => {
  const cases = [[401, 3], [402, 5], [403, 4], [404, 6], [409, 1], [422, 1], [500, 1]]
  for (const [status, exit] of cases) {
    const r = await cli(['get-credits'], { env: withKey, routes: { 'GET /v1/credits': reply(status, { error: { code: `c${status}`, message: 'm' } }) } })
    assert.equal(r.code, exit, `status ${status}`)
    assert.equal(r.err[0].error.code, `c${status}`)
    assert.deepEqual(r.out, [])
  }
})

test('replies are JSON on stdout', async () => {
  const r = await cli(['get-credits'], { env: withKey, routes: { 'GET /v1/credits': { balance: 42 } } })
  assert.deepEqual([r.code, r.out], [0, [{ balance: 42 }]])
})

test('ids are checked, and an id is only taken where the operation has one', async () => {
  assert.equal((await cli(['get-video', 'abc'], { env: withKey })).code, 2)
  assert.equal((await cli(['get-video'], { env: withKey })).code, 2)
  assert.equal((await cli(['get-credits', VIDEO], { env: withKey })).code, 2)
})

test('login checks the key, then saves it for this person only', async () => {
  const routes = { 'GET /v1/brand': (c) => (c.headers.Authorization === `Bearer ${KEY}` ? { product_name: 'GoldMine' } : reply(401, { error: { code: 'invalid_api_key', message: 'no' } })) }
  const r = await cli(['login'], { routes, stdin: `${KEY}\n` })
  assert.equal(r.code, 0)
  assert.deepEqual(r.out[0].brand, 'GoldMine')
  assert.equal(r.out[0].key, `${KEY.slice(0, 12)}…`)
  assert.ok(!r.text.includes(KEY)) // the key itself is never printed
  const file = join(r.configDir, 'config.json')
  assert.equal(statSync(file).mode & 0o777, 0o600)
  assert.equal(statSync(r.configDir).mode & 0o777, 0o700)
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).key, KEY)

  const after = await cli(['whoami'], { env: { OUTSHOT_CONFIG_DIR: r.configDir }, routes })
  assert.deepEqual([after.code, after.out[0].brand, after.out[0].key_from], [0, 'GoldMine', 'saved'])
  assert.ok(!after.text.includes(KEY))

  const out = await cli(['logout'], { env: { OUTSHOT_CONFIG_DIR: r.configDir } })
  assert.deepEqual(out.out[0], { forgotten: true })
  assert.equal((await cli(['whoami'], { env: { OUTSHOT_CONFIG_DIR: r.configDir } })).code, 3)
})

test('login refuses what isn\'t a working key, and saves nothing', async () => {
  const notAKey = await cli(['login'], { stdin: 'hello' })
  assert.equal(notAKey.code, 2)
  const bad = await cli(['login'], { stdin: KEY, routes: { 'GET /v1/brand': reply(401, { error: { code: 'invalid_api_key', message: 'no' } }) } })
  assert.equal(bad.code, 3)
  assert.throws(() => statSync(join(bad.configDir, 'config.json')))
})

test('OUTSHOT_API_KEY is used before the saved key', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'outshot-env-'))
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ key: 'osk_saved' }))
  const r = await cli(['whoami'], { env: { OUTSHOT_CONFIG_DIR: dir, OUTSHOT_API_KEY: KEY }, routes: { 'GET /v1/brand': (c) => ({ product_name: c.headers.Authorization }) } })
  assert.equal(r.out[0].brand, `Bearer ${KEY}`)
  assert.equal(r.out[0].key_from, 'OUTSHOT_API_KEY')
})

test('--wait follows a remake until the video is ready', async () => {
  let polls = 0
  const r = await cli(['regenerate-video', VIDEO, '--wait'], {
    env: withKey,
    routes: {
      [`POST /v1/videos/${VIDEO}/regenerate`]: reply(202, { queued: true, video: { id: VIDEO, state: 'being_changed' } }),
      [`GET /v1/videos/${VIDEO}`]: () => (++polls < 3 ? { id: VIDEO, state: 'being_changed' } : { id: VIDEO, state: 'ready', video_url: 'https://x/v.mp4' }),
    },
  })
  assert.deepEqual([r.code, r.out[0].state, polls], [0, 'ready', 3])
})

test('without --wait a 202 is printed as it is', async () => {
  const r = await cli(['regenerate-video', VIDEO], { env: withKey, routes: { [`POST /v1/videos/${VIDEO}/regenerate`]: reply(202, { queued: true, video: { id: VIDEO, state: 'being_changed' } }) } })
  assert.deepEqual([r.code, r.out[0].queued, r.calls.length], [0, true, 1])
})

test('upload-demo: asks where, uploads there without the key, completes, waits, saves the line', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'outshot-demo-')), 'demo.mp4')
  writeFileSync(file, Buffer.alloc(2048, 1))
  const uploads = []
  const api = fakeApi({
    'POST /v1/demos': reply(201, { demo: { id: VIDEO, status: 'uploaded' }, upload: { url: 'http://storage.test/put/demo.mp4?token=t', content_type: 'video/mp4' } }),
    [`POST /v1/demos/${VIDEO}/complete`]: reply(202, { id: VIDEO, status: 'normalizing' }),
    'GET /v1/demos': (_c, calls) => ({ demos: [{ id: VIDEO, status: calls.filter((x) => x.path === '/v1/demos' && x.method === 'GET').length < 2 ? 'normalizing' : 'ready' }] }),
    [`PATCH /v1/demos/${VIDEO}`]: (c) => ({ id: VIDEO, status: 'ready', label: c.body.line }),
  })
  const fetchImpl = async (url, init) => {
    if (String(url).startsWith('http://storage.test')) {
      uploads.push({ headers: init.headers, size: init.body.length })
      return new Response('', { status: 200 })
    }
    return api.fetchImpl(url, init)
  }
  const r = await cli(['upload-demo', file, '--line', 'Shows the dashboard', '--cut'], { env: withKey, api: { fetchImpl, calls: api.calls } })
  assert.equal(r.code, 0, JSON.stringify(r.err))
  assert.deepEqual(uploads, [{ headers: { 'Content-Type': 'video/mp4' }, size: 2048 }])
  assert.deepEqual(api.calls[0].body, { filename: 'demo.mp4', size_bytes: 2048 })
  assert.deepEqual(api.calls[1].body, { cut: true })
  assert.equal(r.out[0].label, 'Shows the dashboard')
})

test('upload-demo checks the file first', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'outshot-demo-'))
  writeFileSync(join(dir, 'a.gif'), 'x')
  assert.equal((await cli(['upload-demo', join(dir, 'a.gif')], { env: withKey })).code, 2)
  assert.equal((await cli(['upload-demo', join(dir, 'missing.mp4')], { env: withKey })).code, 2)
})

test('help: the overview lists every operation, and one command shows its flags and credits', async () => {
  const all = await cli(['help'])
  for (const o of SNAPSHOT.operations) assert.ok(all.text.includes(commandOf(o)), o.name)
  const one = await cli(['help', 'regenerate-video'])
  assert.match(one.text, /Credits: 8/)
  const yes = await cli(['approve-video', '--help'])
  assert.match(yes.text, /runs only with --yes/)
})

test('an unknown command suggests near ones', async () => {
  const r = await cli(['edit'])
  assert.equal(r.code, 2)
  assert.match(r.err[0].error.message, /edit-video/)
})

test('a key that isn\'t shaped like one is refused, and never repeated', async () => {
  const pasted = `${KEY}\nsomething else`
  const r = await cli(['get-credits'], { env: { OUTSHOT_API_KEY: pasted } })
  assert.equal(r.code, 3)
  assert.equal(r.err[0].error.code, 'invalid_api_key')
  assert.ok(!JSON.stringify(r.err).includes(KEY))
  assert.equal(r.calls.length, 0)
})

test('an error that quotes the key shows only its start', async () => {
  const api = { calls: [], fetchImpl: async (url, init) => {
    if (String(url).endsWith('/v1/operations')) return reply(200, SNAPSHOT)
    throw new Error(`Headers.append: "${init.headers.Authorization}" is an invalid header value.`)
  } }
  const r = await cli(['get-credits'], { env: withKey, api })
  assert.equal(r.code, 1)
  assert.ok(!JSON.stringify(r.err).includes(KEY))
  assert.match(r.err[0].error.message, /osk_aaaaaaaa…/)
})

test('the key only goes over https, or plain http to this computer', async () => {
  const away = await cli(['get-credits'], { env: { ...withKey, OUTSHOT_API_URL: 'http://example.com' } })
  assert.equal(away.code, 2)
  assert.match(away.err[0].error.message, /https/)
  const local = await cli(['--version'], { env: { OUTSHOT_API_URL: 'http://127.0.0.1:8000' } })
  assert.equal(local.code, 0)
})

test('a change that got no answer exits 7: it may have gone through', async () => {
  const api = { calls: [], fetchImpl: async (url) => {
    if (String(url).endsWith('/v1/operations')) return reply(200, SNAPSHOT)
    throw new Error('The operation was aborted due to timeout')
  } }
  const r = await cli(['regenerate-video', VIDEO], { env: withKey, api })
  assert.equal(r.code, 7)
  assert.match(r.err[0].error.message, /check before running it again/)
  const read = await cli(['get-credits'], { env: withKey, api })
  assert.equal(read.code, 1) // a read that got no answer is just a failure
})

test('--wait: a remake that fails exits 1 with change_failed, the video as it was', async () => {
  let polls = 0
  const r = await cli(['regenerate-video', VIDEO, '--wait'], {
    env: withKey,
    routes: {
      [`POST /v1/videos/${VIDEO}/regenerate`]: reply(202, { queued: true, video: { id: VIDEO, state: 'being_changed', change_failed: null } }),
      [`GET /v1/videos/${VIDEO}`]: () => (++polls < 2 ? { id: VIDEO, state: 'being_changed' } : { id: VIDEO, state: 'ready', change_failed: 'Your video is unchanged.' }),
    },
  })
  assert.equal(r.code, 1)
  assert.equal(r.err[0].error.code, 'change_failed')
  assert.equal(r.err[0].error.video.state, 'ready')
  assert.deepEqual(r.out, [])
})

test('--wait gives up after 10 minutes with exit 7, never a success', async () => {
  const { fetchImpl, calls } = fakeApi({
    [`POST /v1/videos/${VIDEO}/regenerate`]: reply(202, { queued: true, video: { id: VIDEO, state: 'being_changed' } }),
    [`GET /v1/videos/${VIDEO}`]: () => ({ id: VIDEO, state: 'being_changed' }),
  })
  const { waitUntilDone } = await import('../../dist/wait.js')
  let clock = 0
  const first = await (await fetchImpl(`https://api.test/v1/videos/${VIDEO}/regenerate`, { method: 'POST' })).json()
  await assert.rejects(
    waitUntilDone({ status: 202, body: first }, SNAPSHOT, { origin: 'https://api.test', key: KEY, fetchImpl, sleep: async (ms) => { clock += ms }, now: () => clock }),
    (e) => e.code === 'still_working' && e.exit === 7,
  )
  assert.ok(calls.length > 100)
})

test('upload-demo: a demo that fails exits 1 and its line is not sent', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'outshot-demo-')), 'demo.mov')
  writeFileSync(file, Buffer.alloc(64, 1))
  const api = fakeApi({
    'POST /v1/demos': reply(201, { demo: { id: VIDEO, status: 'uploaded' }, upload: { url: 'https://storage.test/put', content_type: 'video/quicktime' } }),
    [`POST /v1/demos/${VIDEO}/complete`]: reply(202, { id: VIDEO, status: 'normalizing' }),
    'GET /v1/demos': { demos: [{ id: VIDEO, status: 'failed' }] },
  })
  const fetchImpl = async (url, init) => (String(url).startsWith('https://storage.test') ? new Response('', { status: 200 }) : api.fetchImpl(url, init))
  const r = await cli(['upload-demo', file, '--line', 'x'], { env: withKey, api: { fetchImpl, calls: api.calls } })
  assert.deepEqual([r.code, r.err[0].error.code], [1, 'demo_failed'])
  assert.ok(!api.calls.some((c) => c.method === 'PATCH'))
})

test('upload-demo usage mistakes are JSON errors on stderr', async () => {
  for (const argv of [['upload-demo'], ['upload-demo', 'a.mp4', 'b.mp4'], ['upload-demo', 'a.mp4', '--line'], ['upload-demo', 'a.mp4', '--line', 'a', '--line', 'b']]) {
    const r = await cli(argv, { env: withKey })
    assert.equal(r.code, 2, argv.join(' '))
    assert.equal(r.err[0].error.code, 'usage')
    assert.deepEqual(r.out, [])
  }
  const help = await cli(['help', 'upload-demo'])
  assert.match(help.text, /^outshot upload-demo <file>/)
})

test('--json is checked: a missing file, a bare --json, and fields the command doesn\'t take', async () => {
  const missing = await cli(['update-brand', '--json', '@/nope/brand.json'], { env: withKey })
  assert.deepEqual([missing.code, missing.err[0].error.code], [2, 'usage'])
  assert.equal((await cli(['edit-video', VIDEO, '--json'], { env: withKey })).code, 2)
  const stray = await cli(['list-trends', '--json', '{"key":"osk_x"}'], { env: withKey })
  assert.equal(stray.code, 2)
  assert.equal(stray.calls.length, 0)
  assert.equal((await cli(['list-calendar', '--past-days', '0x10'], { env: withKey })).code, 2)
})
