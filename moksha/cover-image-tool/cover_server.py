#!/usr/bin/env python3
"""
Cover Image Tool — covers.mokshatools.com (port 4300)
Background image + style reference + thumbnail copy → Nano Banana → styled cover PNG.
"""

import base64
import json
import logging
import os
import shutil
import tempfile
import threading
import time
import uuid
from pathlib import Path

from flask import Flask, jsonify, render_template_string, request, send_file
from dotenv import load_dotenv
load_dotenv()

import frame_extractor as fe

# ── Config ─────────────────────────────────────────────────────────────────────

PORT           = int(os.getenv("PORT", "4300"))
NB_URL         = os.getenv("NB_URL", "http://localhost:5150")
PROFILES_DIR   = Path(__file__).parent / "brand_profiles"
STYLE_REFS_DIR = Path(__file__).parent / "style_refs"
VIDEOS_DIR     = Path(__file__).parent / "temp_videos"

# ── Logging ────────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(Path(__file__).parent / "logs" / "covers.log"),
    ],
)
logger = logging.getLogger(__name__)

# ── Flask ──────────────────────────────────────────────────────────────────────

app = Flask(__name__)

@app.after_request
def no_cache(r):
    r.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    return r

# ── Job State ──────────────────────────────────────────────────────────────────

_jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()

# ── Recents ────────────────────────────────────────────────────────────────────

RECENTS_FILE = Path(__file__).parent / "recents.json"
MAX_RECENTS  = 8
_recents_lock = threading.Lock()

def _load_recents() -> list:
    try:
        return json.loads(RECENTS_FILE.read_text())
    except Exception:
        return []

def _save_recents(items: list):
    try:
        RECENTS_FILE.write_text(json.dumps(items))
    except Exception:
        pass

def _add_recent(result: dict):
    entry = {
        "token":          result["token"],
        "thumbnail_copy": result.get("thumbnail_copy", ""),
        "aspect":         result.get("aspect", "1:1"),
        "image_b64":      result["image_b64"],
    }
    with _recents_lock:
        items = _load_recents()
        items.insert(0, entry)
        items = items[:MAX_RECENTS]
        _save_recents(items)

def _get_recents():
    with _recents_lock:
        return _load_recents()

def _new_job() -> str:
    job_id = str(uuid.uuid4())[:8]
    with _jobs_lock:
        _jobs[job_id] = {"status": "pending", "progress": "", "result": None, "error": None}
    return job_id

def _update_job(job_id, **kwargs):
    with _jobs_lock:
        if job_id in _jobs:
            _jobs[job_id].update(kwargs)

def _get_job(job_id):
    with _jobs_lock:
        return dict(_jobs.get(job_id, {}))

# ── Brand Profiles ─────────────────────────────────────────────────────────────

def _load_profiles():
    profiles = []
    if not PROFILES_DIR.is_dir():
        return []
    for f in sorted(PROFILES_DIR.glob("*.json")):
        try:
            profiles.append(json.loads(f.read_text()))
        except Exception:
            pass
    return profiles

def _get_profile(profile_id: str):
    for p in _load_profiles():
        if p.get("id") == profile_id:
            return p
    return None

def _style_ref_path(profile: dict, style_id: str):
    styles_dir = STYLE_REFS_DIR / profile.get("style_refs_dir", "").split("/")[-1]
    for s in profile.get("styles", []):
        if s["id"] == style_id:
            if not s.get("image"):      # stock card has no image
                return None
            p = styles_dir / s["image"]
            return p if p.exists() else None
    return None

def _style_ref_b64(profile: dict, style_id: str):
    """Returns (base64_data, mime_type) or None if image not found."""
    path = _style_ref_path(profile, style_id)
    if not path:
        return None
    data = path.read_bytes()
    return base64.b64encode(data).decode(), "image/jpeg"

# ── Nano Banana API Call ───────────────────────────────────────────────────────

def _call_nb(prompt: str, ref_images: list[dict], aspect_ratio: str = "1:1") -> str:
    """
    Call Nano Banana's /generate endpoint.
    ref_images: [{"data": b64, "mimeType": "image/jpeg"}, ...]
    Returns base64 PNG string.
    """
    import requests as req
    payload = {
        "prompt":         prompt,
        "model":          "nb2",
        "aspectRatio":    aspect_ratio,
        "resolution":     "0.5K",
        "numImages":      1,
        "outputFormat":   "png",
        "useWebSearch":   False,
        "referenceImages": ref_images,
    }
    try:
        resp = req.post(f"{NB_URL}/generate", json=payload, timeout=120)
    except req.exceptions.ConnectionError:
        raise RuntimeError(f"Cannot reach Nano Banana at {NB_URL} — is it running?")

    if resp.status_code != 200:
        body = resp.json() if resp.content else {}
        errs = body.get("errors", [])
        raise RuntimeError(errs[0] if errs else f"NB HTTP {resp.status_code}")

    images = resp.json().get("images", [])
    if not images:
        errs = resp.json().get("errors", [])
        raise RuntimeError(errs[0] if errs else "Nano Banana returned no images")

    return images[0]["data"]


# ── Background Generation ──────────────────────────────────────────────────────

def _run_generation(job_id: str, body: dict):
    try:
        profile_id  = body.get("profile_id", "dre-alexandra")
        style_id    = body.get("style_id", "")
        thumb_copy  = body.get("thumbnail_copy", "").strip()
        bg_mode     = body.get("bg_mode", "upload")   # upload | auto_stock
        bg_b64      = body.get("bg_b64", "")
        bg_frames   = body.get("bg_frames", [])       # list of b64 strings (1 or 2 frames)
        bg_mime     = body.get("bg_mime", "image/jpeg")
        aspect      = body.get("aspect_ratio", "1:1")
        topic       = body.get("topic", "")

        # Single frame from youtube picker → treat as bg_b64
        if not bg_b64 and len(bg_frames) == 1:
            bg_b64 = bg_frames[0]

        profile = _get_profile(profile_id)
        if not profile:
            _update_job(job_id, status="error", error=f"Profile '{profile_id}' not found")
            return

        if not thumb_copy:
            _update_job(job_id, status="error", error="Thumbnail copy is required")
            return

        # ── Load style reference ──────────────────────────────────────────────
        # Stock card = no style ref, always auto-generate
        is_stock_card = (style_id == "stock_image")
        if is_stock_card:
            style_ref  = None
            bg_mode    = "auto_stock"
        else:
            style_ref = None
            if style_id:
                style_ref = _style_ref_b64(profile, style_id)
                if not style_ref:
                    logger.warning(f"Job {job_id}: style ref '{style_id}' not found, skipping")

        # ── Generate ──────────────────────────────────────────────────────────

        # Best path: 2 frames (host + guest) + style ref → composite thumbnail
        if len(bg_frames) == 2 and style_ref:
            _update_job(job_id, status="running", progress="Compositing host + guest into style…")
            composite_prompt = profile.get("composite_prompt",
                "IMAGE 1 is the style reference. IMAGE 2 is the host. IMAGE 3 is the guest. "
                "Create a new thumbnail in the style of image 1 with host left, guest right. "
                "Text: \"{thumbnail_copy}\"."
            ).format(thumbnail_copy=thumb_copy)
            ref_images = [
                {"data": style_ref[0],    "mimeType": style_ref[1]},
                {"data": bg_frames[0],    "mimeType": "image/jpeg"},
                {"data": bg_frames[1],    "mimeType": "image/jpeg"},
            ]
            result_b64 = _call_nb(composite_prompt, ref_images, aspect)

        elif bg_mode == "auto_stock" and style_ref and topic:
            # Style + topic → generate stock bg from topic, then overlay text in reference style
            _update_job(job_id, status="running", progress="Generating background image…")
            stock_prompt = profile.get("stock_bg_prompt", "Medical stock background: {topic}").format(topic=topic)
            bg_b64 = _call_nb(stock_prompt, [], aspect)
            bg_mime = "image/png"
            logger.info(f"Job {job_id}: stock background generated")
            _update_job(job_id, progress="Applying style + text overlay…")
            overlay_prompt = profile.get("overlay_prompt", "Add text: \"{thumbnail_copy}\"").format(
                thumbnail_copy=thumb_copy
            )
            ref_images = [
                {"data": style_ref[0], "mimeType": style_ref[1]},
                {"data": bg_b64,       "mimeType": bg_mime},
            ]
            result_b64 = _call_nb(overlay_prompt, ref_images, aspect)

        elif bg_mode == "auto_stock" and style_ref:
            # Style + no topic → recreate entire image in reference style (podcast thumbnail mode)
            _update_job(job_id, status="running", progress="Generating in style of reference…")
            restyle_prompt = profile.get("restyle_prompt",
                "Create a new image in the exact same visual style as the reference. New text: \"{thumbnail_copy}\"."
            ).format(thumbnail_copy=thumb_copy)
            ref_images = [{"data": style_ref[0], "mimeType": style_ref[1]}]
            result_b64 = _call_nb(restyle_prompt, ref_images, aspect)

        elif bg_mode == "auto_stock":
            # No style ref — generate stock bg then overlay text
            _update_job(job_id, status="running", progress="Generating background image…")
            stock_prompt = profile.get("stock_bg_prompt", "Medical stock background: {topic}").format(topic=topic)
            bg_b64 = _call_nb(stock_prompt, [], aspect)
            bg_mime = "image/png"
            logger.info(f"Job {job_id}: stock background generated")
            _update_job(job_id, progress="Applying text overlay…")
            overlay_prompt = (
                f"Use this image as the background. Add bold white sans-serif text that reads: "
                f'"{thumb_copy}". Large, centered, clearly readable.'
            )
            result_b64 = _call_nb(overlay_prompt, [{"data": bg_b64, "mimeType": bg_mime}], aspect)

        else:
            # Upload / YouTube frame — bg image provided
            if not bg_b64:
                _update_job(job_id, status="error", error="No background image provided")
                return
            _update_job(job_id, status="running", progress="Applying style + text overlay…")
            ref_images = []
            if style_ref:
                ref_images.append({"data": style_ref[0], "mimeType": style_ref[1]})
            ref_images.append({"data": bg_b64, "mimeType": bg_mime})

            if style_ref:
                overlay_prompt = profile.get("overlay_prompt", "Add text: \"{thumbnail_copy}\"").format(
                    thumbnail_copy=thumb_copy
                )
            else:
                overlay_prompt = (
                    f"Use this image as the background. Add bold white sans-serif text overlay that reads: "
                    f'"{thumb_copy}". Make it large, centered, clearly readable, professional.'
                )
            result_b64 = _call_nb(overlay_prompt, ref_images, aspect)

        logger.info(f"Job {job_id}: cover generated for '{thumb_copy[:40]}'")

        result_obj = {
            "image_b64": result_b64,
            "thumbnail_copy": thumb_copy,
            "aspect": aspect,
            "token": job_id,
        }
        _update_job(job_id, status="done", result=result_obj)
        _add_recent(result_obj)

    except Exception as e:
        logger.exception(f"Job {job_id} failed")
        _update_job(job_id, status="error", error=str(e))


# ── Routes ─────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    profiles = _load_profiles()
    # Build style cards data for each profile (with image URLs)
    for p in profiles:
        for s in p.get("styles", []):
            if not s.get("image"):
                s["has_image"] = False
            else:
                path = _style_ref_path(p, s["id"])
                s["has_image"] = path is not None and path.exists()
    return render_template_string(DASHBOARD_HTML, profiles=profiles)


@app.route("/api/profiles")
def api_profiles():
    return jsonify(_load_profiles())


@app.route("/api/style-ref/<profile_id>/<style_id>")
def api_style_ref_image(profile_id, style_id):
    """Serve a style reference image."""
    profile = _get_profile(profile_id)
    if not profile:
        return "", 404
    path = _style_ref_path(profile, style_id)
    if not path:
        return "", 404
    return send_file(path, mimetype="image/jpeg")


@app.route("/api/upload-style-ref", methods=["POST"])
def api_upload_style_ref():
    """Upload a new style reference image for a profile/style."""
    profile_id = request.form.get("profile_id")
    style_id   = request.form.get("style_id")
    file       = request.files.get("image")

    if not all([profile_id, style_id, file]):
        return jsonify({"error": "profile_id, style_id, and image required"}), 400

    profile = _get_profile(profile_id)
    if not profile:
        return jsonify({"error": "Profile not found"}), 404

    # Find the style entry
    style_entry = next((s for s in profile.get("styles", []) if s["id"] == style_id), None)
    if not style_entry:
        return jsonify({"error": "Style not found"}), 404

    # Save to style_refs dir
    refs_dir = STYLE_REFS_DIR / profile.get("style_refs_dir", "").split("/")[-1]
    refs_dir.mkdir(parents=True, exist_ok=True)
    dest = refs_dir / style_entry["image"]
    file.save(str(dest))
    logger.info(f"Style ref uploaded: {profile_id}/{style_id} → {dest}")
    return jsonify({"ok": True})


@app.route("/api/extract-frames", methods=["POST"])
def api_extract_frames():
    body   = request.get_json(force=True)
    source = body.get("source", "").strip()  # YouTube URL or local path
    mode   = body.get("mode", "pick")        # "quick" or "pick"

    if not source:
        return jsonify({"error": "source required"}), 400

    try:
        if mode == "quick" and source.startswith("http"):
            jpeg = fe.get_youtube_thumbnail(source)
            b64  = base64.b64encode(jpeg).decode()
            return jsonify({"frames": [{"timestamp": "auto", "frame_b64": b64}]})
        else:
            frames = fe.extract_frames_from_source(source, count=12)
            return jsonify({"frames": frames})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/generate", methods=["POST"])
def api_generate():
    body = request.get_json(force=True)
    job_id = _new_job()
    t = threading.Thread(target=_run_generation, args=(job_id, body), daemon=True)
    t.start()
    return jsonify({"job_id": job_id})


@app.route("/api/job/<job_id>")
def api_job(job_id):
    job = _get_job(job_id)
    if not job:
        return jsonify({"error": "Not found"}), 404
    return jsonify({
        "status":   job.get("status"),
        "progress": job.get("progress"),
        "error":    job.get("error"),
        "result":   job.get("result"),
    })


@app.route("/api/recents")
def api_recents():
    return jsonify(_get_recents())


# ── Video Preview ───────────────────────────────────────────────────────────────
# Downloads a low-quality video for in-browser scrubbing.
# Files stored in temp_videos/, auto-cleaned after 30 min.

_video_store: dict[str, dict] = {}   # token → {path, created_at}
_video_lock = threading.Lock()

def _cleanup_old_videos():
    cutoff = time.time() - 1800   # 30 min
    with _video_lock:
        expired = [t for t, v in _video_store.items() if v["created_at"] < cutoff]
        for t in expired:
            try:
                os.remove(_video_store[t]["path"])
            except Exception:
                pass
            del _video_store[t]

@app.route("/api/prepare-video", methods=["POST"])
def api_prepare_video():
    """Download a YouTube video (lowest quality) and return a token to stream it."""
    body   = request.get_json(force=True)
    source = body.get("source", "").strip()
    if not source:
        return jsonify({"error": "source required"}), 400

    _cleanup_old_videos()
    VIDEOS_DIR.mkdir(exist_ok=True)
    token   = str(uuid.uuid4())[:8]
    outpath = str(VIDEOS_DIR / f"{token}.mp4")

    try:
        fe._download_yt_to_file(source, str(VIDEOS_DIR))
        # _download_yt_to_file drops file in tmpdir; redo with explicit path
        _dl_video(source, outpath)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    with _video_lock:
        _video_store[token] = {"path": outpath, "created_at": time.time()}

    return jsonify({"token": token})

def _dl_video(url: str, output_path: str):
    """Download lowest-quality video to an explicit path."""
    import subprocess
    YTDLP = fe.YTDLP
    cmd = [
        YTDLP, "--no-playlist", "--no-warnings",
        "-f", "worstvideo[ext=mp4]/worstvideo/worst",
        "-o", output_path,
        url,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if result.returncode != 0 or not os.path.exists(output_path):
        real_err = "\n".join(
            l for l in result.stderr.splitlines()
            if "WARNING" not in l and "NotOpenSSLWarning" not in l and l.strip()
        )
        raise RuntimeError(real_err[:300] or "yt-dlp download failed")

@app.route("/api/video/<token>")
def api_video(token):
    """Stream a prepared video file for in-browser playback."""
    with _video_lock:
        entry = _video_store.get(token)
    if not entry or not os.path.exists(entry["path"]):
        return "Not found", 404
    return send_file(entry["path"], mimetype="video/mp4", conditional=True)


@app.route("/api/download/<token>")
def api_download(token):
    job = _get_job(token)
    if not job or not job.get("result"):
        return "Not found", 404
    result = job["result"]
    img_bytes = base64.b64decode(result["image_b64"])
    from io import BytesIO
    buf = BytesIO(img_bytes)
    buf.seek(0)
    thumb = result.get("thumbnail_copy", "cover")[:30].replace(" ", "_")
    filename = f"cover_{thumb}.png"
    return send_file(buf, mimetype="image/png",
                     as_attachment=True, download_name=filename)


# ── HTML Template ──────────────────────────────────────────────────────────────

DASHBOARD_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cover Studio — MOKSHATOOLS</title>
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
    .container { position: relative; z-index: 1; max-width: 860px; margin: 0 auto; padding: 0 2rem; }
    .divider { display: flex; align-items: center; gap: 0.75rem; justify-content: center; margin: 1.25rem 0; color: var(--gold-3); }
    .divider::before, .divider::after { content: ''; display: block; width: 50px; height: 1px; background: var(--gold-3); opacity: 0.5; }
    .divider-dot { width: 4px; height: 4px; border-radius: 50%; background: var(--gold-3); }
    .header { padding: 3.5rem 0 1.5rem; text-align: center; }
    .header-eyebrow { font-size: 0.63rem; font-weight: 500; letter-spacing: 0.3em; text-transform: uppercase; color: var(--gold-3); margin-bottom: 1rem; }
    .header-title { font-family: 'Cormorant Garamond', serif; font-size: clamp(2.2rem, 5vw, 3.5rem); font-weight: 300; letter-spacing: 0.1em; color: var(--text-1); margin-bottom: 0.4rem; }
    .header-sub { font-family: 'Cormorant Garamond', serif; font-style: italic; color: var(--text-3); font-size: 1rem; }
    .input-panel { border: 1px solid var(--border); background: var(--cream-2); padding: 1.75rem 2rem; margin-bottom: 1.5rem; }
    .input-group { display: flex; flex-direction: column; gap: 0.35rem; margin-bottom: 1.25rem; }
    .input-label { font-size: 0.6rem; font-weight: 500; letter-spacing: 0.22em; text-transform: uppercase; color: var(--text-4); }
    textarea, input[type=text], select {
      padding: 0.75rem 0.9rem; border: 1px solid var(--border); background: var(--cream);
      color: var(--text-1); font-family: 'Inter', sans-serif; font-size: 0.82rem;
      font-weight: 300; outline: none; width: 100%;
    }
    textarea { min-height: 80px; resize: vertical; }
    textarea:focus, input[type=text]:focus, select:focus { border-color: var(--gold-3); }
    textarea::placeholder, input::placeholder { color: var(--text-4); }
    .btn {
      display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.75rem 1.4rem;
      border: 1px solid var(--border); background: transparent; color: var(--text-3);
      font-family: 'Inter', sans-serif; font-size: 0.68rem; font-weight: 500;
      letter-spacing: 0.18em; text-transform: uppercase; cursor: pointer; transition: all 0.2s; white-space: nowrap;
    }
    .btn:hover { background: var(--cream-3); border-color: var(--gold-3); color: var(--gold-2); }
    .btn:disabled { opacity: 0.35; cursor: not-allowed; }
    .btn-primary { background: var(--cream-3); border-color: var(--gold-3); color: var(--gold-1); }
    .btn-primary:hover { background: var(--gold-5); }
    .btn-sm { padding: 0.4rem 0.85rem; font-size: 0.6rem; }
    .btn-ghost { border-color: transparent; color: var(--text-4); font-size: 0.6rem; padding: 0.3rem 0.6rem; }
    .btn-ghost:hover { border-color: var(--border); background: var(--cream-2); color: var(--gold-2); }

    /* Style Picker */
    .style-grid { display: grid; grid-template-columns: 20fr 9fr 12fr; gap: 0.75rem; margin-top: 0.5rem; align-items: start; }
    .style-card {
      border: 1px solid var(--border); background: var(--cream); cursor: pointer;
      transition: all 0.18s; position: relative; overflow: hidden;
    }
    .style-card:hover { border-color: var(--gold-3); }
    .style-card.selected { border-color: var(--gold-2); box-shadow: 0 0 0 1px var(--gold-3); }
    .style-card-img {
      width: 100%; object-fit: cover; display: block; background: var(--cream-3);
    }
    .style-card-placeholder {
      width: 100%; display: flex; align-items: center;
      justify-content: center; background: var(--cream-3); position: relative;
    }
    .style-card-placeholder-text { font-size: 0.55rem; color: var(--text-4); letter-spacing: 0.1em; text-align: center; padding: 0.5rem; }
    .style-card-label { font-size: 0.6rem; font-weight: 500; letter-spacing: 0.12em; text-transform: uppercase; color: var(--text-3); padding: 0.4rem 0.5rem; text-align: center; }
    .style-card.selected .style-card-label { color: var(--gold-1); }
    .style-upload-btn {
      position: absolute; bottom: 24px; right: 4px;
      font-size: 0.5rem; padding: 0.2rem 0.4rem; opacity: 0;
      border: 1px solid var(--border); background: rgba(250,249,247,0.9);
      color: var(--text-4); cursor: pointer; transition: opacity 0.15s;
      font-family: 'Inter', sans-serif; letter-spacing: 0.1em; text-transform: uppercase;
    }
    .style-card:hover .style-upload-btn { opacity: 1; }
    .style-upload-btn:hover { background: var(--cream-2); color: var(--gold-2); border-color: var(--gold-3); }

    /* Background mode tabs */
    .tab-row { display: flex; gap: 0; border: 1px solid var(--border); margin-bottom: 1rem; width: fit-content; }
    .tab-btn { padding: 0.5rem 1rem; font-size: 0.62rem; font-weight: 500; letter-spacing: 0.15em; text-transform: uppercase; font-family: 'Inter', sans-serif; background: var(--cream); border: none; border-right: 1px solid var(--border); color: var(--text-4); cursor: pointer; transition: all 0.15s; }
    .tab-btn:last-child { border-right: none; }
    .tab-btn.active { background: var(--cream-3); color: var(--gold-1); }
    .tab-btn:hover:not(.active) { background: var(--cream-2); color: var(--text-2); }
    .tab-panel { display: none; }
    .tab-panel.active { display: block; }

    /* Drop zone */
    .drop-zone {
      border: 1px dashed rgba(176,137,40,0.35); padding: 1.5rem; text-align: center;
      cursor: pointer; transition: all 0.2s; background: var(--cream);
    }
    .drop-zone:hover, .drop-zone.drag-over { border-color: var(--gold-3); background: var(--cream-2); }
    .drop-zone-text { font-size: 0.72rem; color: var(--text-4); }
    .drop-zone-sub { font-size: 0.6rem; color: var(--text-4); margin-top: 0.25rem; letter-spacing: 0.08em; }
    .bg-preview { margin-top: 0.75rem; display: none; }
    .bg-preview img { max-height: 140px; max-width: 100%; border: 1px solid var(--border); }

    /* Frame grid */
    .frame-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.5rem; margin-top: 0.75rem; display: none; }
    .frame-thumb { cursor: pointer; border: 2px solid transparent; transition: border-color 0.15s; position: relative; }
    .frame-thumb img { width: 100%; display: block; }
    .frame-thumb.frame-host  { border-color: var(--gold-2); }
    .frame-thumb.frame-guest { border-color: #6aa3d5; }
    .frame-thumb .frame-ts { position: absolute; bottom: 2px; right: 4px; font-size: 0.5rem; color: #fff; background: rgba(0,0,0,0.5); padding: 1px 4px; font-family: monospace; }
    .frame-role { position: absolute; top: 3px; left: 3px; font-size: 0.48rem; font-weight: 500; letter-spacing: 0.1em; text-transform: uppercase; padding: 2px 5px; font-family: 'Inter', sans-serif; }
    .frame-host  .frame-role { background: rgba(122,92,26,0.88); color: #fff; }
    .frame-guest .frame-role { background: rgba(60,100,160,0.88); color: #fff; }
    .frame-hint { font-size: 0.58rem; color: var(--text-4); margin-top: 0.4rem; letter-spacing: 0.05em; }
    .captured-thumb { position: relative; display: inline-block; }
    .captured-thumb img { height: 72px; width: auto; display: block; border: 2px solid transparent; }
    .captured-thumb.host  img { border-color: var(--gold-2); }
    .captured-thumb.guest img { border-color: #6aa3d5; }
    .captured-thumb-label { position: absolute; top: 2px; left: 3px; font-size: 0.45rem; font-weight: 500; letter-spacing: 0.1em; text-transform: uppercase; padding: 1px 4px; font-family: 'Inter', sans-serif; }
    .captured-thumb.host  .captured-thumb-label { background: rgba(122,92,26,0.88); color:#fff; }
    .captured-thumb.guest .captured-thumb-label { background: rgba(60,100,160,0.88); color:#fff; }
    .captured-thumb-remove { position: absolute; top: 2px; right: 2px; font-size: 0.55rem; background: rgba(0,0,0,0.6); color: #fff; border: none; cursor: pointer; padding: 1px 4px; line-height: 1; }

    /* Pills */
    .pill-row { display: flex; gap: 0.4rem; flex-wrap: wrap; }
    .pill { padding: 0.4rem 0.9rem; border: 1px solid var(--border); background: var(--cream); color: var(--text-3); font-family: 'Inter', sans-serif; font-size: 0.62rem; font-weight: 500; letter-spacing: 0.12em; text-transform: uppercase; cursor: pointer; transition: all 0.15s; }
    .pill:hover { border-color: var(--gold-3); color: var(--gold-2); }
    .pill.active { background: var(--cream-3); border-color: var(--gold-3); color: var(--gold-1); }

    /* Bottom row */
    .bottom-row { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem; margin-top: 1.25rem; }

    /* Status */
    #status-bar { min-height: 1.8rem; font-size: 0.72rem; letter-spacing: 0.08em; color: var(--text-4); text-align: center; padding: 0.4rem 0; }
    #status-bar.running { color: var(--gold-3); }
    #status-bar.error   { color: var(--red); }

    /* Result */
    #result-panel { display: none; border: 1px solid var(--border); background: var(--cream-2); padding: 1.75rem 2rem; margin-bottom: 2rem; }
    .result-header { font-size: 0.6rem; font-weight: 500; letter-spacing: 0.22em; text-transform: uppercase; color: var(--text-4); margin-bottom: 1rem; }
    #result-img { max-width: 100%; max-height: 400px; width: auto; border: 1px solid var(--border); display: block; }
    .result-actions { display: flex; gap: 0.75rem; margin-top: 1rem; align-items: center; }

    /* Loading overlay */
    #loading-overlay { display: none; position: fixed; inset: 0; z-index: 100; background: rgba(240,228,188,0.97); align-items: center; justify-content: center; flex-direction: column; gap: 1.25rem; }
    #loading-overlay.visible { display: flex; }
    .spinner { width: 52px; height: 52px; border: 2px solid var(--gold-4); border-top-color: var(--gold-1); border-radius: 50%; animation: spin 0.9s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .loading-title { font-family: 'Cormorant Garamond', serif; font-size: 1.8rem; font-weight: 300; letter-spacing: 0.12em; color: var(--text-2); }
    .loading-msg { font-size: 0.7rem; letter-spacing: 0.15em; color: var(--gold-3); text-transform: uppercase; min-height: 1.2em; }

    /* Lightbox */
    #lightbox { display: none; position: fixed; inset: 0; z-index: 200; background: rgba(28,22,8,0.88); align-items: center; justify-content: center; flex-direction: column; gap: 1rem; padding: 2rem; }
    #lightbox.visible { display: flex; }
    #lightbox-img { max-width: min(90vw, 900px); max-height: 78vh; object-fit: contain; border: 1px solid var(--border); display: block; }
    #lightbox-copy { font-family: 'Cormorant Garamond', serif; font-style: italic; color: var(--gold-4); font-size: 1rem; letter-spacing: 0.08em; text-align: center; max-width: 600px; }
    #lightbox-actions { display: flex; gap: 0.75rem; }
    #lightbox-close { position: fixed; top: 1.25rem; right: 1.5rem; font-size: 1.4rem; color: var(--gold-4); cursor: pointer; background: none; border: none; line-height: 1; opacity: 0.7; }
    #lightbox-close:hover { opacity: 1; }

    /* Recents */
    #recents-panel { margin-bottom: 2rem; display: none; }
    .recents-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem; }
    .recents-title { font-size: 0.6rem; font-weight: 500; letter-spacing: 0.22em; text-transform: uppercase; color: var(--text-4); }
    .recents-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.6rem; }
    .recent-thumb {
      cursor: grab; border: 1px solid var(--border); background: var(--cream-2);
      transition: border-color 0.15s; overflow: hidden; position: relative;
    }
    .recent-thumb:active { cursor: grabbing; }
    .recent-thumb:hover { border-color: var(--gold-3); }
    .recent-thumb img { width: 100%; display: block; aspect-ratio: 1/1; object-fit: cover; pointer-events: none; }
    .recent-thumb-label {
      position: absolute; bottom: 0; left: 0; right: 0;
      font-size: 0.5rem; color: #fff; background: rgba(0,0,0,0.55);
      padding: 2px 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      letter-spacing: 0.05em; pointer-events: none;
    }
    .recent-thumb:hover::after {
      content: '↗'; position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%);
      font-size: 1.4rem; color: #fff; text-shadow: 0 1px 4px rgba(0,0,0,0.6);
      pointer-events: none;
    }
    /* Drop zone highlight when dragging a recent over it */
    .drop-zone.recent-drag-over { border-color: var(--gold-2); background: var(--gold-5); }

    footer { text-align: center; padding: 2rem 0 3rem; border-top: 1px solid var(--border-2); margin-top: 2rem; }
    footer p { font-size: 0.63rem; letter-spacing: 0.2em; color: var(--text-4); text-transform: uppercase; }
    footer a { color: var(--gold-3); text-decoration: none; }
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

<div id="lightbox" onclick="closeLightbox(event)">
  <button id="lightbox-close" onclick="closeLightbox()">✕</button>
  <img id="lightbox-img" src="" alt="">
  <div id="lightbox-copy"></div>
  <div id="lightbox-actions">
    <button class="btn btn-primary" onclick="lightboxUseAsBg()">Use as Background</button>
    <a id="lightbox-dl" class="btn" href="#" download>↓ Download PNG</a>
  </div>
</div>

<div id="loading-overlay">
  <div class="spinner"></div>
  <div class="loading-title">Generating</div>
  <div class="loading-msg" id="loading-msg">Starting…</div>
</div>

<div class="container">

  <header class="header">
    <p class="header-eyebrow">Mokshatools &nbsp;·&nbsp; Content Ops &nbsp;·&nbsp; 2026</p>
    <div class="divider"><div class="divider-dot"></div></div>
    <h1 class="header-title">COVER STUDIO</h1>
    <p class="header-sub">thumbnail copy + background + style → Nano Banana → cover image</p>
    <div class="divider"><div class="divider-dot"></div></div>
  </header>

  <div class="input-panel">

    <!-- Thumbnail Copy -->
    <div class="input-group">
      <label class="input-label">Thumbnail Copy</label>
      <textarea id="thumb-copy" placeholder="Paste thumbnail copy from Social Scribe…&#10;e.g. C'est normal? · Le foie · Arthrose vs Arthrite"></textarea>
    </div>

    <!-- Style Reference Picker -->
    <div class="input-group">
      <label class="input-label">Style Reference</label>
      <div class="style-grid" id="style-grid">
        {% for profile in profiles %}{% if loop.first %}
        {% for style in profile.styles %}
        <div class="style-card {% if loop.first %}selected{% endif %}"
             data-profile="{{ profile.id }}"
             data-style="{{ style.id }}"
             data-aspect="{{ style.aspect or '1:1' }}"
             data-style-type="{{ style.get('type', '') }}"
             onclick="selectStyle(this)">
          {% if style.has_image %}
          <img class="style-card-img"
               style="aspect-ratio: {{ (style.aspect or '1:1').replace(':', '/') }};"
               src="/api/style-ref/{{ profile.id }}/{{ style.id }}"
               alt="{{ style.label }}">
          {% else %}
          <div class="style-card-placeholder"
               style="aspect-ratio: {{ (style.aspect or '1:1').replace(':', '/') }};">
            {% if style.get('type') == 'stock' %}
            <div class="style-card-placeholder-text">Auto-generate<br>stock background</div>
            {% else %}
            <div class="style-card-placeholder-text">Drop a reference<br>image here</div>
            {% endif %}
          </div>
          {% endif %}
          <div class="style-card-label">{{ style.label }}</div>
          <button class="style-upload-btn"
                  onclick="event.stopPropagation(); uploadStyleRef('{{ profile.id }}','{{ style.id }}',this)">
            ↑ Set image
          </button>
        </div>
        {% endfor %}
        {% endif %}{% endfor %}
      </div>
    </div>

    <!-- Background Mode Tabs -->
    <div class="input-group" style="margin-bottom:0;">
      <label class="input-label">Background Image</label>
      <div class="tab-row">
        <button class="tab-btn active" onclick="switchTab('upload')">Upload</button>
        <button class="tab-btn" onclick="switchTab('youtube')">YouTube URL</button>
        <button class="tab-btn" onclick="switchTab('auto')">Auto-generate</button>
      </div>

      <!-- Upload Tab -->
      <div class="tab-panel active" id="tab-upload">
        <div class="drop-zone" id="drop-zone"
             ondragover="event.preventDefault(); this.classList.add('drag-over')"
             ondragleave="this.classList.remove('drag-over')"
             ondrop="onDrop(event)"
             onclick="document.getElementById('file-input').click()">
          <div class="drop-zone-text">Drop image or click to browse</div>
          <div class="drop-zone-sub">Screenshot of Dre · Stock image · Any JPG/PNG</div>
        </div>
        <input type="file" id="file-input" accept="image/*" style="display:none" onchange="onFileSelect(this)">
        <div class="bg-preview" id="bg-preview">
          <img id="bg-preview-img" src="" alt="background">
        </div>
      </div>

      <!-- YouTube Tab -->
      <div class="tab-panel" id="tab-youtube">
        <div style="display:flex; gap:0.5rem; margin-bottom:0.75rem;">
          <input type="text" id="yt-url" placeholder="https://www.youtube.com/watch?v=..." style="flex:1;">
          <button class="btn btn-sm" onclick="ytQuick()">Quick Thumb</button>
          <button class="btn btn-sm" onclick="ytScrub()">Scrub Video</button>
          <button class="btn btn-sm btn-ghost" onclick="ytFrames()">Grid</button>
        </div>
        <div class="bg-preview" id="yt-preview">
          <img id="yt-preview-img" src="" alt="YouTube thumbnail">
        </div>

        <!-- Video scrubber -->
        <div id="video-scrubber" style="display:none;">
          <div id="video-loading" style="font-size:0.68rem; color:var(--gold-3); letter-spacing:0.12em; padding:0.75rem 0; display:none;">
            Downloading video for preview… (~15s)
          </div>
          <video id="scrub-video" controls preload="auto"
                 style="width:100%; display:none; border:1px solid var(--border); background:#000;"></video>
          <div id="scrub-actions" style="display:none; margin-top:0.6rem; display:none;">
            <div style="font-size:0.58rem; color:var(--text-4); margin-bottom:0.5rem; letter-spacing:0.06em;">
              Pause on the frame you want, then capture it as Host or Guest.
            </div>
            <div style="display:flex; gap:0.5rem; flex-wrap:wrap; align-items:center;">
              <button class="btn btn-sm" onclick="captureFrame('host')" style="border-color:var(--gold-2); color:var(--gold-1);">&#9654; Capture Host</button>
              <button class="btn btn-sm" onclick="captureFrame('guest')" style="border-color:#6aa3d5; color:#3a6090;">&#9654; Capture Guest</button>
              <span id="capture-status" style="font-size:0.6rem; color:var(--text-4); letter-spacing:0.06em;"></span>
            </div>
            <div id="captured-frames" style="display:flex; gap:0.5rem; margin-top:0.6rem; flex-wrap:wrap;"></div>
          </div>
        </div>

        <div class="frame-grid" id="frame-grid"></div>
        <p class="frame-hint" id="frame-hint" style="display:none;">
          Click one frame for a single background — or click two frames to composite <span style="color:var(--gold-2);">HOST</span> + <span style="color:#6aa3d5;">GUEST</span> with your style reference.
        </p>
      </div>

      <!-- Auto-generate Tab -->
      <div class="tab-panel" id="tab-auto">
        <input type="text" id="topic-input"
               placeholder="Describe the content topic… e.g. arthrose et douleur chronique">
        <p style="font-size:0.62rem; color:var(--text-4); margin-top:0.5rem; letter-spacing:0.05em;">
          <strong style="color:var(--text-3);">With topic:</strong> generates a stock background from your description, then applies the text style from your selected reference over it.<br>
          <strong style="color:var(--text-3);">Without topic:</strong> recreates the entire reference image style from scratch with your new text.
        </p>
      </div>
    </div>

    <!-- Format + Generate -->
    <div class="bottom-row">
      <div>
        <div class="input-label" style="margin-bottom:0.4rem;">Format</div>
        <div class="pill-row" id="format-pills">
          <button class="pill active" data-aspect="1:1"   onclick="setFormat(this)">Square 1:1</button>
          <button class="pill"        data-aspect="4:5"   onclick="setFormat(this)">Portrait 4:5</button>
          <button class="pill"        data-aspect="16:9"  onclick="setFormat(this)">YouTube 16:9</button>
          <button class="pill"        data-aspect="9:16"  onclick="setFormat(this)">TikTok 9:16</button>
        </div>
      </div>
      <div>
        <div class="input-label" style="margin-bottom:0.4rem;">Profile</div>
        <select id="profile-select">
          {% for p in profiles %}
          <option value="{{ p.id }}">{{ p.name }}</option>
          {% endfor %}
        </select>
      </div>
    </div>

    <div style="margin-top:1.25rem;">
      <button class="btn btn-primary" id="btn-generate" onclick="generate()" style="width:100%;">
        &#9656;&nbsp;Generate Cover
      </button>
    </div>

  </div><!-- /input-panel -->

  <div id="status-bar"></div>

  <!-- Result Panel -->
  <div id="result-panel">
    <div class="result-header">Generated Cover</div>
    <img id="result-img" src="" alt="Generated cover">
    <div class="result-actions">
      <a id="download-btn" class="btn btn-primary" href="#" download>↓ Download PNG</a>
      <button class="btn" onclick="regenerate()">↺ Regenerate</button>
    </div>
  </div>

  <!-- Recents Panel -->
  <div id="recents-panel">
    <div class="recents-header">
      <span class="recents-title">Recent Generations</span>
      <button class="btn btn-ghost btn-sm" onclick="clearRecents()">Clear</button>
    </div>
    <div class="recents-grid" id="recents-grid"></div>
  </div>

  <footer>
    <div class="divider"><div class="divider-dot"></div></div>
    <p>Mokshatools &nbsp;·&nbsp; <a href="https://mokshatools.com">mokshatools.com</a> &nbsp;·&nbsp; 2026</p>
  </footer>

</div><!-- /container -->

<!-- Hidden file input for style ref uploads -->
<input type="file" id="style-ref-input" accept="image/*" style="display:none">

<script>
// ── State ────────────────────────────────────────────────────────────────────
let _jobId       = null;
let _pollTimer   = null;
let _bgB64       = null;        // single bg image (upload or quick thumb)
let _bgMime      = "image/jpeg";
let _bgFrames    = [];          // [{b64, el}] — up to 2 picked frames (host + guest)
let _bgMode      = "upload";   // upload | youtube | auto
let _styleId     = document.querySelector('.style-card.selected')?.dataset.style || '';
let _profileId   = document.querySelector('.style-card.selected')?.dataset.profile || 'dre-alexandra';
let _aspect      = "1:1";

// ── Style Picker ─────────────────────────────────────────────────────────────
function selectStyle(card) {
  document.querySelectorAll('.style-card').forEach(c => c.classList.remove('selected'));
  card.classList.add('selected');
  _styleId   = card.dataset.style;
  _profileId = card.dataset.profile;
  // Auto-set format to match style's default aspect
  const aspect = card.dataset.aspect;
  if (aspect) {
    document.querySelectorAll('.pill').forEach(p => {
      p.classList.toggle('active', p.dataset.aspect === aspect);
    });
    _aspect = aspect;
  }
  // Stock card → auto-switch to auto-generate tab
  if (card.dataset.styleType === 'stock') {
    switchTab('auto');
  }
}

function uploadStyleRef(profileId, styleId, btn) {
  const input = document.getElementById('style-ref-input');
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('profile_id', profileId);
    fd.append('style_id', styleId);
    fd.append('image', file);
    const res = await fetch('/api/upload-style-ref', {method:'POST', body:fd});
    if (res.ok) {
      // Refresh the card image
      const card = btn.closest('.style-card');
      let img = card.querySelector('img.style-card-img');
      const placeholder = card.querySelector('.style-card-placeholder');
      if (!img) {
        img = document.createElement('img');
        img.className = 'style-card-img';
        card.insertBefore(img, card.firstChild);
        if (placeholder) placeholder.remove();
      }
      img.src = `/api/style-ref/${profileId}/${styleId}?t=${Date.now()}`;
    }
    input.value = '';
  };
  input.click();
}

// ── Background Tabs ───────────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach((b,i) => {
    const names = ['upload','youtube','auto'];
    b.classList.toggle('active', names[i] === name);
  });
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  _bgMode = name;
  if (name !== 'upload') { _bgB64 = null; }
  if (name !== 'youtube') {
    // Pause video if leaving youtube tab
    const vid = document.getElementById('scrub-video');
    if (vid) vid.pause();
  }
}

// ── File Upload ───────────────────────────────────────────────────────────────
function onDrop(e) {
  e.preventDefault();
  document.getElementById('drop-zone').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) loadImageFile(file);
}
function onFileSelect(input) {
  if (input.files[0]) loadImageFile(input.files[0]);
}
function loadImageFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    const dataUrl = e.target.result;
    const parts = dataUrl.split(',');
    _bgB64  = parts[1];
    _bgMime = file.type || 'image/jpeg';
    const preview = document.getElementById('bg-preview');
    const img     = document.getElementById('bg-preview-img');
    img.src = dataUrl;
    preview.style.display = 'block';
  };
  reader.readAsDataURL(file);
}

// ── YouTube ───────────────────────────────────────────────────────────────────
async function ytQuick() {
  const url = document.getElementById('yt-url').value.trim();
  if (!url) return;
  setStatus('running', 'Fetching thumbnail…');
  try {
    const res = await fetch('/api/extract-frames', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({source: url, mode: 'quick'}),
    });
    const d = await res.json();
    if (d.error) { setStatus('error', d.error); return; }
    setStatus('', '');
    const frame = d.frames[0];
    _bgB64  = frame.frame_b64;
    _bgMime = 'image/jpeg';
    const preview = document.getElementById('yt-preview');
    const img = document.getElementById('yt-preview-img');
    img.src = 'data:image/jpeg;base64,' + frame.frame_b64;
    preview.style.display = 'block';
    document.getElementById('frame-grid').style.display = 'none';
  } catch(e) { setStatus('error', String(e)); }
}

async function ytScrub() {
  const url = document.getElementById('yt-url').value.trim();
  if (!url) return;

  // Hide grid, show scrubber area
  document.getElementById('frame-grid').style.display = 'none';
  document.getElementById('yt-preview').style.display = 'none';
  document.getElementById('frame-hint').style.display = 'none';
  document.getElementById('video-scrubber').style.display = 'block';
  document.getElementById('video-loading').style.display = 'block';
  document.getElementById('scrub-video').style.display = 'none';
  document.getElementById('scrub-actions').style.display = 'none';
  setStatus('running', 'Downloading video preview…');

  try {
    const res = await fetch('/api/prepare-video', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({source: url}),
    });
    const d = await res.json();
    if (d.error) { setStatus('error', d.error); document.getElementById('video-loading').style.display = 'none'; return; }

    setStatus('', '');
    document.getElementById('video-loading').style.display = 'none';
    const vid = document.getElementById('scrub-video');
    vid.src = `/api/video/${d.token}`;
    vid.style.display = 'block';
    document.getElementById('scrub-actions').style.display = 'block';
  } catch(e) {
    setStatus('error', String(e));
    document.getElementById('video-loading').style.display = 'none';
  }
}

// Hidden canvas for frame capture
const _captureCanvas = document.createElement('canvas');

function captureFrame(role) {
  const vid = document.getElementById('scrub-video');
  if (!vid.src || vid.readyState < 2) {
    setStatus('error', 'Video not ready — wait for it to load.'); return;
  }
  _captureCanvas.width  = vid.videoWidth;
  _captureCanvas.height = vid.videoHeight;
  _captureCanvas.getContext('2d').drawImage(vid, 0, 0);
  const b64 = _captureCanvas.toDataURL('image/jpeg', 0.85).split(',')[1];

  // Store in _bgFrames (reuse same multi-frame state)
  const existingIdx = _bgFrames.findIndex(f => f.role === role);
  if (existingIdx !== -1) _bgFrames.splice(existingIdx, 1);
  _bgFrames = _bgFrames.filter(f => f.role !== role);
  _bgFrames.push({b64, role, el: null});
  // Keep host first
  _bgFrames.sort((a, b) => (a.role === 'host' ? -1 : 1));

  renderCapturedFrames();
  const count = _bgFrames.length;
  document.getElementById('capture-status').textContent =
    count === 1 ? `${role === 'host' ? 'Host' : 'Guest'} captured — now capture the other.`
                : 'Both captured — ready to generate!';
}

function renderCapturedFrames() {
  const container = document.getElementById('captured-frames');
  container.innerHTML = _bgFrames.map(f => `
    <div class="captured-thumb ${f.role}">
      <img src="data:image/jpeg;base64,${f.b64}" alt="${f.role}">
      <span class="captured-thumb-label">${f.role}</span>
      <button class="captured-thumb-remove" onclick="removeCapture('${f.role}')">✕</button>
    </div>`).join('');
  container.style.display = _bgFrames.length ? 'flex' : 'none';
}

function removeCapture(role) {
  _bgFrames = _bgFrames.filter(f => f.role !== role);
  renderCapturedFrames();
  const remaining = _bgFrames.length;
  document.getElementById('capture-status').textContent = remaining ? '' : '';
}

async function ytFrames() {
  const url = document.getElementById('yt-url').value.trim();
  if (!url) return;
  setStatus('running', 'Extracting frames — this may take ~30s…');
  try {
    const res = await fetch('/api/extract-frames', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({source: url, mode: 'pick'}),
    });
    const d = await res.json();
    if (d.error) { setStatus('error', d.error); return; }
    setStatus('', '');
    renderFrameGrid(d.frames);
  } catch(e) { setStatus('error', String(e)); }
}

function renderFrameGrid(frames) {
  _bgFrames = [];
  const grid = document.getElementById('frame-grid');
  grid.innerHTML = frames.filter(f => f.frame_b64).map((f, i) => `
    <div class="frame-thumb" data-b64="${f.frame_b64}" onclick="selectFrame(this)">
      <img src="data:image/jpeg;base64,${f.frame_b64}" alt="frame">
      <span class="frame-ts">${f.timestamp}</span>
    </div>`).join('');
  grid.style.display = 'grid';
  document.getElementById('yt-preview').style.display = 'none';
  document.getElementById('frame-hint').style.display = 'block';
}

function selectFrame(el) {
  const b64 = el.dataset.b64;
  const existingIdx = _bgFrames.findIndex(f => f.el === el);

  if (existingIdx !== -1) {
    // Deselect — remove from list, refresh labels
    _bgFrames.splice(existingIdx, 1);
    el.classList.remove('frame-host', 'frame-guest');
    el.querySelector('.frame-role')?.remove();
  } else if (_bgFrames.length < 2) {
    // Add as HOST or GUEST
    const role = _bgFrames.length === 0 ? 'host' : 'guest';
    _bgFrames.push({b64, el});
    el.classList.add(`frame-${role}`);
    const lbl = document.createElement('span');
    lbl.className = 'frame-role';
    lbl.textContent = role === 'host' ? 'Host' : 'Guest';
    el.appendChild(lbl);
  } else {
    // 2 already selected — replace the guest (index 1) with this new one
    const old = _bgFrames[1];
    old.el.classList.remove('frame-guest');
    old.el.querySelector('.frame-role')?.remove();
    _bgFrames[1] = {b64, el};
    el.classList.add('frame-guest');
    const lbl = document.createElement('span');
    lbl.className = 'frame-role';
    lbl.textContent = 'Guest';
    el.appendChild(lbl);
  }

  // Re-sync labels in case host was deselected (remaining becomes host)
  _bgFrames.forEach((f, i) => {
    const role = i === 0 ? 'host' : 'guest';
    f.el.classList.remove('frame-host', 'frame-guest');
    f.el.classList.add(`frame-${role}`);
    const lbl = f.el.querySelector('.frame-role');
    if (lbl) lbl.textContent = role === 'host' ? 'Host' : 'Guest';
  });
}

// ── Format Pills ──────────────────────────────────────────────────────────────
function setFormat(pill) {
  document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
  pill.classList.add('active');
  _aspect = pill.dataset.aspect;
}

// ── Generate ──────────────────────────────────────────────────────────────────
async function generate() {
  const thumbCopy = document.getElementById('thumb-copy').value.trim();
  if (!thumbCopy) { setStatus('error', 'Paste thumbnail copy first.'); return; }

  if (_bgMode === 'upload' && !_bgB64) {
    setStatus('error', 'Upload a background image first.'); return;
  }
  if (_bgMode === 'youtube' && !_bgB64 && _bgFrames.length === 0) {
    setStatus('error', 'Fetch a YouTube thumbnail or pick a frame first.'); return;
  }

  const topic = document.getElementById('topic-input')?.value.trim() || thumbCopy;
  const profileId = document.getElementById('profile-select').value;

  const body = {
    thumbnail_copy: thumbCopy,
    profile_id:     profileId,
    style_id:       _styleId,
    aspect_ratio:   _aspect,
    bg_mode:        _bgMode === 'auto' ? 'auto_stock' : 'upload',
    bg_b64:         _bgMode === 'upload' ? _bgB64 : (_bgMode === 'youtube' && !_bgFrames.length ? _bgB64 : null),
    bg_frames:      _bgMode === 'youtube' ? _bgFrames.map(f => f.b64).filter(Boolean) : [],
    bg_mime:        _bgMime,
    topic:          topic,
  };

  document.getElementById('btn-generate').disabled = true;
  showLoading('Preparing…');
  setStatus('running', '');
  document.getElementById('result-panel').style.display = 'none';

  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(body),
  });
  const d = await res.json();
  if (d.error) { hideLoading(); setStatus('error', d.error); document.getElementById('btn-generate').disabled = false; return; }
  _jobId = d.job_id;
  pollJob();
}

function pollJob() {
  _pollTimer = setInterval(async () => {
    const res = await fetch(`/api/job/${_jobId}`);
    const d   = await res.json();
    if (d.progress) document.getElementById('loading-msg').textContent = d.progress;
    if (d.status === 'done') {
      clearInterval(_pollTimer);
      hideLoading();
      document.getElementById('btn-generate').disabled = false;
      renderResult(d.result);
      loadRecents();
    } else if (d.status === 'error') {
      clearInterval(_pollTimer);
      hideLoading();
      document.getElementById('btn-generate').disabled = false;
      setStatus('error', '⚠ ' + (d.error || 'Generation failed'));
    }
  }, 1500);
}

function renderResult(result) {
  const src = 'data:image/png;base64,' + result.image_b64;
  document.getElementById('result-img').src = src;
  const dl = document.getElementById('download-btn');
  dl.href = `/api/download/${result.token}`;
  dl.download = 'cover.png';
  document.getElementById('result-panel').style.display = 'block';
  document.getElementById('result-panel').scrollIntoView({behavior:'smooth', block:'start'});
  setStatus('', '');
}

function regenerate() {
  generate();
}

// ── UI Helpers ────────────────────────────────────────────────────────────────
function showLoading(msg) {
  document.getElementById('loading-msg').textContent = msg;
  document.getElementById('loading-overlay').classList.add('visible');
}
function hideLoading() {
  document.getElementById('loading-overlay').classList.remove('visible');
}
function setStatus(type, msg) {
  const el = document.getElementById('status-bar');
  el.textContent = msg;
  el.className = type;
}

// ── Recents ───────────────────────────────────────────────────────────────────
// ── Lightbox ──────────────────────────────────────────────────────────────────
let _lightboxB64  = null;
let _lightboxCopy = '';

function openLightbox(b64, copy, token) {
  _lightboxB64  = b64;
  _lightboxCopy = copy;
  document.getElementById('lightbox-img').src = 'data:image/png;base64,' + b64;
  document.getElementById('lightbox-copy').textContent = copy;
  document.getElementById('lightbox-dl').href = `/api/download/${token}`;
  document.getElementById('lightbox-dl').download = `cover_${copy.slice(0,30).replace(/\s+/g,'_')}.png`;
  document.getElementById('lightbox').classList.add('visible');
  document.body.style.overflow = 'hidden';
}

function closeLightbox(e) {
  if (e && e.target !== document.getElementById('lightbox') && e.target !== document.getElementById('lightbox-close')) return;
  document.getElementById('lightbox').classList.remove('visible');
  document.body.style.overflow = '';
}

function lightboxUseAsBg() {
  useRecentAsBg(_lightboxB64, _lightboxCopy);
  document.getElementById('lightbox').classList.remove('visible');
  document.body.style.overflow = '';
}

// Close on Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.getElementById('lightbox').classList.remove('visible');
    document.body.style.overflow = '';
  }
});

// ── Recents drag state ────────────────────────────────────────────────────────
let _dragRecentB64 = null;

async function loadRecents() {
  const res = await fetch('/api/recents');
  const items = await res.json();
  const panel = document.getElementById('recents-panel');
  const grid  = document.getElementById('recents-grid');
  if (!items.length) { panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  grid.innerHTML = items.map((r, i) => `
    <div class="recent-thumb"
         draggable="true"
         data-idx="${i}"
         data-b64="${r.image_b64}"
         data-copy="${escHtml(r.thumbnail_copy)}"
         data-token="${r.token}"
         onclick="openLightbox('${r.image_b64}','${escHtml(r.thumbnail_copy)}','${r.token}')"
         ondragstart="onRecentDragStart(event,this)"
         ondragend="onRecentDragEnd(event)">
      <img src="data:image/png;base64,${r.image_b64}" alt="">
      <div class="recent-thumb-label">${escHtml(r.thumbnail_copy)}</div>
    </div>`).join('');

  // Make drop zone accept drags from recents
  const dz = document.getElementById('drop-zone');
  dz.ondragover  = e => { e.preventDefault(); if (_dragRecentB64) dz.classList.add('recent-drag-over'); else dz.classList.add('drag-over'); };
  dz.ondragleave = e => { dz.classList.remove('recent-drag-over', 'drag-over'); };
  dz.ondrop      = e => {
    e.preventDefault();
    dz.classList.remove('recent-drag-over', 'drag-over');
    if (_dragRecentB64) {
      useRecentAsBg(_dragRecentB64, '');
      _dragRecentB64 = null;
    } else {
      const file = e.dataTransfer.files[0];
      if (file) loadImageFile(file);
    }
  };
}

function onRecentDragStart(e, el) {
  _dragRecentB64 = el.dataset.b64;
  e.dataTransfer.effectAllowed = 'copy';
}

function onRecentDragEnd(e) {
  _dragRecentB64 = null;
}

function useRecentAsBg(b64, copy) {
  _bgB64  = b64;
  _bgMime = 'image/png';
  switchTab('upload');
  const preview = document.getElementById('bg-preview');
  const img     = document.getElementById('bg-preview-img');
  img.src = 'data:image/png;base64,' + b64;
  preview.style.display = 'block';
  if (copy) document.getElementById('thumb-copy').value = copy;
  window.scrollTo({top: 0, behavior: 'smooth'});
}

function clearRecents() {
  document.getElementById('recents-panel').style.display = 'none';
  document.getElementById('recents-grid').innerHTML = '';
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Cmd/Ctrl + Enter to generate ─────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault();
    generate();
  }
});

// Init: set first style card as selected
document.addEventListener('DOMContentLoaded', () => {
  const first = document.querySelector('.style-card');
  if (first) {
    _styleId   = first.dataset.style || '';
    _profileId = first.dataset.profile || 'dre-alexandra';
  }
  loadRecents();
});
</script>
</body>
</html>"""


# ── Entry Point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    (Path(__file__).parent / "logs").mkdir(exist_ok=True)
    logger.info(f"Cover Studio — http://localhost:{PORT}")
    logger.info(f"Nano Banana at: {NB_URL}")
    app.run(host="0.0.0.0", port=PORT, debug=False)
