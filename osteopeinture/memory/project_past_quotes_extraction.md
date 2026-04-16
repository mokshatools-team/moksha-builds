---
name: Past quotes extraction — 80 done, ~300 pending with filtering needed
description: 80 past quotes imported to Supabase with Claude search tool. Remaining ~300 PDFs need sorting before extraction — only extract actual quotes, recent ones, and ones that converted to jobs.
type: project
---

**Current state:**
- 80 quotes extracted and imported to `past_quotes` table in Supabase
- Claude tool `search_past_quotes` registered and working (searches by client, address, project_id)
- API endpoint: GET /api/past-quotes/search?q=term&type=interior
- ~300 PDFs in `past-quotes/pdfs/` NOT yet extracted

**Loric's filtering criteria for the remaining ~300:**
1. Only extract actual QUOTES (not invoices, not emails, not random docs)
2. Only recent ones (2024-2025 at minimum; older ones less useful)
3. Prioritize ones that actually converted to real jobs (not declined quotes)

**Approach for next session:**
- The PDFs were already classified earlier (interior/exterior/both/not-quotes) — use that classification to skip non-quotes
- Filter by filename date prefix (2024+ and 2025+)
- Run extraction on the filtered subset
- For "ones we converted" — cross-reference with client names or addresses that appear in finance sheet transactions (those are jobs that actually happened)

**Storage:** Option D confirmed — structured JSON in Supabase only, no PDFs stored in the app. Zero container bloat.

**Not imported yet:** SINCLAIR quotes (among others) — exist as PDFs but weren't in the initial 80 extraction batch.

**Next session:** Sort the ~300 PDFs using classification + date + finance-sheet cross-reference, then batch-extract the filtered set.
