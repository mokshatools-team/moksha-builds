---
name: Use Codex rescue for architecture and plan review
description: Loric wants independent second opinions on plans and architecture via /codex:rescue before committing
type: feedback
---

When presenting architectural recommendations or implementation plans, offer to run `/codex:rescue` for an independent review before Loric commits.

**Why:** Loric asked how to get a separate review of a plan. Codex caught real blind spots in the Sheets-as-ledger recommendation (missing Postgres option, inaccurate Apps Script rejection, outdated MCP info). The second opinion changed the direction.

**How to apply:** After presenting any non-trivial plan or architecture choice, proactively suggest: "Want me to run /codex:rescue for a second opinion before we commit?"
