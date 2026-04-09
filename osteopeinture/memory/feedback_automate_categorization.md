---
name: Never ask Loric to manually categorize transactions
description: Auto-categorize bank imports using autocat rules — manual review is unacceptable
type: feedback
---

Never present Loric with uncategorized rows and ask him to fill in categories manually. Auto-categorize everything using the autocat-rules.json lookup table first. Only flag the ones that can't be matched for his input.

**Why:** Loric reacted strongly ("are you crazy") when presented with 98 uncategorized rows to review. The AutoCat rules from the Tiller Master sheet exist for exactly this purpose. Manual categorization of bank imports is not an acceptable workflow.

**How to apply:** Every import pipeline must: parse CSV → auto-categorize via keyword matching → generate mirrors → only surface unmatched rows for review. The autocat-rules.json file is at `osteopeinture/finance-system/autocat-rules.json`. The Tiller Master sheet (ID: `12FT0agrTeIdrC929n-vjEWLG9Uxbf136VxpESs-Kcsc`) has the source AutoCat tab if rules need updating.
