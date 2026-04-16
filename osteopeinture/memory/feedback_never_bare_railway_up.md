---
name: Never run bare `railway up` for OP Hub — use `npm run deploy`
description: The Railway CLI silently drifts between projects. A bare `railway up` deployed OP Hub code to a Fidelio service (text-overlay-assistant) on 2026-04-16. Build failed so no live damage, but the next time it might overwrite a working service.
type: feedback
---

**Rule:** for OP Hub deploys, always run `npm run deploy` (which calls `scripts/deploy.sh`), never bare `railway up`.

**Why:** the Railway CLI's "linked project" state persists across shells, and gets clobbered by any other terminal that runs `railway link`. On 2026-04-16 a bare `railway up` started uploading OP Hub code to `text-overlay-assistant` in the Fidelio project. The build failed (different repo structure, no Dockerfile match) so the live service was never replaced — but a structurally similar Node service WOULD have been overwritten silently.

**The safeguard:** `osteopeinture/quote-assistant/scripts/deploy.sh` does:
1. Preflight: check `railway` and `node` are on PATH.
2. `railway link --project 2049a8ed-... --service 81f7e3b4-... --environment production`.
3. Cross-check by parsing `railway status --json` and comparing the project ID.
4. Abort with a clear message if mismatch.
5. Only then `railway up --detach`.

**How to apply:**
- Always `npm run deploy` from `osteopeinture/quote-assistant/`.
- If you need to deploy a different OP Hub environment, edit `scripts/deploy.sh` (don't go around it).
- If a future build needs the same protection, copy the same script pattern into its folder with its own project/service IDs.
- The previous OP-specific memory `feedback_railway_cli_drift.md` (2026-04-XX) is still true but now superseded operationally — the script enforces the chained-link rule automatically.

**Reference:** see `osteopeinture/quote-assistant/scripts/deploy.sh` for the actual implementation.
