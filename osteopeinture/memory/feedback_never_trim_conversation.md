---
name: Never trim conversation history — full context is critical for quoting
description: Conversation trimming (last 14 messages) caused Claude to lose all scope details mid-quote. Reverted immediately. Use dynamic system prompt instead to save tokens.
type: feedback
---

**Rule:** NEVER trim conversation history. Send full message history to Claude on every request.

**Why:** Trimming to 14 messages caused Claude to lose zone breakdowns, hour calculations, and scope details on FREEMAN_01. It told the user "I don't have that context" after they'd spent 30+ messages building the quote. This is unacceptable for a quoting tool where every detail matters.

**How to apply:** Token cost savings come from the dynamic system prompt (only include relevant QUOTING_LOGIC sections), NOT from cutting conversation history. The full history is the user's work product — cutting it destroys the session.

**The dynamic prompt approach (implemented 2026-04-21):** scan conversation keywords, assemble only the sections needed. Simple clarification = 1.4K tokens (14% of full). Paint discussion = 2.2K. Quote generation = 4.2K. Full exterior = 9.6K.
