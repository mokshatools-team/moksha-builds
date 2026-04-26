# Ostéopeinture Server Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the quote-assistant prompt behavior in `osteopeinture-quote-assistant/server.js` so the app branches early between quick ballpark and full quote, gathers the right interior estimating inputs, and aligns email defaults with the quoting logic file.

**Architecture:** Keep the implementation contained to `server.js`. Replace the current single-path system prompt with a mode-aware prompt that distinguishes ballpark from full-quote intake, requires better assumption disclosure before JSON generation, and updates default email subject/body behavior so it does not conflict with the finalized quoting logic. Preserve the existing JSON structure and overall request/response plumbing.

**Tech Stack:** Node.js, Express, Anthropic SDK, Markdown prompt strings, nodemailer

---

### Task 1: Rewrite the system prompt conversation flow

**Files:**
- Modify: `osteopeinture-quote-assistant/server.js`
- Reference: `docs/superpowers/specs/2026-03-31-osteopeinture-server-prompt-design.md`

- [ ] **Step 1: Write the failing prompt-flow check**

Run:
```bash
rg -n "quick ballpark|full quote|paintable sqft|room dimensions|door-face|window count|closets|6h/day x 3 guys" /Users/loric/MOKSHA/FIDELIO\ Automations/osteopeinture-quote-assistant/server.js
```

Expected: missing one or more of these key prompt-flow phrases

- [ ] **Step 2: Replace the single intake path with the approved branch structure**

Update the `buildSystemPrompt()` conversation-flow text so it includes content equivalent to:

```js
## CONVERSATION FLOW

Phase 1 — Client and project overview:
- Collect client name, address, project type, and a basic description of the scope.
- After the overview, ask: "Do you want a quick ballpark or a full quote?"

Phase 2A — Quick ballpark:
- Use standards and room-average logic by room.
- Ask for room list and floor grouping when relevant.
- Ask whether the home/room style is modern or Victorian.
- Ask whether the space should be treated as low-end, mid-end, or high-end.
- Ask what surfaces are included in each room and whether closets are included when relevant.
- Do not recommend getting dimensions first.

Phase 2B — Full quote:
- Ask for room-by-room and floor-by-floor scope.
- Ask whether the user has paintable sqft, floor plans, or room dimensions.
- If available, prefer measured-surface logic.
- If not available, proceed with room-average fallback logic.
- Ask for door-face count, window count, window type, and closet inclusion when relevant.
- Ask special-condition questions only when triggered by scope.
```

- [ ] **Step 3: Run the prompt-flow check again**

Run:
```bash
rg -n "quick ballpark|full quote|paintable sqft|room dimensions|door-face|window count|closets|6h/day x 3 guys" /Users/loric/MOKSHA/FIDELIO\ Automations/osteopeinture-quote-assistant/server.js
```

Expected: all prompt-flow concepts present in the system prompt

- [ ] **Step 4: Commit**

```bash
git add /Users/loric/MOKSHA/FIDELIO\ Automations/osteopeinture-quote-assistant/server.js
git commit -m "feat: add ballpark and full-quote prompt branching"
```


### Task 2: Encode the default estimating assumptions

**Files:**
- Modify: `osteopeinture-quote-assistant/server.js`

- [ ] **Step 1: Write the failing assumption check**

Run:
```bash
rg -n "initial setup|teardown|30 min/day|6h/day x 3 guys|5 days/week|approximate the number of work days" /Users/loric/MOKSHA/FIDELIO\ Automations/osteopeinture-quote-assistant/server.js
```

Expected: missing one or more of these assumption rules

- [ ] **Step 2: Add the approved production defaults to the prompt**

Update the prompt so it includes content equivalent to:

```js
Default production assumptions:
- Initial setup + teardown: 3h once for the whole job
- Daily setup: 30 min/day
- Approximate work days from total labour hours using 6h/day x 3 guys
- Use a 5 days/week framing unless the user specifies otherwise
```

Also make the prompt say that the assistant should already approximate the number of work days from hours rather than waiting for the user to provide it.

- [ ] **Step 3: Run the assumption check again**

Run:
```bash
rg -n "Initial setup \\+ teardown: 3h|Daily setup: 30 min/day|6h/day x 3 guys|5 days/week|approximate the number of work days" /Users/loric/MOKSHA/FIDELIO\ Automations/osteopeinture-quote-assistant/server.js
```

Expected: all assumption rules found

- [ ] **Step 4: Commit**

```bash
git add /Users/loric/MOKSHA/FIDELIO\ Automations/osteopeinture-quote-assistant/server.js
git commit -m "feat: add default production assumptions to quote prompt"
```


### Task 3: Strengthen the pre-generation review behavior

**Files:**
- Modify: `osteopeinture-quote-assistant/server.js`

- [ ] **Step 1: Write the failing review-behavior check**

Run:
```bash
rg -n "ballpark estimate|standards / room averages|modern or Victorian|low-end, mid-end, or high-end|measured vs estimated|door and window assumptions|closet inclusion|setup and day-count assumptions|provisional benchmark" /Users/loric/MOKSHA/FIDELIO\ Automations/osteopeinture-quote-assistant/server.js
```

Expected: missing one or more of these review phrases

- [ ] **Step 2: Update the pre-generation review instructions**

Rewrite the review section in the prompt so it includes mode-specific confirmation requirements equivalent to:

```js
For quick ballpark, the review must state:
- this is a ballpark estimate
- it is based on standards / room averages
- the assumed home style: modern or Victorian
- the assumed tier: low-end, mid-end, or high-end

For full quote, the review must state:
- which parts were measured vs estimated
- door and window assumptions
- closet inclusion
- setup and day-count assumptions
- any provisional benchmark used
```

Keep the existing clean markdown summary pattern, but make assumptions explicit before JSON generation.

- [ ] **Step 3: Run the review-behavior check**

Run:
```bash
rg -n "ballpark estimate|standards / room averages|modern or Victorian|low-end, mid-end, or high-end|measured vs estimated|door and window assumptions|closet inclusion|setup and day-count assumptions|provisional benchmark" /Users/loric/MOKSHA/FIDELIO\ Automations/osteopeinture-quote-assistant/server.js
```

Expected: all review concepts present

- [ ] **Step 4: Commit**

```bash
git add /Users/loric/MOKSHA/FIDELIO\ Automations/osteopeinture-quote-assistant/server.js
git commit -m "feat: require estimating-mode assumption review before quote json"
```


### Task 4: Align email defaults with the quoting logic file

**Files:**
- Modify: `osteopeinture-quote-assistant/server.js`
- Reference: `osteopeinture-quote-assistant/QUOTING_LOGIC.md`

- [ ] **Step 1: Write the failing email-default check**

Run:
```bash
rg -n "Quote — \\$\\{projectId\\}|Hi \\$\\{clientFirstName\\}|painting work at your property|Looking forward to working with you" /Users/loric/MOKSHA/FIDELIO\ Automations/osteopeinture-quote-assistant/server.js
```

Expected: current generic defaults still present

- [ ] **Step 2: Update email defaults to match the quoting logic defaults**

Adjust the default subject/body logic so it follows the operational defaults in `QUOTING_LOGIC.md`, equivalent to:

```js
const emailSubject = subject || `Quote — ${projectId} — Ostéopeinture`;
const emailBody = body || `Bonjour ${clientFirstName},\n\nVeuillez trouver ci-joint notre soumission${addressReference}.\n\nN'hésitez pas à me contacter si vous avez des questions. Répondez à ce courriel pour confirmer ou discuter de la suite.\n\nOstéopeinture\n438-870-8087\ninfo@osteopeinture.com`;
```

If the quote address is known, reference it in the message. Keep the implementation simple and deterministic.

- [ ] **Step 3: Run the email-default check again**

Run:
```bash
rg -n "Quote — \\$\\{projectId\\} — Ostéopeinture|Répondez à ce courriel pour confirmer|Ostéopeinture\\\\n438-870-8087\\\\ninfo@osteopeinture.com" /Users/loric/MOKSHA/FIDELIO\ Automations/osteopeinture-quote-assistant/server.js
```

Expected: new defaults present

- [ ] **Step 4: Commit**

```bash
git add /Users/loric/MOKSHA/FIDELIO\ Automations/osteopeinture-quote-assistant/server.js
git commit -m "feat: align osteopeinture email defaults with quoting logic"
```


### Task 5: Verify the finished prompt behavior for consistency

**Files:**
- Modify: `osteopeinture-quote-assistant/server.js`
- Reference: `docs/superpowers/specs/2026-03-31-osteopeinture-server-prompt-design.md`

- [ ] **Step 1: Run a final spec coverage scan**

Run:
```bash
rg -n "quick ballpark|full quote|paintable sqft|room dimensions|modern or Victorian|low-end, mid-end, or high-end|door-face|window count|closets|3h|30 min/day|6h/day x 3 guys|5 days/week|measured vs estimated|provisional benchmark" /Users/loric/MOKSHA/FIDELIO\ Automations/osteopeinture-quote-assistant/server.js
```

Expected: all major prompt concepts present

- [ ] **Step 2: Perform a manual contradiction sweep**

Review the final prompt and email defaults for issues such as:

```md
- single-path instructions that still fight the new branch structure
- wording that recommends measuring before quoting
- prompt text that blurs ballpark and full-quote behavior
- review instructions that omit assumptions
- email defaults that conflict with QUOTING_LOGIC.md
```

- [ ] **Step 3: Save the final polished file**

Ensure the final `server.js`:

```md
- keeps the existing JSON format intact
- clearly branches between ballpark and full quote
- encodes default setup/day-count assumptions
- surfaces assumptions before JSON output
- uses aligned email defaults
```

- [ ] **Step 4: Verify the file exists and is non-empty**

Run:
```bash
wc -l /Users/loric/MOKSHA/FIDELIO\ Automations/osteopeinture-quote-assistant/server.js
```

Expected: a non-zero line count for the final file

- [ ] **Step 5: Commit**

```bash
git add /Users/loric/MOKSHA/FIDELIO\ Automations/osteopeinture-quote-assistant/server.js
git commit -m "feat: rework osteopeinture quote assistant prompt flow"
```
