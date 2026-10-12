import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { flagsFor, inputFor, parseArgs } from '../../dist/flags.js'
import { SNAPSHOT, op } from './helpers.mjs'

const input = (name, argv, booleans = []) => inputFor(op(name), parseArgs(argv, new Set(['yes', 'wait', 'help', ...booleans])))
const refused = (fn, pattern) => assert.throws(fn, (e) => e.code === 'usage' && e.exit === 2 && pattern.test(e.message))

test('every operation the API lists gets its flags', () => {
  assert.ok(SNAPSHOT.operations.length >= 20)
  for (const o of SNAPSHOT.operations) {
    const flags = flagsFor(o)
    const props = Object.keys(o.input_schema?.properties ?? {})
    assert.deepEqual(flags.map((f) => f.prop), props, o.name)
    for (const f of flags) assert.ok(['string', 'integer', 'number', 'boolean', 'list', 'json'].includes(f.kind), `${o.name} ${f.prop}`)
  }
})

test('schema shapes become the right kind of flag', () => {
  const kinds = (name) => Object.fromEntries(flagsFor(op(name)).map((f) => [f.prop, f]))
  const brand = kinds('update_brand')
  assert.equal(brand.answers.kind, 'json') // an object, through $ref
  assert.equal(brand.pillars.kind, 'json') // a list of objects
  const edit = kinds('edit_video')
  assert.equal(edit.caption.kind, 'string')
  assert.equal(edit.caption.maxLength, 2200)
  assert.equal(edit.hashtags.kind, 'list')
  assert.equal(edit.hook_text.flag, 'hook-text')
  const days = kinds('set_posting_days').days
  assert.equal(days.kind, 'list')
  assert.deepEqual(days.choices, ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])
  assert.equal(days.required, true)
  const range = kinds('list_calendar').past_days
  assert.deepEqual([range.kind, range.minimum, range.maximum], ['integer', 0, 730])
  assert.equal(kinds('answer_missed').posted.kind, 'boolean')
  assert.equal(kinds('answer_missed').posted.required, true)
  assert.ok(kinds('place_video').day.pattern)
})

test('flags turn into the input', () => {
  assert.deepEqual(input('edit_video', ['--caption', 'Hi, you', '--hashtags', 'saas', '--hashtags', 'ai']), { caption: 'Hi, you', hashtags: ['saas', 'ai'] })
  assert.deepEqual(input('edit_video', ['--caption=a=b']), { caption: 'a=b' })
  assert.deepEqual(input('list_calendar', ['--past-days', '90']), { past_days: 90 })
  assert.deepEqual(input('set_posting_days', ['--days', 'mon', '--days', 'fri']), { days: ['mon', 'fri'] })
  assert.deepEqual(input('answer_missed', ['--posted', 'false'], ['posted']), { posted: false })
  assert.deepEqual(input('complete_demo_upload', ['--cut'], ['cut']), { cut: true })
  assert.deepEqual(input('complete_demo_upload', []), {}) // optional body: sent as {}
  assert.deepEqual(input('place_video', ['--day', '2026-10-20', '--swap'], ['swap']), { day: '2026-10-20', swap: true })
  assert.equal(input('regenerate_video', []), null) // takes no input at all
})

test('--json gives nested input, and flags go on top of it', () => {
  assert.deepEqual(input('update_brand', ['--answers', '{"tone":"calm"}']), { answers: { tone: 'calm' } })
  assert.deepEqual(input('edit_video', ['--json', '{"caption":"a","hashtags":["x"]}', '--caption', 'b']), { caption: 'b', hashtags: ['x'] })
  const file = join(mkdtempSync(join(tmpdir(), 'outshot-json-')), 'brand.json')
  writeFileSync(file, '{"answers":{"goal":"sales"}}')
  assert.deepEqual(input('update_brand', ['--json', `@${file}`]), { answers: { goal: 'sales' } })
})

test('wrong input is refused before anything is sent', () => {
  refused(() => input('edit_video', ['--captoin', 'x']), /isn't a flag of edit-video.*--caption/)
  refused(() => input('edit_video', ['--key', 'osk_x']), /never given on the command line/)
  refused(() => input('edit_video', ['--token', 'x']), /never given on the command line/)
  refused(() => input('set_posting_days', ['--days', 'monday']), /Not: monday/)
  refused(() => input('set_posting_days', []), /Missing --days/)
  refused(() => input('list_calendar', ['--past-days', '9999']), /at most 730/)
  refused(() => input('list_calendar', ['--past-days', '1.5']), /whole number/)
  refused(() => input('place_video', ['--day', 'tomorrow']), /doesn't look right/)
  refused(() => input('answer_missed', ['--posted=maybe'], ['posted']), /true or false/)
  refused(() => input('edit_video', ['--caption', 'a', '--caption', 'b']), /more than once/)
  refused(() => input('edit_video', ['--caption']), /needs a value/)
  refused(() => input('edit_video', ['--json', '[1]']), /is an object/)
  refused(() => input('edit_video', ['--json', '{nope']), /isn't valid JSON/)
  refused(() => input('regenerate_video', ['--json', '{}']), /takes no input/)
  refused(() => input('edit_video', ['--caption', 'x'.repeat(2201)]), /at most 2200 characters/)
})

test('a flag never takes the next flag as its value', () => {
  const parsed = parseArgs(['--caption', '--wait'], new Set(['wait']))
  assert.ok(parsed.bare.has('caption'))
  assert.ok(parsed.bare.has('wait'))
  const yes = parseArgs(['--yes', '3f2b6c1e-8a4d-4e7b-9c1a-2d5e6f7a8b9c'], new Set(['yes']))
  assert.deepEqual(yes.positionals, ['3f2b6c1e-8a4d-4e7b-9c1a-2d5e6f7a8b9c']) // the id stays the id
})
