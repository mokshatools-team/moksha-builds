---
name: Draft editor architecture
description: Editable quote doc in right panel — state-driven, auto-save, panel mode enum, total overrides
type: project
---

Draft editor shipped 2026-04-26. Key architecture decisions:

- **Panel mode enum** (`placeholder | draft | pdf | gallery`) via `setPanelMode()` — replaces scattered show/hide toggles. Codex review flagged the old approach as bug-prone.
- **State-driven, not DOM-scraped** — one in-memory `draftQuoteJson` object, inputs update it directly, saves from state. Codex recommended this over contenteditable + DOM scraping.
- **`<input>/<textarea>` instead of `contenteditable`** — avoids paste sanitization, caret jumps, mobile IME quirks in a 5K-line vanilla JS file.
- **Total override system** — `sec._totalOverride` flag (stripped before saving to server). When locked, section total is manual; when unlocked, auto-sums from items. Allows H2 sections without any H3 items.
- **Grouping is render-only** — derived from flat `sections[]` by reading `floor` values. No group objects in data model. Matches how `renderQuoteHTML` works.
- **`/api/sessions/:id/adjust-quote`** is the save endpoint — already existed but was unused. Fixed to skip excluded/optional in totals + update emailRecipient.

**Why:** Loric needed to edit quotes directly (prices, text, structure) without constant chat back-and-forth. The Draft is the workspace; the Quote PDF is the output.

**How to apply:** When touching the draft editor, maintain the state-driven pattern. Never read from DOM to build JSON. The `_totalOverride` flag is UI-only — always strip it before server saves.
