---
name: Past quotes search — import 252 PDFs + extracted JSON into Supabase for Claude tool use
description: Plan to give Claude institutional memory of past quotes via a search_past_quotes tool and serve original PDFs as static files
type: project
---

**What exists:**
- `past-quotes/pdfs/` — 252 scraped PDFs from Gmail (2024-2025)
- `past-quotes/extracted-interior.json`, `extracted-exterior.json`, `extracted-both.json` — 94 quotes extracted into structured JSON
- `past-quotes/interior-patterns.md`, `exterior-patterns.md` — pattern analysis that fed QUOTING_LOGIC §22 and §27

**What to build (~1 session):**
1. Create `past_quotes` table in Supabase: client_name, address, project_id, date, type, total, sections_json, source_pdf_filename
2. Import the 94 extracted JSONs
3. Copy 252 PDFs to `public/past-quotes/` (or Google Drive if container size is a concern)
4. Register a `search_past_quotes` Claude tool — queries by client, address, type, price range
5. When Claude finds a match, it includes a link to the original PDF in its response
6. No search UI needed initially — Claude uses it conversationally

**Loric confirmed:** wants the original PDFs served as-is (not just the extracted data). User clicks link → PDF opens in browser.

**Filename concern:** scraped filenames are ugly. Create a clean filename mapping in the DB table.

**Next session:** build this.
