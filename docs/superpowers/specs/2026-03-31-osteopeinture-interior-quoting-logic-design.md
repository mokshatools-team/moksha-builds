# Ostéopeinture Interior Quoting Logic Design

**Date:** 2026-03-31

## Goal

Rewrite the interior quoting logic brain so the assistant estimates like the manual `INT 1` quoting template: calculate by room first, group by floor when relevant, derive labour from measurable surfaces when available, include paint and materials in quoted room totals, and surface assumptions for user confirmation before finalizing.

## Scope

This design covers interior quoting logic only.

It does not cover:
- exterior quoting logic
- training on past quotes
- Gmail or PDF ingestion
- UI changes

## Current State

The current quoting brain in `osteopeinture-quote-assistant/QUOTING_LOGIC.md` is strong on paint pricing, product defaults, primers, and business terms, but weak on labour benchmarking and estimating flow.

The manual source of truth observed in `/Users/loric/Downloads/KENNERKNECHT_01 - INT 1.csv` shows a different operating model:
- quote math is built room by room
- labour is broken down by task
- floors can be subtotaled separately
- paint, materials, and consumables are included in the total quote
- paint and materials are not typically exposed as separate client-facing line items

## Required Estimating Hierarchy

The assistant must estimate interiors in this order:

1. Build the quote room by room.
2. Group room totals by floor when the project is naturally split that way.
3. Sum floor totals into a project subtotal.
4. Prefer sqft-based estimation whenever dimensions, floor plans, or paintable surface measurements are available.
5. Fall back to average per-room time benchmarks only when reliable measurements are not available.
6. Use count-based allowances for items that are better estimated by unit than by area.
7. State assumptions clearly and ask the user to confirm or adjust them before the final quote is generated.

## Labour Model

### Core rule

Labour defaults to `$65/h` unless the user specifies a different rate.

### Sqft-first estimating

When paintable surface area is known, the assistant should use sqft-based benchmarks as the primary time driver.

Current confirmed benchmark:
- Walls: `1.64 min/sqft per coat`

Operational note:
- This wall benchmark excludes setup time.
- Setup must be added separately.

### Temporary provisional benchmark policy

Sqft-based logic should apply to all paintable surfaces, but current benchmark data is incomplete.

Until more surface-specific benchmarks are available:
- ceilings may temporarily use the same time-per-sqft benchmark as walls
- trim-like painted surface totals may also temporarily use the same time-per-sqft benchmark when only area is known
- these assumptions must be explicitly labeled as provisional
- the assistant must ask the user to confirm or adjust those assumptions

This is intentionally approximate. The system should prefer an explicit stated assumption over silent false precision.

### Unit-based allowances

Use fixed unit allowances for the following:

- Doors: `30 min per face`, including door frame and inner frame
- Windows, standard Victorian / ancestral: `30 min per window`, including frame and inner frame
- Windows, modern flat rectangular: `15 min per window`

The assistant must state which window type assumption was used and ask for confirmation if unclear.

### Fallback room-average mode

When sqft or measurable surfaces are not available:
- revert to average per-room time logic
- use room averages as fallback only, not as the preferred method
- tell the user that the estimate is based on room averages rather than measured surfaces

## Operational Time Allowances

The logic file should explicitly separate productive painting time from job-operation time.

Known confirmed rule:
- Daily setup: `30 min per day`

The file rewrite should also preserve the concept of separate allowances for:
- initial setup
- protection / covering
- preparation
- spot priming or full priming
- daily teardown
- touch-ups
- final cleanup
- pack-out

Where current benchmark confidence is weak, the file should mark these as fallback allowances or manual-adjustment items rather than pretend they are exact.

## Cost Model

The quote must distinguish internal estimating math from client-facing presentation.

### Internal estimate

The assistant should calculate:
- labour hours per room
- labour cost per room
- floor subtotals when applicable
- total project labour
- paint quantities by surface and product
- paint cost before tax
- protection and other material costs
- consumables

After material quantities are calculated:
- apply `15%` margin to all paint and materials

Material pricing should remain embedded in the quoting logic file as the editable source of truth.

### Client-facing quote

By default, the quote should not present paint and materials as separate line items.

Instead:
- include paint, protection materials, and consumables in the quoted item totals
- distribute these non-labour costs across rooms proportionally by each room's share of total labour hours
- if grouped by floor, room totals should roll up into floor subtotals

This preserves internal costing accuracy while matching how Ostéopeinture actually presents quotes.

## Paint and Material Logic

The reworked file should preserve and reorganize the existing strengths of the current quoting brain:
- product defaults by tier and surface
- primer decision rules
- paint price reference tables
- taxes, terms, and deposit rules

The key change is how these interact with labour and quote assembly:
- quantities must be calculated first
- product selection then determines unit cost
- costs are accumulated internally
- `15%` material margin is applied
- final room pricing absorbs these amounts instead of listing them separately

## Assistant Behavior Rules

The logic file should instruct the assistant to:
- ask for paintable sqft or floor-plan dimensions when that information may be available
- prefer measured-surface logic over room averages
- tell the user when any benchmark is provisional
- state assumptions for windows, doors, ceilings, trim, setup, and missing measurements
- present the estimate summary for confirmation before generating final quote output
- invite the user to adjust any assumption or benchmark that does not fit the project reality

## Required Output Shape

The logic file should support quotes that can be presented:
- by room
- by floor, when relevant

It should not yet attempt to support exterior facade grouping in the same logic path.

## File Rewrite Strategy

`osteopeinture-quote-assistant/QUOTING_LOGIC.md` should be reorganized into a more operational structure:

1. Estimating hierarchy and quoting workflow
2. Labour benchmarks and fallback rules
3. Surface and unit assumptions
4. Paint quantity and product selection rules
5. Material and consumable pricing rules
6. Cost assembly rules
7. Client-facing quote presentation rules
8. Business terms, taxes, deposit, and company info
9. Known provisional benchmarks and confirmation requirements

## Constraints

- The first rewrite must remain usable even though some benchmark data is still incomplete.
- The assistant should be transparent about approximations rather than hiding them.
- Embedded paint pricing is acceptable because prices do not change often.
- Exterior logic is out of scope for this rewrite because its grouping hierarchy and estimating logic differ materially from interior quoting.

## Success Criteria

The reworked quoting logic file is successful if:
- the assistant prefers sqft-based estimating when measurements are available
- the assistant can still quote when measurements are missing by falling back to room averages
- room totals can be rolled into floor subtotals
- paint and material cost are included in room pricing rather than shown separately by default
- assumptions are surfaced clearly for confirmation
- the file reads like an operational quoting brain rather than a loose pricing memo
