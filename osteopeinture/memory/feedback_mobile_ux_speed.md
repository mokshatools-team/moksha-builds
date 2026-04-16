---
name: Mobile UX must be instant — no round-trips per interaction
description: Loric tested the interactive checklists and rejected them because each tap caused a 2-second delay (3 network calls). Replaced with simple textareas that save on blur. Speed beats features every time on mobile.
type: feedback
---

Interactive checklists (tap circle to check, add items via input) were built and deployed but immediately rejected by Loric because they were too slow. Each checkbox tap triggered: fetch job → modify → save → reload page = 3 network round-trips = ~2 seconds of visible delay.

**Rule:** any mobile interaction must feel instant. If it requires a server round-trip before the user sees a result, it's too slow. Use optimistic UI (update visually first, save in background) or simpler patterns (textareas with blur-save).

**What worked:** simple textareas per section (To Do, To Clarify, To Bring, Products). User types/pastes freely, saves on blur — one background PATCH, no reload, no visible delay. Matches Apple Notes behavior.

**How to apply:**
- Default to textareas over interactive widgets for mobile-first features
- If building interactive elements, always use optimistic UI — update the DOM immediately, save in background
- Never reload the entire view after a single-item change
- Test on mobile (iPhone Safari PWA) before deploying interactive features

**Also from this session:**
- Enter key on mobile should create new lines, not send messages (fixed)
- Hamburger menu must be visible on ALL tabs, not just Chat (fixed — floating button top-right)
- Swipe between tabs: Chat ↔ Quote ↔ Email (Jobs accessed via sidebar toggle, not bottom tab)
- Bottom tabs: removed Jobs tab (accessible via sidebar Quotes/Jobs toggle instead)
