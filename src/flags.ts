import { readFileSync } from 'node:fs'
import { usage } from './errors.js'
import type { JsonSchema, Operation } from './operations.js'

export type FlagKind = 'string' | 'integer' | 'number' | 'boolean' | 'list' | 'json'

/** One flag of an operation's command, read from the input's JSON Schema. */
export interface Flag {
  flag: string // `hook-text`
  prop: string // `hook_text`
  kind: FlagKind
  required: boolean
  description?: string
  choices?: string[] // for a string, or for each item of a list
  minimum?: number
  maximum?: number
  pattern?: string
  maxLength?: number
  minItems?: number
  maxItems?: number
}

/** The flags every operation command understands, whatever its input. */
export const COMMON_FLAGS = ['json', 'yes', 'wait', 'help'] as const

function deref(schema: JsonSchema, root: JsonSchema): JsonSchema {
  let s = schema
  for (let i = 0; i < 10 && typeof s?.$ref === 'string'; i++) {
    const name = s.$ref.replace(/^#\/\$defs\//, '')
    s = root.$defs?.[name] ?? {}
  }
  return s
}

/** `anyOf: [X, {type: null}]` (an optional field) is X. */
function unwrap(schema: JsonSchema, root: JsonSchema): JsonSchema {
  const s = deref(schema, root)
  if (Array.isArray(s.anyOf)) {
    const real = s.anyOf.filter((b: JsonSchema) => b?.type !== 'null')
    if (real.length === 1) return { ...s, ...deref(real[0], root), anyOf: undefined }
  }
  return s
}

export function flagsFor(op: Operation): Flag[] {
  const root = op.input_schema
  if (!root?.properties) return []
  const required = new Set<string>(root.required ?? [])
  return Object.entries(root.properties as Record<string, JsonSchema>).map(([prop, raw]) => {
    const s = unwrap(raw, root)
    const base = {
      flag: prop.replace(/_/g, '-'),
      prop,
      required: required.has(prop),
      description: raw.description ?? s.description,
    }
    if (s.type === 'string') {
      return { ...base, kind: 'string', choices: s.enum, pattern: s.pattern, maxLength: s.maxLength }
    }
    if (s.type === 'integer' || s.type === 'number') {
      return { ...base, kind: s.type, minimum: s.minimum, maximum: s.maximum }
    }
    if (s.type === 'boolean') return { ...base, kind: 'boolean' }
    if (s.type === 'array') {
      const item = unwrap(s.items ?? {}, root)
      if (item.type === 'string') {
        return { ...base, kind: 'list', choices: item.enum, minItems: s.minItems, maxItems: s.maxItems }
      }
    }
    return { ...base, kind: 'json' }
  })
}

export interface Parsed {
  positionals: string[]
  values: Map<string, string[]> // flag → every value given
  bare: Set<string> // flags given with no value
}

/**
 * Reads `--name value`, `--name=value` and a bare `--name`. A flag's value is never taken from
 * a word that starts with `--`, so `--caption --wait` is a mistake rather than a caption.
 */
export function parseArgs(argv: string[], booleans: Set<string>): Parsed {
  const out: Parsed = { positionals: [], values: new Map(), bare: new Set() }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--') {
      out.positionals.push(...argv.slice(i + 1))
      break
    }
    if (arg === '-h') {
      out.bare.add('help')
      continue
    }
    if (!arg.startsWith('--')) {
      out.positionals.push(arg)
      continue
    }
    const eq = arg.indexOf('=')
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq)
    if (!name) throw usage(`"${arg}" isn't a flag. A value that starts with -- goes after =, like --caption="-- …".`)
    let value: string | undefined = eq === -1 ? undefined : arg.slice(eq + 1)
    if (value === undefined) {
      const next = argv[i + 1]
      const takesValue = booleans.has(name) ? next === 'true' || next === 'false' : next !== undefined && !next.startsWith('--')
      if (takesValue) {
        value = next
        i++
      }
    }
    if (value === undefined) {
      out.bare.add(name)
    } else {
      out.values.set(name, [...(out.values.get(name) ?? []), value])
    }
  }
  return out
}

function readJson(text: string, what: string): unknown {
  let source = text
  if (text.startsWith('@')) {
    try {
      source = readFileSync(text.slice(1), 'utf8')
    } catch {
      throw usage(`${what}: there's no file at ${text.slice(1)}.`)
    }
  }
  try {
    return JSON.parse(source)
  } catch {
    throw usage(`${what} isn't valid JSON.`)
  }
}

function one(flag: Flag, values: string[]): string {
  if (values.length > 1) throw usage(`--${flag.flag} was given more than once.`)
  return values[0]
}

function convert(flag: Flag, values: string[]): unknown {
  const name = `--${flag.flag}`
  switch (flag.kind) {
    case 'boolean': {
      const v = one(flag, values)
      if (v !== 'true' && v !== 'false') throw usage(`${name} is true or false.`)
      return v === 'true'
    }
    case 'integer':
    case 'number': {
      const v = one(flag, values)
      const n = Number(v)
      const shape = flag.kind === 'integer' ? /^-?\d+$/ : /^-?\d+(\.\d+)?$/
      if (!shape.test(v.trim()) || Number.isNaN(n)) {
        throw usage(`${name} is a${flag.kind === 'integer' ? ' whole' : ''} number.`)
      }
      if (flag.minimum !== undefined && n < flag.minimum) throw usage(`${name} is at least ${flag.minimum}.`)
      if (flag.maximum !== undefined && n > flag.maximum) throw usage(`${name} is at most ${flag.maximum}.`)
      return n
    }
    case 'string': {
      const v = one(flag, values)
      if (flag.choices && !flag.choices.includes(v)) throw usage(`${name} is one of: ${flag.choices.join(', ')}.`)
      if (flag.pattern && !new RegExp(flag.pattern).test(v)) throw usage(`${name} doesn't look right: "${v}".`)
      if (flag.maxLength !== undefined && v.length > flag.maxLength) {
        throw usage(`${name} is at most ${flag.maxLength} characters.`)
      }
      return v
    }
    case 'list': {
      const bad = flag.choices ? values.filter((v) => !flag.choices!.includes(v)) : []
      if (bad.length) throw usage(`${name} takes: ${flag.choices!.join(', ')}. Not: ${bad.join(', ')}.`)
      if (flag.minItems !== undefined && values.length < flag.minItems) throw usage(`${name} needs at least ${flag.minItems}.`)
      if (flag.maxItems !== undefined && values.length > flag.maxItems) throw usage(`${name} takes at most ${flag.maxItems}.`)
      return values
    }
    case 'json':
      return readJson(one(flag, values), name)
  }
}

/**
 * The operation's input from the parsed flags: `--json` (an object, or @file) first, then each
 * flag on top of it. Unknown flags are refused, so a typo never sends a half-made change.
 */
export function inputFor(op: Operation, parsed: Parsed): Record<string, unknown> | null {
  const flags = flagsFor(op)
  const byFlag = new Map(flags.map((f) => [f.flag, f]))
  if (parsed.bare.has('json')) throw usage('--json needs a value: an object, or @file.json.')
  const given = [...parsed.values.keys(), ...parsed.bare]
  for (const name of given) {
    if ((COMMON_FLAGS as readonly string[]).includes(name)) continue
    if (name === 'key' || name === 'api-key' || name === 'token') {
      throw usage('The key is never given on the command line. Run `outshot login`, or set OUTSHOT_API_KEY.')
    }
    if (!byFlag.has(name)) {
      const known = flags.map((f) => `--${f.flag}`).join(', ')
      throw usage(`--${name} isn't a flag of ${op.name.replace(/_/g, '-')}.${known ? ` Its flags: ${known}.` : ''}`)
    }
  }
  if (!op.input_schema) {
    if (parsed.values.has('json')) throw usage(`${op.name.replace(/_/g, '-')} takes no input.`)
    return null
  }
  let input: Record<string, unknown> = {}
  const json = parsed.values.get('json')
  if (json) {
    if (json.length > 1) throw usage('--json was given more than once.')
    const obj = readJson(json[0], '--json')
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw usage('--json is an object, like {"caption": "…"}.')
    input = { ...(obj as Record<string, unknown>) }
    const takes = Object.keys(op.input_schema?.properties ?? {})
    const unknown = Object.keys(input).filter((k) => !takes.includes(k))
    if (unknown.length) {
      throw usage(`--json has ${unknown.join(', ')}, which ${op.name.replace(/_/g, '-')} doesn't take. It takes: ${takes.join(', ')}.`)
    }
  }
  for (const flag of flags) {
    const values = parsed.values.get(flag.flag)
    if (values) {
      input[flag.prop] = convert(flag, values)
    } else if (parsed.bare.has(flag.flag)) {
      if (flag.kind !== 'boolean') throw usage(`--${flag.flag} needs a value.`)
      input[flag.prop] = true
    }
  }
  const missing = flags.filter((f) => f.required && !(f.prop in input))
  if (missing.length) throw usage(`Missing ${missing.map((f) => `--${f.flag}`).join(', ')}.`)
  return input
}
