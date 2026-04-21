---
name: Supabase Storage for file attachments
description: Images from chat stored in op-hub-attachments bucket. SDK installed, env vars on Railway. Attachments table tracks metadata.
type: reference
---

**Supabase Storage bucket:** `op-hub-attachments` (public read)
**SDK:** `@supabase/supabase-js` v2 in package.json
**Env vars on Railway:** `SUPABASE_URL` (https://qvxdzoysfmgekdcvhhzu.supabase.co) + `SUPABASE_ANON_KEY`
**File path convention:** `sessions/{sessionId}/{fileId}.jpeg`
**DB table:** `attachments` (id, session_id, job_id, filename, original_name, content_type, size_bytes, storage_path, public_url, created_at)
**Transfer:** on job conversion, `UPDATE attachments SET job_id = ? WHERE session_id = ?`
**Free tier limit:** 1GB storage
