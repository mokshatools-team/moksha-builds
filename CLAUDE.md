# MOKSHA BUILDS — Claude Operating SOP

You are building production tools for MOKSHA, a four-person collective
operating five companies: MOKSHA AI Solutions, FIDELIO Productions, LXR,
OstéoPeinture, and LIONHEART. Builder is Loric. Stack is Railway + GitHub.
All builds are web apps or automation tools deployed live on Railway.

---

## Session Start (every time, no exceptions)

Before touching any code:

1. Read CLAUDE.md (this file)
2. Read CONTEXT.md inside the active build folder
3. State current build status in 2 sentences
4. Confirm the live Railway URL for this build
5. State what "working" means for today's task specifically
6. List all unknowns — do not guess, do not invent

Do not write a single line of code until all six are done.

---

## Definition of Done

A task is NOT done when:
- Code compiles
- Tests pass
- Railway says "deploy successful"

A task IS done only when:
- The live Railway URL has been tested
- The exact user flow for this build works end to end
- You have verified this yourself — never ask Loric to check

---

## Mandatory Build Loop

Every change follows this exact sequence:

### Phase 1 — Plan
- Read CONTEXT.md and the relevant spec in docs/
- If no spec exists for this task, stop and tell Loric before building
- State what you are going to build in plain language before touching code

### Phase 2 — Build
- Follow existing code patterns — never invent new architecture
- Make small, targeted changes — never large rewrites
- Never hardcode environment variables — list required ones explicitly

### Phase 3 — Review (mandatory before every commit)
- Invoke /requesting-code-review skill
- Spawn code-quality-reviewer subagent using subagent-driven-development/code-quality-reviewer-prompt.md
- Spawn spec-reviewer subagent using subagent-driven-development/spec-reviewer-prompt.md
- Both reviewers must pass before proceeding
- If either reviewer flags issues: fix them, then re-review
- Do not skip this phase even for small changes

### Phase 4 — Deploy
- Deploy command: railway up
- Wait for deploy confirmation before proceeding

### Phase 5 — Verify (mandatory after every deploy)
- Link to the correct Railway service: railway link, then railway service link
- Check deploy status: railway deployment list — if FAILED, pull logs immediately
- Pull logs yourself: railway logs — NEVER ask Loric for screenshots or logs
- Hit the live Railway URL health endpoint to confirm it responds
- Test the exact user flow that was changed — not just "is the server up"
- If broken:
  - Read logs first before touching code
  - Check for missing environment variables
  - Check network and API failures
  - Fix → redeploy → retest → re-check logs yourself
  - Repeat until working
- Never ask Loric to manually test unless blocked after two failed attempts
- When asking Loric for help, always include the Railway logs you already pulled

### Phase 6 — Commit and close
- Invoke /receiving-code-review if any review feedback was received
- Commit with a clear message describing what changed and why
- Update CONTEXT.md with:
  - What was built or changed today
  - Current status
  - Live URL confirmed working (or current blocker if not)
  - Exact next step for next session
- Push to GitHub: git add . && git commit -m "message" && git push

---

## Railway Rules

- Deploy command: railway up
- Logs command: railway logs
- Environment variables live in Railway dashboard — never hardcode them
- If deploy fails: read logs before doing anything else
- Railway is not connected to GitHub for auto-deploy — always deploy manually via railway up

---

## When to Escalate — and to Whom

**Ask Loric** about business logic, preferences, priorities, and scope decisions.
**Ask Codex** (`/codex:rescue`) about code, debugging, and implementation strategy.

### Automatic Codex triggers — do not skip these

- **2 failed fixes** on the same bug → stop and run `/codex:rescue` before attempt 3
- **About to rewrite >50 lines** to fix something that should be small → get a second opinion first
- **Choosing between 2+ approaches** and unsure which is right → ask Codex, not Loric
- **Same error keeps coming back** after you thought it was fixed → root cause investigation via Codex
- **Deploy fails twice** and logs aren't making it obvious → Codex before another blind attempt

### Never do these instead of escalating

- Loop on the same fix hoping it works this time
- Rewrite large sections of code as a workaround
- Ask Loric to debug something technical
- Guess at architecture and hope for the best

---

## Hard Rules

- Never stop at deploy success
- Never guess commands — check package.json or requirements.txt first
- Never invent environment variable names
- Never rewrite architecture when a small fix will do
- Never ask Loric to manually test unless truly blocked
- Never skip the review phase
- Follow existing code patterns — do not invent new structure
- Prefer small targeted changes over large rewrites
- Explain structural changes in plain language before making them — Loric is not a developer

---

## Folder Structure

MOKSHA BUILDS/
├── CLAUDE.md              ← this file, read every session
├── AGENTS.md
├── docs/                  ← specs and plans live here
├── osteopeinture/         ← OstéoPeinture builds
├── fidelio/               ← FIDELIO builds
└── moksha-internal/       ← MOKSHA internal tools

Each build folder contains its own CONTEXT.md — read it, maintain it, update it every session.

---

## Shared Memory & Cross-Build Resources

Project memory lives inside `MOKSHA BUILDS/` next to the build folders:

- **OP / OstéoPeinture** → `MOKSHA BUILDS/osteopeinture/memory/`
- **FDL / FIDELIO** → `MOKSHA BUILDS/fidelio/memory/`
- **MOK / MOKSHA (cross-cutting)** → `MOKSHA BUILDS/moksha-internal/memory/`
- **LXR** → `MOKSHA BUILDS/lxr/memory/` (create when needed)
- **LIONHEART** → `MOKSHA BUILDS/lionheart/memory/` (create when needed)

The **moksha-internal/memory/** folder holds cross-cutting memory used by ALL builds:
- gws CLI setup and Sheets API access patterns
- Railway deploy timing notes
- General workflow preferences (output format, Codex review, voice setup)

Each folder has a `MEMORY.md` index. Read it at session start when working on that company.

The `/end-session` and `/switch` skills know the per-project paths and write memory to the correct folder automatically.

---

## Build Conventions

- Company prefixes: OP (OstéoPeinture), FDL (FIDELIO), MOK (MOKSHA), RSV, WED
- Each build has a spec in docs/ before Claude Code touches it
- Loric is not a developer — plain language always
- When in doubt, do less and confirm with Loric
