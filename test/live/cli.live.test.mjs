/**
 * Live: the `outshot` command, run for real against an Outshot API, with real keys of a
 * throwaway account. Run through the API's helper, which makes the account and its keys and
 * deletes them afterwards:
 *
 *   python scripts/outshot_with_throwaway_key.py -- npm run test:live   (in the API's repository)
 *
 * It needs OUTSHOT_API_URL, OUTSHOT_API_KEY (can do everything) and OUTSHOT_READ_KEY. Nothing
 * is ever posted: the throwaway brand has no TikTok connected. Every step is written to
 * test/live/outputs/cli-live.json; test/live/results.md summarises a run.
 */
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const { OUTSHOT_API_URL: API, OUTSHOT_API_KEY: KEY, OUTSHOT_READ_KEY: READ_KEY } = process.env
const CLI = new URL('../../dist/cli.js', import.meta.url).pathname
const OUT = new URL('./outputs/', import.meta.url).pathname
const timeline = []
const t0 = Date.now()

/** Runs `outshot …` as a person or an agent would, in its own process. */
function outshot(args, { key = KEY, stdin, configDir } = {}) {
  const env = { ...process.env, OUTSHOT_API_URL: API, OUTSHOT_CONFIG_DIR: configDir ?? mkdtempSync(join(tmpdir(), 'outshot-live-')) }
  delete env.OUTSHOT_READ_KEY
  if (key) env.OUTSHOT_API_KEY = key
  else delete env.OUTSHOT_API_KEY
  const r = spawnSync('node', [CLI, ...args], { env, input: stdin ?? '', encoding: 'utf8', timeout: 15 * 60 * 1000 })
  const parse = (s) => { try { return JSON.parse(s) } catch { return s.trim() } }
  const result = { code: r.status, out: r.stdout.trim() ? parse(r.stdout) : null, err: r.stderr.trim() ? parse(r.stderr) : null }
  const shown = args.map((a) => (a === KEY || a === READ_KEY ? 'osk_…' : a))
  timeline.push({ t: Math.round((Date.now() - t0) / 1000), command: `outshot ${shown.join(' ')}`, ...result })
  return result
}

const balance = () => outshot(['get-credits']).out.balance
const save = () => {
  mkdirSync(OUT, { recursive: true })
  writeFileSync(join(OUT, 'cli-live.json'), JSON.stringify({ api: API, timeline }, null, 2))
}
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000))
const dayAhead = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)

test('a person or an agent runs Outshot from the command line', { skip: !API || !KEY || !READ_KEY }, async () => {
  try {
    // Sign in with the key from stdin, as `outshot login` reads it when piped.
    const home = mkdtempSync(join(tmpdir(), 'outshot-home-'))
    const login = outshot(['login'], { key: null, stdin: `${KEY}\n`, configDir: home })
    assert.equal(login.code, 0, JSON.stringify(login.err))
    assert.ok(!JSON.stringify(login).includes(KEY))
    const who = outshot(['whoami'], { key: null, configDir: home })
    assert.deepEqual([who.code, who.out.key_from], [0, 'saved'])

    // Credits are only counted once the first videos are all made.
    let listing
    for (let i = 0; i < 120; i++) {
      listing = outshot(['list-videos'])
      assert.equal(listing.code, 0)
      const { videos, target } = listing.out
      if (videos.length >= target && videos.every((v) => v.state === 'ready')) break
      await sleep(10)
    }
    const start = balance()
    const ready = listing.out.videos.filter((v) => v.state === 'ready')
    assert.ok(ready.length >= 1, 'a ready video')
    const [first] = ready

    // A caption edit is free and immediate.
    const caption = outshot(['edit-video', first.id, '--caption', 'Made from the command line', '--hashtags', 'outshot', '--hashtags', 'cli'])
    assert.equal(caption.code, 0, JSON.stringify(caption.err))
    assert.equal(caption.out.video.caption, 'Made from the command line')
    assert.equal(balance(), start)

    // A remake costs 8 and is followed until it's ready.
    const remake = outshot(['regenerate-video', first.id, '--wait'])
    assert.equal(remake.code, 0, JSON.stringify(remake.err))
    assert.equal(remake.out.state, 'ready')
    assert.equal(balance(), start - 8)

    // Skip, then take it back.
    const other = outshot(['list-videos']).out.videos.find((v) => v.state === 'ready' && v.id !== first.id)
    if (other) {
      assert.equal(outshot(['skip-video', other.id]).code, 0)
      assert.equal(outshot(['undo-video', other.id]).code, 0)
    }

    // Keeping it needs --yes; with it, it goes to the Calendar (no TikTok here, so to post by hand).
    const refused = outshot(['approve-video', first.id])
    assert.equal(refused.code, 2)
    const kept = outshot(['approve-video', first.id, '--yes'])
    assert.equal(kept.code, 0, JSON.stringify(kept.err))

    const content = outshot(['list-content'])
    assert.equal(content.code, 0)
    assert.ok(JSON.stringify(content.out).includes(first.id))
    const posting = outshot(['update-posting', '--time', '18:30'])
    assert.equal(posting.code, 0, JSON.stringify(posting.err))
    assert.equal(posting.out.time, '18:30')
    const placed = outshot(['place-video', first.id, '--day', dayAhead(9), '--yes'])
    assert.equal(placed.code, 0, JSON.stringify(placed.err))

    // Posting now needs TikTok: the plain refusal, nothing sent anywhere.
    const now = outshot(['post-video-now', first.id, '--yes'])
    assert.equal(now.code, 1)
    assert.equal(now.err.error.code, 'tiktok_not_connected')

    // A video from a trend in the Library.
    const trends = outshot(['list-trends'])
    assert.equal(trends.code, 0)
    const trend = trends.out.items.find((t) => t.makes)
    assert.ok(trend, 'a trend that makes a video')
    const before = balance()
    const ids = new Set(outshot(['list-videos']).out.videos.map((v) => v.id))
    const made = outshot(['make-video-from-trend', trend.id])
    assert.equal(made.code, 0, JSON.stringify(made.err))
    let fresh
    for (let i = 0; i < 36 && !fresh; i++) {
      await sleep(5)
      fresh = outshot(['list-videos']).out.videos.find((v) => !ids.has(v.id))
    }
    assert.ok(fresh, 'the new video shows in list-videos')
    // Its credits are taken as it's made (listing the videos may also top the deck up).
    assert.ok(balance() <= before - made.out.credits)

    // A product demo, uploaded and ready, with its line.
    const clip = join(mkdtempSync(join(tmpdir(), 'outshot-clip-')), 'demo.mp4')
    execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=720x1280:rate=30', '-t', '8', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', clip])
    const demo = outshot(['upload-demo', clip, '--line', 'Shows the dashboard filling up'])
    assert.equal(demo.code, 0, JSON.stringify(demo.err))
    assert.equal(demo.out.label, 'Shows the dashboard filling up')

    // Refusals, each with its exit code.
    const readOnly = outshot(['edit-video', first.id, '--caption', 'x'], { key: READ_KEY })
    assert.deepEqual([readOnly.code, readOnly.err.error.code], [4, 'insufficient_scope'])
    assert.equal(outshot(['get-video', '00000000-0000-4000-8000-000000000000']).code, 6)
    const wrongKey = outshot(['get-credits'], { key: 'osk_' + 'x'.repeat(43) })
    assert.deepEqual([wrongKey.code, wrongKey.err.error.code], [3, 'invalid_api_key'])

    timeline.push({ balances: { start, end: balance() } })
  } finally {
    save()
  }
})
