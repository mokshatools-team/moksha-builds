---
name: Smart paste should route paint/product data to Products section, not scratchpad
description: The Apple Notes smart paste extraction dumps paint qty/color/product lines into the remainder (scratchpad). User wants them routed to the Products section of the job instead.
type: feedback
---

**Observed:** pasting a note with a PAINT block like:

    PAINT
    Trim - advance OC-17 pearl -- ? gal
    Ceiling - ultra spec OC-17 flat -- 4 gal
    Walls - regal, ultimatte, color ? -- 6 gal

...ends up in the scratchpad remainder, not the Products section.

**Why:** the smart paste Claude prompt in `POST /api/jobs/:id/smart-paste` only extracts these fields: clientName, address, phone, contractTotal, paintTotal, consumablesTotal, laborCost, payments[], remainder. It doesn't know about the job's section structure (To Do, To Clarify, To Bring, Products).

**Fix (next session):** update the smart paste prompt to also extract a `products` string field that captures paint/product/material lines. Then in `/api/jobs/:id/smart-paste/apply`, write that string to `job_sections.products` instead of the scratchpad.

**Rule of thumb:** any line that mentions paint products (BM, SW, Regal, Advance, Ultra Spec, Duration Home, etc.), gallons/quantities, or paint finishes (flat, semi-gloss, eggshell, satin) should go to Products. Free-form notes stay in scratchpad.
