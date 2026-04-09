---
name: Bump the # Version line when editing QUOTING_LOGIC.md — or the volume won't update
description: The OP Hub force-reseed mechanism only overwrites the Railway volume copy of QUOTING_LOGIC.md when the # Version header in the repo differs from the volume. Silent failure if you forget to bump.
type: feedback
---

`osteopeinture/quote-assistant/server.js` seeds `QUOTING_LOGIC.md` to the Railway persistent volume on boot and then reads the volume copy on every request. The admin panel writes to the volume too. To push an authoritative update from the repo on deploy, the server compares a `# Version:` header line at the top of the seed file vs the volume copy and force-overwrites the volume only when they differ.

**Rule:** any time you edit `osteopeinture/quote-assistant/QUOTING_LOGIC.md`, bump the `# Version:` line at the top of the file. If you forget, the deploy will succeed but the live app will continue to read the old volume copy and the edit will appear to have done nothing.

**Why:** the version comparison is the only force-reseed trigger. There is no other way to push repo changes to the volume short of wiping the volume or editing via the admin panel (which the CLAUDE.md explicitly forbids relying on for deploy-driven updates).

**How to apply:**

1. Edit QUOTING_LOGIC.md as needed.
2. Update the second-from-top line: `# Version: vN — short description of change`.
3. Deploy. In `railway logs` you should see a line like:
   ```
   [quoting-logic] Force-reseeded: <old version> -> <new version>
   ```
4. If the log line doesn't appear, either the version didn't change, or the seed file wasn't uploaded. Check the diff.

**Verification:**
```bash
curl -s https://op-quote-assistant.up.railway.app/api/quoting-logic | \
  python3 -c "import sys,json; print([l for l in json.load(sys.stdin)['content'].split('\n')[:6] if 'Version' in l])"
```
Should print the new version string.

**Side effect by design:** bumping the version clobbers any admin-panel edits Loric made to the volume copy since the last deploy. This is intentional — deploys are authoritative. If Loric is making live edits via the admin panel, coordinate before bumping.

**Code location:** `server.js`, `readQuotingLogicVersion()` + the seed block near the top of the file (search for `Force-reseeded`).
