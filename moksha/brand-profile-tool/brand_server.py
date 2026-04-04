#!/usr/bin/env python3
"""
brand_server.py — MOKSHATOOLS Brand Profiles
brand.mokshatools.com · port 4400

Per-client brand profile pages. Scrapes YouTube + website + Instagram,
generates a brand brief via Claude Haiku, and serves a visual brand deck.
All text fields editable inline — auto-saves back to brand_profiles/*.json.
"""

import json
import logging
import os
import re
import shutil
import threading
import uuid
from datetime import datetime
from typing import Optional

from flask import Flask, jsonify, redirect, render_template_string, request, send_from_directory
import mimetypes
import urllib.parse
import urllib.request
from dotenv import load_dotenv
import anthropic

import brand_scraper as bs
import brand_discover as bd

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("logs/brand.log"),
    ],
)
logger = logging.getLogger(__name__)

app = Flask(__name__)
PORT         = int(os.getenv("PORT", 4400))
PROFILES_DIR = os.path.join(os.path.dirname(__file__), "brand_profiles")
ASSETS_DIR   = os.path.join(os.path.dirname(__file__), "brand_assets")

# Paths to push updated profiles to sibling tools (same machine)
SYNC_PATHS = [
    os.path.expanduser("~/.postprod/brand_profiles"),
    os.path.expanduser("~/.covers/brand_profiles"),
]

# ── Job State ───────────────────────────────────────────────────────────────

_jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()


def _new_job() -> str:
    job_id = str(uuid.uuid4())[:8]
    with _jobs_lock:
        _jobs[job_id] = {"status": "pending", "progress": "", "result": None, "error": None}
    return job_id


def _update_job(job_id, **kwargs):
    with _jobs_lock:
        _jobs[job_id].update(kwargs)


def _get_job(job_id) -> Optional[dict]:
    with _jobs_lock:
        return dict(_jobs.get(job_id, {}))


# ── Brand Profile I/O ────────────────────────────────────────────────────────

def _profile_path(client_id: str) -> str:
    return os.path.join(PROFILES_DIR, f"{client_id}.json")


def _load_profile(client_id: str) -> Optional[dict]:
    path = _profile_path(client_id)
    if not os.path.exists(path):
        return None
    with open(path) as f:
        return json.load(f)


def _save_profile(client_id: str, profile: dict):
    path = _profile_path(client_id)
    with open(path, "w") as f:
        json.dump(profile, f, indent=2, ensure_ascii=False)
    # Sync to sibling tool runtime dirs
    for sync_dir in SYNC_PATHS:
        try:
            if os.path.isdir(sync_dir):
                shutil.copy2(path, os.path.join(sync_dir, f"{client_id}.json"))
        except Exception as e:
            logger.warning(f"Sync to {sync_dir} failed: {e}")


def _list_clients() -> list[str]:
    if not os.path.isdir(PROFILES_DIR):
        return []
    return [
        f[:-5] for f in sorted(os.listdir(PROFILES_DIR))
        if f.endswith(".json")
    ]


# ── Claude Brief Generation ──────────────────────────────────────────────────

BRIEF_SYSTEM = """\
You are a brand strategist. Given scraped data about a content creator, write a structured brand brief.

Output ONLY a valid JSON object with exactly these keys:
{
  "mission": "1-2 sentence mission statement — what the creator stands for",
  "bio": "2-3 sentence bio — who they are, what they make, who it's for",
  "voice": "How the creator speaks — 2-3 specific descriptors with examples",
  "tone": "Emotional/stylistic guidance — what feeling the content creates",
  "format_notes": "How content is structured and delivered (format, length, cadence)",
  "title_style": "Specific guidance for writing titles — include pattern examples from their actual video titles",
  "thumbnail_style": "Guidance for thumbnail text — length, style, language",
  "description_example": "A template sentence that matches their actual description style",
  "copy_style_notes": "Detailed notes on their writing style — vocabulary, sentence length, recurring phrases, what to avoid"
}

Base this on the scraped data. If the creator is French-Canadian, all output should reflect that context.
No text outside the JSON. No markdown fences. Just the JSON object.\
"""


def _generate_brief(scraped: dict, existing: dict) -> dict:
    """Call Claude Haiku to generate a brand brief from scraped data."""
    yt   = scraped.get("youtube", {})
    web  = scraped.get("website", {})
    ig   = scraped.get("instagram", {})

    recent_titles = "\n".join(
        f"- {v['title']}" for v in (yt.get("recent_videos") or [])[:10]
    )

    prompt = f"""Creator: {existing.get('name', 'Unknown')}
Website: {existing.get('website_url', 'N/A')}
YouTube channel: {existing.get('youtube_url', 'N/A')}
Instagram: {existing.get('instagram_handle', 'N/A')}

YouTube channel description:
{yt.get('channel_description', 'N/A')}

Recent video titles:
{recent_titles or 'N/A'}

Subscriber count: {yt.get('subscriber_count', 'N/A')}
Total videos: {yt.get('video_count', 'N/A')}

Website meta description:
{web.get('meta_description', 'N/A')}

Website page title: {web.get('page_title', 'N/A')}

Instagram bio: {ig.get('bio', 'N/A')}
Instagram followers: {ig.get('follower_count', 'N/A')}

Existing brand notes (use as context, improve upon):
Voice: {existing.get('voice', 'N/A')}
Tone: {existing.get('tone', 'N/A')}
Format notes: {existing.get('format_notes', 'N/A')}

Generate a complete, specific brand brief based on this data."""

    client = anthropic.Anthropic()
    resp = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=2000,
        system=BRIEF_SYSTEM,
        messages=[{"role": "user", "content": prompt}],
    )
    text = resp.content[0].text if resp.content else ""

    # Parse JSON
    text = text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        text = "\n".join(lines[1:-1] if lines[-1] == "```" else lines[1:])
    start = text.find("{")
    end   = text.rfind("}") + 1
    if start >= 0 and end > start:
        return json.loads(text[start:end])
    raise ValueError(f"Claude returned invalid JSON: {text[:200]}")


# ── Refresh Jobs ─────────────────────────────────────────────────────────────

def _has_local_logo(client_id: str) -> bool:
    """Return True if a manually-uploaded or previously-downloaded logo exists."""
    d = os.path.join(ASSETS_DIR, client_id)
    for ext in ("png", "jpg", "jpeg", "svg", "webp"):
        if os.path.exists(os.path.join(d, f"logo.{ext}")):
            return True
    return False


def _run_quick_refresh(job_id: str, client_id: str):
    """
    Quick refresh: pull latest YouTube stats + recent videos only.
    Fast (~5s), no Claude, no website/Instagram scrape.
    """
    try:
        _update_job(job_id, status="running", progress="Fetching latest YouTube stats…")
        profile = _load_profile(client_id)
        if not profile:
            _update_job(job_id, status="error", error=f"Profile not found: {client_id}")
            return

        yt = bs.scrape_youtube(profile.get("youtube_url", ""))
        logger.info(f"Quick refresh for {client_id}: {len(yt.get('recent_videos', []))} videos")

        existing_scraped = profile.get("scraped", {})
        existing_scraped["youtube"] = yt
        existing_scraped["youtube_updated"] = datetime.now().isoformat()
        profile["scraped"] = existing_scraped

        _update_job(job_id, progress="Saving…")
        _save_profile(client_id, profile)
        _update_job(job_id, status="done", result=profile, progress="Done")

    except Exception as e:
        logger.exception(f"Quick refresh failed for {client_id}: {e}")
        _update_job(job_id, status="error", error=str(e))


def _run_full_refresh(job_id: str, client_id: str):
    """
    Full brand refresh: scrape YouTube + website + Instagram, regenerate Claude brief.
    Slow (~30-60s). Preserves manually-uploaded assets — never overwrites them.
    """
    try:
        _update_job(job_id, status="running", progress="Loading profile…")
        profile = _load_profile(client_id)
        if not profile:
            _update_job(job_id, status="error", error=f"Profile not found: {client_id}")
            return

        _update_job(job_id, progress="Scraping YouTube, website, and Instagram…")
        scraped = bs.scrape_all(profile)
        logger.info(f"Full scrape for {client_id}: yt={bool(scraped['youtube'])}, web={bool(scraped['website'])}, ig={bool(scraped['instagram'])}")

        # Download logo only if user hasn't already set one (via logo_file or manual upload)
        logo_url = scraped.get("website", {}).get("logo_url", "")
        if logo_url and not profile.get("logo_file") and not _has_local_logo(client_id):
            _update_job(job_id, progress="Downloading logo…")
            _download_logo(client_id, logo_url)

        _update_job(job_id, progress="Generating brand brief with Claude…")
        try:
            brief = _generate_brief(scraped, profile)
        except Exception as e:
            logger.warning(f"Brief generation failed: {e}")
            brief = {}

        # Merge: only update fields NOT manually edited by Loric
        manually_edited = set(profile.get("manually_edited", []))
        brief_fields = ["mission", "bio", "voice", "tone", "format_notes",
                        "title_style", "thumbnail_style", "description_example", "copy_style_notes"]
        for field in brief_fields:
            if field in brief and field not in manually_edited:
                profile[field] = brief[field]

        profile["scraped"] = {
            "last_updated":    datetime.now().isoformat(),
            "youtube":         scraped.get("youtube", {}),
            "website":         scraped.get("website", {}),
            "instagram":       scraped.get("instagram", {}),
        }

        _update_job(job_id, progress="Saving…")
        _save_profile(client_id, profile)
        _update_job(job_id, status="done", result=profile, progress="Done")
        logger.info(f"Full refresh complete for {client_id}")

    except Exception as e:
        logger.exception(f"Full refresh failed for {client_id}: {e}")
        _update_job(job_id, status="error", error=str(e))


# ── Assets ──────────────────────────────────────────────────────────────────

def _assets_dir(client_id: str) -> str:
    d = os.path.join(ASSETS_DIR, client_id)
    os.makedirs(d, exist_ok=True)
    return d


def _download_logo(client_id: str, url: str):
    """Download a logo from url and save to brand_assets/<client_id>/logo.<ext>."""
    try:
        ext = "png"
        if ".svg" in url.lower():
            ext = "svg"
        elif ".jpg" in url.lower() or ".jpeg" in url.lower():
            ext = "jpg"
        dest = os.path.join(_assets_dir(client_id), f"logo.{ext}")
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15) as r:
            data = r.read()
        if len(data) > 500:  # ignore empty/error responses
            with open(dest, "wb") as f:
                f.write(data)
            logger.info(f"Logo saved: {dest} ({len(data)} bytes)")
    except Exception as e:
        logger.warning(f"Logo download failed: {e}")


def _list_assets(client_id: str) -> list[dict]:
    d = _assets_dir(client_id)
    assets = []
    for fname in sorted(os.listdir(d)):
        if fname.startswith("."):
            continue
        fpath = os.path.join(d, fname)
        mime, _ = mimetypes.guess_type(fname)
        assets.append({
            "name":     fname,
            "size":     os.path.getsize(fpath),
            "mime":     mime or "application/octet-stream",
            "is_image": (mime or "").startswith("image/"),
            "url":      f"/assets/{client_id}/{urllib.parse.quote(fname)}",
        })
    return assets


# ── Routes ──────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    clients = _list_clients()
    if clients:
        return redirect(f"/{clients[0]}")
    return "No brand profiles found.", 404


@app.route("/<client_id>")
def profile_page(client_id):
    profile = _load_profile(client_id)
    if not profile:
        return f"Profile '{client_id}' not found.", 404
    clients = _list_clients()
    import time
    logo_file = profile.get("logo_file", "")
    # Build display names for dropdown: use profile.name if set, else slugify client_id
    client_names = {}
    for c in clients:
        p = _load_profile(c)
        client_names[c] = (p.get("name") or c.replace("-", " ").title()) if p else c.replace("-", " ").title()
    return render_template_string(
        PAGE_HTML,
        profile=profile,
        client_id=client_id,
        clients=clients,
        client_names=client_names,
        now=int(time.time()),
        logo_file_encoded=urllib.parse.quote(logo_file) if logo_file else "",
    )


@app.route("/api/<client_id>/data")
def api_data(client_id):
    profile = _load_profile(client_id)
    if not profile:
        return jsonify({"error": "not found"}), 404
    return jsonify(profile)


@app.route("/api/<client_id>/refresh", methods=["POST"])
def api_refresh(client_id):
    if not _load_profile(client_id):
        return jsonify({"error": "not found"}), 404
    mode = (request.json or {}).get("mode", "quick")
    job_id = _new_job()
    target = _run_quick_refresh if mode == "quick" else _run_full_refresh
    threading.Thread(target=target, args=(job_id, client_id), daemon=True).start()
    return jsonify({"job_id": job_id, "mode": mode})


@app.route("/api/job/<job_id>")
def api_job(job_id):
    job = _get_job(job_id)
    if not job:
        return jsonify({"error": "not found"}), 404
    return jsonify(job)


@app.route("/api/<client_id>/save", methods=["POST"])
def api_save(client_id):
    profile = _load_profile(client_id)
    if not profile:
        return jsonify({"error": "not found"}), 404
    data = request.json or {}
    # Track which fields were manually edited
    manually_edited = set(profile.get("manually_edited", []))
    editable_fields = ["name", "mission", "bio", "voice", "tone", "format_notes",
                       "title_style", "thumbnail_style", "description_example",
                       "copy_style_notes", "website_url", "youtube_url", "instagram_handle", "tiktok_handle"]
    for field in editable_fields:
        if field in data:
            profile[field] = data[field]
            manually_edited.add(field)
    profile["manually_edited"] = list(manually_edited)
    _save_profile(client_id, profile)
    return jsonify({"ok": True})


@app.route("/assets/<client_id>/<path:filename>")
def serve_asset(client_id, filename):
    d = _assets_dir(client_id)
    return send_from_directory(d, filename)


@app.route("/api/<client_id>/logo")
def serve_logo(client_id):
    """Serve the active logo for a client. Stable URL regardless of filename."""
    profile = _load_profile(client_id)
    if not profile:
        return "", 404
    logo_file = profile.get("logo_file", "")
    d = _assets_dir(client_id)
    # Try logo_file first, then fallback to logo.png
    for candidate in ([logo_file] if logo_file else []) + ["logo.png", "logo.jpg", "logo.jpeg", "logo.svg", "logo.webp"]:
        fpath = os.path.join(d, candidate)
        if os.path.exists(fpath):
            return send_from_directory(d, candidate)
    return "", 404


@app.route("/proxy/style-ref/<profile_id>/<style_id>")
def proxy_style_ref(profile_id, style_id):
    """Proxy style reference images from the Cover Studio (localhost:4300).
    This lets remote clients (iPhone, etc.) load style refs without hitting localhost."""
    import urllib.request as _ur
    covers_url = os.getenv("COVERS_URL", "http://localhost:4300")
    url = f"{covers_url}/api/style-ref/{profile_id}/{style_id}"
    try:
        with _ur.urlopen(url, timeout=5) as r:
            data = r.read()
            content_type = r.headers.get("Content-Type", "image/jpeg")
        from flask import Response
        return Response(data, mimetype=content_type)
    except Exception:
        # Return a 1x1 transparent PNG if cover studio is unreachable
        from flask import Response
        import base64
        px = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")
        return Response(px, mimetype="image/png")


@app.route("/api/<client_id>/assets")
def api_list_assets(client_id):
    return jsonify(_list_assets(client_id))


@app.route("/api/<client_id>/upload-asset", methods=["POST"])
def api_upload_asset(client_id):
    if not _load_profile(client_id):
        return jsonify({"error": "not found"}), 404
    f = request.files.get("file")
    if not f or not f.filename:
        return jsonify({"error": "no file"}), 400
    # Sanitise filename
    safe = "".join(c for c in f.filename if c.isalnum() or c in "._- ").strip()
    safe = safe or "upload"
    dest = os.path.join(_assets_dir(client_id), safe)
    f.save(dest)
    mime, _ = mimetypes.guess_type(safe)
    return jsonify({
        "ok":       True,
        "name":     safe,
        "url":      f"/assets/{client_id}/{safe}",
        "is_image": (mime or "").startswith("image/"),
    })


@app.route("/api/<client_id>/delete-asset", methods=["POST"])
def api_delete_asset(client_id):
    name = (request.json or {}).get("name", "")
    if not name or "/" in name or ".." in name:
        return jsonify({"error": "invalid"}), 400
    fpath = os.path.join(_assets_dir(client_id), name)
    if os.path.exists(fpath):
        os.remove(fpath)
    # If this was the logo file, clear logo_file from profile
    profile = _load_profile(client_id)
    if profile and profile.get("logo_file") == name:
        profile.pop("logo_file", None)
        _save_profile(client_id, profile)
    return jsonify({"ok": True})


@app.route("/api/<client_id>/set-logo", methods=["POST"])
def api_set_logo(client_id):
    """Set which uploaded asset is the displayed logo."""
    name = (request.json or {}).get("name", "")
    if not name or "/" in name or ".." in name:
        return jsonify({"error": "invalid"}), 400
    profile = _load_profile(client_id)
    if not profile:
        return jsonify({"error": "not found"}), 404
    profile["logo_file"] = name
    _save_profile(client_id, profile)
    return jsonify({"ok": True, "logo_url": f"/assets/{client_id}/{name}"})


@app.route("/api/new-client", methods=["POST"])
def api_new_client():
    """Create a new blank brand profile."""
    data = request.json or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name required"}), 400
    # Generate ID from name
    client_id = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    if not client_id:
        return jsonify({"error": "invalid name"}), 400
    if os.path.exists(_profile_path(client_id)):
        return jsonify({"error": f"'{client_id}' already exists"}), 409

    profile = {
        "id":               client_id,
        "name":             name,
        "website_url":      data.get("website_url", ""),
        "youtube_url":      data.get("youtube_url", ""),
        "instagram_handle": data.get("instagram_handle", ""),
        "tiktok_handle":    data.get("tiktok_handle", ""),
        "voice":            "",
        "tone":             "",
        "format_notes":     "",
        "title_style":      "",
        "thumbnail_style":  "",
        "description_example": "",
        "mission":          "",
        "bio":              "",
        "copy_style_notes": "",
        "manually_edited":  [],
        "styles":           [],
        "style_refs_dir":   f"style_refs/{client_id}",
    }
    _save_profile(client_id, profile)
    os.makedirs(_assets_dir(client_id), exist_ok=True)
    logger.info(f"New brand profile created: {client_id}")
    return jsonify({"ok": True, "client_id": client_id})


@app.route("/api/<client_id>/delete", methods=["POST"])
def api_delete_client(client_id):
    """Delete a brand profile and all its assets."""
    profile = _load_profile(client_id)
    if not profile:
        return jsonify({"error": "not found"}), 404
    # Delete JSON
    try:
        os.remove(_profile_path(client_id))
    except Exception as e:
        logger.warning(f"Could not delete profile JSON for {client_id}: {e}")
    # Delete assets dir
    assets_d = os.path.join(ASSETS_DIR, client_id)
    if os.path.isdir(assets_d):
        import shutil as _shutil
        try:
            _shutil.rmtree(assets_d)
        except Exception as e:
            logger.warning(f"Could not delete assets for {client_id}: {e}")
    # Remove from sibling tools too
    for sync_dir in SYNC_PATHS:
        p = os.path.join(sync_dir, f"{client_id}.json")
        if os.path.exists(p):
            try:
                os.remove(p)
            except Exception:
                pass
    logger.info(f"Deleted brand profile: {client_id}")
    clients = _list_clients()
    next_id = clients[0] if clients else None
    return jsonify({"ok": True, "next_client": next_id})


def _run_discover(job_id: str, query: str):
    """Run brand_discover.discover() in a thread and store result in job state."""
    try:
        _update_job(job_id, status="running", progress="Searching…")
        result = bd.discover(query)
        _update_job(job_id, status="done", result=result, progress="Done")
        logger.info(f"Discover result for '{query}': {result}")
    except Exception as e:
        logger.exception(f"Discover failed for '{query}': {e}")
        _update_job(job_id, status="error", error=str(e))


@app.route("/api/discover", methods=["POST"])
def api_discover():
    """Auto-discover brand socials from a name or URL. Returns a job_id to poll."""
    data = request.json or {}
    query = (data.get("query") or "").strip()
    if not query:
        return jsonify({"error": "query required"}), 400
    job_id = _new_job()
    threading.Thread(target=_run_discover, args=(job_id, query), daemon=True).start()
    return jsonify({"job_id": job_id})


# ── HTML ────────────────────────────────────────────────────────────────────

PAGE_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{ profile.name }} — Brand Profile · MOKSHATOOLS</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=Inter:wght@300;400;500&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --cream:   #faf9f7; --cream-2: #f4f2ef; --cream-3: #ede9e2;
      --gold-1:  #7a5c1a; --gold-2:  #b08928; --gold-3:  #c9a84c;
      --gold-4:  #e2c97e; --gold-5:  #f0e4bc;
      --text-1:  #1c1608; --text-2:  #3a2e14; --text-3:  #7a6540; --text-4:  #b09870;
      --border:  rgba(176,137,40,0.18); --border-2: rgba(176,137,40,0.08);
      --red: #a03030;
    }
    html { scroll-behavior: smooth; }
    body { background: var(--cream); color: var(--text-1); font-family: 'Inter', sans-serif; font-weight: 300; min-height: 100vh; }

    .geo-bg { position: fixed; inset: 0; pointer-events: none; z-index: 0; overflow: hidden; }
    .container { position: relative; z-index: 1; max-width: 1100px; margin: 0 auto; padding: 0 2rem; }

    /* Header */
    .header { padding: 3.5rem 0 1.5rem; text-align: center; }
    .header-eyebrow { font-size: 0.63rem; font-weight: 500; letter-spacing: 0.3em; text-transform: uppercase; color: var(--gold-3); margin-bottom: 1rem; }
    .header-title { font-family: 'Cormorant Garamond', serif; font-size: clamp(2.2rem, 5vw, 3.5rem); font-weight: 300; letter-spacing: 0.1em; color: var(--text-1); margin-bottom: 0.4rem; }
    .header-sub { font-family: 'Cormorant Garamond', serif; font-style: italic; color: var(--text-3); font-size: 1rem; }

    .divider { display: flex; align-items: center; gap: 0.75rem; justify-content: center; margin: 1.25rem 0; color: var(--gold-3); }
    .divider::before, .divider::after { content: ''; display: block; width: 50px; height: 1px; background: var(--gold-3); opacity: 0.5; }
    .divider-dot { width: 4px; height: 4px; border-radius: 50%; background: var(--gold-3); }

    /* Top controls bar */
    .controls-bar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.75rem; margin-bottom: 2rem; padding-bottom: 1rem; border-bottom: 1px solid var(--border); }
    .client-switcher { display: flex; align-items: center; gap: 0.5rem; }
    select.client-select { padding: 0.5rem 0.75rem; border: 1px solid var(--border); background: var(--cream-2); color: var(--text-1); font-family: 'Inter', sans-serif; font-size: 0.72rem; font-weight: 500; letter-spacing: 0.1em; text-transform: uppercase; outline: none; cursor: pointer; }
    select.client-select:focus { border-color: var(--gold-3); }
    .last-updated { font-size: 0.6rem; color: var(--text-4); letter-spacing: 0.08em; }
    .controls-right { display: flex; align-items: center; gap: 0.75rem; }

    /* Buttons */
    .btn { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.65rem 1.2rem; border: 1px solid var(--border); background: transparent; color: var(--text-3); font-family: 'Inter', sans-serif; font-size: 0.65rem; font-weight: 500; letter-spacing: 0.18em; text-transform: uppercase; cursor: pointer; transition: all 0.2s; white-space: nowrap; }
    .btn:hover { background: var(--cream-3); border-color: var(--gold-3); color: var(--gold-2); }
    .btn:disabled { opacity: 0.35; cursor: not-allowed; }
    .btn-primary { background: var(--cream-3); border-color: var(--gold-3); color: var(--gold-1); }
    .btn-primary:hover { background: var(--gold-5); }

    /* Section panels */
    .section { margin-bottom: 1.5rem; border: 1px solid var(--border); background: var(--cream-2); }
    .section-head { display: flex; align-items: center; justify-content: space-between; padding: 0.9rem 1.5rem; border-bottom: 1px solid var(--border); }
    .section-label { font-size: 0.6rem; font-weight: 500; letter-spacing: 0.28em; text-transform: uppercase; color: var(--text-4); }
    .section-body { padding: 1.5rem; }

    /* Brand Identity */
    .identity-grid { display: grid; grid-template-columns: auto 1fr; gap: 1.5rem; align-items: start; }
    .logo-box { max-width: 280px; border: 1px solid var(--border); background: var(--cream); display: flex; align-items: center; justify-content: center; overflow: hidden; flex-shrink: 0; padding: 12px; }
    .logo-box img { max-width: 100%; max-height: 220px; width: auto; height: auto; display: block; object-fit: contain; }
    .logo-placeholder { font-size: 0.55rem; color: var(--text-4); letter-spacing: 0.1em; text-align: center; }
    .identity-name { font-family: 'Cormorant Garamond', serif; font-size: 1.8rem; font-weight: 400; color: var(--text-1); margin-bottom: 0.35rem; }
    .identity-field { margin-bottom: 0.75rem; }
    .field-label { font-size: 0.55rem; font-weight: 500; letter-spacing: 0.22em; text-transform: uppercase; color: var(--text-4); margin-bottom: 0.2rem; }
    .field-links { display: flex; gap: 1rem; flex-wrap: wrap; margin-top: 0.5rem; }
    .field-link { font-size: 0.72rem; color: var(--gold-2); text-decoration: none; letter-spacing: 0.04em; }
    .field-link:hover { color: var(--gold-1); text-decoration: underline; }

    /* Editable fields */
    [contenteditable] { outline: none; border-bottom: 1px solid transparent; padding: 0.1rem 0.2rem; transition: border-color 0.15s, background 0.15s; border-radius: 2px; }
    [contenteditable]:focus { border-bottom-color: var(--gold-3); background: rgba(176,137,40,0.04); }
    [contenteditable]:hover:not(:focus) { border-bottom-color: var(--border); }
    .saved-flash { color: var(--gold-3); font-size: 0.6rem; opacity: 0; transition: opacity 0.3s; letter-spacing: 0.1em; }
    .saved-flash.show { opacity: 1; }

    /* Visual Identity */
    .colors-row { display: flex; gap: 1rem; flex-wrap: wrap; margin-bottom: 2rem; align-items: flex-start; }
    .swatch-wrap { display: flex; flex-direction: column; align-items: center; gap: 0.4rem; }
    .swatch { width: 80px; height: 80px; border-radius: 50%; border: 1px solid var(--border); position: relative; cursor: default; flex-shrink: 0; }
    .swatch-hex { font-size: 0.52rem; color: var(--text-3); letter-spacing: 0.05em; font-family: 'Courier New', monospace; text-align: center; }
    .swatch-tip { display: none; position: absolute; bottom: calc(100% + 4px); left: 50%; transform: translateX(-50%); background: var(--text-1); color: var(--cream); font-size: 0.55rem; padding: 0.2rem 0.4rem; letter-spacing: 0.05em; white-space: nowrap; pointer-events: none; }
    .swatch:hover .swatch-tip { display: block; }
    .fonts-row { display: flex; gap: 1.25rem; flex-wrap: wrap; align-items: flex-end; margin-bottom: 0.5rem; }
    .font-chip { padding: 0.5rem 1.25rem; font-size: 3rem; color: var(--text-1); line-height: 1.1; font-weight: 400; }
    .font-name { font-size: 0.52rem; color: var(--text-4); letter-spacing: 0.1em; margin-top: 0.3rem; text-align: center; }
    .style-refs { display: flex; gap: 1rem; flex-wrap: wrap; margin-top: 1.5rem; align-items: flex-start; }
    .style-ref-thumb { display: flex; flex-direction: column; align-items: center; gap: 0.5rem; }
    .style-ref-img { height: 200px; width: auto; max-width: 400px; display: block; border: 1px solid var(--border); object-fit: contain; }
    .style-ref-label { font-size: 0.55rem; color: var(--text-4); letter-spacing: 0.1em; text-transform: uppercase; }

    /* Channel stats */
    .stats-row { display: flex; gap: 2rem; flex-wrap: wrap; margin-bottom: 1.25rem; }
    .stat { display: flex; flex-direction: column; gap: 0.2rem; }
    .stat-value { font-family: 'Cormorant Garamond', serif; font-size: 2rem; font-weight: 400; color: var(--gold-2); line-height: 1; }
    .stat-label { font-size: 0.55rem; color: var(--text-4); letter-spacing: 0.18em; text-transform: uppercase; }
    .video-list { display: flex; flex-direction: column; gap: 0; border: 1px solid var(--border); }
    .video-row { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 0.6rem 1rem; border-bottom: 1px solid var(--border-2); font-size: 0.78rem; color: var(--text-2); }
    .video-row:last-child { border-bottom: none; }
    .video-title { flex: 1; }
    .video-meta { font-size: 0.6rem; color: var(--text-4); flex-shrink: 0; text-align: right; }

    /* Voice fields grid */
    .voice-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: var(--border); border: 1px solid var(--border); }
    .voice-card { background: var(--cream); padding: 1.25rem 1.5rem; }
    .voice-card.full { grid-column: 1 / -1; }
    .voice-card-label { font-size: 0.55rem; font-weight: 500; letter-spacing: 0.22em; text-transform: uppercase; color: var(--text-4); margin-bottom: 0.5rem; display: flex; align-items: center; justify-content: space-between; }
    .voice-text { font-size: 0.82rem; color: var(--text-2); line-height: 1.65; min-height: 2em; }

    /* Social Scribe injection preview */
    .injection-pre { background: var(--cream); border: 1px solid var(--border-2); padding: 1rem 1.25rem; font-size: 0.72rem; font-family: 'Inter', monospace; color: var(--text-3); white-space: pre-wrap; line-height: 1.7; }

    /* Loading overlay */
    #loading-overlay { display: none; position: fixed; inset: 0; z-index: 100; background: rgba(240,228,188,0.97); align-items: center; justify-content: center; flex-direction: column; gap: 1.25rem; }
    #loading-overlay.visible { display: flex; }
    .spinner { width: 52px; height: 52px; border: 2px solid var(--gold-4); border-top-color: var(--gold-1); border-radius: 50%; animation: spin 0.9s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .loading-title { font-family: 'Cormorant Garamond', serif; font-size: 1.8rem; font-weight: 300; letter-spacing: 0.12em; color: var(--text-2); }
    .loading-msg { font-size: 0.7rem; letter-spacing: 0.15em; color: var(--gold-3); text-transform: uppercase; min-height: 1.2em; }

    footer { text-align: center; padding: 2rem 0 3rem; border-top: 1px solid var(--border-2); margin-top: 2rem; }
    footer p { font-size: 0.63rem; letter-spacing: 0.2em; color: var(--text-4); text-transform: uppercase; }
    footer a { color: var(--gold-3); text-decoration: none; }

    .no-data { font-size: 0.72rem; color: var(--text-4); font-style: italic; }

    /* Assets */
    .asset-drop-zone { min-height: 80px; border: 1px dashed var(--border); padding: 1rem; transition: background 0.15s; }
    .asset-drop-zone.drag-over { background: var(--gold-5); border-color: var(--gold-3); }
    .drop-hint { font-size: 0.68rem; color: var(--text-4); letter-spacing: 0.08em; margin-bottom: 0.75rem; }
    .asset-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 0.75rem; margin-top: 0.5rem; }
    .asset-item { display: flex; flex-direction: column; align-items: center; gap: 0.35rem; position: relative; }
    .asset-item:hover .asset-delete { display: flex; }
    .asset-item:hover .asset-set-logo { display: flex; }
    .asset-thumb { width: 100%; border: 1px solid var(--border); background: var(--cream); display: flex; align-items: center; justify-content: center; overflow: hidden; padding: 4px; }
    .asset-thumb img { max-width: 100%; height: auto; display: block; object-fit: contain; }
    .asset-icon { font-size: 1.8rem; }
    .asset-name { font-size: 0.58rem; color: var(--text-3); text-align: center; word-break: break-all; max-width: 100%; }
    .asset-delete { display: none; position: absolute; top: 4px; right: 4px; width: 18px; height: 18px; background: var(--red); color: #fff; border: none; cursor: pointer; font-size: 0.65rem; align-items: center; justify-content: center; }
    .asset-set-logo { display: none; position: absolute; bottom: 22px; left: 0; right: 0; background: rgba(176,137,40,0.88); color: #fff; border: none; cursor: pointer; font-size: 0.52rem; font-weight: 500; letter-spacing: 0.1em; text-transform: uppercase; padding: 3px 0; align-items: center; justify-content: center; width: 100%; }
    .asset-is-logo { position: absolute; bottom: 22px; left: 0; right: 0; background: var(--gold-3); color: var(--text-1); font-size: 0.5rem; font-weight: 500; letter-spacing: 0.1em; text-transform: uppercase; padding: 2px 0; text-align: center; pointer-events: none; }
    /* New brand modal */
    .modal-overlay { display: none; position: fixed; inset: 0; z-index: 200; background: rgba(28,22,8,0.55); align-items: center; justify-content: center; }
    .modal-overlay.visible { display: flex; }
    .modal { background: var(--cream); border: 1px solid var(--border); padding: 2rem 2.5rem; max-width: 520px; width: 90%; }
    .modal-title { font-family: 'Cormorant Garamond', serif; font-size: 1.6rem; font-weight: 300; margin-bottom: 0.4rem; color: var(--text-1); }
    .modal-subtitle { font-size: 0.68rem; color: var(--text-4); letter-spacing: 0.06em; margin-bottom: 1.4rem; }
    .modal-field { display: flex; flex-direction: column; gap: 0.3rem; margin-bottom: 1rem; }
    .modal-field label { font-size: 0.58rem; font-weight: 500; letter-spacing: 0.2em; text-transform: uppercase; color: var(--text-4); }
    .modal-field input { padding: 0.6rem 0.8rem; border: 1px solid var(--border); background: var(--cream-2); color: var(--text-1); font-family: 'Inter', sans-serif; font-size: 0.82rem; outline: none; }
    .modal-field input:focus { border-color: var(--gold-3); }
    .modal-actions { display: flex; gap: 0.75rem; justify-content: flex-end; margin-top: 1.5rem; }
    .modal-error { font-size: 0.72rem; color: var(--red); min-height: 1.2em; margin-top: 0.5rem; }
    .discover-row { display: flex; gap: 0.5rem; margin-bottom: 1.25rem; }
    .discover-row input { flex: 1; padding: 0.6rem 0.8rem; border: 1px solid var(--border); background: var(--cream-2); color: var(--text-1); font-family: 'Inter', sans-serif; font-size: 0.82rem; outline: none; }
    .discover-row input:focus { border-color: var(--gold-3); }
    .discover-divider { display: flex; align-items: center; gap: 0.75rem; margin: 1rem 0; color: var(--text-4); font-size: 0.58rem; letter-spacing: 0.15em; text-transform: uppercase; }
    .discover-divider::before, .discover-divider::after { content: ''; flex: 1; height: 1px; background: var(--border); }
    .discover-found { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 1rem; }
    .discover-chip { padding: 0.25rem 0.6rem; background: var(--cream-3); border: 1px solid var(--gold-4); font-size: 0.62rem; color: var(--gold-1); letter-spacing: 0.06em; }
    .discover-msg { font-size: 0.68rem; color: var(--text-4); font-style: italic; margin-bottom: 0.75rem; }
  </style>
</head>
<body>

<div class="geo-bg">
  <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <g id="oct">
        <polygon points="0,-48 11.3,-11.3 48,0 11.3,11.3 0,48 -11.3,11.3 -48,0 -11.3,-11.3" fill="none" stroke="#b08928" stroke-width="0.6"/>
        <circle cx="0" cy="0" r="48" fill="none" stroke="#b08928" stroke-width="0.4"/>
        <circle cx="0" cy="0" r="4" fill="none" stroke="#b08928" stroke-width="0.5"/>
      </g>
      <g id="hex">
        <polygon points="0,-40 34.6,20 -34.6,20" fill="none" stroke="#b08928" stroke-width="0.6"/>
        <polygon points="0,40 34.6,-20 -34.6,-20" fill="none" stroke="#b08928" stroke-width="0.6"/>
        <circle cx="0" cy="0" r="40" fill="none" stroke="#b08928" stroke-width="0.4"/>
      </g>
    </defs>
    <g opacity="0.045">
      <use href="#oct" transform="translate(120,130) scale(1.5)"/>
      <use href="#hex" transform="translate(280,70) scale(0.9)"/>
      <use href="#oct" transform="translate(calc(100vw - 130px),120) scale(1.1)"/>
    </g>
  </svg>
</div>

<div id="loading-overlay">
  <div class="spinner"></div>
  <div class="loading-title" id="loading-title">Refreshing</div>
  <div class="loading-msg" id="loading-msg">Initialising…</div>
</div>

<div class="container">
  <header class="header">
    <div class="header-eyebrow">Mokshatools</div>
    <h1 class="header-title">Brand Profiles</h1>
    <div class="header-sub">Visual brand deck · Social Scribe data source</div>
  </header>

  <div class="divider"><div class="divider-dot"></div></div>

  <div class="controls-bar">
    <div class="client-switcher">
      <select class="client-select" onchange="if(this.value==='__new__'){openNewBrandModal()}else{window.location='/'+this.value}">
        {% for c in clients %}
        <option value="{{ c }}" {% if c == client_id %}selected{% endif %}>{{ client_names[c] }}</option>
        {% endfor %}
        <option value="__new__" style="color:var(--gold-2);font-style:italic">+ New Brand…</option>
      </select>
    </div>
    <div class="controls-right">
      {% set scraped = profile.get('scraped', {}) %}
      {% if scraped.get('last_updated') %}
      <span class="last-updated">Last refreshed {{ scraped.last_updated[:10] }}</span>
      {% endif %}
      <span class="saved-flash" id="saved-flash">Saved</span>
      <button class="btn" onclick="startRefresh('quick')" title="Pull latest YouTube stats only — fast, no Claude">↻ Quick</button>
      <button class="btn btn-primary" onclick="startRefresh('full')" title="Full scrape + Claude brand brief regeneration">⟳ Full Refresh</button>
      <button class="btn" onclick="deleteBrand()" title="Delete this brand profile" style="border-color:var(--red);color:var(--red)" onmouseover="this.style.background='rgba(160,48,48,0.08)'" onmouseout="this.style.background=''">✕ Delete</button>
    </div>
  </div>

  <!-- Brand Identity -->
  <div class="section">
    <div class="section-head">
      <span class="section-label">Brand Identity</span>
    </div>
    <div class="section-body">
      <div class="identity-grid">
        <div class="logo-box" id="logo-box">
          <img id="logo-img" src="/api/{{ client_id }}/logo?t={{ now }}" alt="Logo"
            onload="document.getElementById('logo-placeholder').style.display='none'"
            onerror="this.style.display='none';document.getElementById('logo-placeholder').style.display='flex'">
          <div class="logo-placeholder" id="logo-placeholder" style="display:none">
            <label style="cursor:pointer;text-align:center;font-size:0.5rem;color:var(--text-4);line-height:1.6">
              Upload<br>logo<br>
              <input type="file" accept="image/*" style="display:none" onchange="uploadLogo(this)">
            </label>
          </div>
        </div>
        <div>
          <div class="identity-name" contenteditable="true" data-field="name" spellcheck="false">{{ profile.name }}</div>

          <div class="identity-field">
            <div class="field-label">Mission</div>
            <div class="voice-text" contenteditable="true" data-field="mission"
              >{{ profile.get('mission', '') or 'Click Refresh All to generate mission statement…' }}</div>
          </div>

          <div class="identity-field">
            <div class="field-label">Bio</div>
            <div class="voice-text" contenteditable="true" data-field="bio"
              >{{ profile.get('bio', '') or 'Click Refresh All to generate bio…' }}</div>
          </div>

          <div class="field-links">
            {% if profile.get('website_url') %}
            <a href="{{ profile.website_url }}" class="field-link" target="_blank">🌐 {{ profile.website_url }}</a>
            {% endif %}
            {% if profile.get('youtube_url') %}
            <a href="{{ profile.youtube_url }}" class="field-link" target="_blank">▶ YouTube</a>
            {% endif %}
            {% if profile.get('instagram_handle') %}
            <a href="https://instagram.com/{{ profile.instagram_handle.lstrip('@') }}" class="field-link" target="_blank">◈ {{ profile.instagram_handle }}</a>
            {% endif %}
            {% if profile.get('tiktok_handle') %}
            <a href="https://tiktok.com/@{{ profile.tiktok_handle.lstrip('@') }}" class="field-link" target="_blank">◎ {{ profile.tiktok_handle }}</a>
            {% endif %}
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Visual Identity -->
  <div class="section">
    <div class="section-head">
      <span class="section-label">Visual Identity</span>
    </div>
    <div class="section-body">
      {% set web_scraped = (profile.get('scraped') or {}).get('website', {}) %}
      {% set colors = web_scraped.get('colors', []) %}
      {% set fonts  = web_scraped.get('fonts', []) %}

      {% if colors %}
      <div class="field-label" style="margin-bottom:0.75rem">Website Colors</div>
      <div class="colors-row">
        {% for color in colors[:8] %}
        <div class="swatch-wrap">
          <div class="swatch" style="background: {{ color }}">
            <div class="swatch-tip">{{ color }}</div>
          </div>
          <div class="swatch-hex">{{ color }}</div>
        </div>
        {% endfor %}
      </div>
      {% else %}
      <p class="no-data">Color swatches will appear after Refresh All.</p>
      {% endif %}

      {% if fonts %}
      <div class="field-label" style="margin-top:1rem;margin-bottom:0.75rem">Fonts</div>
      <div class="fonts-row">
        {% for font in fonts %}
        <div style="display:flex;flex-direction:column;align-items:center">
          <div class="font-chip" style="font-family: '{{ font }}', serif">Aa</div>
          <div class="font-name">{{ font }}</div>
        </div>
        {% endfor %}
      </div>
      {% endif %}

      {% set styles = profile.get('styles', []) %}
      {% set refs_dir = profile.get('style_refs_dir', '') %}
      {% if styles and refs_dir %}
      <div class="field-label" style="margin-top:1.25rem;margin-bottom:0.5rem">Cover Style References</div>
      <div class="style-refs">
        {% for style in styles %}
        {% if style.get('image') %}
        <div class="style-ref-thumb">
          <img class="style-ref-img"
            src="/proxy/style-ref/{{ profile.id }}/{{ style.id }}"
            alt="{{ style.label }}"
            onerror="this.style.display='none'">
          <div class="style-ref-label">{{ style.label }}</div>
        </div>
        {% endif %}
        {% endfor %}
      </div>
      {% endif %}
    </div>
  </div>

  <!-- Channel Stats -->
  <div class="section">
    <div class="section-head">
      <span class="section-label">Channel Stats</span>
    </div>
    <div class="section-body">
      {% set yt = (profile.get('scraped') or {}).get('youtube', {}) %}
      {% set ig = (profile.get('scraped') or {}).get('instagram', {}) %}

      {% if yt or ig %}
      <div class="stats-row">
        {% if yt.get('subscriber_count') %}
        <div class="stat">
          <div class="stat-value">{{ '{:,}'.format(yt.subscriber_count) }}</div>
          <div class="stat-label">YouTube Subscribers</div>
        </div>
        {% endif %}
        {% if yt.get('video_count') %}
        <div class="stat">
          <div class="stat-value">{{ yt.video_count }}</div>
          <div class="stat-label">Videos incl. Shorts</div>
        </div>
        {% endif %}
        {% if ig.get('follower_count') %}
        <div class="stat">
          <div class="stat-value">{{ '{:,}'.format(ig.follower_count) }}</div>
          <div class="stat-label">Instagram Followers</div>
        </div>
        {% endif %}
        {% if ig.get('post_count') %}
        <div class="stat">
          <div class="stat-value">{{ ig.post_count }}</div>
          <div class="stat-label">IG Posts</div>
        </div>
        {% endif %}
      </div>

      {% set recent = yt.get('recent_videos', []) %}
      {% if recent %}
      <div class="field-label" style="margin-bottom:0.5rem">Recent Videos</div>
      <div class="video-list">
        {% for v in recent[:8] %}
        <div class="video-row">
          <div class="video-title">{{ v.title }}</div>
          <div class="video-meta">
            {% if v.get('view_count') %}{{ '{:,}'.format(v.view_count) }} views · {% endif %}
            {{ v.get('upload_date', '')[:4] if v.get('upload_date') else '' }}
          </div>
        </div>
        {% endfor %}
      </div>
      {% endif %}

      {% else %}
      <p class="no-data">Channel stats will appear after Refresh All.</p>
      {% endif %}
    </div>
  </div>

  <!-- Voice & Copy Style -->
  <div class="section">
    <div class="section-head">
      <span class="section-label">Voice &amp; Copy Style</span>
      <span class="field-label" style="font-size:0.55rem">Click any field to edit · auto-saves on blur</span>
    </div>
    <div class="section-body" style="padding:0">
      <div class="voice-grid">
        <div class="voice-card">
          <div class="voice-card-label">Voice</div>
          <div class="voice-text" contenteditable="true" data-field="voice"
            >{{ profile.get('voice', '') }}</div>
        </div>
        <div class="voice-card">
          <div class="voice-card-label">Tone</div>
          <div class="voice-text" contenteditable="true" data-field="tone"
            >{{ profile.get('tone', '') }}</div>
        </div>
        <div class="voice-card">
          <div class="voice-card-label">Format Notes</div>
          <div class="voice-text" contenteditable="true" data-field="format_notes"
            >{{ profile.get('format_notes', '') }}</div>
        </div>
        <div class="voice-card">
          <div class="voice-card-label">Title Style</div>
          <div class="voice-text" contenteditable="true" data-field="title_style"
            >{{ profile.get('title_style', '') }}</div>
        </div>
        <div class="voice-card">
          <div class="voice-card-label">Thumbnail Copy Style</div>
          <div class="voice-text" contenteditable="true" data-field="thumbnail_style"
            >{{ profile.get('thumbnail_style', '') }}</div>
        </div>
        <div class="voice-card">
          <div class="voice-card-label">Copy Style Notes</div>
          <div class="voice-text" contenteditable="true" data-field="copy_style_notes"
            >{{ profile.get('copy_style_notes', '') }}</div>
        </div>
        <div class="voice-card full">
          <div class="voice-card-label">Description Template</div>
          <div class="voice-text" contenteditable="true" data-field="description_example"
            >{{ profile.get('description_example', '') }}</div>
        </div>
      </div>
    </div>
  </div>

  <!-- Social Scribe Injection Preview -->
  <div class="section">
    <div class="section-head">
      <span class="section-label">Social Scribe — Injection Preview</span>
    </div>
    <div class="section-body">
      <p style="font-size:0.7rem;color:var(--text-4);margin-bottom:0.75rem;letter-spacing:0.05em">This is the exact brand context injected into Claude when Social Scribe generates titles &amp; descriptions.</p>
      <pre class="injection-pre" id="injection-preview"></pre>
    </div>
  </div>

  <!-- Brand Assets -->
  <div class="section">
    <div class="section-head">
      <span class="section-label">Brand Assets</span>
      <label class="btn btn-primary" style="cursor:pointer;margin:0">
        + Upload Asset
        <input type="file" multiple accept="image/*,.pdf,.svg,.ai,.eps,.zip,.ttf,.otf,.woff,.woff2" style="display:none" onchange="uploadAssets(this)">
      </label>
    </div>
    <div class="section-body">
      <div id="asset-drop-zone" class="asset-drop-zone">
        <div class="drop-hint">Drop files here — logos, fonts, brand guidelines, reference images</div>
        <div id="asset-grid" class="asset-grid"></div>
      </div>
    </div>
  </div>

  <footer>
    <p>Mokshatools · <a href="https://mokshatools.com">mokshatools.com</a></p>
  </footer>
</div>

<!-- New Brand Modal -->
<div class="modal-overlay" id="new-brand-modal">
  <div class="modal">
    <div class="modal-title">New Brand Profile</div>
    <div class="modal-subtitle">Enter a brand name or website URL — we'll find the rest automatically.</div>

    <div class="discover-row">
      <input type="text" id="nb-query" placeholder="e.g. RSV, drealexandra.com, @handle…" autocomplete="off"
        onkeydown="if(event.key==='Enter')discoverBrand()">
      <button class="btn btn-primary" id="nb-discover-btn" onclick="discoverBrand()">Discover →</button>
    </div>

    <div id="nb-found" style="display:none">
      <div class="discover-found" id="nb-chips"></div>
      <div class="discover-msg" id="nb-found-msg"></div>
      <div class="discover-divider">Fill in details</div>
    </div>

    <div class="modal-field">
      <label>Brand Name *</label>
      <input type="text" id="nb-name" placeholder="e.g. RSV, Dr. Tremblay" autocomplete="off">
    </div>
    <div class="modal-field">
      <label>Website URL</label>
      <input type="text" id="nb-website" placeholder="https://example.com">
    </div>
    <div class="modal-field">
      <label>YouTube Channel URL</label>
      <input type="text" id="nb-youtube" placeholder="https://www.youtube.com/@handle">
    </div>
    <div class="modal-field">
      <label>Instagram Handle</label>
      <input type="text" id="nb-instagram" placeholder="@handle">
    </div>
    <div class="modal-field">
      <label>TikTok Handle</label>
      <input type="text" id="nb-tiktok" placeholder="@handle">
    </div>
    <div class="modal-error" id="nb-error"></div>
    <div class="modal-actions">
      <button class="btn" onclick="closeNewBrandModal()">Cancel</button>
      <button class="btn btn-primary" onclick="createNewBrand()">Create Profile</button>
    </div>
  </div>
</div>

<div class="container" style="display:none"><!-- spacer -->
</div>

<script>
  const CLIENT_ID = {{ client_id|tojson }};
  let _profile = {{ profile|tojson }};
  let _saveTimer = null;
  let _pollInterval = null;

  // ── Load brand fonts from Google Fonts ────────────────────────────────
  (function loadBrandFonts() {
    const fonts = ((_profile.scraped || {}).website || {}).fonts || [];
    const SYSTEM = new Set(['arial','helvetica','georgia','times','verdana','trebuchet ms',
      'courier','courier new','impact','tahoma','palatino','garamond','bookman',
      'comic sans ms','lucida','inter','system-ui','sans-serif','serif','monospace']);
    fonts.forEach(font => {
      if (!font || SYSTEM.has(font.toLowerCase())) return;
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(font) + ':wght@400;700&display=swap';
      document.head.appendChild(link);
    });
  })();

  // ── Injection preview ──────────────────────────────────────────────────
  function buildInjectionPreview(p) {
    let block = `Brand/Channel: ${p.name || ''}
Voice: ${p.voice || ''}
Tone: ${p.tone || ''}
Format notes: ${p.format_notes || ''}
Title style: ${p.title_style || ''}
Thumbnail style: ${p.thumbnail_style || ''}`;
    if (p.description_example) block += `\n\nExample description style:\n${p.description_example}`;
    if (p.mission) block = `Mission: ${p.mission}\n\n` + block;
    if (p.copy_style_notes) block += `\n\nCopy style notes: ${p.copy_style_notes}`;
    return block;
  }
  document.getElementById('injection-preview').textContent = buildInjectionPreview(_profile);

  // ── Inline editing ─────────────────────────────────────────────────────
  document.querySelectorAll('[contenteditable][data-field]').forEach(el => {
    el.addEventListener('blur', () => {
      const field = el.dataset.field;
      const value = el.innerText.trim();
      clearTimeout(_saveTimer);
      _saveTimer = setTimeout(() => saveField(field, value), 300);
    });
  });

  async function saveField(field, value) {
    try {
      await fetch(`/api/${CLIENT_ID}/save`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({[field]: value}),
      });
      _profile[field] = value;
      if (field === 'name') {
        // Update dropdown label and page title to reflect new name
        const sel = document.querySelector('.client-select');
        if (sel) { const opt = sel.querySelector(`option[value="${CLIENT_ID}"]`); if (opt) opt.textContent = value; }
        document.title = value + ' — Brand Profile · MOKSHATOOLS';
      }
      document.getElementById('injection-preview').textContent = buildInjectionPreview(_profile);
      const flash = document.getElementById('saved-flash');
      flash.classList.add('show');
      setTimeout(() => flash.classList.remove('show'), 1500);
    } catch(e) {
      console.error('Save failed:', e);
    }
  }

  // ── Refresh ────────────────────────────────────────────────────────────
  async function startRefresh(mode) {
    const titles = { quick: 'Pulling Latest Stats', full: 'Full Brand Refresh' };
    document.getElementById('loading-title').textContent = titles[mode] || 'Refreshing';
    document.getElementById('loading-msg').textContent = 'Starting…';
    document.getElementById('loading-overlay').classList.add('visible');

    try {
      const res = await fetch(`/api/${CLIENT_ID}/refresh`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({mode}),
      });
      const {job_id} = await res.json();
      pollJob(job_id);
    } catch(e) {
      document.getElementById('loading-overlay').classList.remove('visible');
      alert('Refresh failed: ' + e);
    }
  }

  function pollJob(job_id) {
    _pollInterval = setInterval(async () => {
      const res = await fetch(`/api/job/${job_id}`);
      const job = await res.json();
      document.getElementById('loading-msg').textContent = job.progress || '';

      if (job.status === 'done') {
        clearInterval(_pollInterval);
        document.getElementById('loading-overlay').classList.remove('visible');
        window.location.reload();
      } else if (job.status === 'error') {
        clearInterval(_pollInterval);
        document.getElementById('loading-overlay').classList.remove('visible');
        alert('Refresh error: ' + job.error);
      }
    }, 1500);
  }

  // ── Assets ────────────────────────────────────────────────────────────────
  async function loadAssets() {
    const res = await fetch(`/api/${CLIENT_ID}/assets`);
    const assets = await res.json();
    renderAssets(assets);
  }

  const _currentLogoFile = {{ (profile.get('logo_file') or '')|tojson }};

  function renderAssets(assets) {
    const grid = document.getElementById('asset-grid');
    grid.innerHTML = '';
    for (const a of assets) {
      const item = document.createElement('div');
      item.className = 'asset-item';
      const thumb = document.createElement('div');
      thumb.className = 'asset-thumb';
      if (a.is_image) {
        const img = document.createElement('img');
        img.src = a.url + '?t=' + Date.now();
        img.alt = a.name;
        thumb.appendChild(img);
      } else {
        const icon = document.createElement('div');
        icon.className = 'asset-icon';
        icon.textContent = a.name.endsWith('.pdf') ? '📄' : a.name.match(/\.(ttf|otf|woff)/) ? '🔤' : '📦';
        thumb.appendChild(icon);
      }
      const del = document.createElement('button');
      del.className = 'asset-delete';
      del.textContent = '×';
      del.onclick = () => deleteAsset(a.name);
      // "Set as Logo" for images
      if (a.is_image) {
        if (a.name === _currentLogoFile) {
          const badge = document.createElement('div');
          badge.className = 'asset-is-logo';
          badge.textContent = '★ Logo';
          item.appendChild(badge);
        } else {
          const setLogo = document.createElement('button');
          setLogo.className = 'asset-set-logo';
          setLogo.textContent = 'Set as Logo';
          setLogo.onclick = () => setAsLogo(a.name, a.url);
          item.appendChild(setLogo);
        }
      }
      const name = document.createElement('div');
      name.className = 'asset-name';
      name.textContent = a.name;
      item.appendChild(thumb);
      item.appendChild(del);
      item.appendChild(name);
      grid.appendChild(item);
    }
  }

  async function setAsLogo(name, url) {
    await fetch(`/api/${CLIENT_ID}/set-logo`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({name}),
    });
    // Refresh logo box using stable URL
    const img = document.getElementById('logo-img');
    const ph  = document.getElementById('logo-placeholder');
    if (img) { img.src = `/api/${CLIENT_ID}/logo?t=` + Date.now(); img.style.display = ''; }
    if (ph)  { ph.style.display = 'none'; }
    window.location.reload();
  }

  async function uploadAssets(input) {
    for (const file of input.files) {
      const fd = new FormData();
      fd.append('file', file);
      await fetch(`/api/${CLIENT_ID}/upload-asset`, {method: 'POST', body: fd});
    }
    loadAssets();
    input.value = '';
  }

  async function uploadLogo(input) {
    const file = input.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    await fetch(`/api/${CLIENT_ID}/upload-asset`, {method: 'POST', body: fd});
    // Refresh the logo display using stable URL
    const img = document.getElementById('logo-img');
    if (img) { img.src = `/api/${CLIENT_ID}/logo?t=` + Date.now(); img.style.display = ''; }
    loadAssets();
  }

  async function deleteAsset(name) {
    if (!confirm(`Delete ${name}?`)) return;
    await fetch(`/api/${CLIENT_ID}/delete-asset`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({name}),
    });
    loadAssets();
  }

  // Drag-drop on the drop zone
  const dropZone = document.getElementById('asset-drop-zone');
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', async e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    for (const file of e.dataTransfer.files) {
      const fd = new FormData();
      fd.append('file', file);
      await fetch(`/api/${CLIENT_ID}/upload-asset`, {method: 'POST', body: fd});
    }
    loadAssets();
  });

  loadAssets();

  // ── New Brand Modal ────────────────────────────────────────────────────────
  let _discoverPoll = null;

  function openNewBrandModal() {
    document.getElementById('new-brand-modal').classList.add('visible');
    document.getElementById('nb-query').focus();
    document.querySelector('.client-select').value = CLIENT_ID;
    // Reset state
    document.getElementById('nb-found').style.display = 'none';
    document.getElementById('nb-chips').innerHTML = '';
    document.getElementById('nb-found-msg').textContent = '';
    document.getElementById('nb-error').textContent = '';
    document.getElementById('nb-query').value = '';
    document.getElementById('nb-name').value = '';
    document.getElementById('nb-website').value = '';
    document.getElementById('nb-youtube').value = '';
    document.getElementById('nb-instagram').value = '';
    document.getElementById('nb-tiktok').value = '';
    document.getElementById('nb-discover-btn').disabled = false;
    document.getElementById('nb-discover-btn').textContent = 'Discover \u2192';
  }
  function closeNewBrandModal() {
    document.getElementById('new-brand-modal').classList.remove('visible');
    if (_discoverPoll) { clearInterval(_discoverPoll); _discoverPoll = null; }
  }
  document.getElementById('new-brand-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('new-brand-modal')) closeNewBrandModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeNewBrandModal();
  });

  async function discoverBrand() {
    const query = document.getElementById('nb-query').value.trim();
    if (!query) return;
    document.getElementById('nb-error').textContent = '';
    document.getElementById('nb-discover-btn').disabled = true;
    document.getElementById('nb-discover-btn').textContent = 'Searching…';
    document.getElementById('nb-found').style.display = 'none';

    try {
      const res = await fetch('/api/discover', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({query}),
      });
      const {job_id, error} = await res.json();
      if (error) { document.getElementById('nb-error').textContent = error; _resetDiscoverBtn(); return; }

      _discoverPoll = setInterval(async () => {
        const r2 = await fetch('/api/job/' + job_id);
        const job = await r2.json();
        if (job.status === 'done') {
          clearInterval(_discoverPoll); _discoverPoll = null;
          _applyDiscoveredData(query, job.result || {});
          _resetDiscoverBtn();
        } else if (job.status === 'error') {
          clearInterval(_discoverPoll); _discoverPoll = null;
          document.getElementById('nb-error').textContent = 'Discovery failed: ' + (job.error || 'unknown error');
          _resetDiscoverBtn();
        }
      }, 1500);
    } catch(e) {
      document.getElementById('nb-error').textContent = 'Request failed: ' + e;
      _resetDiscoverBtn();
    }
  }

  function _resetDiscoverBtn() {
    document.getElementById('nb-discover-btn').disabled = false;
    document.getElementById('nb-discover-btn').textContent = 'Discover \u2192';
  }

  function _applyDiscoveredData(query, found) {
    // Pre-fill form fields with discovered data
    if (found.website_url && !document.getElementById('nb-website').value)
      document.getElementById('nb-website').value = found.website_url;
    if (found.youtube_url && !document.getElementById('nb-youtube').value)
      document.getElementById('nb-youtube').value = found.youtube_url;
    if (found.instagram_handle && !document.getElementById('nb-instagram').value)
      document.getElementById('nb-instagram').value = found.instagram_handle;
    if (found.tiktok_handle && !document.getElementById('nb-tiktok').value)
      document.getElementById('nb-tiktok').value = found.tiktok_handle;
    // Use page title as name hint if name is blank
    if (!document.getElementById('nb-name').value) {
      const hint = found._page_title || query;
      document.getElementById('nb-name').value = hint;
    }

    // Show chips for what was found
    const chips = document.getElementById('nb-chips');
    chips.innerHTML = '';
    const labels = {
      website_url: '🌐 Website',
      youtube_url: '\u25b6 YouTube',
      instagram_handle: '\u25c8 Instagram',
      tiktok_handle: '\u25e0 TikTok',
      twitter_handle: '\u2613 Twitter',
      facebook_url: 'f Facebook',
    };
    let count = 0;
    for (const [k, label] of Object.entries(labels)) {
      if (found[k]) {
        const chip = document.createElement('span');
        chip.className = 'discover-chip';
        chip.textContent = label;
        chips.appendChild(chip);
        count++;
      }
    }
    const msgEl = document.getElementById('nb-found-msg');
    msgEl.textContent = count > 0
      ? 'Found ' + count + ' channel' + (count > 1 ? 's' : '') + '. Fields pre-filled below — adjust if needed.'
      : 'Nothing found automatically. Fill in the details below.';
    document.getElementById('nb-found').style.display = '';
    document.getElementById('nb-name').focus();
  }

  async function createNewBrand() {
    const name = document.getElementById('nb-name').value.trim();
    if (!name) { document.getElementById('nb-error').textContent = 'Brand name is required.'; return; }
    document.getElementById('nb-error').textContent = '';
    try {
      const res = await fetch('/api/new-client', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          name,
          website_url:      document.getElementById('nb-website').value.trim(),
          youtube_url:      document.getElementById('nb-youtube').value.trim(),
          instagram_handle: document.getElementById('nb-instagram').value.trim(),
          tiktok_handle:    document.getElementById('nb-tiktok').value.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) { document.getElementById('nb-error').textContent = data.error || 'Error creating profile.'; return; }
      window.location = '/' + data.client_id;
    } catch(e) {
      document.getElementById('nb-error').textContent = 'Request failed: ' + e;
    }
  }

  // ── Delete Brand ──────────────────────────────────────────────────────────
  async function deleteBrand() {
    const name = {{ (profile.get('name') or client_id)|tojson }};
    if (!confirm(`Delete "${name}"?\n\nThis will permanently remove the profile and all uploaded assets. This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/${CLIENT_ID}/delete`, {method: 'POST'});
      const data = await res.json();
      if (!res.ok) { alert('Delete failed: ' + (data.error || 'unknown error')); return; }
      if (data.next_client) {
        window.location = '/' + data.next_client;
      } else {
        window.location = '/';
      }
    } catch(e) {
      alert('Delete failed: ' + e);
    }
  }
</script>
</body>
</html>"""


# ── Main ────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    os.makedirs(PROFILES_DIR, exist_ok=True)
    os.makedirs(ASSETS_DIR, exist_ok=True)
    os.makedirs("logs", exist_ok=True)
    logger.info(f"Brand Profile server starting on port {PORT}")
    app.run(host="0.0.0.0", port=PORT, debug=False)
