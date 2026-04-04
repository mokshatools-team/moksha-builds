# Cover Image Tool — Build Brief
## Part of the Loric / Dre Alexandra Mokshatools Ecosystem

---

## What You're Building

A Flask web tool hosted at `covers.mokshatools.com` (port **4300**) that generates on-brand social media cover images (primarily for Instagram/Facebook) from video content metadata.

Dre Alexandra Champagne is a French-language medical content creator. Her social media manager (Loric) currently makes cover images manually. This tool automates it.

---

## The Ecosystem — Tools Already Live

All tools follow the same pattern: Flask server → local port → Cloudflare Tunnel → `*.mokshatools.com`. Runtime files live in `~/.<toolname>/` (macOS launchd TCC workaround — can't read from ~/Documents/).

| URL | Port | Tool | Runtime dir |
|-----|------|------|-------------|
| `mokshatools.com` | 9000 | Homepage | `~/.mokshatools-home/` |
| `stream.mokshatools.com` | 3333 | Moksha Stream (voice → text) | `~/.moksha/` |
| `studio.mokshatools.com` | 5150 | Nano Banana (AI image gen via FAL.ai) | `~/.nanobana/` |
| `post.mokshatools.com` | 4200 | Social Scribe (transcript → metadata) | `~/.postprod/` |
| `inventory.mokshatools.com` | 4100 | Content Inventory (TT/YT gap analysis) | `~/.inventory/` |

**Your tool:** `covers.mokshatools.com` → port **4300** → runtime `~/.covers/`

---

## What the Tool Does

Loric pastes in:
- A video **title** (or picks from recent post-production tool outputs)
- The **thumbnail copy** (short punchy text, 3–7 words) — this comes from the post-production tool
- Optionally a **topic/context** snippet

The tool outputs a ready-to-download cover image in Instagram/Facebook format (1:1 square and/or 4:5 portrait) with:
- On-brand background (Dre Alexandra's palette: clean medical aesthetic, white/cream/deep teal or navy)
- The thumbnail copy as the main headline text
- Her name or channel branding in a secondary position
- Clean, minimal design — not AI-generated art, more like a professional social media card

---

## Implementation Approach

Use **Pillow (PIL)** to composite the image programmatically:
1. Background: solid brand color OR a soft gradient (configurable per brand profile)
2. Text rendering: headline in a bold sans-serif (use a bundled font — Inter or Montserrat TTF)
3. Optional: logo/watermark layer
4. Output: PNG download, 1080×1080 (square) and 1080×1350 (portrait)

**Do NOT use AI image generation for this** — the client needs consistent, on-brand, predictable outputs. Pillow compositing is the right approach.

Future enhancement: accept a video frame/thumbnail as a background image layer (upload or URL).

---

## Brand Profile: Dre Alexandra (default client)

```json
{
  "name": "Dre Alexandra Champagne",
  "handle": "@DreAlexandra",
  "palette": {
    "primary": "#1A3A4A",
    "accent": "#C8A96E",
    "background": "#FFFFFF",
    "text_on_dark": "#FFFFFF",
    "text_on_light": "#1A3A4A"
  },
  "font_headline": "bold",
  "font_body": "regular",
  "logo": null,
  "tagline": "Médecine · Santé · Prévention"
}
```

The exact colors can be adjusted — this is a starting point. Keep it clean, medical, professional. Not flashy.

---

## Project Structure

```
MOKSHA Post Production/cover-image-tool/
  cover_server.py         ← Flask server + web UI
  cover_generator.py      ← Pillow image compositing engine
  brand_profiles/
    dre_alexandra.json    ← brand config (colors, fonts, layout)
  fonts/
    Inter-Bold.ttf        ← bundled font (download from Google Fonts)
    Inter-Regular.ttf
  static/
    (any CSS/JS assets)
  .env                    ← PORT=4300, COVERS_PASSWORD=...
  RUN COVERS.command      ← clickable launcher
  logs/
    covers.log
```

Runtime: `~/.covers/` (copy from project folder, same launchd pattern as all other tools)

---

## Infrastructure Setup (after build)

Same pattern as every other tool:

1. **launchd plist:** `~/Library/LaunchAgents/com.moksha.covers.plist`
2. **Cloudflare tunnel config:** add to `~/.cloudflared/config.yml`:
   ```yaml
   - hostname: covers.mokshatools.com
     service: http://localhost:4300
   ```
3. **DNS:** `cloudflared tunnel route dns mokshatools covers.mokshatools.com`
4. **Runtime sync:** `cp -r .../cover-image-tool/. ~/.covers/`

Full infra reference: `/Users/robertsinclair/Documents/CLAUDE CODE/MOKSHATOOLS.md`

---

## Connection to Other Tools

The post-production tool (`post.mokshatools.com`) outputs a `thumbnail_copy` field in its JSON package. Long-term, these tools will share that data — for now, Loric pastes it in manually. The cover tool's input form should make this a single paste-and-go workflow.

The `brand_profiles/` folder in the post-production tool (`MOKSHA Post Production/post-production-tool/brand_profiles/`) is the model for how brand configs work across the ecosystem. Reuse the same JSON structure where possible so profiles can eventually be shared.

---

## Port Registry (do not reuse these)

| Port | Tool |
|------|------|
| 3333 | Moksha Stream |
| 4100 | Content Inventory Tool |
| 4200 | Social Scribe (post-production) |
| **4300** | **Cover Image Tool ← this build** |
| 5150 | Nano Banana Studio |
| 5151 | Kling |
| 8080 | Montreal Scraper |
| 9000 | mokshatools.com homepage |

---

## Memory / Docs to Read First

- `/Users/robertsinclair/Documents/CLAUDE CODE/MOKSHATOOLS.md` — full infra doc
- `/Users/robertsinclair/Documents/CLAUDE CODE/CLAUDE.md` — project overview
- `/Users/robertsinclair/.claude/projects/-Users-robertsinclair-Documents-CLAUDE-CODE/memory/MEMORY.md` — user preferences and project state
- `/Users/robertsinclair/Documents/CLAUDE CODE/MOKSHA Post Production/post-production-tool/brand_profiles/` — existing brand profile format to match

---

## Success Criteria

1. Loric opens `covers.mokshatools.com`, pastes thumbnail copy + title, selects brand profile, clicks Generate
2. Gets two download links: 1080×1080 square + 1080×1350 portrait PNG
3. Images look clean, on-brand, ready to post — no Photoshop needed
4. Takes under 5 seconds to generate
