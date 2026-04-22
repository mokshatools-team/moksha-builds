---
name: Dynamic system prompt — only include relevant QUOTING_LOGIC sections per message
description: System prompt now scans conversation keywords and assembles only needed sections. Saves 50-85% tokens per request without losing context.
type: project
---

**Implemented (2026-04-21):** `buildDynamicQuotingLogic()` in server.js.

**How it works:**
- Always includes: §1-2 (core), §11-14 (cost assembly, presentation), §15-19 (scope, taxes, deposit)
- Conditionally includes based on keyword detection:
  - Benchmarks (§3-4): room, surface, hour, door, window, baseboard, ceiling
  - Coverage (§5): gallon, coverage, quantity
  - Paint (§6-8): paint, product, color, finish, primer, brand names
  - Materials (§9-10A): protection, consumable, material
  - JSON format (§22): generate, regenerate, adjust
  - Exterior (§23-29): exterior flag from session detection
  - Scaffold (§30-35): scaffold, lift, EMCO, ladder

**Token savings:**
- Simple clarification: ~1.4K tokens (14% of 9.6K full)
- Paint discussion: ~2.2K (23%)
- Quote generation: ~4.2K (43%)
- Full exterior+scaffold: 9.6K (100%)

**Next improvement:** could cache the assembled prompt per conversation state to avoid re-scanning, but current approach is fast enough (string search + slice).
