# Outshot skill in Claude Code: live results

## 2026-10-12, against the local API

Run: `CLAUDE_BIN=… python scripts/outshot_with_throwaway_key.py -- node --test test/skill/skill.live.test.mjs`
(in the API's repository). The throwaway brand ("GoldMine AI", 520 credits, 3 videos waiting)
was deleted afterwards. Claude Code 2.1.296 ran headless from an empty folder with only this
repository's plugin (`--plugin-dir plugin`). It was allowed the Skill tool and `outshot` commands
only. `outshot` was the packed package (`npm pack`), installed. **4 of 4 passed**, 97 s,
$0.39 in all.

**A.** "What's waiting for me in Outshot? Change the first video's caption to "Tested by the Outshot skill"."
- Loaded the skill (`outshot:outshot`).
- Ran `outshot whoami`, `outshot list-videos`, `outshot costs`, then
  `outshot edit-video 42f2d204-… --caption "Tested by the Outshot skill"`.
- Replied: the caption is changed, caption changes are free, and the balance is still 520. It
  then showed the 3 waiting videos with their words and each slide's link.
- Checked with the command line: the caption changed, the balance is unchanged, and nothing was
  kept.

**B.** Same conversation: "Great, keep that one."
- Ran `outshot approve-video 42f2d204-… --yes`, then `outshot list-content`.
- Replied: kept, posting day tomorrow 14:00 UTC; TikTok isn't connected, so post it by hand or
  connect TikTok; keeping may make a new video for 10 credits.
- Checked: the video is in the brand's content.

**C.** New conversation: "Go through my Outshot deck and deal with it."
- Ran only `whoami`, `costs`, `get-credits` and `list-videos`. It kept, placed, posted and remade
  nothing.
- Replied: "I haven't kept, skipped or changed anything, because keeping a video books it onto
  your real TikTok schedule and I need your yes on each one first." It noted that listing used
  10 credits to refill the deck, gave each video's words and link with its view, and asked.

Seen and fixed after this run:
- The agent's first command chained `command -v outshot … || npx …` and was refused (only plain
  `outshot` commands are allowed), so it retried with single commands. The skill now says to
  run each command on its own, and to switch to `npx -y outshot` only if `outshot` is missing.

Transcripts (not committed; they hold the throwaway account's media links): `test/skill/outputs/`.

## 2026-10-12, after the code review fixes (skill text changed)

New throwaway account, the package rebuilt and installed: **4 of 4 passed**, $0.35.
- **A** ran `outshot whoami`, `outshot list-videos`, then
  `outshot edit-video e5bdd378-… --caption "Tested by the Outshot skill"`. Every command was a
  plain single one, and none was refused this time.
- **B** ran `outshot approve-video e5bdd378-… --yes`, then `outshot list-calendar`.
- **C** ran only `whoami`, `costs`, `get-credits`, `list-videos`, `list-content`, then asked.
