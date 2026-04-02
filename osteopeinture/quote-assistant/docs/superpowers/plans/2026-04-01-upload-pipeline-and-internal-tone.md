# Upload Pipeline And Internal Tone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reliable 15-image upload support with HEIC intake, server-side image normalization, request budgeting, global drag-and-drop attachment, and an internal-only assistant tone.

**Architecture:** Keep the existing synchronous Express + Anthropic flow, but insert a dedicated image normalization module between `multer` and the Anthropic request builder. Store compact text summaries of image-bearing user turns instead of replaying raw image binaries in session history, and update the frontend to treat dropped files exactly like picked files while globally blocking browser file navigation.

**Tech Stack:** Node.js, Express, Multer, Anthropic SDK, browser DOM APIs, plus server-side image libraries for resize/compression and HEIC conversion.

---

## File Structure

- Create: `osteopeinture-quote-assistant/lib/image-upload.js`
- Modify: `osteopeinture-quote-assistant/server.js`
- Modify: `osteopeinture-quote-assistant/public/index.html`
- Modify: `osteopeinture-quote-assistant/package.json`

### Task 1: Add Image Processing Dependencies

**Files:**
- Modify: `osteopeinture-quote-assistant/package.json`

- [ ] **Step 1: Add the dependency declarations**

Update `package.json` dependencies to include image normalization support:

```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "better-sqlite3": "^9.6.0",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "heic-convert": "^2.1.0",
    "multer": "^2.0.0",
    "nodemailer": "^8.0.1",
    "playwright": "^1.44.0",
    "sharp": "^0.33.5",
    "uuid": "^9.0.1"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `npm install`

Expected: install completes and `package-lock.json` is updated with `sharp` and `heic-convert`.

- [ ] **Step 3: Verify install results**

Run: `npm ls sharp heic-convert`

Expected:

```text
osteopeinture-quote-assistant@1.0.0
├── heic-convert@...
└── sharp@...
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add image upload processing dependencies"
```

### Task 2: Create The Image Normalization Module

**Files:**
- Create: `osteopeinture-quote-assistant/lib/image-upload.js`

- [ ] **Step 1: Create the helper module with supported MIME types and error class**

Create `lib/image-upload.js`:

```js
const sharp = require('sharp');
const heicConvert = require('heic-convert');

const MAX_IMAGE_COUNT = 15;
const MAX_INPUT_BYTES = 20 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 900 * 1024;
const MAX_TOTAL_OUTPUT_BYTES = 9 * 1024 * 1024;
const MAX_DIMENSION = 1800;
const JPEG_QUALITY_STEPS = [82, 74, 66, 58, 50];

const SUPPORTED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

class UploadError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'UploadError';
    this.status = status;
  }
}

module.exports = {
  MAX_IMAGE_COUNT,
  MAX_INPUT_BYTES,
  MAX_OUTPUT_BYTES,
  MAX_TOTAL_OUTPUT_BYTES,
  MAX_DIMENSION,
  JPEG_QUALITY_STEPS,
  SUPPORTED_MIME_TYPES,
  UploadError,
};
```

- [ ] **Step 2: Add HEIC conversion and image normalization helpers**

Extend `lib/image-upload.js`:

```js
async function convertHeicBuffer(buffer) {
  return Buffer.from(await heicConvert({
    buffer,
    format: 'JPEG',
    quality: 0.9,
  }));
}

async function normalizeInputBuffer(file) {
  if (!file || !file.buffer || !file.buffer.length) {
    throw new UploadError(`Empty upload: ${file?.originalname || 'unknown file'}`);
  }

  if (file.size > MAX_INPUT_BYTES) {
    throw new UploadError(`${file.originalname} is too large before processing. Split the upload.`);
  }

  if (!SUPPORTED_MIME_TYPES.has(file.mimetype)) {
    throw new UploadError(`Unsupported file type: ${file.originalname}`);
  }

  if (file.mimetype === 'image/heic' || file.mimetype === 'image/heif') {
    try {
      return await convertHeicBuffer(file.buffer);
    } catch (error) {
      throw new UploadError(`HEIC conversion failed: ${file.originalname}`);
    }
  }

  return file.buffer;
}

async function normalizeImage(file) {
  const inputBuffer = await normalizeInputBuffer(file);

  for (const quality of JPEG_QUALITY_STEPS) {
    const transformer = sharp(inputBuffer, { failOn: 'none' }).rotate().resize({
      width: MAX_DIMENSION,
      height: MAX_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true,
    });

    const { data, info } = await transformer.jpeg({
      quality,
      mozjpeg: true,
    }).toBuffer({ resolveWithObject: true });

    if (data.length <= MAX_OUTPUT_BYTES) {
      return {
        originalName: file.originalname,
        originalMimeType: file.mimetype,
        mediaType: 'image/jpeg',
        byteLength: data.length,
        width: info.width,
        height: info.height,
        buffer: data,
        base64: data.toString('base64'),
      };
    }
  }

  throw new UploadError(`Image is still too large after compression: ${file.originalname}`);
}

module.exports.normalizeImage = normalizeImage;
```

- [ ] **Step 3: Add batch normalization, request budgeting, and history summary helpers**

Extend `lib/image-upload.js`:

```js
async function normalizeImages(files = []) {
  if (files.length > MAX_IMAGE_COUNT) {
    throw new UploadError(`Maximum ${MAX_IMAGE_COUNT} images per message.`);
  }

  const normalized = [];
  let totalBytes = 0;

  for (const file of files) {
    const image = await normalizeImage(file);
    totalBytes += image.byteLength;
    normalized.push(image);
  }

  if (totalBytes > MAX_TOTAL_OUTPUT_BYTES) {
    throw new UploadError('Too many/larger images for one message after compression. Split the batch in two.');
  }

  return normalized;
}

function buildAnthropicImageParts(normalizedImages = []) {
  return normalizedImages.map((image) => ({
    type: 'image',
    source: {
      type: 'base64',
      media_type: image.mediaType,
      data: image.base64,
    },
  }));
}

function summarizeImageUpload(normalizedImages = []) {
  if (!normalizedImages.length) return '';
  const names = normalizedImages
    .slice(0, 3)
    .map((image) => image.originalName)
    .join(', ');
  const suffix = normalizedImages.length > 3 ? ', ...' : '';
  return `[Attached ${normalizedImages.length} image(s): ${names}${suffix}]`;
}

module.exports.normalizeImages = normalizeImages;
module.exports.buildAnthropicImageParts = buildAnthropicImageParts;
module.exports.summarizeImageUpload = summarizeImageUpload;
```

- [ ] **Step 4: Verify the module loads cleanly**

Run: `node -e "const mod=require('./lib/image-upload'); console.log(Object.keys(mod).sort().join(','))"`

Expected:

```text
JPEG_QUALITY_STEPS,MAX_DIMENSION,MAX_IMAGE_COUNT,MAX_INPUT_BYTES,MAX_OUTPUT_BYTES,MAX_TOTAL_OUTPUT_BYTES,SUPPORTED_MIME_TYPES,UploadError,buildAnthropicImageParts,normalizeImage,normalizeImages,summarizeImageUpload
```

- [ ] **Step 5: Commit**

```bash
git add lib/image-upload.js
git commit -m "feat: add image normalization pipeline"
```

### Task 3: Wire The Backend Upload Pipeline Into The Message Route

**Files:**
- Modify: `osteopeinture-quote-assistant/server.js`

- [ ] **Step 1: Import the upload helpers**

Near the top of `server.js`, add:

```js
const {
  MAX_IMAGE_COUNT,
  UploadError,
  normalizeImages,
  buildAnthropicImageParts,
  summarizeImageUpload,
} = require('./lib/image-upload');
```

- [ ] **Step 2: Increase Multer limits to support the new flow**

Replace the current upload setup in `server.js`:

```js
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024,
    files: MAX_IMAGE_COUNT,
  },
});
```

- [ ] **Step 3: Add helpers to compact stored user messages**

Add these helpers above the route definitions:

```js
function extractTextContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part) => part && part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n');
}

function buildStoredUserContent(userText, uploadSummary) {
  return [userText.trim(), uploadSummary].filter(Boolean).join('\n');
}
```

- [ ] **Step 4: Replace the message route request builder**

Replace the current `/api/sessions/:id/messages` body with this structure:

```js
app.post('/api/sessions/:id/messages', upload.array('images', MAX_IMAGE_COUNT), async (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const userText = String(req.body.message || '').trim();
  const files = req.files || [];

  try {
    const normalizedImages = await normalizeImages(files);
    const uploadSummary = summarizeImageUpload(normalizedImages);
    const anthropicContent = [];

    if (userText) anthropicContent.push({ type: 'text', text: userText });
    anthropicContent.push(...buildAnthropicImageParts(normalizedImages));

    if (!anthropicContent.length) {
      return res.status(400).json({ error: 'No message or image' });
    }

    const requestMessages = [
      ...session.messages.map((message) => ({
        role: message.role,
        content: extractTextContent(message.content),
      })),
      { role: 'user', content: anthropicContent },
    ];

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: buildSystemPrompt(),
      messages: requestMessages,
    });

    const assistantText = response.content
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n')
      .trim();

    session.messages.push({
      role: 'user',
      content: buildStoredUserContent(userText, uploadSummary),
    });
    session.messages.push({ role: 'assistant', content: assistantText });

    // keep the existing quote JSON extraction block here
  } catch (err) {
    const status = err instanceof UploadError ? err.status : 500;
    const error = err instanceof UploadError
      ? err.message
      : (err?.error?.message || err.message || 'Upload failed');
    console.error('Claude API error:', err);
    return res.status(status).json({ error });
  }
});
```

- [ ] **Step 5: Preserve the existing quote parsing block after the refactor**

Keep the existing quote extraction/update logic, but ensure it runs after `assistantText` is built and after the compacted user message is added to `session.messages`:

```js
let quoteJson = null;
let status = session.status;

const jsonMatch = assistantText.match(/^\s*(\{[\s\S]+\})\s*$/);
if (jsonMatch) {
  try {
    quoteJson = JSON.parse(jsonMatch[1]);
    status = 'quote_ready';
    // existing total/client/project/address updates remain here unchanged
  } catch (error) {
    // keep gathering if the assistant returned non-JSON text
  }
}

session.status = status;
saveSession(session);

res.json({
  reply: assistantText,
  status,
  hasQuote: !!quoteJson,
});
```

- [ ] **Step 6: Verify the server still boots**

Run: `node -e "require('./server'); setTimeout(() => process.exit(0), 1000)"`

Expected: process exits cleanly without syntax errors.

- [ ] **Step 7: Commit**

```bash
git add server.js
git commit -m "feat: normalize uploads before Anthropic requests"
```

### Task 4: Rewrite The Internal Assistant Tone

**Files:**
- Modify: `osteopeinture-quote-assistant/server.js`
- Modify: `osteopeinture-quote-assistant/public/index.html`

- [ ] **Step 1: Replace the system prompt intro and tone rules**

In `buildSystemPrompt()` inside `server.js`, replace the current intro/tone section with:

```js
return `You are Ostéopeinture's internal quote builder for Loric, Lubo, and Graeme.

This tool is for internal use only. You are not speaking to the client unless the admin explicitly asks you to draft client-facing copy.

Default behavior:
- be casual, direct, and brief
- ask only what is needed to finish the estimate
- do not add pleasantries, flattery, coaching, or extra commentary
- do not tone-police rough internal phrasing
- do not moralize or correct shorthand
- stay focused on getting the quote built fast

You generate accurate painting quotes for Montréal projects by gathering job details and producing structured JSON output when ready.
...
`;
```

- [ ] **Step 2: Tighten the frontend starter message**

In `public/index.html`, replace:

```js
appendMessage('assistant', 'Hello! I\'m ready to build your quote. What\'s the client\'s name and job address?');
```

with:

```js
appendMessage('assistant', 'Ready. Send the client name, address, and any pics/plans.');
```

- [ ] **Step 3: Verify tone in a manual chat round-trip**

Run: `npm start`

Expected manual result:

- new session greeting is terse and internal
- assistant replies stay direct and non-client-facing during info gathering

- [ ] **Step 4: Commit**

```bash
git add server.js public/index.html
git commit -m "feat: switch quote assistant to internal admin tone"
```

### Task 5: Add Global Drag-And-Drop Attachment Handling

**Files:**
- Modify: `osteopeinture-quote-assistant/public/index.html`

- [ ] **Step 1: Add a shared queue helper**

In the `<script>` block, add:

```js
function isImageFile(file) {
  return !!file && typeof file.type === 'string' && file.type.startsWith('image/');
}

function addPendingFiles(files) {
  const validFiles = files.filter(isImageFile);
  const rejectedCount = files.length - validFiles.length;

  pendingFiles = pendingFiles.concat(validFiles).slice(0, 15);
  renderImagePreviews();

  if (rejectedCount) {
    appendMessage('system', `Ignored ${rejectedCount} non-image file(s).`);
  }
}
```

- [ ] **Step 2: Reuse the helper from the picker flow**

Replace `onFilesSelected` with:

```js
function onFilesSelected(event) {
  const files = Array.from(event.target.files || []);
  addPendingFiles(files);
  event.target.value = '';
}
```

- [ ] **Step 3: Add global drag/drop prevention and attachment routing**

Add this near the bottom of the script before initialization:

```js
let dragDepth = 0;

function hasDraggedFiles(event) {
  return Array.from(event.dataTransfer?.types || []).includes('Files');
}

function setDropActive(active) {
  document.body.classList.toggle('drop-active', active);
}

['dragenter', 'dragover', 'dragleave', 'drop'].forEach((eventName) => {
  window.addEventListener(eventName, (event) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
  });
});

window.addEventListener('dragenter', (event) => {
  if (!hasDraggedFiles(event)) return;
  dragDepth += 1;
  setDropActive(true);
});

window.addEventListener('dragleave', (event) => {
  if (!hasDraggedFiles(event)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) setDropActive(false);
});

window.addEventListener('drop', (event) => {
  if (!hasDraggedFiles(event)) return;
  dragDepth = 0;
  setDropActive(false);
  addPendingFiles(Array.from(event.dataTransfer.files || []));
});
```

- [ ] **Step 4: Add a visible drop state**

Add CSS in `public/index.html`:

```css
body.drop-active #chat-panel {
  outline: 2px dashed rgba(90, 80, 72, 0.45);
  outline-offset: -10px;
}

body.drop-active #status-text::after {
  content: " · Drop images to attach";
}
```

- [ ] **Step 5: Manually verify drag/drop behavior**

Run: `npm start`

Expected manual result:

- dropping files anywhere on the page never opens a new browser tab
- dropped images appear in the preview bar
- dropped non-image files are ignored with a short system message

- [ ] **Step 6: Commit**

```bash
git add public/index.html
git commit -m "feat: add global drag and drop image attachments"
```

### Task 6: Manual End-To-End Verification

**Files:**
- Modify: `osteopeinture-quote-assistant/docs/superpowers/plans/2026-04-01-upload-pipeline-and-internal-tone.md`

- [ ] **Step 1: Start the app**

Run: `npm start`

Expected:

```text
Server running on http://localhost:3000
```

- [ ] **Step 2: Verify single-image flows**

Manual checks:

- send one JPEG
- send one PNG
- send one HEIC from an iPhone

Expected:

- previews render before send
- the request succeeds
- no upload-format error for HEIC

- [ ] **Step 3: Verify high-volume batch flow**

Manual checks:

- send 15 images in one message
- follow with a text-only message like `use the same scope, now give me the quote`

Expected:

- first request succeeds without `request exceeds maximum size`
- second request also succeeds because old image binaries are not replayed

- [ ] **Step 4: Verify over-budget and invalid input behavior**

Manual checks:

- try more than 15 images
- try a non-image file
- try a very large batch that still exceeds compressed limits

Expected:

- each case returns a short operational error
- app remains usable after the error

- [ ] **Step 5: Record verification notes in this plan file**

Append a short verification log to the bottom of this file:

```md
## Verification Notes

- Date:
- Commands run:
- Manual scenarios covered:
- Remaining risks:
```

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/plans/2026-04-01-upload-pipeline-and-internal-tone.md
git commit -m "docs: record upload pipeline verification results"
```
