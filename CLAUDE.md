# CLAUDE.md — MOKSHA Builds Repo

This is the operational guide for Claude Code working in this repo.

## Read this first

1. Read `/MOKSHA-CODING-SOP.md` for the universal standard.
2. Read the relevant project's `CONTEXT.md` for project-specific state.
3. Invoke the Superpowers skills at the gates defined in the SOP.

## Session start (mandatory)

1. Run `git status` and report what state the repo is in.
2. If the user names a project, read that project's CONTEXT.md before doing anything else.
3. State current build status in 2 sentences. Confirm the live Railway URL. List unknowns.
4. If no spec exists for the requested work, invoke `brainstorming` and `writing-plans` before writing any code.

Do not write a single line of code until all of the above are done.

---

## Repo structure

```
MOKSHA BUILDS/
├── CLAUDE.md                  ← this file
├── MOKSHA-CODING-SOP.md       ← universal coding standard
├── AGENTS.md                  ← pointer for non-Claude agents
├── osteopeinture/             ← OstéoPeinture builds
│   ├── CONTEXT.md             ← umbrella (lists all OP builds)
│   ├── ECOSYSTEM-OVERVIEW.md  ← cross-cutting architecture
│   ├── quote-assistant/       ← OP Hub (most active)
│   └── finance-system/        ← Sheets-based ledger
├── fidelio/                   ← FIDELIO builds
│   ├── CONTEXT.md             ← umbrella (lists all FDL builds)
│   ├── fdl1-publishing-pipeline/
│   ├── fdl2-archive-import/
│   ├── text-overlay-assistant/
│   ├── transcript-chat-assistant/
│   ├── video-post-studio/
│   ├── _rob-pipeline-clone/
│   └── memory/
└── moksha-internal/           ← cross-cutting tools and memory
```

Each build folder contains its own `CONTEXT.md` (current state) and `JOURNAL.md` (session history). Specs live in each project's `docs/` subfolder.

---

## Railway deployment

- This repo uses one Railway project per company: `osteoPeinture`, `fidelio`.
- **The Railway CLI drifts between projects unexpectedly.** Before any `railway up`, verify the active project and service match the intended target. Use `railway status` to confirm.
- Always re-link explicitly before deploying:
  ```
  railway link --project [project-id] --service [service-id] -e production
  ```
- For OP Hub specifically, use `npm run deploy` which wraps `railway up` with safety checks and aborts on project mismatch.
- Never rely on GitHub auto-deploy. Always trigger deploys explicitly.
- After deploying, check `railway deployment list` to confirm SUCCESS. Pull `railway logs` yourself — never ask Loric for logs or screenshots.

---

## Skill invocation (enforced)

Per the SOP, invoke these skills at these gates. Failure to invoke = halt and ask Loric.

| Gate | Skill to invoke |
|------|-----------------|
| Before starting any build | `brainstorming` then `writing-plans` |
| When debugging | `systematic-debugging` |
| Before any deploy | `requesting-code-review` |
| Before claiming completion | `verification-before-completion` |
| When work is done for the day | `end-session` |
| When switching projects mid-session | `switch` |
| When parallelizing independent problems | `dispatching-parallel-agents` |
| When writing test code | `test-driven-development` |

---

## Escalation

**Ask Loric** about business logic, preferences, priorities, scope decisions, security.
**Ask Codex** (`/codex:rescue`) about code, debugging, and implementation strategy.

### Automatic Codex triggers

- 2 failed fixes on the same bug → `/codex:rescue` before attempt 3
- About to rewrite >50 lines for what should be a small fix → second opinion first
- Choosing between 2+ approaches → ask Codex, not Loric
- Same error keeps recurring → root cause investigation via Codex
- Deploy fails twice with unclear logs → Codex before another blind attempt

### Never do these instead of escalating

- Loop on the same fix hoping it works this time
- Rewrite large sections of code as a workaround
- Ask Loric to debug something technical
- Guess at architecture

---

## Memory paths

- **OstéoPeinture** → `osteopeinture/memory/` (create when needed)
- **FIDELIO** → `fidelio/memory/`
- **Cross-cutting** → `moksha-internal/memory/`
- **LXR** → `lxr/memory/` (create when needed)
- **LIONHEART** → `lionheart/memory/` (create when needed)

Each memory folder has a `MEMORY.md` index. The `/end-session` and `/switch` skills know these paths.

---

## Hard rules (repo-specific)

- Plain language with Loric. Loric is not a developer.
- Don't ask Loric to test. Verify yourself via the live URL.
- No `git add .` — specific paths only.
- Never hardcode environment variables — they live in Railway dashboard.
- Never invent environment variable names — check CONTEXT.md or the project's existing config.
- Follow existing code patterns — do not invent new structure.
- Prefer small targeted changes over large rewrites.
- When in doubt, do less and confirm with Loric.
- Company prefixes: OP (OstéoPeinture), FDL (FIDELIO), MOK (MOKSHA)

## When something breaks

Invoke `systematic-debugging`. Do not fix symptoms. Find root cause first.
