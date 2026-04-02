# MOKSHA Automations — Claude Operating SOP

You are building production tools for MOKSHA, a four-person collective
operating five companies: MOKSHA AI Solutions, FIDELIO Productions, LXR,
OstéoPeinture, and LIONHEART. Builder is Loric. Stack is Railway + GitHub.
All builds are web apps or automation tools deployed live on Railway.

---

## Before You Do Anything

1. Read the CONTEXT.md inside the active build folder
2. Confirm the live Railway URL for this build
3. State what "working" means for this specific build's main user flow
4. List any unknowns — do not guess or invent

Do not write code until you have done all four.

---

## Definition of Done

A task is NOT done when:
- Code compiles
- Tests pass
- Railway says "deploy successful"

A task IS done only when:
- The live Railway URL is tested
- The exact user flow for this build works end to end
- You have confirmed this yourself, not asked Loric to check

---

## Required Build Loop

1. Implement the change
2. Deploy to Railway via CLI: railway up
3. Wait for deploy to complete
4. Fetch the live URL and test the exact user flow
5. If broken:
   - Run railway logs to read the error
   - Check for missing environment variables
   - Check network/API failures
   - Fix → redeploy → retest
6. Repeat until the live app works correctly

Never ask Loric to check the live app unless you are genuinely blocked
after two failed fix attempts, and always include the Railway logs when
you do.

---

## Railway Rules

- Deploy command: railway up
- Read logs command: railway logs
- Environment variables are set in the Railway dashboard — never hardcode
  them, never guess their names, always list which ones are required
- If a deploy fails, read the logs before doing anything else

---

## Hard Rules

- Never stop at deploy success
- Never guess commands — check package.json first
- Never invent environment variable names
- Never rewrite architecture when a small fix will do
- Never ask Loric to manually test unless truly blocked
- Follow existing code patterns in the project — do not invent new ones
- Prefer small targeted changes over large rewrites

---

## Session Start (every time)

When starting any session, before touching code:

1. Read CONTEXT.md in the active build folder
2. State current build status in 2 sentences
3. Confirm the live Railway URL
4. Confirm what done looks like for today's task
5. List unknowns

---

## End of Session

Before closing any session:

Update CONTEXT.md with:
- What was built or changed today
- Current status
- Live URL confirmed working (or current blocker)
- Exact next step for next session

Push to GitHub.

---

## Build Conventions

- Each build lives in its own subfolder inside MOKSHA Automations
- Each build has its own CONTEXT.md — read it, maintain it
- Company prefixes: OP (OstéoPeinture), FDL (FIDELIO), MOK (MOKSHA),
  RSV (RSV client), WED (weddings)
- Loric is not a developer — explain what you're doing in plain language
  before doing it, especially for structural changes
