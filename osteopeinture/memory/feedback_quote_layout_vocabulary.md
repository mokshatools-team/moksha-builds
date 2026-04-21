---
name: Quote layout vocabulary — H1/H2/H3 tags for user to direct formatting
description: Loric wants to be able to tell Claude "put X as H1, Y as H2" to control quote layout. Map H1=grey bar header (floor/title), H2=bold section name, H3=bullet items. Build this into the system prompt next session.
type: feedback
---

**Request (2026-04-19):** Add shorthand tags so Loric can tell the assistant how to structure the quote layout:

- **H1** = grey bar header (PIÈCE 1, RÉPARATIONS, OPTIONS) → maps to `floor` or `title` field in JSON
- **H2** = bold name with price (Chambre (bleu foncé) — 975$) → maps to `name` field
- **H3** = bullet item lines (➛ Murs — 2 couches de finition) → maps to `items[].description`

**Example user instruction:** "Put PEINTURE as H1, then each room as H2 under it"
→ Claude outputs: `{ "floor": "PEINTURE", "name": "Pièce 1 — Chambre (bleu foncé)", ... }`

**Next session:** Add this vocabulary to the system prompt so Claude understands H1/H2/H3 shorthand. Also write a quick cheat sheet for Loric.
