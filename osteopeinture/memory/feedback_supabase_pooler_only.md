---
name: Supabase direct connection is IPv6-only — always use Session Pooler
description: The db.*.supabase.co direct connection fails on Railway and local networks (IPv4 only). Must use aws-*.pooler.supabase.com Session Pooler.
type: feedback
---

Supabase free-tier databases have IPv6-only direct connections. Both Railway containers and Loric's local network are IPv4-only. The direct connection string (`db.qvxdzoysfmgekdcvhhzu.supabase.co:5432`) fails with DNS resolution errors everywhere.

**Always use the Session Pooler:**
- Host: `aws-1-ca-central-1.pooler.supabase.com`
- Port: `5432`
- Username: `postgres.qvxdzoysfmgekdcvhhzu` (note the dot — pooler uses project-ref in the username)

**Why:** Supabase's free tier doesn't include an IPv4 add-on. The Session Pooler is the IPv4-compatible path and is the recommended connection method for serverless/container deployments anyway.

**How to apply:** When setting DATABASE_URL (in .env or Railway env vars), always use the pooler URL. If DNS resolution fails, check whether the URL accidentally uses the direct hostname.

**Supabase dashboard location:** Project Settings → Database → Connection string → change Mode dropdown to "Session pooler" to see the correct URL.
