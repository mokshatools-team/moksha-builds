---
name: Image gallery in quote panel — carousel + full preview
description: Reuse the quote panel as a media viewer. Top = full-size preview, bottom = horizontal thumbnail carousel. Toggle between quote view and gallery view.
type: project
---

**Requested (2026-04-21):** Build an image gallery inside the quote panel.

**Layout:**
- Top area: full-size preview of selected image (scrollable, maybe pinch-to-zoom on mobile)
- Bottom: horizontal carousel strip of all session thumbnails
- Tap a thumbnail → shows full-size above
- When quote exists: toggle between quote preview and image gallery (tab or button)
- When no quote yet: gallery is the default view

**Data source:** `GET /api/sessions/:id/attachments` returns `public_url` for each image.

**Implementation notes:**
- Reuse `#quote-panel` or overlay within it
- Carousel: horizontal scroll, `overflow-x: auto`, thumbnail height ~60px
- Full preview: `object-fit: contain` in the frame area
- Mobile: quote panel already goes full-screen, so gallery would too
- Could also allow re-sending an image to Claude ("ask about this image") — injects the stored image back into the conversation as a new message

**Next session:** build this.
