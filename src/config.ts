import { chmodSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { CliError, EXIT } from './errors.js'

export const DEFAULT_API = 'https://api.outshot.ai'
const KEY_SHAPE = /^osk_[A-Za-z0-9_-]{20,}$/
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Where the saved key and the cached operation list live. Only the person can read it. */
export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.OUTSHOT_CONFIG_DIR) return env.OUTSHOT_CONFIG_DIR
  const base = env.XDG_CONFIG_HOME || join(homedir(), '.config')
  return join(base, 'outshot')
}

/**
 * The API's origin. OUTSHOT_API_URL points the command at another server (a local one, for
 * tests). The key goes wherever this points, so plain http is only allowed to this computer.
 */
export function apiOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const raw = (env.OUTSHOT_API_URL || DEFAULT_API).trim().replace(/\/+$/, '').replace(/\/v1$/, '')
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new CliError('usage', `OUTSHOT_API_URL isn't an address: "${raw}".`, EXIT.usage)
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname))) {
    throw new CliError('usage', 'OUTSHOT_API_URL must start with https:// (plain http only for this computer).', EXIT.usage)
  }
  return url.origin
}

export const isDefaultApi = (origin: string) => origin === DEFAULT_API

export type KeySource = 'OUTSHOT_API_KEY' | 'saved'

/**
 * The key to use: OUTSHOT_API_KEY first, then the one saved by `outshot login`. Something that
 * isn't shaped like a key is refused without repeating it, so a bad paste is never printed.
 */
export function readKey(env: NodeJS.ProcessEnv = process.env): { key: string; source: KeySource } | null {
  let found: { key: string; source: KeySource } | null = null
  const fromEnv = env.OUTSHOT_API_KEY?.trim()
  if (fromEnv) {
    found = { key: fromEnv, source: 'OUTSHOT_API_KEY' }
  } else {
    try {
      const saved = JSON.parse(readFileSync(join(configDir(env), 'config.json'), 'utf8'))
      if (typeof saved.key === 'string' && saved.key) found = { key: saved.key.trim(), source: 'saved' }
    } catch {
      // Nothing saved yet.
    }
  }
  if (found && !looksLikeKey(found.key)) {
    const where = found.source === 'saved' ? 'The saved key' : 'OUTSHOT_API_KEY'
    throw new CliError('invalid_api_key', `${where} isn't an Outshot key (they start with osk_ and are one line). Run \`outshot login\` again.`, EXIT.signedOut)
  }
  return found
}

export function looksLikeKey(key: string): boolean {
  return KEY_SHAPE.test(key)
}

/**
 * Save the key for this person only: the folder 0700, the file 0600. The file is written
 * beside it first and moved into place, so the key is never readable by others, even briefly.
 */
export function saveKey(key: string, env: NodeJS.ProcessEnv = process.env): string {
  const dir = configDir(env)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)
  const file = join(dir, 'config.json')
  const temp = join(dir, `.config.${process.pid}.tmp`)
  rmSync(temp, { force: true })
  writeFileSync(temp, JSON.stringify({ key }, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
  try {
    if (lstatSync(file).isSymbolicLink()) rmSync(file)
  } catch {
    // No file yet.
  }
  renameSync(temp, file)
  return file
}

export function removeKey(env: NodeJS.ProcessEnv = process.env): boolean {
  const file = join(configDir(env), 'config.json')
  try {
    lstatSync(file)
  } catch {
    return false
  }
  rmSync(file, { force: true })
  return true
}

/** The start of a key, safe to show. */
export function keyPrefix(key: string): string {
  return `${key.slice(0, 12)}…`
}
