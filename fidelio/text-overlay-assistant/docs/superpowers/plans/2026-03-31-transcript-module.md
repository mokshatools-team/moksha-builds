# Transcript Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor Text Overlay Assistant to add a reusable transcript-fetching module and support YouTube URL input without changing downstream overlay analysis behavior.

**Architecture:** Keep `app.py` as the orchestration layer, extract reusable plain-text transcript fetching into `transcript_fetcher.py`, and add explicit either/or input handling in the frontend and transcription route. Preserve the current timestamped file-transcription behavior for local media while routing YouTube transcription through the shared module.

**Tech Stack:** Flask, OpenAI Python SDK, Anthropic SDK, `yt-dlp`, `ffmpeg`, browser-side JavaScript, Python `unittest`

---

### Task 1: Add failing tests for transcript source handling

**Files:**
- Create: `tests/test_transcript_fetcher.py`
- Test: `tests/test_transcript_fetcher.py`

- [ ] **Step 1: Write the failing test**

```python
import unittest

from transcript_fetcher import is_youtube_url


class TranscriptFetcherTests(unittest.TestCase):
    def test_detects_youtube_watch_url(self):
        self.assertTrue(is_youtube_url("https://www.youtube.com/watch?v=abc123"))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m unittest tests.test_transcript_fetcher -v`
Expected: FAIL with import or attribute error for `is_youtube_url`

- [ ] **Step 3: Write minimal implementation**

```python
def is_youtube_url(source: str) -> bool:
    return "youtube.com/watch" in source or "youtu.be/" in source
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m unittest tests.test_transcript_fetcher -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/test_transcript_fetcher.py transcript_fetcher.py
git commit -m "test: add transcript source detection coverage"
```

### Task 2: Add failing route validation tests

**Files:**
- Create: `tests/test_app_routes.py`
- Test: `tests/test_app_routes.py`

- [ ] **Step 1: Write the failing test**

```python
import io
import unittest

from app import app


class RouteValidationTests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_upload_rejects_both_file_and_youtube_url(self):
        response = self.client.post(
            "/upload",
            data={
                "youtube_url": "https://www.youtube.com/watch?v=abc123",
                "file": (io.BytesIO(b"fake"), "clip.mp4"),
            },
            content_type="multipart/form-data",
        )

        self.assertEqual(response.status_code, 400)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m unittest tests.test_app_routes -v`
Expected: FAIL because `/upload` does not yet validate mixed input

- [ ] **Step 3: Write minimal implementation**

```python
youtube_url = (request.form.get("youtube_url") or "").strip()
if youtube_url and "file" in request.files and request.files["file"].filename:
    return jsonify({"error": "Choose either a file or a YouTube URL, not both."}), 400
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m unittest tests.test_app_routes -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/test_app_routes.py app.py
git commit -m "test: cover mutually exclusive transcript inputs"
```

### Task 3: Implement transcript module and route changes

**Files:**
- Create: `transcript_fetcher.py`
- Modify: `app.py`
- Modify: `requirements.txt`

- [ ] **Step 1: Write the failing test**

```python
def test_missing_file_path_raises_file_not_found(self):
    with self.assertRaises(FileNotFoundError):
        fetch_transcript("/tmp/does-not-exist.mp4")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m unittest tests.test_transcript_fetcher -v`
Expected: FAIL because `fetch_transcript` is missing or incomplete

- [ ] **Step 3: Write minimal implementation**

```python
def fetch_transcript(source: str) -> str:
    if not source:
        raise ValueError("Transcript source is required.")
    if not is_youtube_url(source):
        if not os.path.exists(source):
            raise FileNotFoundError(f"Local file not found: {source}")
        return transcribe_local_file(source)
    return transcribe_youtube_url(source)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m unittest tests.test_transcript_fetcher -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add transcript_fetcher.py app.py requirements.txt
git commit -m "refactor: add shared transcript fetcher"
```

### Task 4: Implement frontend YouTube input and final verification

**Files:**
- Modify: `templates/index.html`
- Test: `tests/test_app_routes.py`

- [ ] **Step 1: Write the failing test**

```python
def test_index_contains_youtube_input(self):
    response = self.client.get("/")
    self.assertIn(b"Paste a YouTube URL", response.data)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m unittest tests.test_app_routes -v`
Expected: FAIL because the current template has no YouTube input

- [ ] **Step 3: Write minimal implementation**

```html
<label class="field-label" for="youtube-url-input">Paste a YouTube URL</label>
<input class="field-input" id="youtube-url-input" type="text" placeholder="https://www.youtube.com/watch?v=..." />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m unittest tests.test_app_routes -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add templates/index.html tests/test_app_routes.py
git commit -m "feat: add YouTube transcript input path"
```

### Task 5: Run end-to-end verification and push branch

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Run automated tests**

Run: `python -m unittest discover -s tests -v`
Expected: PASS

- [ ] **Step 2: Run local app checks**

Run: `python app.py`
Expected: Flask server starts without import or syntax errors

- [ ] **Step 3: Manually verify**

```text
1. Upload a short video and confirm transcript + overlay output.
2. Paste a valid YouTube URL and confirm transcript + overlay output.
3. Submit both inputs and confirm validation error.
4. Submit neither input and confirm validation error.
```

- [ ] **Step 4: Commit docs and any README updates**

```bash
git add README.md docs/superpowers/specs/2026-03-31-transcript-module-design.md docs/superpowers/plans/2026-03-31-transcript-module.md
git commit -m "docs: record transcript module refactor plan"
```

- [ ] **Step 5: Push branch**

```bash
git push origin feature/transcript-module
```
