# Transcript Actions and TOA Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shared in-memory transcript layer, expose transcript-ready actions in `Import`, and make `TOA` read transcript-backed workspace state.

**Architecture:** Extend the existing modular shell by adding a `TranscriptSession` contract to the shared workspace model, a transcript generation service with a deterministic mock implementation, and route/template updates that reveal transcript actions after import. Keep the current in-memory workspace approach, but route all transcript consumers through the same contract so later real transcription and full TOA generation can replace internals without changing call sites.

**Tech Stack:** Python 3.9, Flask, unittest, dataclasses, Jinja templates

---

## File Structure

- `app/models/contracts.py`
  Adds `TranscriptSession` and expands `Workspace` to carry one active transcript session.
- `app/services/transcripts.py`
  New focused transcript service for deterministic mock transcript generation and download-safe filename handling.
- `app/services/workspaces.py`
  Extends workspace state helpers so import can replace the active source and active transcript together.
- `app/services/toa_adapter.py`
  Updates TOA summary to read transcript-backed readiness state instead of source-only state.
- `app/routes/shell.py`
  Wires transcript creation on import, transcript-ready UI state, and transcript download route.
- `app/templates/module.html`
  Renders transcript preview, copy/download/open TOA actions, and transcript-backed TOA status.
- `tests/test_models.py`
  Covers `TranscriptSession` and transcript-aware workspace shape.
- `tests/test_workspace_service.py`
  Covers replacing workspace state with a new source plus transcript.
- `tests/test_routes.py`
  Covers transcript-ready import state, transcript download, and TOA transcript-backed rendering.
- `README.md`
  Documents the new transcript-ready flow and current mock transcription limitation.

### Task 1: Add failing model tests for `TranscriptSession` and transcript-aware workspace state

**Files:**
- Modify: `app/models/contracts.py`
- Modify: `tests/test_models.py`
- Test: `tests/test_models.py`

- [ ] **Step 1: Write the failing test**

```python
def test_transcript_session_keeps_core_fields(self):
    transcript = TranscriptSession(
        id="tx_1",
        source_asset_id="src_1",
        transcript_text="Full transcript text.",
        status="ready",
    )

    self.assertEqual(transcript.source_asset_id, "src_1")


def test_workspace_can_expose_an_active_transcript_session(self):
    transcript = TranscriptSession(
        id="tx_1",
        source_asset_id="src_1",
        transcript_text="Full transcript text.",
        status="ready",
    )
    workspace = Workspace(
        id="ws-001",
        name="Main workspace",
        active_module=IMPORT_MODULE,
        active_transcript_session=transcript,
    )

    self.assertEqual(workspace.active_transcript_session.id, "tx_1")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./venv/bin/python -m unittest tests.test_models -v`
Expected: FAIL with missing `TranscriptSession` and/or unsupported `active_transcript_session`

- [ ] **Step 3: Write minimal implementation**

```python
@dataclass(frozen=True)
class TranscriptSession:
    id: str
    source_asset_id: str
    transcript_text: str
    status: str


@dataclass(init=False)
class Workspace:
    ...
    active_transcript_session: TranscriptSession | None

    def __init__(..., active_transcript_session=None, ...):
        ...
        self.active_transcript_session = active_transcript_session
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./venv/bin/python -m unittest tests.test_models -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/models/contracts.py tests/test_models.py
git commit -m "test: add transcript session contract coverage"
```

### Task 2: Add failing service tests for mock transcript generation and workspace replacement

**Files:**
- Create: `app/services/transcripts.py`
- Modify: `app/services/workspaces.py`
- Modify: `tests/test_workspace_service.py`
- Test: `tests/test_workspace_service.py`

- [ ] **Step 1: Write the failing test**

```python
def test_add_imported_source_replaces_workspace_source_and_transcript(self):
    workspace = Workspace(id="ws_001", name="Workspace", active_module=IMPORT_MODULE)

    updated_workspace = import_source_with_mock_transcript(
        workspace,
        source_type="upload",
        title="Episode 1",
        source_value="episode-1.mp4",
    )

    self.assertEqual(len(updated_workspace.source_assets), 1)
    self.assertEqual(updated_workspace.active_transcript_session.status, "ready")
    self.assertIn("Episode 1", updated_workspace.active_transcript_session.transcript_text)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./venv/bin/python -m unittest tests.test_workspace_service -v`
Expected: FAIL because transcript service and replacement helper do not exist

- [ ] **Step 3: Write minimal implementation**

```python
def build_mock_transcript(source_type: str, title: str, source_value: str) -> str:
    return f"Mock transcript for {title} from {source_type}: {source_value}"


def import_source_with_mock_transcript(workspace, source_type, title, source_value):
    source_asset = SourceAsset(...)
    transcript = TranscriptSession(
        id="tx_001",
        source_asset_id=source_asset.id,
        transcript_text=build_mock_transcript(source_type, title, source_value),
        status="ready",
    )
    return Workspace(
        id=workspace.id,
        name=workspace.name,
        active_module=workspace.active_module,
        source_assets=(source_asset,),
        active_transcript_session=transcript,
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./venv/bin/python -m unittest tests.test_workspace_service -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/services/transcripts.py app/services/workspaces.py tests/test_workspace_service.py
git commit -m "feat: add mock transcript workspace service"
```

### Task 3: Add failing route tests for transcript-ready import state and transcript download

**Files:**
- Modify: `app/routes/shell.py`
- Modify: `app/templates/module.html`
- Modify: `tests/test_routes.py`
- Test: `tests/test_routes.py`

- [ ] **Step 1: Write the failing test**

```python
def test_import_post_shows_transcript_actions_when_transcript_is_ready(self):
    response = self.client.post(
        "/import",
        data={
            "source_type": "public_url",
            "title": "Reference video",
            "source_value": "https://example.com/video",
        },
    )

    self.assertIn(b"Copy Transcript", response.data)
    self.assertIn(b"Download Transcript", response.data)
    self.assertIn(b"Open TOA", response.data)


def test_transcript_download_returns_plain_text_file(self):
    self.client.post(...)
    response = self.client.get("/transcripts/active.txt")

    self.assertEqual(response.status_code, 200)
    self.assertEqual(response.mimetype, "text/plain")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./venv/bin/python -m unittest tests.test_routes -v`
Expected: FAIL because transcript actions and download route do not exist

- [ ] **Step 3: Write minimal implementation**

```python
@shell_bp.route("/transcripts/active.txt")
def download_active_transcript():
    transcript = _workspace_state.active_transcript_session
    if transcript is None:
        abort(404)
    return Response(
        transcript.transcript_text,
        mimetype="text/plain",
        headers={"Content-Disposition": 'attachment; filename="transcript.txt"'},
    )
```

Render in the import template:

```html
<h3>Transcript Ready</h3>
<pre>{{ workspace.active_transcript_session.transcript_text }}</pre>
<button type="button">Copy Transcript</button>
<a href="/transcripts/active.txt">Download Transcript</a>
<a href="/toa">Open TOA</a>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./venv/bin/python -m unittest tests.test_routes -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/routes/shell.py app/templates/module.html tests/test_routes.py
git commit -m "feat: add transcript actions to import flow"
```

### Task 4: Add failing TOA transcript-backed tests and update the adapter seam

**Files:**
- Modify: `app/services/toa_adapter.py`
- Modify: `app/routes/shell.py`
- Modify: `app/templates/module.html`
- Modify: `tests/test_routes.py`
- Test: `tests/test_routes.py`

- [ ] **Step 1: Write the failing test**

```python
def test_toa_page_shows_transcript_backed_status_from_workspace(self):
    self.client.post(
        "/import",
        data={
            "source_type": "upload",
            "title": "Episode 12",
            "source_value": "episode-12.mp4",
        },
    )

    response = self.client.get("/toa")

    self.assertIn(b"Transcript available: Yes", response.data)
    self.assertIn(b"TOA can now operate from the shared transcript layer.", response.data)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./venv/bin/python -m unittest tests.test_routes -v`
Expected: FAIL because TOA still reports source-only readiness

- [ ] **Step 3: Write minimal implementation**

```python
@dataclass(frozen=True)
class TOAWorkspaceSummary:
    has_transcript: bool
    transcript_length: int
    transcript_preview: str | None
    status_message: str
```

Use `workspace.active_transcript_session` inside `build_toa_workspace_summary(...)` and render transcript-backed fields in the TOA section.

- [ ] **Step 4: Run test to verify it passes**

Run: `./venv/bin/python -m unittest tests.test_routes -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/services/toa_adapter.py app/routes/shell.py app/templates/module.html tests/test_routes.py
git commit -m "feat: connect toa to shared transcript state"
```

### Task 5: Verify, document, and push

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Run the full suite**

Run: `./venv/bin/python -m unittest discover -s tests -v`
Expected: PASS

- [ ] **Step 2: Update README**

Add a brief note describing:
- the mock transcript generation seam
- transcript-ready actions in `Import`
- `TOA` now reading shared transcript state

- [ ] **Step 3: Run the app locally**

Run: `./venv/bin/python run.py`
Expected: Flask app starts successfully, or if port `5000` is occupied, startup reaches Flask boot and stops only on the local port conflict

- [ ] **Step 4: Commit**

```bash
git add README.md docs/superpowers/plans/2026-04-01-transcript-actions-and-toa.md
git commit -m "docs: describe transcript actions and transcript-backed toa"
```

- [ ] **Step 5: Push**

```bash
git push origin main
```
