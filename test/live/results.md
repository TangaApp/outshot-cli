# `outshot` command line: live results

## 2026-10-12, against the local API (latest `outshot` branch, 29 operations)

Run: `python scripts/outshot_with_throwaway_key.py -- npm run test:live` (in the API's repository).
A throwaway person signed up through the app's own signup and was given 500 credits. Two keys were
made in the app: `osk_rcreClNg…` (see, change, keep) and `osk_yEwx46hX…` (see only). Both were
revoked and the account deleted afterwards. **Passed** (1 test, 509 s, most of it waiting for the
first videos).

Each step ran `node dist/cli.js …` in its own process, as a person or an agent would:

| Step | Command | Exit | What came back |
|---|---|---|---|
| Sign in from stdin | `outshot login` | 0 | brand "GoldMine AI", key shown as `osk_…` prefix only; file 0600 |
| Who am I | `outshot whoami` | 0 | `key_from: "saved"` |
| Wait for the deck | `outshot list-videos` (every 10 s) | 0 | 3 of 3 ready; balance 540 → 520 while they were made |
| Free caption edit | `outshot edit-video <id> --caption "Made from the command line" --hashtags outshot --hashtags cli` | 0 | caption changed, hashtags `#outshot #cli`; **520 → 520** |
| Full remake | `outshot regenerate-video <id> --wait` | 0 | followed until `state: ready` (39 s); **520 → 512 (−8)** |
| Skip, undo | `outshot skip-video <id>`, `outshot undo-video <id>` | 0, 0 | back to waiting |
| Keep without --yes | `outshot approve-video <id>` | **2** | refused, nothing sent: "can post to the brand's real TikTok. Run it again with --yes…" |
| Keep | `outshot approve-video <id> --yes` | 0 | kept (no TikTok: to post by hand) |
| Content | `outshot list-content` | 0 | the video, `ready_to_post_manually` |
| Posting time | `outshot update-posting --time 18:30` | 0 | `time: "18:30"` |
| Move it | `outshot place-video <id> --day 2026-10-21 --yes` | 0 | `scheduled_for: 2026-10-21T18:30:00+00:00` |
| Post now | `outshot post-video-now <id> --yes` | 1 | `tiktok_not_connected`: "Connect TikTok in Outshot first (Accounts)." Nothing posted. |
| Library | `outshot list-trends` | 0 | 459 trends |
| Video from a trend | `outshot make-video-from-trend <trend>` | 0 | `{format: meme, credits: 10, queued: true}`; first in `list-videos` 45 s later; **512 → 502 (−10)** |
| Product demo | `outshot upload-demo demo.mp4 --line "Shows the dashboard filling up"` | 0 | uploaded (8 s test clip), `status: ready`, `label` saved |
| See-only key | `outshot edit-video <id> --caption x` | **4** | `insufficient_scope`: "This key can't make changes…" |
| Unknown video | `outshot get-video 00000000-…` | **6** | `not_found` |
| Wrong key | `outshot get-credits` with a made-up `osk_` key | **3** | `invalid_api_key` |

Balance: 520 when the deck was full, then −8 for the remake and −10 for the trend video. The
last −10 is the new video made to fill the deck after keeping one (as the app does). 492 at the
end.

Notes:
- `make-video-from-trend` takes its credits as the video is made, not when it answers. The
  test checks the balance once the video shows.
- The full log of every command and reply is in `test/live/outputs/cli-live.json`. It's not
  committed, because it holds the throwaway account's signed media links.

## 2026-10-12, after the code review fixes

Same run, same steps, on a new throwaway account (keys `osk_XxF1y6Ez…`, `osk_3s8phBOW…`, both
revoked, account deleted): **passed**. Balance 510 when the deck was full, then 492 at the end
(−8 remake, −10 video from a trend). The fixes are covered by unit tests (37):
- A key that isn't one line is refused and never repeated.
- An error that quotes the key shows only its start.
- `--wait` exits 1 with `change_failed` when a remake doesn't work.
- No answer to a change, or a wait that runs out, exits 7 ("check before running it again").
- The key only goes over https, or plain http to this computer.
