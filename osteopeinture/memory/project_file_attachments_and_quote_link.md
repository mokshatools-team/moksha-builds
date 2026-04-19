---
name: File attachments persist + quote stays accessible from job
description: Images/docs shared in chat should be saved and browsable in the UI. Files should transfer to the job when a quote converts. The original quote must remain findable from the job dashboard.
type: project
---

**Requested (2026-04-19):** Three related features:

1. **File persistence in quote sessions:** images, floor plans, and docs shared in the chat should be saved and accessible from the interface — not just consumed by Claude and forgotten. A file gallery or attachment list within the session.

2. **File transfer to jobs:** when a quote converts to a job, all files from the chat session should carry over and be accessible in the job-specific dashboard (e.g., an "Attachments" or "Files" section alongside To Do, Products, etc.).

3. **Quote accessible from job:** once a session is converted to a job, the original quote should remain findable from within the job dashboard — a link or embedded view. The job already stores `quote_session_id` which links back to the session, so the data connection exists. Need a UI element (button or section) in the job detail that opens/shows the original quote.

**Current state:**
- Images sent in chat are processed by Claude but not stored persistently (they're in the messages array as base64 but not surfaced in the UI)
- `jobs.quote_session_id` links to the original session — data exists, just no UI for it
- No file/attachment table in Supabase yet

**Implementation notes:**
- May need a `job_files` or `attachments` table (id, job_id, session_id, filename, mime_type, storage_url, created_at)
- Storage: Supabase Storage bucket or Google Drive folder per job
- Quote link in job detail: simple button that opens `/preview/{quote_session_id}` in a new tab
