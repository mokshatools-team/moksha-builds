# Claude Morning Handoff — 2026-04-06

## What Landed

- Blotato v2 flow is working
- Review UI platform toggles are working
- Review UI is now manual-refresh and sticky instead of background-resetting
- Short-form auto covers are working with mixed real-frame vs stock-style generation
- Manual regen supports exact host scrubber frame and IG stock mode
- FFmpeg now prepends thumbnail/cover frames before Blotato upload
- Publish Queue writes per-platform rows and now records `Cover Stitch`
- Google Sheets dropdown conflict for `Cover Stitch` was fixed live and in `scripts/setup_sheets.py`

## Important Root Cause Fixed Tonight

`Cover Stitch` was not writing because the live `Publish Queue` tab still had 9 columns.  
`ensure_column()` in `local/sheets/connector.py` now expands the worksheet before writing a new header.

## Current Repo / Ops State

- Daemon was restarted cleanly after the Sheets fix
- Repo currently has no git remote configured
- Main rollout focus should now shift from feature work to GitHub push + editor onboarding/install

## Recommended Next Steps

1. Push repo to GitHub
2. Freeze onboarding/install flow for the other two editors
3. Do one clean-machine install test
4. Add any last UX polish only after install flow is documented

## Handback Prompt

Codex complete: docs + rollout handoff
Files modified: README.md, DECISIONS.md
Files created: ROLLOUT.md, HANDOFF_CLAUDE_2026-04-06.md
Notable state: Publish Queue now writes `Cover Stitch`; dropdown mismatch fixed live and in setup script; repo has no git remote yet
Recommended next move: GitHub push + editor onboarding/install pass
