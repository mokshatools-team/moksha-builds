---
name: Email sending via Resend HTTP API (Railway blocks SMTP)
description: Railway blocks all outbound SMTP. Emails sent via Resend HTTP API with verified osteopeinture.com domain on GoDaddy.
type: reference
---

**Problem:** Railway blocks outbound SMTP on both port 587 (STARTTLS) and 465 (SSL). Gmail SMTP fails with ENETUNREACH (IPv6) or Connection timeout (IPv4).

**Solution:** Resend HTTP API (resend.com). Free tier: 100 emails/day.

**Setup:**
- Resend account: logged in as info@osteopeinture.com
- Domain: osteopeinture.com — verified, DNS records on GoDaddy (DKIM TXT + SPF MX/TXT)
- API key: `RESEND_API_KEY` env var on Railway (`re_ZkdZCWcV_...`)
- Sends from: `OstéoPeinture <info@osteopeinture.com>`

**Code:** `server.js` POST `/api/sessions/:id/send-email` — checks for `RESEND_API_KEY`, uses Resend if present, falls back to SMTP for local dev.

**Package:** `resend` v6.12.0 in package.json.
