---
name: Railway deploys take 2-3 minutes — don't test too early
description: railway up uploads instantly but the build + activate cycle takes 2-3 minutes. Wait before testing.
type: feedback
---

When deploying to Railway via `railway up`:

1. Upload completes immediately (`Indexing... Uploading...`)
2. Build runs in Docker (~90 seconds)
3. New deployment activates and replaces the old one (~30-60 seconds more)
4. Total: 2-3 minutes from `railway up` to active

**Don't test endpoints in the first 2 minutes.** You'll get the OLD version's responses and think the deploy didn't work. The old deployment is shown as `REMOVED` in the dashboard once the new one becomes `ACTIVE`.

**How to verify a deploy is active:**
- Use the `/api/version` endpoint with a version string in the response
- Or check the Railway dashboard for the `ACTIVE` deployment timestamp
- Or test a brand new endpoint that only exists in the latest code

**Build cache invalidation:**
- Editing `package.json` invalidates the npm install layer
- Editing the Dockerfile invalidates everything below the change
- File-only changes only invalidate the `COPY . .` step

**Railway Hobby tier throttling:**
- During high build volume, Railway pauses Hobby/Trial tier builds
- Status: https://status.railway.com (check before debugging deploy issues)
- Pro tier builds get priority
