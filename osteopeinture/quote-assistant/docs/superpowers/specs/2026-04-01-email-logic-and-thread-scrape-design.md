# Email Logic And Thread Scrape Design

## Summary

This design extends the existing Gmail scraping pipeline so it can collect full quote-related and lead-related thread context from January 1, 2025 through today, instead of only downloading PDF attachments. The extracted email dataset will be used to analyze how Ostéopeinture actually writes sent emails, then codify those patterns in a dedicated `EMAIL_LOGIC.md` file that Quote Assistant can use for smarter subject lines, signer-specific signatures, and context-sensitive quote email drafts.

This round does **not** build the intake workflow itself. The goal is to produce the reusable email intelligence layer that Quote Assistant can use immediately and that a future intake workflow can reuse later.

## Scope

In scope:

- Extend the Gmail scraper to capture relevant sent email threads, not just PDFs.
- Limit the analysis window to January 1, 2025 through the present.
- Build a structured dataset for thread-level email analysis.
- Analyze the dataset into reusable email-writing patterns.
- Create a dedicated `EMAIL_LOGIC.md` file for:
  - quote-send emails
  - quote-revision emails
  - quote follow-up emails
  - lead triage / intake-response branches at the logic level only
- Add signer-aware signature and sign-off rules for Loric, Graeme, and Lubo.
- Add subject-line pattern rules derived from real sent history.
- Wire Quote Assistant to use the new email logic file in a later implementation phase.

Out of scope:

- Building the intake form.
- Building the inbound email workflow.
- Automating estimate booking.
- Replacing `QUOTING_LOGIC.md`.
- Full mailbox scraping outside the filtered relevant dataset.

## Why A Separate File

`QUOTING_LOGIC.md` is already the estimating brain. Email behavior is a separate concern with different inputs, different decisions, and different reuse needs.

Putting this into `EMAIL_LOGIC.md` keeps responsibilities clean:

- `QUOTING_LOGIC.md` = estimate structure, scope, pricing, assumptions
- `EMAIL_LOGIC.md` = email branches, tone, signatures, subject patterns, drafting rules

This also makes the future intake workflow easier to build without having to pull email behavior back out of the quote logic later.

## Current State

The current Gmail scraper in `past-quotes/scrape-gmail.js`:

- logs into Gmail
- scans a fixed folder set
- filters by date
- downloads PDF attachments
- saves them to `past-quotes/pdfs/`

It does **not** currently persist:

- sent email body text
- thread context
- client message context
- signatures or sign-offs
- sender identity patterns
- subject line structure
- quote-email branching behavior

That means Quote Assistant cannot currently learn from how the team actually sends quotes or replies to leads.

## Recommended Approach

Build a second extraction layer around email threads rather than trying to infer email behavior from PDFs alone.

The pipeline should become:

1. Scrape relevant threads from Gmail
2. Save structured thread/email JSON locally
3. Analyze the structured dataset for recurring patterns
4. Write those patterns into `EMAIL_LOGIC.md`
5. Later, update Quote Assistant to reference `EMAIL_LOGIC.md` when drafting outgoing emails

This is cheaper and more robust than trying to hard-code email logic from memory.

## Data Sources

Use Gmail content from:

- sent threads containing quote emails
- sent threads containing lead triage / estimate-booking responses
- surrounding client messages in the same thread

Date range:

- `SINCE 1-Jan-2025`
- through current date

Accounts:

- `info@osteopeinture.com`
- `osteopeinture@gmail.com`

## Thread Selection Rules

Only keep threads/messages that are useful for email drafting analysis.

Include messages where one or more of the following is true:

- sent message has a PDF quote attached
- subject/body indicates quote sending, revision, estimate, painting quote, soumission, estimate booking, project intake, or follow-up
- thread contains a client project inquiry paired with a sent reply from Ostéopeinture

Exclude messages that are clearly irrelevant:

- supplier mail
- receipts
- internal notifications
- spam
- unrelated admin traffic

## Dataset Structure

Create a dedicated dataset folder, for example:

- `past-quotes/email-history/threads.json`
- `past-quotes/email-history/messages.json`
- `past-quotes/email-history/attachments.json`
- `past-quotes/email-patterns.md`

### Thread-level record

Each thread record should include:

- thread id
- account scraped
- first message date
- last message date
- participants
- language guess
- high-level classification:
  - quote_send
  - quote_revision
  - quote_follow_up
  - lead_triage
  - lead_more_info
  - decline
  - mixed / unknown
- whether a PDF quote is present
- whether photos are discussed
- whether an estimate visit is discussed
- whether a form / data request is present

### Message-level record

Each message record should include:

- thread id
- Gmail UID / message id where available
- date
- folder
- direction:
  - sent
  - received
- account / sender mailbox
- inferred signer:
  - Loric
  - Graeme
  - Lubo
  - unknown
- subject
- body text normalized
- quoted-reply text removed where possible
- detected signature block
- sign-off line
- attachment metadata
- language
- scenario tags

### Derived pattern fields

The analysis layer should extract:

- subject templates and recurring tokens
- signature variants by signer
- sign-off styles by signer
- detail level by scenario
- common call-to-action phrasing
- phase/explanation language when sending more complex quotes
- when emails are very short vs more explanatory
- when revisions mention deltas or phases

## Scraper Changes

Extend `past-quotes/scrape-gmail.js` so it can do more than save PDFs.

### Required scraper upgrades

- capture full parsed message metadata for relevant messages
- capture thread linkage using available email headers:
  - `message-id`
  - `in-reply-to`
  - `references`
- collect both sent and received messages that belong to the same relevant thread
- save raw-normalized text bodies for analysis
- keep PDF download behavior where useful

### Practical constraint

Gmail IMAP is not a perfect thread API. Thread grouping will likely need a hybrid strategy:

- use message headers first
- fall back to normalized subject grouping plus date/participant proximity

This is acceptable for the analysis layer as long as the grouping logic is explicit and conservative.

## Pattern Analysis Output

The extracted threads should be summarized into a markdown artifact that states:

- how quote emails are usually introduced
- what the common subject format is
- when the body is minimal vs detailed
- how phase-based explanations are framed
- how signers differ
- how decline / more-info / intake-style replies are phrased
- language split patterns
- recurring CTAs

This analysis markdown is an intermediate artifact, not the final operating logic.

## EMAIL_LOGIC.md Structure

Create `EMAIL_LOGIC.md` as the reusable operating file.

### Proposed sections

1. Purpose and scope
2. Shared tone rules
3. Language selection rules
4. Subject-line rules
5. Signer selection and signature rules
6. Quote-send email rules
7. Quote-revision email rules
8. Quote follow-up rules
9. Lead triage branch rules
10. More-info / intake-request rules
11. Decline branch rules
12. Variables required before drafting
13. What not to say / avoid

### Subject-line rules

Capture patterns such as:

- `Painting Quote`
- address
- short location shorthand
- season or month when known

The logic file should specify when to use:

- month-specific timing
- season-only timing
- no timing token

### Signer rules

The system should not guess silently if avoidable. Quote Assistant can ask:

- `Who should sign this? Loric / Graeme / Lubo`

`EMAIL_LOGIC.md` should define:

- preferred sign-off style by signer
- signature block by signer
- any consistent tone differences if they are strong enough to matter

## Quote Assistant Use

After this design is implemented, Quote Assistant should have enough information to:

- draft smarter quote-send emails
- choose a tighter or more detailed body based on the scenario
- use the right subject style
- use the correct signer signature
- mention phases when appropriate

It should not need the full future intake workflow to benefit from this work.

## Risks

### Thread reconstruction ambiguity

IMAP thread reconstruction will not be perfect. The mitigation is conservative grouping and explicit uncertainty handling.

### Sensitive data volume

Email bodies contain more sensitive context than PDFs alone. The dataset should stay local, be clearly scoped, and not be mixed casually into unrelated tooling.

### Pattern overfitting

Not every historical email pattern should become a rule. The analysis should look for recurring, current behavior, not one-off phrasing.

## Success Criteria

- Relevant Gmail threads from January 2025 through today are extracted into a structured local dataset.
- The dataset captures enough thread context to explain why specific reply styles were used.
- `EMAIL_LOGIC.md` exists as a dedicated reusable file.
- `EMAIL_LOGIC.md` contains subject rules, signer rules, quote-send logic, revision logic, and lead triage logic.
- Quote Assistant has a clear future source of truth for drafting smarter outbound emails.
