# outshot

Outshot from the command line. Review, edit, remake, keep and schedule the short-form TikTok
videos [Outshot](https://outshot.ai) makes for your brand. You can do it yourself, or let your AI
agent (Claude Code, Codex, any agent with a shell) do it for you.

```sh
npx outshot login          # paste a key from https://outshot.ai/app/api
npx outshot list-videos    # the videos waiting for you
```

Or install it: `npm i -g outshot`, then `outshot …`. Needs Node 22 or later.

## Your key

Make a key in Outshot at **[outshot.ai/app/api](https://outshot.ai/app/api)**. A key works on one
brand, and either only sees, or can also make changes, or can also keep videos.

- `outshot login` asks for the key and saves it where only you can read it
  (`~/.config/outshot/config.json`, mode 600).
- Or set `OUTSHOT_API_KEY` in your shell. It's used before a saved key.

The key is never given on the command line, so it never lands in your shell history.

## Commands

Every operation of the [Outshot API](https://outshot.ai/docs/api/reference) is a command,
with the same name as its MCP tool:

```sh
outshot list-videos
outshot edit-video <id> --caption "New caption" --hashtags saas --hashtags ai   # free
outshot edit-video <id> --text "New words on screen" --wait                     # 1 credit
outshot regenerate-video <id> --wait                                            # 8 credits
outshot approve-video <id> --yes
outshot place-video <id> --day 2026-10-20 --yes
outshot update-posting --days mon --days wed --days fri --time 18:30
outshot list-trends
outshot make-video-from-trend <trend-id>                                        # 10-15 credits
outshot upload-demo demo.mp4 --line "Shows the dashboard" --wait
```

- `outshot help` lists every command; `outshot help <command>` shows its flags and its cost.
- `outshot costs` shows what each change uses.
- `--wait` follows a remake or a demo until it's ready.
- Commands that keep or post a video (`approve-video`, `place-video`, `schedule-video`,
  `post-video-now`) post to the brand's real TikTok, so they run only with `--yes`.
- Nested input goes in as JSON: `outshot update-brand --answers '{"tone": "calm"}'`, or
  `--json @changes.json` for the whole input.

The commands come from the API's own list (`GET /v1/operations`, cached for 5 minutes), so a new
operation works without updating this package.

## Output

Replies are JSON on stdout: indented in a terminal, one line when piped (for `jq` and agents).
Errors are JSON on stderr, `{"error": {"code", "message"}}`, with an exit code:

| Exit | Meaning |
|---|---|
| 0 | OK |
| 1 | Failed (the message says why) |
| 2 | Wrong usage: fix the command |
| 3 | No key, or a bad one |
| 4 | The key can't do this |
| 5 | Out of credits |
| 6 | Not found |
| 7 | No answer yet: it may have gone through, so check before running it again |

## For AI agents: the skill

The skill teaches an agent how to use Outshot well: check the key, say what a change costs,
follow remakes, and ask before keeping or posting anything.

- **Claude Code:** `/plugin marketplace add outshot-ai/outshot`, then `/plugin install outshot@outshot`
- **Codex and other agents:** `npx skills add outshot-ai/outshot`

Prefer MCP? Outshot also has an MCP server: see [Connect your agent](https://outshot.ai/docs/api#connect).

## Develop

```sh
npm install
npm test            # unit tests
npm run snapshot    # refresh the bundled copy of the operation list
```

The live test (`test/live/`) runs the real command against an Outshot API with a throwaway
account's keys; see `test/live/results.md`.

## License

MIT
