/** Exit codes, so a script or an agent can tell what went wrong without reading the message. */
export const EXIT = {
  ok: 0,
  failed: 1,
  usage: 2,
  signedOut: 3,
  notAllowed: 4,
  outOfCredits: 5,
  notFound: 6,
  // The change may or may not have happened (no answer in time, or still being made): check
  // with a read before running it again, as running it again may use credits twice.
  unknown: 7,
} as const

/** The exit code for an API reply's HTTP status. */
export function exitFor(status: number): number {
  if (status === 401) return EXIT.signedOut
  if (status === 402) return EXIT.outOfCredits
  if (status === 403) return EXIT.notAllowed
  if (status === 404) return EXIT.notFound
  return EXIT.failed
}

/** A problem found by the command line itself, printed in the API's own error shape. */
export class CliError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly exit: number = EXIT.failed,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message)
  }

  get body(): { error: Record<string, unknown> } {
    return { error: { code: this.code, message: this.message, ...this.extra } }
  }
}

export const usage = (message: string, extra: Record<string, unknown> = {}) =>
  new CliError('usage', message, EXIT.usage, extra)
