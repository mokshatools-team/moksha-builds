---
name: Don't block on data when building structure
description: Don't ask for data values (like opening balances) before building the structure that will hold them
type: feedback
---

Don't block on data inputs when the task is to build a structure. Opening balances, specific numbers, and content can be entered after the system is built — they don't affect the schema.

**Why:** Loric pushed back when I asked "which opening balances should we use?" before building the sheet. The sheet structure is independent of the data values. Asking for data before building wastes time and feels like unnecessary friction.

**How to apply:** When building any container (sheet, database, form) — build it first, ask for data second. Only block on data if the schema itself depends on it (e.g. unknown column count).
