---
name: Railway CLI drifts between projects — always chain link+up in one shell
description: The railway CLI silently switches to the wrong Railway project between sessions and sometimes between deploys in the same session. railway status lies — it shows correct names even when up will target the wrong project ID.
type: feedback
---

The `railway` CLI cannot be trusted to remember the linked project for the OP Hub (quote-assistant) between deploys. Confirmed across multiple sessions: `railway status` will cheerfully report `Project: osteoPeinture / Service: quote-assistant` while the next `railway up` silently targets a completely different Railway project ID. Multiple deploys in the April 8-9 sessions initially landed on project `afc0e272-8012-4279-bd43-b06b052d5d26` (wrong) instead of `2049a8ed-33ea-47bf-aee6-08056b3a16ab` (correct), and "live verification" via curl passed because the OLD container on the correct project kept serving the old code — so the tests returned 200 but the new code was never actually running.

**Why:** Loric is in multiple Railway workspaces, both containing a project named `osteoPeinture`. The CLI link state is stored in a shared config and gets clobbered between invocations.

**How to apply:**

Mandatory protocol before EVERY deploy of OP Hub / quote-assistant:

1. Chain `railway link` and `railway up` in the **same bash invocation** (single tool call). Never split them.
   ```
   cd osteopeinture/quote-assistant && \
     railway link -p 2049a8ed-33ea-47bf-aee6-08056b3a16ab \
                  -s 81f7e3b4-00b5-4b49-8f74-955313738a11 \
                  -e production && \
     railway up --detach
   ```
2. After `railway up`, read the build log URL it prints. It MUST contain `project/2049a8ed-...`. If it shows any other project ID, the deploy went nowhere useful — the live app is unchanged — and you need to re-link and redeploy.
3. Within ~90 seconds, run `railway deployment list` and confirm a new `SUCCESS` row appeared. If the top row is still the previous deploy, something is wrong.
4. Only after the above: verify live behavior via curl/browser.

**Correct OP Hub target (April 2026):**
- Project: `osteoPeinture` (id `2049a8ed-33ea-47bf-aee6-08056b3a16ab`)
- Service: `quote-assistant` (id `81f7e3b4-00b5-4b49-8f74-955313738a11`)
- Environment: `production`
- URL: `https://op-quote-assistant.up.railway.app`

**Warning signs a deploy went to the wrong project:**
- Build log URL contains a project ID that isn't `2049a8ed-...`
- `railway deployment list` shows the previous deploy still at the top
- Curl probes for new endpoints/code return old behavior
- Expected log lines (e.g. `[quoting-logic] Force-reseeded`) never appear in `railway logs`

If this gets in the way repeatedly, consider adding a small shell wrapper in the repo that always re-links before `up`.
