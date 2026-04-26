# Ostéopeinture Interior Quoting Logic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the interior quoting brain in `osteopeinture-quote-assistant/QUOTING_LOGIC.md` so it follows the approved sqft-first, room-first quoting method and preserves embedded paint/material pricing.

**Architecture:** Keep the implementation contained to the quoting logic document. Replace the current pricing-memo structure with an operational interior quoting spec that defines estimating hierarchy, labour benchmarks, fallback rules, cost assembly, and assistant confirmation behavior. Preserve existing paint, primer, tax, deposit, and company-reference content, but reorganize it so the assistant can reason from estimating workflow to final quote output.

**Tech Stack:** Markdown, Node/Express app prompt file consumer (`osteopeinture-quote-assistant/server.js`), local workspace files

---

### Task 1: Build the new document structure

**Files:**
- Modify: `osteopeinture-quote-assistant/QUOTING_LOGIC.md`
- Reference: `docs/superpowers/specs/2026-03-31-osteopeinture-interior-quoting-logic-design.md`

- [ ] **Step 1: Write the failing structure check**

Confirm that the current document does not yet contain the new required operational sections.

Run:
```bash
rg -n "ESTIMATING HIERARCHY|LABOUR BENCHMARKS|CLIENT-FACING QUOTE PRESENTATION|KNOWN PROVISIONAL BENCHMARKS" /Users/loric/MOKSHA/FIDELIO\ Automations/osteopeinture-quote-assistant/QUOTING_LOGIC.md
```

Expected: no matches

- [ ] **Step 2: Replace the top-level outline with the new interior quoting structure**

Rewrite the document headings so the file is organized in this order:

```md
# OSTÉOPEINTURE — INTERIOR QUOTING LOGIC
# Main estimating brain for interior quotes.
# Last updated: March 31, 2026

---

## 1. ESTIMATING HIERARCHY

## 2. LABOUR RATES

## 3. LABOUR BENCHMARKS

## 4. SURFACE / UNIT ASSUMPTIONS

## 5. COVERAGE RATES

## 6. PAINT PRODUCT SELECTION

## 7. PRIMERS — CRITICAL RULES

## 8. FULL PAINT PRICE REFERENCE

## 9. FLOOR PROTECTION / MATERIALS

## 10. CONSUMABLES

## 11. COST ASSEMBLY RULES

## 12. CLIENT-FACING QUOTE PRESENTATION

## 13. ASSISTANT CONFIRMATION RULES

## 14. JOB TIER INDICATORS

## 15. SCOPE & TERMS DEFAULTS

## 16. TAXES (QC)

## 17. DEPOSIT & PAYMENT TERMS

## 18. PROJECT ID FORMAT

## 19. COMPANY INFO

## 20. KNOWN PROVISIONAL BENCHMARKS

## 21. EMAIL TEMPLATE
```

- [ ] **Step 3: Run the structure check again**

Run:
```bash
rg -n "ESTIMATING HIERARCHY|LABOUR BENCHMARKS|CLIENT-FACING QUOTE PRESENTATION|KNOWN PROVISIONAL BENCHMARKS" /Users/loric/MOKSHA/FIDELIO\ Automations/osteopeinture-quote-assistant/QUOTING_LOGIC.md
```

Expected: matches for each new section heading

- [ ] **Step 4: Commit**

```bash
git add /Users/loric/MOKSHA/FIDELIO\ Automations/osteopeinture-quote-assistant/QUOTING_LOGIC.md
git commit -m "docs: restructure osteopeinture interior quoting logic"
```


### Task 2: Encode the estimating hierarchy and labour rules

**Files:**
- Modify: `osteopeinture-quote-assistant/QUOTING_LOGIC.md`
- Reference: `docs/superpowers/specs/2026-03-31-osteopeinture-interior-quoting-logic-design.md`

- [ ] **Step 1: Write the failing content check for sqft-first logic**

Run:
```bash
rg -n "sqft-based|1.64 min/sqft per coat|30 min per face|Victorian|modern flat rectangular|room averages as fallback" /Users/loric/MOKSHA/FIDELIO\ Automations/osteopeinture-quote-assistant/QUOTING_LOGIC.md
```

Expected: missing one or more of these exact rules

- [ ] **Step 2: Add the new estimating hierarchy and labour benchmark content**

Insert content equivalent to the following under sections `1` through `4`:

```md
## 1. ESTIMATING HIERARCHY

- Interior quotes are built room by room first.
- Group room totals by floor when relevant.
- Prefer sqft-based estimating whenever paintable surface measurements are available.
- Fall back to room-average estimating only when measurements are not available.
- Use count-based allowances for doors and windows.
- State assumptions clearly and ask the user to confirm or adjust them before finalizing the quote.

## 2. LABOUR RATES

- Standard rate: $65/h unless otherwise specified
- Relationship / rebate clients: $55/h unless otherwise specified
- Carpentry / millwork: $65/h unless otherwise specified

## 3. LABOUR BENCHMARKS

- Walls: 1.64 min/sqft per coat
- Daily setup: 30 min per day
- When exact surface-specific benchmarks are missing, ceilings and trim-like surfaces may temporarily use the wall benchmark as a provisional sqft assumption.
- Room-average estimating is fallback only.

## 4. SURFACE / UNIT ASSUMPTIONS

- Doors: 30 min per face, including frame and inner frame
- Windows — standard Victorian / ancestral: 30 min per window, including frame and inner frame
- Windows — modern flat rectangular: 15 min per window
- If window type is unclear, state the assumption and ask the user to confirm it.
```

- [ ] **Step 3: Run the labour-rule check**

Run:
```bash
rg -n "1.64 min/sqft per coat|30 min per face|30 min per window|15 min per window|room-average estimating is fallback only|Daily setup: 30 min per day" /Users/loric/MOKSHA/FIDELIO\ Automations/osteopeinture-quote-assistant/QUOTING_LOGIC.md
```

Expected: all rules present exactly once or in clearly identifiable bullets

- [ ] **Step 4: Commit**

```bash
git add /Users/loric/MOKSHA/FIDELIO\ Automations/osteopeinture-quote-assistant/QUOTING_LOGIC.md
git commit -m "docs: add interior labour benchmarks and assumptions"
```


### Task 3: Preserve and reframe materials, products, and pricing

**Files:**
- Modify: `osteopeinture-quote-assistant/QUOTING_LOGIC.md`

- [ ] **Step 1: Write the failing content check for cost assembly rules**

Run:
```bash
rg -n "quantities must be calculated first|15% margin|distribute .* labour hours|include paint, protection materials, and consumables" /Users/loric/MOKSHA/FIDELIO\ Automations/osteopeinture-quote-assistant/QUOTING_LOGIC.md
```

Expected: no exact matches for this cost-assembly guidance

- [ ] **Step 2: Add the new cost assembly and presentation rules while preserving existing price tables**

Keep the current paint tables, primer rules, coverage rates, and floor-protection pricing, but add these sections:

```md
## 11. COST ASSEMBLY RULES

- Calculate labour hours per room first.
- Convert room hours to labour cost using the selected hourly rate.
- Calculate paint quantities before selecting final product costs.
- Apply a 15% margin to all paint and materials.
- Add consumables and protection/materials to the internal estimate.
- Sum room totals into floor subtotals when relevant, then into the project subtotal.

## 12. CLIENT-FACING QUOTE PRESENTATION

- By default, do not show paint and materials as separate line items.
- Include paint, protection materials, and consumables in the quoted room totals.
- Distribute non-labour costs across rooms proportionally by each room's share of total labour hours.
- If the quote is grouped by floor, room totals roll up into the floor subtotal.
```

Also preserve or adapt the existing markup explanation so it aligns with `15%` margin on all paint and materials.

- [ ] **Step 3: Run the cost-assembly check**

Run:
```bash
rg -n "Calculate labour hours per room first|Apply a 15% margin to all paint and materials|Distribute non-labour costs across rooms proportionally by each room's share of total labour hours|do not show paint and materials as separate line items" /Users/loric/MOKSHA/FIDELIO\ Automations/osteopeinture-quote-assistant/QUOTING_LOGIC.md
```

Expected: all four rules found

- [ ] **Step 4: Commit**

```bash
git add /Users/loric/MOKSHA/FIDELIO\ Automations/osteopeinture-quote-assistant/QUOTING_LOGIC.md
git commit -m "docs: align interior quote cost assembly with int1 method"
```


### Task 4: Add assistant behavior and provisional benchmark guidance

**Files:**
- Modify: `osteopeinture-quote-assistant/QUOTING_LOGIC.md`

- [ ] **Step 1: Write the failing behavior-rule check**

Run:
```bash
rg -n "ask for paintable sqft|tell the user when any benchmark is provisional|ask the user to confirm or adjust|Exterior quoting is out of scope" /Users/loric/MOKSHA/FIDELIO\ Automations/osteopeinture-quote-assistant/QUOTING_LOGIC.md
```

Expected: missing one or more of these behavior notes

- [ ] **Step 2: Add assistant confirmation rules and known provisional benchmark section**

Insert content equivalent to the following:

```md
## 13. ASSISTANT CONFIRMATION RULES

- Ask for paintable sqft or floor-plan dimensions when that information may be available.
- Prefer measured-surface logic over room averages.
- Tell the user when any benchmark is provisional.
- State assumptions for windows, doors, ceilings, trim, setup, and missing measurements.
- Ask the user to confirm or adjust those assumptions before generating the final quote.

## 20. KNOWN PROVISIONAL BENCHMARKS

- Walls have a confirmed benchmark of 1.64 min/sqft per coat.
- Ceilings may temporarily use the wall benchmark until a ceiling-specific benchmark is confirmed.
- Trim-like painted surfaces may temporarily use the wall benchmark until a trim-specific benchmark is confirmed.
- Room-average estimates remain valid fallback logic when measured surfaces are unavailable.
- This file governs interior quoting only. Exterior quoting requires separate logic.
```

- [ ] **Step 3: Run the behavior-rule check again**

Run:
```bash
rg -n "Ask for paintable sqft or floor-plan dimensions|Tell the user when any benchmark is provisional|Ask the user to confirm or adjust those assumptions before generating the final quote|Exterior quoting requires separate logic" /Users/loric/MOKSHA/FIDELIO\ Automations/osteopeinture-quote-assistant/QUOTING_LOGIC.md
```

Expected: all rules found

- [ ] **Step 4: Commit**

```bash
git add /Users/loric/MOKSHA/FIDELIO\ Automations/osteopeinture-quote-assistant/QUOTING_LOGIC.md
git commit -m "docs: add interior quoting confirmation and provisional rules"
```


### Task 5: Review the final document against the spec

**Files:**
- Modify: `osteopeinture-quote-assistant/QUOTING_LOGIC.md`
- Reference: `docs/superpowers/specs/2026-03-31-osteopeinture-interior-quoting-logic-design.md`

- [ ] **Step 1: Run a spec coverage scan**

Run:
```bash
rg -n "sqft-based|room-average|30 min per face|Victorian|15 min per window|15% margin|floor subtotals|confirm or adjust" /Users/loric/MOKSHA/FIDELIO\ Automations/osteopeinture-quote-assistant/QUOTING_LOGIC.md
```

Expected: all major approved rules present

- [ ] **Step 2: Perform a manual read-through for contradictions**

Review the full file and fix any of these issues if found:

```md
- old section titles that imply the file is only a pricing memo
- conflicting statements about markup vs margin
- any wording that implies paint/materials should be listed separately by default
- any wording that makes room averages sound preferred over sqft
- any wording that blurs interior and exterior logic together
```

- [ ] **Step 3: Save the final polished document**

Ensure the final document:

```md
- reads as an operational interior quoting brain
- preserves paint prices, primer rules, taxes, deposit logic, and company info
- makes provisional assumptions explicit
- is internally consistent
```

- [ ] **Step 4: Verify the final file exists and is non-empty**

Run:
```bash
wc -l /Users/loric/MOKSHA/FIDELIO\ Automations/osteopeinture-quote-assistant/QUOTING_LOGIC.md
```

Expected: a non-zero line count substantially larger than a stub file

- [ ] **Step 5: Commit**

```bash
git add /Users/loric/MOKSHA/FIDELIO\ Automations/osteopeinture-quote-assistant/QUOTING_LOGIC.md
git commit -m "docs: rewrite osteopeinture interior quoting logic"
```
