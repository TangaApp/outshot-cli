import { apiOrigin, keyPrefix, looksLikeKey, readKey, removeKey, saveKey } from './config.js'
import { CliError, EXIT, exitFor, usage } from './errors.js'
import { flagsFor, inputFor, parseArgs, type Flag } from './flags.js'
import { call, type Reply } from './http.js'
import { commandName, findOperation, loadListing, needsYes, takesId, type Listing, type Operation } from './operations.js'
import { uploadDemo } from './upload.js'
import { VERSION } from './version.js'
import { waitUntilDone } from './wait.js'

export interface Io {
  out: (text: string) => void
  err: (text: string) => void
  env: NodeJS.ProcessEnv
  isTTY: boolean // stdout is a terminal: indent the JSON
  canPrompt: boolean // stdin is a terminal: ask for the key
  readSecret: (prompt: string) => Promise<string>
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

const MAKE_KEY = 'https://outshot.ai/app/api'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const BUILT_IN = ['login', 'logout', 'whoami', 'costs', 'upload-demo', 'help'] as const

const BUILT_IN_HELP: Record<string, string> = {
  login: `outshot login\n\nAsks for your key (make one at ${MAKE_KEY}), checks it, and saves it where only you can read it.\nPiped in, it reads the key from stdin. OUTSHOT_API_KEY, when set, is used before the saved key.`,
  logout: 'outshot logout\n\nForgets the saved key.',
  whoami: 'outshot whoami\n\nThe brand your key works on, the start of the key, and where it came from.',
  costs: 'outshot costs\n\nWhat each change uses, in credits.',
  'upload-demo': 'outshot upload-demo <file> [--line <text>] [--cut] [--wait]\n\nUploads a 5–20 second product demo (.mp4, .mov or .webm, up to 250 MB) and gets it ready.\n  --line   what the demo shows (Demo videos follow it); waits for the demo to be ready first\n  --cut    trim the dead time at the start and end\n  --wait   follow the demo until it\'s ready',
}

const SCOPE_TITLE: Record<Operation['scope'], string> = {
  read: 'See (any key)',
  write: 'Change (a key that can make changes; some use credits)',
  publish: 'Keep and post (a key that can keep videos; posts to TikTok, needs --yes)',
}

function print(io: Io, body: unknown) {
  io.out(io.isTTY ? JSON.stringify(body, null, 2) : JSON.stringify(body))
}

function printError(io: Io, body: unknown) {
  io.err(JSON.stringify(body))
}

/** Prints an API reply: the JSON on stdout, or its error on stderr. Returns the exit code. */
function finish(io: Io, reply: Reply): number {
  if (reply.status >= 400) {
    const body = reply.body?.error ? reply.body : { error: { code: 'failed', message: `The API answered ${reply.status}.` } }
    printError(io, body)
    return exitFor(reply.status)
  }
  print(io, reply.body)
  return EXIT.ok
}

function requireKey(io: Io): { key: string; source: string } {
  const found = readKey(io.env)
  if (!found) {
    throw new CliError('not_signed_in', `No key yet. Make one at ${MAKE_KEY}, then run \`outshot login\` (or set OUTSHOT_API_KEY).`, EXIT.signedOut)
  }
  return found
}

/** The summary's first sentence, shortened at a word to fit one line of the overview. */
const firstSentence = (text: string, max = 90) => {
  const cut = text.search(/\.(\s|$)/)
  const sentence = cut === -1 ? text : text.slice(0, cut + 1)
  if (sentence.length <= max) return sentence
  return sentence.slice(0, sentence.lastIndexOf(' ', max - 1)).replace(/[,:;(]$/, '') + '…'
}

function costNote(op: Operation): string {
  return op.credits ? `${op.credits} credit${op.credits === '1' ? '' : 's'}` : ''
}

function flagLine(f: Flag): string {
  const value = f.kind === 'boolean' ? ' [true|false]'
    : f.kind === 'list' ? ` <${f.choices ? f.choices.join('|') : 'text'}> (repeat for more)`
    : f.kind === 'json' ? ' <json>'
    : f.choices ? ` <${f.choices.join('|')}>`
    : f.kind === 'string' ? ' <text>' : ' <number>'
  const range = f.minimum !== undefined || f.maximum !== undefined ? ` (${f.minimum ?? ''}–${f.maximum ?? ''})` : ''
  return `  --${f.flag}${value}${f.required ? ' (required)' : ''}${range}${f.description ? `\n      ${f.description}` : ''}`
}

function usageLine(op: Operation): string {
  const id = takesId(op) ? ` <${op.id ?? 'id'}>` : ''
  return `outshot ${commandName(op)}${id}${needsYes(op) ? ' --yes' : ''}`
}

function opHelp(op: Operation): string {
  const flags = flagsFor(op)
  const lines = [
    usageLine(op) + (flags.length ? ' [flags]' : ''),
    '',
    op.summary,
    '',
    `Key needed: ${op.scope === 'read' ? 'any key' : op.scope === 'write' ? 'one that can make changes' : 'one that can keep videos'}`,
  ]
  if (op.credits) lines.push(`Credits: ${op.credits}`)
  if (needsYes(op)) lines.push('Posts to the real TikTok (or puts the video on the Calendar): runs only with --yes.')
  if (flags.length) lines.push('', 'Flags:', ...flags.map(flagLine), '  --json <object|@file>  the whole input as JSON (flags are applied on top)')
  lines.push('  --wait   when the reply says a video or demo is being made, follow it until it\'s ready')
  return lines.join('\n')
}

function generalHelp(listing: Listing): string {
  const lines = [
    `outshot ${VERSION}: Outshot from the command line.`,
    '',
    'Usage: outshot <command> [id] [flags]      Replies are JSON. Help for one command: outshot help <command>',
    '',
    'Start',
    `  login          save your key (make one at ${MAKE_KEY})`,
    '  whoami         the brand your key works on',
    '  costs          what each change uses, in credits',
    '  logout         forget the saved key',
  ]
  for (const scope of ['read', 'write', 'publish'] as const) {
    lines.push('', SCOPE_TITLE[scope])
    for (const op of listing.operations.filter((o) => o.scope === scope)) {
      const head = `  ${commandName(op)}${takesId(op) ? ' <id>' : ''}`
      const cost = costNote(op)
      lines.push(`${head.padEnd(30)} ${firstSentence(op.summary)}${cost ? ` (${cost})` : ''}`)
    }
    if (scope === 'write') lines.push(`${'  upload-demo <file>'.padEnd(30)} Upload a 5–20 s product demo, start to finish. Flags: --line, --cut, --wait.`)
  }
  lines.push('', 'Exit codes: 0 ok, 1 failed, 2 wrong usage, 3 no key or a bad one, 4 the key can\'t do this, 5 out of credits, 6 not found,', '7 no answer yet (it may have gone through: check before running it again).')
  return lines.join('\n')
}

async function login(io: Io, origin: string, listing: Listing, stdinKey: () => Promise<string>): Promise<number> {
  const key = (io.canPrompt ? await io.readSecret(`Paste your Outshot key (make one at ${MAKE_KEY}): `) : await stdinKey()).trim()
  if (!looksLikeKey(key)) throw usage('That doesn\'t look like an Outshot key: they start with osk_.')
  const getBrand = listing.operations.find((o) => o.name === 'get_brand')!
  const r = await call(getBrand, { origin, key, fetchImpl: io.fetchImpl, sleep: io.sleep })
  if (r.status >= 400) return finish(io, r)
  const file = saveKey(key, io.env)
  print(io, { saved: true, brand: r.body.product_name, key: keyPrefix(key), file, api: origin })
  if (io.env.OUTSHOT_API_KEY) io.err('Note: OUTSHOT_API_KEY is set, and it is used before the saved key.')
  return EXIT.ok
}

async function runOperation(io: Io, origin: string, listing: Listing, op: Operation, args: string[]): Promise<number> {
  const parsed = parseArgs(args, new Set(['yes', 'wait', 'help', ...flagsFor(op).filter((f) => f.kind === 'boolean').map((f) => f.flag)]))
  if (parsed.bare.has('help')) {
    io.out(opHelp(op))
    return EXIT.ok
  }
  const input = inputFor(op, parsed)
  let id: string | undefined
  if (takesId(op)) {
    if (parsed.positionals.length !== 1) throw usage(`Usage: ${usageLine(op)}`)
    id = parsed.positionals[0]
    if (!UUID.test(id)) throw usage(`"${id}" isn't an id: ids look like 3f2b6c1e-8a4d-4e7b-9c1a-2d5e6f7a8b9c.`)
  } else if (parsed.positionals.length) {
    throw usage(`${commandName(op)} takes no id. Usage: ${usageLine(op)}`)
  }
  if (needsYes(op) && !parsed.bare.has('yes') && parsed.values.get('yes')?.[0] !== 'true') {
    throw usage(`${commandName(op)} can post to the brand's real TikTok. Run it again with --yes once the person has said so.`)
  }
  const { key } = requireKey(io)
  const reply = await call(op, { origin, key, id, input, fetchImpl: io.fetchImpl, sleep: io.sleep })
  const wait = parsed.bare.has('wait') || parsed.values.get('wait')?.[0] === 'true'
  if (wait && reply.status < 400) {
    return finish(io, await waitUntilDone(reply, listing, { origin, key, fetchImpl: io.fetchImpl, sleep: io.sleep, note: io.err }))
  }
  return finish(io, reply)
}

export async function run(argv: string[], io: Io, stdinKey: () => Promise<string> = async () => ''): Promise<number> {
  try {
    const [command, ...rest] = argv
    if (command === '--version' || command === '-v' || command === 'version') {
      io.out(VERSION)
      return EXIT.ok
    }
    const origin = apiOrigin(io.env)
    const { listing } = await loadListing(origin, { fetchImpl: io.fetchImpl, env: io.env })
    if (!command || command === 'help' || command === '--help' || command === '-h') {
      const topic = rest[0]
      const op = topic ? findOperation(listing, topic) : undefined
      io.out(op ? opHelp(op) : topic && BUILT_IN_HELP[topic] ? BUILT_IN_HELP[topic] : generalHelp(listing))
      return EXIT.ok
    }
    switch (command as (typeof BUILT_IN)[number]) {
      case 'login':
        return await login(io, origin, listing, stdinKey)
      case 'logout':
        print(io, { forgotten: removeKey(io.env) })
        return EXIT.ok
      case 'whoami': {
        const { key, source } = requireKey(io)
        const r = await call(listing.operations.find((o) => o.name === 'get_brand')!, { origin, key, fetchImpl: io.fetchImpl, sleep: io.sleep })
        if (r.status >= 400) return finish(io, r)
        print(io, { brand: r.body.product_name, website: r.body.project_url, key: keyPrefix(key), key_from: source, api: origin })
        return EXIT.ok
      }
      case 'costs':
        print(io, {
          costs: listing.costs,
          commands: listing.operations.filter((o) => o.credits).map((o) => ({ command: commandName(o), credits: o.credits })),
        })
        return EXIT.ok
      case 'upload-demo': {
        const parsed = parseArgs(rest, new Set(['cut', 'wait', 'help']))
        const unknown = [...parsed.values.keys(), ...parsed.bare].filter((n) => !['line', 'cut', 'wait', 'help'].includes(n))
        if (unknown.length) throw usage(`upload-demo takes --line, --cut and --wait. Not: --${unknown.join(', --')}.`)
        if (parsed.bare.has('help')) {
          io.out(BUILT_IN_HELP['upload-demo'])
          return EXIT.ok
        }
        if (parsed.positionals.length !== 1) throw usage('Usage: outshot upload-demo <file> [--line <text>] [--cut] [--wait]')
        if (parsed.bare.has('line')) throw usage('--line needs the words: what the demo shows.')
        if ((parsed.values.get('line')?.length ?? 0) > 1) throw usage('--line was given more than once.')
        const { key } = requireKey(io)
        const flag = (n: string) => parsed.bare.has(n) || parsed.values.get(n)?.[0] === 'true'
        return finish(io, await uploadDemo(listing, {
          origin, key, file: parsed.positionals[0], line: parsed.values.get('line')?.[0],
          cut: flag('cut'), wait: flag('wait'), fetchImpl: io.fetchImpl, sleep: io.sleep, note: io.err,
        }))
      }
    }
    const op = findOperation(listing, command)
    if (!op) {
      const near = listing.operations.map(commandName).filter((n) => n.includes(command) || command.includes(n.split('-')[0]))
      throw usage(`Unknown command "${command}".${near.length ? ` Did you mean: ${near.slice(0, 4).join(', ')}?` : ''} Run \`outshot help\`.`)
    }
    return await runOperation(io, origin, listing, op, rest)
  } catch (e) {
    if (e instanceof CliError) {
      printError(io, e.body)
      return e.exit
    }
    printError(io, { error: { code: 'failed', message: (e as Error).message } })
    return EXIT.failed
  }
}

