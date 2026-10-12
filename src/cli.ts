#!/usr/bin/env node
import { createInterface } from 'node:readline'
import { Writable } from 'node:stream'
import { run } from './main.js'

/** Asks for the key without showing what's typed or pasted. */
function readSecret(prompt: string): Promise<string> {
  process.stderr.write(prompt)
  const muted = new Writable({ write: (_chunk, _enc, done) => done() })
  const rl = createInterface({ input: process.stdin, output: muted, terminal: true })
  return new Promise((resolve) => {
    let answered = false
    rl.question('', (answer) => {
      answered = true
      rl.close()
      process.stderr.write('\n')
      resolve(answer)
    })
    // Ctrl-C or Ctrl-D at the prompt: stop, saving nothing.
    rl.on('close', () => {
      if (answered) return
      process.stderr.write('\n')
      process.exit(130)
    })
  })
}

async function readStdin(): Promise<string> {
  let text = ''
  for await (const chunk of process.stdin) text += chunk
  return text
}

const code = await run(
  process.argv.slice(2),
  {
    out: (text) => process.stdout.write(text + '\n'),
    err: (text) => process.stderr.write(text + '\n'),
    env: process.env,
    isTTY: Boolean(process.stdout.isTTY),
    canPrompt: Boolean(process.stdin.isTTY),
    readSecret,
  },
  readStdin,
)
process.exitCode = code
