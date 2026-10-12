---
name: outshot
description: >
  Run the person's Outshot account from the command line: the short-form TikTok videos Outshot
  makes for their brand. Use when they mention Outshot, their deck or waiting videos, TikTok
  videos to review, edit, remake, keep, schedule or post, their posting days and time, the
  trend Library, product demos, or their credits.
allowed-tools: Bash(outshot:*), Bash(npx -y outshot@0:*)
---

# Outshot

Outshot makes short-form videos for one brand. They wait in a deck until the person keeps or
skips them. Kept videos go to a posting day. With TikTok connected, they post there by
themselves. You drive all of it with the `outshot` command; every reply is JSON.

Run each command on its own (no `&&`, `;` or pipes). If `outshot` is not found, run the same
command as `npx -y outshot@0 …` from then on.

## First: check the key

Run `outshot whoami`.
- It names the brand: go on.
- Exit code 3 (no key, or a bad one): ask the person to make a key at
  https://outshot.ai/app/api, then run `outshot login` themselves and paste it there. Never ask
  for the key in the chat, and never put it in a command.

A key works on one brand. A key can only see, or also make changes, or also keep videos. On
exit code 4, tell the person their key can't do that, and that they can make one that can.

## Credits

Run `outshot costs` once per session. Before anything that uses credits, say what it costs and
check `outshot get-credits`:
- Changing a caption or hashtags is free.
- Words on screen cost 1 (the video is remade). Swapping a picture or clip costs 2. A full
  remake costs 8. A new video costs 10 (a Demo video 15).
- Listing the videos, skipping or keeping one can make new videos to keep the deck full. That
  uses credits, as it does in the app.

On exit code 5 (out of credits), tell the person to top up in the app at https://outshot.ai/app.
Never retry in a loop, and never remake the same video again and again to find a better one.

## Review the deck

1. `outshot list-videos`: the videos waiting, oldest first. Each has an `id`, a `format`, a
   `caption`, its words (`script`) and a link (`video_url`, or `slide_urls` for a slideshow).
2. `outshot get-video <id>`: one video as it is now.
3. Show the person what each video says and its link, then ask what to do.

## Change a video

- Caption or hashtags (free, at once):
  `outshot edit-video <id> --caption "…" --hashtags saas --hashtags ai`
- Words on screen (1 credit, remade):
  `outshot edit-video <id> --text "…" --wait`. A slideshow uses `--slides` once per slide, in
  order; a Demo video uses `--hook-text`, `--demo-caption` and `--payoff-text`.
- A new picture or clip (2): `outshot swap-media <id> --slot <slot> --wait` (a slideshow also
  needs `--slide`, counted from 0)
- A full remake (8): `outshot regenerate-video <id> --wait`
- Without the closing reaction (Demo videos, 1): `outshot remove-closer <id> --wait`

`--wait` follows the remake until the video is ready, then prints it. Show the person the new
link. If a remake doesn't work, the command fails with `change_failed` and the video stays as it
was: tell the person, and don't try again on your own. Run `outshot help <command>` for any
command's flags.

## Keep, place and post: always ask first

These post to the brand's real TikTok. They run only with `--yes`. Add it only after the person
has said yes to that video in this conversation.
- `outshot approve-video <id> --yes`: keep it; it takes the next open posting day.
- `outshot place-video <id> --day YYYY-MM-DD --yes`: give it a day, or move it (`--swap true`
  trades days with the video already there).
- `outshot post-video-now <id> --yes`: post it within 15 minutes.
- `outshot schedule-video <id> --yes`: a video kept before TikTok was connected, set to post by
  itself on its day.

`outshot skip-video <id>` passes on a video; `outshot undo-video <id>` takes a decision back.

## After keeping

- `outshot list-content`: everything kept, scheduled, posted or skipped.
- A video marked `missed` reached its time without being posted, or its send stopped midway.
  Ask the person whether it's on TikTok, then run `outshot answer-missed <id> --posted true`
  or `--posted false`.
- `outshot list-calendar`: kept and posted videos by day, with their TikTok links.

## Posting days and time

`outshot get-posting` shows the days, the time, the time zone and whether kept videos take the
next open day by themselves. To change them:
`outshot update-posting --days mon --days wed --days fri --time 18:30 --time-zone Europe/London --auto-schedule true`.
Only what's given changes. Confirm with the person first: it moves the videos still to come.

## The Library: videos from trends

`outshot list-trends` lists the trending TikToks videos are made from, saved ones first. Each
says what it would make (`makes`) and its cost. `outshot make-video-from-trend <trend-id>`
makes one now (10 to 15 credits; say so first). It shows first in `outshot list-videos` about
half a minute later.

## The brand

`outshot get-brand` shows what Outshot knows: the product, audience, tone and content themes.
`outshot update-brand --answers '{"tone": "calm"}'` changes it. Goal, tone, audience, words to
avoid and themes all shape every future video, so confirm the change with the person first.

## Product demos

A demo is a 5 to 20 second screen recording (.mp4, .mov or .webm). Demo videos are made with it.
`outshot upload-demo <file> --line "what it shows" --wait` uploads it and gets it ready. The
brand's first demo then makes a Demo video (15 credits). `outshot list-demos` lists them;
`outshot set-demo-rhythm --per-week 2` sets how many Demo videos a week (0 to 3).

## Errors

Errors print on stderr as `{"error": {"code", "message"}}`. Tell the person the message in
plain words. Exit codes: 1 failed, 2 wrong usage (fix the command), 3 no key or a bad one,
4 the key can't do this, 5 out of credits, 6 not found, 7 no answer yet. On 7 (`still_working`
or `unreachable`), the change may have happened: check with `outshot get-video <id>` and never
run a paid change again just because of it. When the API is busy the command waits once; if it
still fails, wait a minute before trying again.
