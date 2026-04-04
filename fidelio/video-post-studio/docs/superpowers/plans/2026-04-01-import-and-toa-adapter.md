# Import Flow and TOA Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real in-memory import flow to Video Post Studio and a minimal TOA adapter seam that consumes shared workspace state.

**Architecture:** Extend the current shell by adding a small `SourceAsset` contract, a mutable in-memory workspace service, POST handling on the `Import` route, and a `TOA` adapter that reads the shared workspace and renders an adapter-backed summary. Keep all persistence local and in-process so the seam is proven before integrating the standalone TOA repo.

**Tech Stack:** Python 3.9, Flask, unittest, dataclasses, Jinja templates

---

### Task 1: Add failing tests for `SourceAsset` and workspace source storage

**Files:**
- Modify: `app/models/contracts.py`
- Modify: `tests/test_models.py`
- Test: `tests/test_models.py`

- [ ] **Step 1: Write the failing test**

```python
def test_source_asset_keeps_core_fields(self):
    asset = SourceAsset(
        id="src_1",
        source_type="upload",
        title="Episode 12",
        source_value="episode-12.mp4",
    )

    self.assertEqual(asset.source_type, "upload")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./venv/bin/python -m unittest tests.test_models -v`
Expected: FAIL with `NameError` or missing `SourceAsset`

- [ ] **Step 3: Write minimal implementation**

```python
@dataclass
class SourceAsset:
    id: str
    source_type: str
    title: str
    source_value: str
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./venv/bin/python -m unittest tests.test_models -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/models/contracts.py tests/test_models.py
git commit -m "test: add source asset contract coverage"
```

### Task 2: Add failing tests for the import workspace service

**Files:**
- Modify: `app/services/workspaces.py`
- Modify: `tests/test_workspace_service.py`
- Test: `tests/test_workspace_service.py`

- [ ] **Step 1: Write the failing test**

```python
def test_add_source_asset_appends_to_workspace(self):
    workspace = build_demo_workspace()
    updated = add_source_asset(
        workspace,
        source_type="upload",
        title="Episode 12",
        source_value="episode-12.mp4",
    )

    self.assertEqual(len(updated.source_assets), 1)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./venv/bin/python -m unittest tests.test_workspace_service -v`
Expected: FAIL because `add_source_asset` or `source_assets` is missing

- [ ] **Step 3: Write minimal implementation**

```python
def add_source_asset(workspace, source_type, title, source_value):
    asset = SourceAsset(...)
    workspace.source_assets.append(asset)
    workspace.source_asset_ids.append(asset.id)
    return workspace
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./venv/bin/python -m unittest tests.test_workspace_service -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/services/workspaces.py tests/test_workspace_service.py
git commit -m "feat: add in-memory source import service"
```

### Task 3: Add failing route tests for Import GET/POST and validation

**Files:**
- Modify: `app/routes/shell.py`
- Modify: `app/templates/base.html`
- Modify: `app/templates/module.html`
- Modify: `tests/test_routes.py`
- Test: `tests/test_routes.py`

- [ ] **Step 1: Write the failing test**

```python
def test_import_post_adds_source_to_workspace(self):
    response = self.client.post(
        "/import",
        data={
            "source_type": "upload",
            "title": "Episode 12",
            "source_value": "episode-12.mp4",
        },
    )

    self.assertEqual(response.status_code, 200)
    self.assertIn(b"Episode 12", response.data)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./venv/bin/python -m unittest tests.test_routes -v`
Expected: FAIL because `/import` is GET-only or does not render imported state

- [ ] **Step 3: Write minimal implementation**

```python
@shell_bp.route("/import", methods=["GET", "POST"])
def import_page():
    ...
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./venv/bin/python -m unittest tests.test_routes -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/routes/shell.py app/templates/base.html app/templates/module.html tests/test_routes.py
git commit -m "feat: add import form flow to shell"
```

### Task 4: Add the TOA adapter seam and route coverage

**Files:**
- Create: `app/services/toa_adapter.py`
- Modify: `app/routes/shell.py`
- Modify: `app/templates/module.html`
- Modify: `tests/test_routes.py`
- Test: `tests/test_routes.py`

- [ ] **Step 1: Write the failing test**

```python
def test_toa_page_shows_adapter_status_from_workspace(self):
    response = self.client.get("/toa")
    self.assertIn(b"TOA workspace status", response.data)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./venv/bin/python -m unittest tests.test_routes -v`
Expected: FAIL because no adapter-backed TOA summary is rendered

- [ ] **Step 3: Write minimal implementation**

```python
def build_toa_summary(workspace):
    return {"status": "...", "source_count": len(workspace.source_assets)}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./venv/bin/python -m unittest tests.test_routes -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/services/toa_adapter.py app/routes/shell.py app/templates/module.html tests/test_routes.py
git commit -m "feat: add toa adapter seam"
```

### Task 5: Verify, document, and push

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Run the full suite**

Run: `./venv/bin/python -m unittest discover -s tests -v`
Expected: PASS

- [ ] **Step 2: Update README**

Add a brief note describing:
- the import form
- current in-memory limitations
- the TOA adapter seam

- [ ] **Step 3: Run the app locally**

Run: `./venv/bin/python run.py`
Expected: Flask app starts successfully

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: describe import flow and toa adapter seam"
```

- [ ] **Step 5: Push**

```bash
git push origin main
```
