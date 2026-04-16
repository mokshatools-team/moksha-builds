---
name: past_emails Supabase table — 193 real OstéoPeinture sent emails
description: Where the email tone-matching corpus lives, what's in it, how it's tagged, and how to re-import or extend.
type: reference
---

**Table:** `past_emails` in OP Hub Supabase project `qvxdzoysfmgekdcvhhzu`.

**Source data:** `osteopeinture/quote-assistant/past-quotes/email-history/messages.json` — 847 messages scraped from Gmail on 2026-04-01, 197 sent, 193 with body ≥50 chars.

**Schema:**
```
id TEXT PRIMARY KEY
message_id TEXT UNIQUE
sent_at TEXT
subject TEXT
to_address TEXT
to_name TEXT
body TEXT              ← normalizedText from Gmail scrape
sign_off TEXT
signer TEXT            ← Loric / Graeme / Lubo / Unknown (from signature block)
scenario TEXT          ← quote_send / quote_revision / quote_follow_up / decline / lead_more_info / project_update / other
language TEXT          ← french / english / unknown (from accent density)
thread_id TEXT
relevance_reasons TEXT
created_at TEXT
```

**Distribution (as of 2026-04-16):**
- 98 English / 92 French / 3 unknown
- Loric quote_send: 11 FR + 20 EN  ← primary use case
- Loric decline: 8 FR + 1 EN
- Most "other" rows are mid-thread replies that didn't match the keyword classifier

**Re-import / extend:**
```
node scripts/import-past-emails.js
```
Idempotent UPSERT — safe to re-run after improving classifiers. Reads from `past-quotes/email-history/messages.json`, so to add new emails, re-scrape Gmail first (the April 1 scraper spec exists somewhere in the repo, never re-run since).

**Used by:** `getPastEmailExamples(signer, scenario, language, limit)` in `server.js`, which feeds 3 examples into `/api/email/standalone-draft`'s Claude prompt as `<example>` blocks.
