# OSTÉOPEINTURE — EMAIL LOGIC
# Shared drafting rules for quote-send emails and future lead-response workflows.
# Last updated: April 1, 2026

## 1. PURPOSE

- This file governs how the assistant drafts client emails.
- `QUOTING_LOGIC.md` remains the estimating brain.
- `EMAIL_LOGIC.md` is the communication brain.
- This file is shared across:
  - Quote Assistant
  - future lead / intake / client-email workflow automation
- Use this file for:
  - sending quotes
  - sending revised quotes
  - following up on sent quotes
  - telling a client their quote is coming shortly
  - declining jobs
  - asking for more info before an estimate
  - following up on a lead before a quote exists
  - sending project-update / cost-update emails

## 1A. TOOL BOUNDARY

### Quote Assistant UI

- Quote Assistant should expose only the two direct quote-send modes:
  - `quote_send`
  - `quote_revision`
- These are the only email types that should appear in the Quote Assistant email panel.
- The rest of the branches below remain relevant, but they belong to broader email workflow automation, not the quote-send UI.

### Future Email Workflow Automation

- The following branches are still part of the shared email brain and should be preserved for future automation:
  - `quote_follow_up`
  - `quote_promise`
  - `decline`
  - `lead_more_info`
  - `lead_follow_up`
  - `project_update`

## 2. DEFAULT TONE

- Clear, direct, operational.
- No salesy fluff.
- No over-explaining unless the project actually needs explanation.
- Default to short emails.
- Sound human and project-specific, not templated.
- If the project already had a phone call or enough back-and-forth, the email can be very minimal.
- Add more context only when there is a concrete reason:
  - phased work
  - revised scope
  - updated pricing
  - scheduling constraints
  - decline explanation
  - unusual assumptions the client should understand

## 3. REQUIRED INPUTS

Before drafting, gather or infer:

- scenario:
  - `quote_send`
  - `quote_revision`
  - `quote_follow_up`
  - `quote_promise`
  - `decline`
  - `lead_more_info`
  - `lead_follow_up`
  - `project_update`
- signer:
  - `Loric`
  - `Graeme`
  - `Lubo`
- client / project name
- address or short project label
- month or season marker if useful
- whether the email should be:
  - minimal
  - standard
  - detailed
- whether phases or project updates must be explained

If signer is unknown, ask: `Who should sign this? Loric, Graeme, or Lubo?`

## 4. SUBJECT LINE RULES

- Subjects should be utilitarian, not clever.
- Default structure:
  - `[Quote / Soumission / Estimate / Update] — [address or project] — [month or season if useful]`
- Use month if timing is specific and known.
- Use season if month is not locked.
- Keep the address/project visible early in the subject.
- Do not write long explanatory subjects.

Preferred patterns:

- `Painting Quote — [address] — [Season Year]`
- `Soumission — [address / project]`
- `Estimate for [address / project]`
- `Revised Quote — [address / project]`
- `Project Update / Cost Breakdown — [address / project]`
- `Suivi — [address / project]`

## 5. SIGNER RULES

- Signature is signer-specific and must not default to one person.
- The tool should ask who signs the email.
- Prefer the signer's usual sign-off and signature style based on scraped history.
- Best-effort pattern hints from the current dataset:
  - Loric often uses `Best,`, `Merci,`, or `Regards,`
  - Graeme often uses `Thank you,` or `Regards,`
  - Lubo often uses `Cordialement,` or `Merci!`
- If the exact signature block is known from stored history, reuse that style.
- Do not invent a long formal signature if the signer usually keeps it short.

## 6. QUOTE SEND LOGIC

### Default mode

- Keep it short.
- Tell them the quote is attached.
- Add one short line of context if needed.
- End with a simple CTA:
  - review and let us know
  - send questions
  - confirm if they want to move ahead

### Minimal mode

Use when:

- the scope was already discussed clearly
- the client already expects the quote
- there are no important caveats
- there is no need to explain phases or assumptions

Shape:

- greeting
- quote attached
- short CTA
- signer block

### Detailed mode

Use when:

- the quote includes notable assumptions
- the project is phased
- the quote changed materially from earlier discussions
- there is useful schedule or scope context to frame

Shape:

- greeting
- quote attached
- 1 short paragraph explaining the important framing only
- CTA
- signer block

### Phase / update mode

Use when:

- the quote is split into phases
- there is a cost breakdown or update summary
- there are optional next steps

Rules:

- explain phases plainly
- do not dump the whole estimate into the email body
- summarize what changed or how the work is staged
- keep it readable in one screen when possible

## 6A. QUOTE PROMISE LOGIC

Use when:

- the client is waiting on a quote
- you want to reassure them it is coming
- the quote is not attached yet

Rules:

- keep it very short
- reassure them you did not forget
- give a concrete timing marker if possible
- do not over-explain a delay unless useful

## 7. QUOTE REVISION LOGIC

- Make it obvious that the quote is updated or revised.
- Say what changed in one or two concrete lines.
- Do not re-explain the full project unless needed.
- Good uses:
  - scope adjustment
  - pricing update
  - phasing update
  - alternate option

Default CTA:

- review the updated quote and let us know

## 8. QUOTE FOLLOW-UP LOGIC

- Follow-up should stay light.
- Do not pressure.
- Assume the client may simply be busy.
- Keep it short unless there is a genuine project update to share.

Default shape:

- short check-in
- offer to answer questions
- optional note on schedule / availability if relevant
- signer block

## 8A. LEAD FOLLOW-UP LOGIC

Use when:

- a lead came in
- they went quiet
- no quote has been sent yet

Rules:

- ask if they are still looking
- invite one next step only:
  - reply
  - call
  - send photos
  - confirm estimate timing
- keep it lighter than a quote follow-up

## 9. DECLINE LOGIC

Valid decline reasons include:

- fully booked / no availability
- outside service area
- not the right fit
- scope is outside what we do
- budget appears mismatched
- product / technical constraints make the job a poor fit

Rules:

- be polite but brief
- do not over-apologize
- give a simple real reason when useful
- do not leave the email vague if a short explanation will avoid confusion

If useful, suggest:

- another contractor
- reconnecting later
- sending details for a future season

## 10. MORE-INFO-BEFORE-ESTIMATE LOGIC

Use when the lead looks potentially interesting but there is not enough data yet.

Primary asks:

- photos
- short project description
- interior / exterior / both
- rough timing or deadline
- any notable constraints
- rough availability for an estimate visit

Rules:

- do not ask for everything in a clumsy wall of text
- prioritize the few pieces that help decide:
  - fit
  - urgency
  - whether to book an estimate
  - whether a ballpark quote is enough first
- ask only for the next missing layer, not the whole intake in one email

This section is meant to support the future intake workflow too, but no intake form logic should be hard-coded here yet.

## 10A. PROJECT UPDATE / COST UPDATE LOGIC

Use when:

- work is already underway
- there is a meaningful cost update
- there is a phase / scope / repair adjustment
- scaffolding, additions, or change-order style costs need explaining

Rules:

- be more explanatory than a normal quote email
- explain what changed in plain language
- do not dump full internal calculations into the body
- keep the action clear:
  - review the update
  - confirm understanding
  - approve the next step if needed

## 11. DETAIL-LEVEL DECISION RULES

- Choose `minimal` when nothing extra needs saying.
- Choose `standard` when one short paragraph adds helpful framing.
- Choose `detailed` only when the client genuinely needs context.

Add detail when:

- phases matter
- revisions matter
- schedule or sequence matters
- there is a decline explanation
- you need to explain what is and is not included
- there is a meaningful project-cost update

Stay minimal when:

- the quote is straightforward
- you already covered the main points by phone
- the attachment speaks for itself

## 12. CTA RULES

Most useful CTAs in this dataset:

- invite questions
- tell them the quote is attached
- ask them to review and get back to us
- request photos
- request availability
- confirm if they want to move ahead
- tell them the quote is coming shortly
- ask whether they are still looking

Avoid:

- generic salesy closes
- multiple competing CTAs in one short email
- long lists of next steps unless the scenario truly needs them

## 13. WHAT THE ASSISTANT SHOULD DO

When drafting:

- choose the scenario first
- choose the signer explicitly
- choose the subject in the utilitarian format
- decide the detail level
- write the shortest email that still does the job
- mention phases / updates only when they matter
- keep the body aligned with the actual relationship and prior thread context

## 14. WHAT THE ASSISTANT SHOULD NOT DO

- Do not use client-facing marketing language.
- Do not sound overly polished or corporate.
- Do not add filler compliments or fake warmth.
- Do not write long explanations by default.
- Do not hard-code one signature for everyone.
- Do not mix quoting math into the email body unless the user asks for it.
- Do not treat invoices / payment emails as the default pattern for quote drafting.
