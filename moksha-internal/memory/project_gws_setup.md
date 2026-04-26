---
name: GWS Setup Status
description: Google Workspace CLI setup — fully authenticated, GCP project osteopeinture-finance active
type: project
---

gws CLI is fully authenticated as `loricstonge@gmail.com`. GCP project `osteopeinture-finance` created with Sheets + Drive APIs enabled.

**Why:** User wants full Google Workspace access (Gmail, Drive, Docs, Sheets, Calendar) via the `gws` CLI across Claude Code and Codex.

**What's installed and working:**
- `gws` CLI: v0.22.5 ✓
- `gcloud` SDK ✓
- Auth: `loricstonge@gmail.com` via `gws auth setup`, GCP project = `osteopeinture-finance` ✓
- `clasp` v3.3.0 installed globally, authenticated as `loricstonge@gmail.com` ✓
- Skills: `gws-gmail`, `gws-drive`, `gws-docs`, `gws-docs-write`, `gws-calendar`, `gws-sheets`, `gws-shared`

**How to apply:** `gws sheets +read`, `gws drive files list` etc. work immediately — no setup needed. Use `clasp push` from project folders to deploy Apps Script files.
