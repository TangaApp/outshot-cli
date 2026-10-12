// Refreshes operations.snapshot.json, the copy of the API's operation list bundled with the
// package (used when the API can't be reached, e.g. for `outshot help` offline).
import { writeFileSync } from 'node:fs'

const origin = (process.env.OUTSHOT_API_URL || 'https://api.outshot.ai').replace(/\/+$/, '')
const res = await fetch(`${origin}/v1/operations`)
if (!res.ok) throw new Error(`${origin}/v1/operations answered ${res.status}`)
const listing = await res.json()
writeFileSync(new URL('../operations.snapshot.json', import.meta.url), JSON.stringify(listing, null, 2) + '\n')
console.log(`${listing.operations.length} operations from ${origin}`)
