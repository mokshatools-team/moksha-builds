# MOKSHA Coding SOP

Standard operating procedure for AI-assisted builds across MOKSHA projects.
Applies to all team members and all AI coding tools (Claude Code, Codex, etc.).

## Required setup

Every team member installs the Superpowers skill ecosystem at `~/.claude/skills/`.
The MOKSHA-specific skills `switch` and `end-session` should also be installed.

## The build loop

Every build follows: **PLAN > BUILD > REVIEW > DEPLOY > VERIFY > COMMIT.**
No skipping steps. Each step has a forcing skill below.

## Skill invocation gates (mandatory)

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

If a gate's skill is not invoked, halt and ask the human for explicit override.

## Hard rules

1. **No hardcoded env vars or secrets.** Use environment variables. Never paste tokens into code or commit them. Files containing secrets must be gitignored before they appear.
2. **Verify before claiming.** No "should work" — run the verification command, read the output, then claim success.
3. **One logical change per commit.** Don't bundle a refactor with a new feature. Commits should be revertible independently.
4. **Deploy via the project's deploy script if one exists.** Otherwise `railway up` with explicit project/service flags. Never rely on auto-deploy.
5. **Verify the live URL after every deploy.** A successful deploy command does not equal a working app.
6. **Plain language with Loric.** Loric is not a developer. Explain in plain language. Don't ask Loric to test code.
7. **Read CONTEXT.md before working on any build.** No exceptions.
8. **No `git add .`** — add specific files or directories.

## Pre-deploy review pass

Before any deploy, the build's diff must be reviewed by a second model:
- Default: invoke `requesting-code-review` (uses Claude subagent)
- Alternative: ask Codex (or a fresh Claude session) to review the diff with the prompt: "Act as a skeptical senior engineer reviewing this for production. List every way this could fail silently, every input that isn't validated, every external call without a timeout or retry, every place state could get inconsistent."

The reviewer's findings must be addressed or explicitly waived before deploy.

## Logging requirement

Every pipeline must log:
- Run start (timestamp, pipeline name, run ID)
- Each major step completion
- Every external API call (success or failure)
- Every error with the actual error message, not a generic "failed"
- Run end (success/fail, duration)

Logs go somewhere readable — Railway logs panel for Railway services, a `Logs` tab in Google Sheets for Apps Script projects.

## Idempotency requirement

Any pipeline that touches Sheets, sends emails, posts to social, or writes to a database must be safe to re-run. Document idempotency assumptions in the project's CONTEXT.md.

## Escalation protocol

- Code or architecture decision: ask Codex or invoke `requesting-code-review`.
- Business decision (scope, priority, naming, money): ask Loric.
- Security or token-related: stop and ask Loric immediately.

## File conventions

Per-project structure:
- `CONTEXT.md` — current state snapshot, max ~150 lines
- `JOURNAL.md` — append-only session log
- `docs/` — specs and plans for this project

Repo root:
- `CLAUDE.md` — operational rules for AI agents in this repo
- `MOKSHA-CODING-SOP.md` — this document
- `AGENTS.md` — pointer to CLAUDE.md for non-Claude agents

Company-level:
- `[company]/CONTEXT.md` — umbrella explaining what the company is and listing builds
