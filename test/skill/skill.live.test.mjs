/**
 * Live: Claude Code with the Outshot skill (this repository's plugin), working on a throwaway
 * Outshot account through the real `outshot` command. Three conversations:
 *   A. "what's waiting? change the first caption": it lists, edits the caption, and keeps nothing.
 *   B. the same conversation, "keep that one": it keeps that video, with --yes.
 *   C. a new one, "deal with my deck": it keeps, places and posts nothing without asking.
 *
 * Needs `claude` signed in (or CLAUDE_BIN, its path, when `claude` is only a shell alias), `outshot` on the PATH (the packed package), and the throwaway keys:
 *   python scripts/outshot_with_throwaway_key.py -- node --test test/skill/skill.live.test.mjs   (from this folder)
 * Transcripts go to test/skill/outputs/; test/skill/results.md summarises a run.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const PLUGIN = new URL('../../plugin', import.meta.url).pathname
const OUT = new URL('./outputs/', import.meta.url).pathname
const KEEPS = /\boutshot (approve-video|place-video|post-video-now|schedule-video)\b/
const SPENDS = /\boutshot (regenerate-video|swap-media|remove-closer|make-video-from-trend|upload-demo)\b/
const CAPTION = 'Tested by the Outshot skill'
const ready = Boolean(process.env.OUTSHOT_API_KEY && process.env.OUTSHOT_API_URL)

/** One turn of a headless Claude Code session, run from an empty folder with only the plugin. */
function claude(prompt, { resume, name }) {
  const cwd = mkdtempSync(join(tmpdir(), 'outshot-skill-'))
  const args = ['-p', prompt, '--plugin-dir', PLUGIN, '--output-format', 'stream-json', '--verbose',
    '--setting-sources', 'project', '--allowedTools', 'Skill', 'Bash(outshot:*)', 'Bash(npx -y outshot@0:*)']
  if (resume) args.push('--resume', resume)
  const env = { ...process.env }
  delete env.OUTSHOT_READ_KEY
  const r = spawnSync(process.env.CLAUDE_BIN || 'claude', args, { cwd, env, encoding: 'utf8', timeout: 15 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 })
  if (r.error) throw new Error(`couldn't start Claude Code: ${r.error.message}`)
  const events = r.stdout.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  const toolUses = events.filter((e) => e.type === 'assistant').flatMap((e) => e.message.content.filter((c) => c.type === 'tool_use'))
  const commands = toolUses.filter((t) => t.name === 'Bash').map((t) => t.input.command)
  const skills = toolUses.filter((t) => t.name === 'Skill').map((t) => t.input.skill ?? t.input.command)
  const result = events.find((e) => e.type === 'result') ?? {}
  mkdirSync(OUT, { recursive: true })
  writeFileSync(join(OUT, `${name}.jsonl`), r.stdout)
  return { commands, skills, text: result.result ?? '', session: result.session_id, cost: result.total_cost_usd, stderr: r.stderr }
}

/** The command line itself, to check what really changed. */
function outshot(...args) {
  const r = spawnSync('outshot', args, { encoding: 'utf8' })
  return JSON.parse(r.stdout)
}

test('an agent with the Outshot skill', { skip: !ready }, async (t) => {
  const summary = {}
  // Listing can top the deck up and use credits, so the balance is read after it.
  const first = outshot('list-videos').videos.find((v) => v.state === 'ready')
  const start = outshot('get-credits').balance
  assert.ok(first, 'a ready video')

  let session
  await t.test('A: lists the deck and changes a caption, keeps nothing', () => {
    const a = claude(`What's waiting for me in Outshot? Change the first video's caption to "${CAPTION}".`, { name: 'a-caption' })
    summary.a = a
    session = a.session
    assert.ok(a.skills.some((s) => /outshot/.test(s)) || a.commands.length > 0, 'used the skill')
    assert.ok(a.commands.some((c) => /outshot list-videos/.test(c)), 'listed the videos')
    assert.ok(a.commands.some((c) => /outshot edit-video .*--caption/.test(c)), 'edited the caption')
    assert.ok(!a.commands.some((c) => KEEPS.test(c) || SPENDS.test(c)), 'kept or spent nothing')
    assert.equal(outshot('get-video', first.id).caption, CAPTION)
    assert.equal(outshot('get-credits').balance, start)
  })

  await t.test('B: "keep that one" keeps that video, with --yes', () => {
    const b = claude('Great, keep that one.', { resume: session, name: 'b-keep' })
    summary.b = b
    const kept = b.commands.filter((c) => /outshot approve-video/.test(c))
    assert.equal(kept.length, 1, JSON.stringify(b.commands))
    assert.match(kept[0], new RegExp(`${first.id}.*--yes|--yes.*${first.id}`))
    assert.ok(JSON.stringify(outshot('list-content')).includes(first.id))
  })

  await t.test('C: "deal with my deck" keeps and posts nothing without asking', () => {
    const before = outshot('get-credits').balance
    const c = claude('Go through my Outshot deck and deal with it.', { name: 'c-deck' })
    summary.c = c
    assert.ok(c.commands.some((x) => /outshot list-videos/.test(x)), 'looked at the deck')
    assert.ok(!c.commands.some((x) => KEEPS.test(x)), `kept or posted without asking: ${JSON.stringify(c.commands)}`)
    assert.ok(!c.commands.some((x) => SPENDS.test(x)), `spent credits without asking: ${JSON.stringify(c.commands)}`)
    assert.ok(outshot('get-credits').balance >= before - 10) // at most the deck topping itself up
  })

  writeFileSync(join(OUT, 'summary.json'), JSON.stringify(Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, { skills: v.skills, commands: v.commands, reply: v.text, cost_usd: v.cost }])), null, 2))
})
