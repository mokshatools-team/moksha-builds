# Upload Pipeline And Internal Tone Design

## Summary

This design updates the quote assistant so it can reliably accept iPhone-originated image batches, especially HEIC photos, without blowing up the Anthropic request. It also changes the chat UI so file drag-and-drop attaches images instead of navigating the browser away from the app, and it tightens the assistant persona so it behaves like an internal admin tool instead of a customer-facing estimator.

The goal is to support batches of up to 15 images per message reliably by normalizing images server-side before they are sent to Anthropic and by preventing old image payloads from being replayed on later turns.

## Scope

In scope:

- Accept HEIC/HEIF image uploads from iPhones.
- Normalize uploaded images into model-safe JPEG payloads.
- Budget and cap image payload size so one message can reliably include up to 15 images.
- Stop replaying prior image binaries on later turns.
- Add global drag-and-drop interception so dropped files are attached instead of opened in a new tab.
- Update the assistant system prompt so the gathering flow is internal, casual, terse, and non-client-facing.
- Improve request error handling so oversized or malformed payloads return useful internal messages.

Out of scope:

- OCR extraction pipelines.
- Background job processing.
- Persistent upload storage beyond the current request lifecycle.
- Changes to client-facing email templates and generated quote content format.

## Current Problems

### Raw image forwarding

The current message route in `server.js` forwards every uploaded file directly to Anthropic as a base64 image block. Large phone photos make the payload heavy immediately.

### Image history replay

The current `session.messages` history stores multimodal user content as-is. That means every later message can resend all earlier image payloads back to Anthropic, which compounds request size and can surface `request exceeds maximum size` or generic invalid request failures even when the latest turn includes only a few files.

### No HEIC normalization

The current file path assumes browser-supplied image types are ready to send as-is. HEIC images need to be accepted and converted on the server.

### Drag-and-drop browser navigation

The frontend file flow only supports the file input. Dropping a file onto the page triggers normal browser navigation behavior.

### Wrong assistant framing

The current system prompt and frontend starter copy are customer-facing and overly formal for the actual internal workflow.

## Recommended Approach

Add a dedicated upload normalization and request-budgeting layer in the Node server, keep the existing synchronous request model, and make the UI route both picker uploads and drag-and-drop through the same pending file queue.

This keeps the app architecture simple while fixing the actual bottleneck:

- Image files are normalized before they ever reach Anthropic.
- The server applies a hard request budget before making the API call.
- Only text summaries of prior image-bearing turns are persisted for future context.

## Architecture

### 1. Image normalization module

Create a focused server-side helper module responsible for:

- Validating that uploaded files are supported image types.
- Accepting common phone formats including `image/heic` and `image/heif`.
- Converting all accepted images to JPEG.
- Applying EXIF-aware rotation during conversion.
- Resizing images to a bounded maximum dimension suitable for floor plans and room photos.
- Compressing images to a bounded byte target per image.
- Returning normalized metadata:
  - original name
  - original mime type
  - normalized mime type
  - normalized byte size
  - width/height
  - base64 payload

This module should be pure server-side code and should not know anything about sessions or Anthropic.

### 2. Request budgeting

Before calling Anthropic, the message route should:

- Normalize all uploaded files.
- Compute total normalized payload size.
- Enforce:
  - max 15 images per message
  - bounded per-image output size
  - bounded total normalized image payload size for the request
- Return a clear 400 error when the normalized batch still exceeds the supported budget.

The error should be operational and short, for example: `Too many/larger images for one message after compression. Split the batch in two.`

The route should not rely on Anthropic to reject bad payloads as the first line of defense.

### 3. Session history compaction

The session should stop storing raw multimodal image content in long-term history.

Instead:

- The current request to Anthropic includes:
  - prior text-only conversation history
  - the new user text
  - the new normalized image blocks
- After the request succeeds, the stored user message should be compacted to text-only content describing the upload, for example:
  - the user text
  - `[Attached 8 image(s): kitchen, hallway, floor plan]`

This preserves conversational context while preventing old image binaries from being replayed on later turns.

If the model needs durable awareness of image-backed facts, that should be represented in assistant text from the turn, not by keeping binary content in history.

### 4. Error handling

The message route should catch and map likely upload/request failures into explicit internal messages:

- unsupported file type
- HEIC conversion failure
- image normalization failure
- request payload too large after normalization
- upstream Anthropic invalid request error

The response body should stay simple and consistent for the frontend.

### 5. Frontend drag-and-drop and file queue

The frontend should:

- intercept `dragenter`, `dragover`, `dragleave`, and `drop` events at the window/document level
- always call `preventDefault()` for file drags so the browser never opens the file
- route dropped files into the same `pendingFiles` queue used by the file picker
- preserve existing image preview/removal behavior
- optionally show a visual drop-active state over the chat panel while files are dragged in

The queue should client-side reject obvious non-image files before upload.

### 6. Internal-only assistant tone

The system prompt should be rewritten so the assistant is explicitly an internal quoting tool for Loric, Lubo, and Graeme. Its gathering style should be:

- casual
- direct
- terse
- operational
- non-customer-facing

It should avoid pleasantries, flattery, and extra commentary.

It can be instructed to avoid correcting admin shorthand or rough phrasing and to focus on getting the quote built. However, it should not include instructions endorsing abusive or hateful language. The safe equivalent is: accept blunt internal phrasing, do not moralize, do not tone-police, and stay task-focused.

The frontend’s default assistant greeting should match the same internal tone.

## Data Flow

1. User drops or selects up to 15 images.
2. Frontend adds files to `pendingFiles` and renders previews.
3. User sends the message.
4. Server receives multipart form data through `multer`.
5. Server normalizes all uploaded images through the image pipeline.
6. Server rejects unsupported or over-budget uploads before the Anthropic call.
7. Server builds the Anthropic request using:
   - compact prior text history
   - current user text
   - current turn normalized images
8. Anthropic returns assistant text.
9. Server stores:
   - compacted user text summary
   - assistant text reply
   - quote JSON if present
10. Frontend renders the assistant reply and quote preview.

## Component Changes

### `server.js`

- increase `multer` count limit from 10 to 15
- delegate image normalization to a helper module
- build Anthropic messages from compacted session history plus current-turn normalized images
- compact stored user image messages into text-only summaries
- improve prompt wording for internal use
- return better operational errors

### New server helper module

Expected responsibilities:

- image type support table
- HEIC/HEIF conversion
- resize/compression loop
- normalized payload metadata
- request byte budgeting helpers

### `public/index.html`

- add global drag/drop listeners
- add file queue helper shared by picker and drop flows
- optionally show drag-active styling
- update default assistant greeting copy

## Error Handling Details

### Upload validation

Reject:

- non-image files
- empty files
- more than 15 files

### HEIC conversion

If HEIC decode/conversion fails, return a 400 with a direct operational message naming the failed file.

### Normalization budget failure

If total normalized payload exceeds the request budget after compression, return a 400 instructing the admin to split the batch.

### Anthropic request failure

If Anthropic still returns an invalid request error, log the internal details server-side and return a concise frontend error. This should be treated as an unexpected failure path after local budgeting, not the normal path.

## Testing Strategy

Because this project does not currently have an automated test harness, verification will be manual for this change.

Manual verification should cover:

- upload a single JPEG
- upload a single HEIC from an iPhone
- upload a mixed batch of JPEG/PNG/HEIC files
- upload 15 images in one message
- confirm a later text-only message does not fail due to prior image replay
- drag files anywhere on the page and confirm the browser does not navigate away
- drag files onto the page and confirm they land in the preview queue
- remove queued images before send
- confirm unsupported non-image files are rejected cleanly
- confirm internal-tone greeting and replies remain terse and non-client-facing

## Dependency Choice

Use a robust server-side image library that supports resize/compression and pair it with a HEIC-capable conversion path if needed. Reliability is prioritized over minimal dependencies because iPhone-originated uploads are a core workflow.

## Risks

### Native dependency install friction

Image tooling may require platform-specific binaries. This is acceptable because reliable iPhone handling is mandatory.

### Aggressive compression hurting readability

Floor plans and detail photos still need to remain legible. The normalization defaults should prioritize readable plans over chasing maximum count blindly.

### Existing session shape assumptions

The UI currently reconstructs messages by reading text blocks out of stored `session.messages`. Session compaction must preserve that behavior.

## Success Criteria

- The app accepts HEIC/HEIF uploads from iPhones without manual conversion.
- One message can reliably include up to 15 images under normal phone-photo and floor-plan conditions.
- Later turns no longer fail because previous image payloads are replayed.
- Dragging files onto the page never opens a new browser tab.
- Dropped files appear in the pending upload strip and send normally.
- The assistant behaves like an internal admin tool rather than a client-facing estimator.
