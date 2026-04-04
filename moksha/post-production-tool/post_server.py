#!/usr/bin/env python3
"""
Post Production Tool — post.mokshatools.com
YouTube URL → Claude Opus 4.6 (2-pass) → titles, description, timestamps, thumbnail copy.
Editable output with per-section LLM revision.
"""

import json
import logging
import os
import threading
import uuid
from datetime import datetime
from typing import Optional

COSTS_LOG = os.path.expanduser("~/.postprod/logs/costs.jsonl")


def _log_cost(video_title: str, cost_usd: float, model: str):
    """Append one cost record to the JSONL cost log."""
    try:
        os.makedirs(os.path.dirname(COSTS_LOG), exist_ok=True)
        record = {"ts": datetime.now().isoformat(), "title": video_title[:80],
                  "cost_usd": cost_usd, "model": model}
        with open(COSTS_LOG, "a") as f:
            f.write(json.dumps(record) + "\n")
    except Exception:
        pass


def _read_costs() -> list:
    try:
        if not os.path.exists(COSTS_LOG):
            return []
        with open(COSTS_LOG) as f:
            return [json.loads(l) for l in f if l.strip()]
    except Exception:
        return []

from flask import Flask, jsonify, render_template_string, request

from dotenv import load_dotenv
load_dotenv()

import transcript_fetcher as tf
import post_producer as pp

# ── Logging ────────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(os.path.join(os.path.dirname(__file__), "logs", "post.log")),
    ],
)
logger = logging.getLogger(__name__)

# ── Config ─────────────────────────────────────────────────────────────────────

PORT = int(os.getenv("PORT", "4200"))
YOUTUBE_CHANNEL_URL = os.getenv("YOUTUBE_CHANNEL_URL", "")
PROFILES_DIR = os.path.join(os.path.dirname(__file__), "brand_profiles")

# ── Flask ──────────────────────────────────────────────────────────────────────

app = Flask(__name__)

@app.after_request
def no_cache(r):
    r.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    r.headers["Pragma"] = "no-cache"
    return r

# ── Job State ──────────────────────────────────────────────────────────────────

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


# ── Brand Profiles ─────────────────────────────────────────────────────────────

def _load_profiles() -> list[dict]:
    profiles = []
    if not os.path.isdir(PROFILES_DIR):
        return [{"id": "default", "name": "Default"}]
    for fname in sorted(os.listdir(PROFILES_DIR)):
        if fname.endswith(".json"):
            try:
                with open(os.path.join(PROFILES_DIR, fname)) as f:
                    profiles.append(json.load(f))
            except Exception:
                pass
    return profiles or [{"id": "default", "name": "Default"}]


def _get_profile(profile_id: str) -> dict:
    for p in _load_profiles():
        if p.get("id") == profile_id:
            return p
    return {"id": "default", "name": "Default", "voice": "Professional", "tone": "Clear"}


# ── Background Generation ──────────────────────────────────────────────────────

def _run_generation(job_id: str, url: str, profile_id: str):
    try:
        _update_job(job_id, status="running", progress="Fetching transcript…")

        def progress_cb(msg):
            _update_job(job_id, progress=msg)

        video_data = tf.fetch_for_production(url, progress_cb=progress_cb)
        if "error" in video_data:
            _update_job(job_id, status="error", error=video_data["error"])
            return

        source = video_data.get('transcript_source', '')
        label = ' (via Whisper)' if source == 'whisper' else ''
        _update_job(job_id, progress=f'Transcript ready{label} — generating…')

        profile = _get_profile(profile_id)

        package = pp.generate_package(
            transcript=video_data["transcript"],
            video_title=video_data["title"],
            channel=video_data["channel"],
            profile=profile,
            progress_cb=progress_cb,
        )

        cost_usd = package.pop("_cost_usd", 0.0)
        model_used = package.pop("_model", "unknown")
        _log_cost(video_data.get("title", "unknown"), cost_usd, model_used)
        logger.info(f"Job {job_id} complete — {video_data['title'][:60]} — cost ${cost_usd:.5f}")

        _update_job(job_id, status="done", result={
            "package": package,
            "video": {k: v for k, v in video_data.items() if k != "transcript"},
            "transcript_snippet": video_data["transcript"][:3000],
            "profile_id": profile_id,
            "generated_at": datetime.now().strftime("%H:%M, %b %d"),
            "cost_usd": cost_usd,
            "model": model_used,
        })

    except Exception as e:
        logger.exception(f"Job {job_id} failed")
        _update_job(job_id, status="error", error=str(e))


# ── Routes ─────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    profiles = _load_profiles()
    resp = app.make_response(render_template_string(DASHBOARD_HTML,
        profiles=profiles,
        channel_url=YOUTUBE_CHANNEL_URL,
    ))
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    return resp


@app.route("/api/profiles")
def api_profiles():
    return jsonify(_load_profiles())


@app.route("/api/recent-videos")
def api_recent_videos():
    if not YOUTUBE_CHANNEL_URL:
        return jsonify({"videos": [], "note": "Set YOUTUBE_CHANNEL_URL in .env to browse recent uploads"})
    videos = tf.get_recent_uploads(YOUTUBE_CHANNEL_URL, limit=20)
    return jsonify({"videos": videos})


@app.route("/api/costs")
def api_costs():
    records = _read_costs()
    total = round(sum(r.get("cost_usd", 0) for r in records), 5)
    last_30 = records[-30:] if len(records) > 30 else records
    return jsonify({"total_usd": total, "count": len(records), "recent": list(reversed(last_30))})


@app.route("/api/generate", methods=["POST"])
def api_generate():
    body = request.get_json(force=True)
    url = body.get("url", "").strip()
    profile_id = body.get("profile_id", "default")

    if not url:
        return jsonify({"error": "URL required"}), 400

    job_id = _new_job()
    t = threading.Thread(target=_run_generation, args=(job_id, url, profile_id), daemon=True)
    t.start()
    return jsonify({"job_id": job_id})


@app.route("/api/job/<job_id>")
def api_job_status(job_id):
    job = _get_job(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    # Don't send transcript_snippet over the wire in status polls
    result = job.get("result")
    if result:
        result = {k: v for k, v in result.items() if k != "transcript_snippet"}
    return jsonify({
        "status":   job.get("status"),
        "progress": job.get("progress"),
        "error":    job.get("error"),
        "result":   result,
    })


@app.route("/api/revise", methods=["POST"])
def api_revise():
    body = request.get_json(force=True)
    job_id     = body.get("job_id")
    section    = body.get("section")
    instruction = body.get("instruction", "").strip()

    if not all([job_id, section, instruction]):
        return jsonify({"error": "job_id, section, and instruction required"}), 400

    job = _get_job(job_id)
    if not job or not job.get("result"):
        return jsonify({"error": "Job not found or not complete"}), 404

    result = job["result"]
    profile = _get_profile(result.get("profile_id", "default"))

    try:
        updated = pp.revise_section(
            current_package=result["package"],
            section_name=section,
            instruction=instruction,
            transcript_snippet=result.get("transcript_snippet", ""),
            profile=profile,
        )
        new_cost = updated.pop("_cost_usd", result.get("cost_usd", 0))
        updated.pop("_model", None)
        # Update stored result
        with _jobs_lock:
            _jobs[job_id]["result"]["package"] = updated
            _jobs[job_id]["result"]["cost_usd"] = new_cost
        return jsonify({"package": updated, "cost_usd": new_cost})
    except Exception as e:
        logger.exception("Revision failed")
        return jsonify({"error": str(e)}), 500


# ── HTML Template ──────────────────────────────────────────────────────────────

DASHBOARD_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Moksha Social Scribe — MOKSHATOOLS</title>
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

    .divider { display: flex; align-items: center; gap: 0.75rem; justify-content: center; margin: 1.25rem 0; color: var(--gold-3); }
    .divider::before, .divider::after { content: ''; display: block; width: 50px; height: 1px; background: var(--gold-3); opacity: 0.5; }
    .divider-dot { width: 4px; height: 4px; border-radius: 50%; background: var(--gold-3); }

    /* Header */
    .header { padding: 3.5rem 0 1.5rem; text-align: center; }
    .header-eyebrow { font-size: 0.63rem; font-weight: 500; letter-spacing: 0.3em; text-transform: uppercase; color: var(--gold-3); margin-bottom: 1rem; }
    .header-title { font-family: 'Cormorant Garamond', serif; font-size: clamp(2.2rem, 5vw, 3.5rem); font-weight: 300; letter-spacing: 0.1em; color: var(--text-1); margin-bottom: 0.4rem; }
    .header-sub { font-family: 'Cormorant Garamond', serif; font-style: italic; color: var(--text-3); font-size: 1rem; }

    /* Input Panel */
    .input-panel { border: 1px solid var(--border); background: var(--cream-2); padding: 1.75rem 2rem; margin-bottom: 2rem; }
    .input-row { display: flex; gap: 0.75rem; align-items: flex-end; flex-wrap: wrap; }
    .input-group { display: flex; flex-direction: column; gap: 0.35rem; flex: 1; min-width: 200px; }
    .input-label { font-size: 0.6rem; font-weight: 500; letter-spacing: 0.22em; text-transform: uppercase; color: var(--text-4); }
    input[type=text], select {
      padding: 0.75rem 0.9rem; border: 1px solid var(--border); background: var(--cream);
      color: var(--text-1); font-family: 'Inter', sans-serif; font-size: 0.82rem;
      font-weight: 300; outline: none; width: 100%;
    }
    input[type=text]:focus, select:focus { border-color: var(--gold-3); }
    input[type=text]::placeholder { color: var(--text-4); }
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
    .btn-copy { color: var(--text-4); border-color: var(--border-2); }
    .btn-copy:hover { color: var(--gold-2); border-color: var(--gold-3); background: transparent; }
    .btn-regen { color: var(--gold-1); border-color: rgba(176,137,40,0.3); }
    .btn-regen:hover { background: var(--gold-5); border-color: var(--gold-3); }

    /* Recent Videos */
    .recent-toggle { font-size: 0.65rem; color: var(--gold-3); cursor: pointer; letter-spacing: 0.1em; margin-top: 0.4rem; display: inline-block; }
    .recent-toggle:hover { color: var(--gold-2); }
    #recent-panel { display: none; margin-top: 1rem; border: 1px solid var(--border-2); max-height: 220px; overflow-y: auto; }
    .recent-row { padding: 0.65rem 1rem; font-size: 0.78rem; color: var(--text-2); cursor: pointer; border-bottom: 1px solid var(--border-2); transition: background 0.15s; display: flex; justify-content: space-between; align-items: center; gap: 1rem; }
    .recent-row:hover { background: var(--cream-2); }
    .recent-row:last-child { border-bottom: none; }
    .recent-date { font-size: 0.6rem; color: var(--text-4); flex-shrink: 0; }

    /* Status */
    #status-bar { min-height: 2rem; font-size: 0.72rem; letter-spacing: 0.08em; color: var(--text-4); text-align: center; padding: 0.5rem 0; }
    #status-bar.running { color: var(--gold-3); }
    #status-bar.error { color: var(--red); }

    /* Results */
    #results { display: none; }
    .results-header { margin-bottom: 1.75rem; padding-bottom: 0.6rem; border-bottom: 1px solid var(--border); }
    .results-source-title { font-family: 'Cormorant Garamond', serif; font-size: 1.55rem; font-weight: 400; color: var(--text-1); line-height: 1.3; margin-bottom: 0.35rem; }
    .results-meta { font-size: 0.62rem; color: var(--text-4); letter-spacing: 0.08em; }
    .cost-bar { display: flex; align-items: center; justify-content: flex-end; gap: 1.5rem; padding: 0.5rem 0; margin-bottom: 0.5rem; font-size: 0.62rem; letter-spacing: 0.1em; color: var(--text-4); }
    .cost-item { display: flex; align-items: center; gap: 0.4rem; }
    .cost-label { text-transform: uppercase; }
    .cost-value { color: var(--gold-2); font-weight: 500; }
    .cost-value.warn { color: #a06020; }
    .cost-this { font-size: 0.72rem; color: var(--text-3); }

    /* Cards */
    .cards-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: var(--border); border: 1px solid var(--border); margin-bottom: 1.5rem; }
    .card { background: var(--cream); padding: 1.5rem 1.75rem; }
    .card-full { grid-column: 1 / -1; }
    .card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem; }
    .card-label { font-size: 0.6rem; font-weight: 500; letter-spacing: 0.22em; text-transform: uppercase; color: var(--text-4); }
    .card-actions { display: flex; gap: 0.4rem; }
    .card-body { font-size: 0.82rem; color: var(--text-2); line-height: 1.6; }

    textarea, .editable {
      width: 100%; background: transparent; border: 1px solid transparent; color: var(--text-2);
      font-family: 'Inter', sans-serif; font-size: 0.82rem; font-weight: 300; line-height: 1.6;
      resize: vertical; outline: none; padding: 0.25rem 0.35rem; transition: border-color 0.15s;
    }
    textarea:focus, .editable:focus { border-color: var(--border); background: var(--cream-2); }
    textarea { min-height: 120px; }

    /* Titles */
    .title-list { display: flex; flex-direction: column; gap: 0.5rem; }
    .title-item { display: flex; align-items: center; gap: 0.5rem; }
    .title-num { font-size: 0.6rem; color: var(--text-4); font-weight: 500; letter-spacing: 0.1em; flex-shrink: 0; padding-top: 0.3rem; }
    .title-input { flex: 1; }

    /* Timestamps */
    .ts-list { display: flex; flex-direction: column; }
    .ts-row { display: grid; grid-template-columns: 60px 1fr; align-items: center; border-bottom: 1px solid var(--border-2); }
    .ts-row:last-child { border-bottom: none; }
    .ts-time { font-family: 'Inter', monospace; font-size: 0.75rem; color: var(--gold-2); padding: 0.45rem 0.5rem 0.45rem 0; border: none !important; background: transparent !important; width: 100%; }
    .ts-label { font-size: 0.82rem; color: var(--text-2); border: none !important; background: transparent !important; border-left: 1px solid var(--border-2) !important; padding-left: 0.75rem; }

    /* Revise Popover */
    .revise-popover { display: none; margin-top: 0.75rem; border: 1px solid var(--border); padding: 0.75rem 1rem; background: var(--cream-2); }
    .revise-popover.visible { display: block; }
    .revise-row { display: flex; gap: 0.5rem; }
    .revise-input { flex: 1; padding: 0.5rem 0.75rem; border: 1px solid var(--border); background: var(--cream); color: var(--text-1); font-family: 'Inter', sans-serif; font-size: 0.78rem; outline: none; }
    .revise-input:focus { border-color: var(--gold-3); }
    .revise-input::placeholder { color: var(--text-4); }

    /* Copy feedback */
    .copied { color: var(--gold-2) !important; }

    /* Loading spinner */
    #loading-overlay { display: none; position: fixed; inset: 0; z-index: 100; background: rgba(240,228,188,0.97); align-items: center; justify-content: center; flex-direction: column; gap: 1.25rem; }
    #loading-overlay.visible { display: flex; }
    .spinner { width: 52px; height: 52px; border: 2px solid var(--gold-4); border-top-color: var(--gold-1); border-radius: 50%; animation: spin 0.9s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .loading-title { font-family: 'Cormorant Garamond', serif; font-size: 1.8rem; font-weight: 300; letter-spacing: 0.12em; color: var(--text-2); }
    .loading-msg { font-size: 0.7rem; letter-spacing: 0.15em; color: var(--gold-3); text-transform: uppercase; min-height: 1.2em; }

    /* Footer */
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

<div id="loading-overlay">
  <div class="spinner"></div>
  <div class="loading-title">Generating</div>
  <div class="loading-msg" id="loading-msg">Initializing…</div>
</div>

<div class="container">

  <header class="header">
    <p class="header-eyebrow">Mokshatools &nbsp;·&nbsp; Content Ops &nbsp;·&nbsp; 2026</p>
    <div class="divider"><div class="divider-dot"></div></div>
    <h1 class="header-title">SOCIAL SCRIBE</h1>
    <p class="header-sub">Transcript → titles, description, timestamps, thumbnail copy</p>
    <div class="divider"><div class="divider-dot"></div></div>
  </header>

  <!-- Cost Bar -->
  <div class="cost-bar">
    <div class="cost-item">
      <span class="cost-label">This run</span>
      <span class="cost-value" id="cost-this">—</span>
    </div>
    <div class="cost-item">
      <span class="cost-label">All time</span>
      <span class="cost-value" id="cost-total">—</span>
    </div>
    <div class="cost-item">
      <span class="cost-label">Runs</span>
      <span class="cost-value" id="cost-count">—</span>
    </div>
  </div>

  <!-- Input Panel -->
  <div class="input-panel">
    <div class="input-row">
      <div class="input-group" style="flex:2;">
        <label class="input-label">YouTube URL</label>
        <input type="text" id="url-input" placeholder="https://www.youtube.com/watch?v=...">
      </div>
      <div class="input-group" style="flex:1;">
        <label class="input-label">Brand Profile</label>
        <select id="profile-select">
          {% for p in profiles %}
          <option value="{{ p.id }}">{{ p.name }}</option>
          {% endfor %}
        </select>
      </div>
      <button class="btn btn-primary" id="btn-generate" onclick="generate()">
        &#9656;&nbsp;Generate
      </button>
    </div>
    {% if channel_url %}
    <div>
      <span class="recent-toggle" onclick="toggleRecent()">↓ Browse recent uploads</span>
      <div id="recent-panel">
        <div style="padding:0.75rem 1rem; font-size:0.68rem; color:var(--text-4);">Loading…</div>
      </div>
    </div>
    {% endif %}
  </div>

  <div id="status-bar"></div>

  <!-- Results -->
  <div id="results">
    <div class="results-header">
      <div class="results-source-title" id="results-video-title"></div>
      <span class="results-meta" id="results-meta"></span>
    </div>

    <div class="cards-grid">

      <!-- Editorial Frame -->
      <div class="card card-full" id="card-editorial_frame">
        <div class="card-header">
          <span class="card-label">Editorial Frame</span>
          <div class="card-actions">
            <button class="btn btn-sm btn-copy" onclick="copySection('editorial_frame')">Copy</button>
            <button class="btn btn-sm btn-regen" onclick="toggleRevise('editorial_frame')">Revise</button>
          </div>
        </div>
        <div class="card-body">
          <textarea id="field-editorial_frame" rows="3" oninput="onFieldEdit('editorial_frame', this.value)"></textarea>
        </div>
        <div class="revise-popover" id="revise-editorial_frame">
          <div class="revise-row">
            <input class="revise-input" placeholder="What should change? e.g. 'focus more on the business angle'" id="ri-editorial_frame">
            <button class="btn btn-sm btn-primary" onclick="submitRevise('editorial_frame')">Apply</button>
            <button class="btn btn-sm" onclick="toggleRevise('editorial_frame')">Cancel</button>
          </div>
        </div>
      </div>

      <!-- Titles -->
      <div class="card" id="card-titles">
        <div class="card-header">
          <span class="card-label">Title Options</span>
          <div class="card-actions">
            <button class="btn btn-sm btn-copy" onclick="copySection('titles')">Copy All</button>
            <button class="btn btn-sm btn-regen" onclick="toggleRevise('titles')">Revise</button>
          </div>
        </div>
        <div class="card-body">
          <div class="title-list" id="field-titles"></div>
        </div>
        <div class="revise-popover" id="revise-titles">
          <div class="revise-row">
            <input class="revise-input" placeholder="e.g. 'make them more curiosity-driven' or 'shorter, punchier'" id="ri-titles">
            <button class="btn btn-sm btn-primary" onclick="submitRevise('titles')">Apply</button>
            <button class="btn btn-sm" onclick="toggleRevise('titles')">Cancel</button>
          </div>
        </div>
      </div>

      <!-- Thumbnail -->
      <div class="card" id="card-thumbnail_copy">
        <div class="card-header">
          <span class="card-label">Thumbnail Copy</span>
          <div class="card-actions">
            <button class="btn btn-sm btn-copy" onclick="copySection('thumbnail_copy')">Copy</button>
            <button class="btn btn-sm btn-regen" onclick="toggleRevise('thumbnail_copy')">Revise</button>
          </div>
        </div>
        <div class="card-body">
          <textarea id="field-thumbnail_copy" rows="2" style="font-size:1.1rem; font-family:'Cormorant Garamond',serif; font-weight:600; letter-spacing:0.02em;" oninput="onFieldEdit('thumbnail_copy', this.value)"></textarea>
        </div>
        <div class="revise-popover" id="revise-thumbnail_copy">
          <div class="revise-row">
            <input class="revise-input" placeholder="e.g. 'more shocking', 'shorter', 'question format'" id="ri-thumbnail_copy">
            <button class="btn btn-sm btn-primary" onclick="submitRevise('thumbnail_copy')">Apply</button>
            <button class="btn btn-sm" onclick="toggleRevise('thumbnail_copy')">Cancel</button>
          </div>
        </div>
      </div>

      <!-- Timestamps -->
      <div class="card card-full" id="card-timestamps">
        <div class="card-header">
          <span class="card-label">Timestamps</span>
          <div class="card-actions">
            <button class="btn btn-sm btn-copy" onclick="copySection('timestamps')">Copy</button>
            <button class="btn btn-sm btn-regen" onclick="toggleRevise('timestamps')">Revise</button>
          </div>
        </div>
        <div class="card-body">
          <div class="ts-list" id="field-timestamps"></div>
        </div>
        <div class="revise-popover" id="revise-timestamps">
          <div class="revise-row">
            <input class="revise-input" placeholder="e.g. 'add more chapters', 'fix the timecodes'" id="ri-timestamps">
            <button class="btn btn-sm btn-primary" onclick="submitRevise('timestamps')">Apply</button>
            <button class="btn btn-sm" onclick="toggleRevise('timestamps')">Cancel</button>
          </div>
        </div>
      </div>

      <!-- Description -->
      <div class="card card-full" id="card-description">
        <div class="card-header">
          <span class="card-label">YouTube Description</span>
          <div class="card-actions">
            <button class="btn btn-sm btn-copy" onclick="copySection('description')">Copy</button>
            <button class="btn btn-sm btn-regen" onclick="toggleRevise('description')">Revise</button>
          </div>
        </div>
        <div class="card-body">
          <textarea id="field-description" rows="10" oninput="onFieldEdit('description', this.value)"></textarea>
        </div>
        <div class="revise-popover" id="revise-description">
          <div class="revise-row">
            <input class="revise-input" placeholder="e.g. 'shorter', 'more keywords', 'add a CTA'" id="ri-description">
            <button class="btn btn-sm btn-primary" onclick="submitRevise('description')">Apply</button>
            <button class="btn btn-sm" onclick="toggleRevise('description')">Cancel</button>
          </div>
        </div>
      </div>

    </div>

    <button class="btn btn-primary" onclick="copyAll()" style="width:100%;">
      &#9670;&nbsp;Copy Complete Package
    </button>
  </div>

  <footer>
    <div class="divider"><div class="divider-dot"></div></div>
    <p>Mokshatools &nbsp;·&nbsp; <a href="https://mokshatools.com">mokshatools.com</a> &nbsp;·&nbsp; 2026</p>
  </footer>

</div>

<script>
  // ── State ───────────────────────────────────────────────────────────────────
  let _jobId = null;
  let _pollTimer = null;
  let _pkg = null;   // current content package

  // ── Generate ────────────────────────────────────────────────────────────────
  async function generate() {
    const url = document.getElementById('url-input').value.trim();
    const profileId = document.getElementById('profile-select').value;
    if (!url) { setStatus('error', 'Paste a YouTube URL first.'); return; }

    const btn = document.getElementById('btn-generate');
    btn.disabled = true;
    btn.textContent = '… Generating';
    showLoading('Starting…');
    setStatus('running', '');

    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({url, profile_id: profileId}),
    });
    const d = await res.json();
    if (d.error) { hideLoading(); setStatus('error', d.error); document.getElementById('btn-generate').disabled = false; return; }
    _jobId = d.job_id;
    pollJob();
  }

  function pollJob() {
    _pollTimer = setInterval(async () => {
      const res = await fetch(`/api/job/${_jobId}`);
      const d = await res.json();
      document.getElementById('loading-msg').textContent = d.progress || 'Working…';
      if (d.status === 'done') {
        clearInterval(_pollTimer);
        hideLoading();
        const b = document.getElementById('btn-generate');
        b.disabled = false; b.textContent = '▶ Generate';
        renderResults(d.result);
        setStatus('', '');
      } else if (d.status === 'error') {
        clearInterval(_pollTimer);
        hideLoading();
        const b = document.getElementById('btn-generate');
        b.disabled = false; b.textContent = '▶ Generate';
        const msg = d.error || 'Generation failed';
        setStatus('error', '⚠ ' + msg);
        alert(msg);
      }
    }, 1500);
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  function renderResults(result) {
    _pkg = result.package;
    const v = result.video;
    document.getElementById('results-video-title').textContent = v.title || '';
    document.getElementById('results-meta').textContent =
      [v.channel, v.upload_date, result.generated_at, result.model].filter(Boolean).join(' · ');
    renderPackage(_pkg);
    updateCostThis(result.cost_usd);
    loadCosts();
    document.getElementById('results').style.display = 'block';
    document.getElementById('results').scrollIntoView({behavior: 'smooth', block: 'start'});
  }

  function renderPackage(pkg) {
    // Editorial frame
    const ef = document.getElementById('field-editorial_frame');
    if (ef) ef.value = pkg.editorial_frame || '';

    // Titles
    const titleList = document.getElementById('field-titles');
    if (titleList) {
      titleList.innerHTML = (pkg.titles || []).map((t, i) => `
        <div class="title-item">
          <span class="title-num">${i+1}.</span>
          <input class="title-input" type="text" value="${esc(t)}" oninput="onTitleEdit(${i}, this.value)">
        </div>`).join('');
    }

    // Thumbnail
    const th = document.getElementById('field-thumbnail_copy');
    if (th) th.value = pkg.thumbnail_copy || '';

    // Timestamps
    const tsList = document.getElementById('field-timestamps');
    if (tsList) {
      tsList.innerHTML = (pkg.timestamps || []).map((ts, i) => `
        <div class="ts-row">
          <input class="ts-time" type="text" value="${esc(ts.time)}" oninput="onTsEdit(${i},'time',this.value)">
          <input class="ts-label" type="text" value="${esc(ts.label)}" oninput="onTsEdit(${i},'label',this.value)">
        </div>`).join('');
    }

    // Description
    const desc = document.getElementById('field-description');
    if (desc) desc.value = pkg.description || '';
  }

  // ── Edit Handlers ────────────────────────────────────────────────────────────
  function onFieldEdit(key, val) { if (_pkg) _pkg[key] = val; }
  function onTitleEdit(i, val) { if (_pkg && _pkg.titles) _pkg.titles[i] = val; }
  function onTsEdit(i, key, val) { if (_pkg && _pkg.timestamps) _pkg.timestamps[i][key] = val; }

  // ── Revise ──────────────────────────────────────────────────────────────────
  function toggleRevise(section) {
    const el = document.getElementById(`revise-${section}`);
    el.classList.toggle('visible');
    if (el.classList.contains('visible')) {
      document.getElementById(`ri-${section}`).focus();
    }
  }

  async function submitRevise(section) {
    const instruction = document.getElementById(`ri-${section}`).value.trim();
    if (!instruction) return;

    const btn = event.target;
    btn.disabled = true;
    btn.textContent = '…';

    const res = await fetch('/api/revise', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({job_id: _jobId, section, instruction}),
    });
    const d = await res.json();
    btn.disabled = false;
    btn.textContent = 'Apply';

    if (d.package) {
      _pkg = d.package;
      renderPackage(_pkg);
      if (d.cost_usd != null) updateCostThis(d.cost_usd);
      toggleRevise(section);
      document.getElementById(`ri-${section}`).value = '';
    } else {
      alert(d.error || 'Revision failed');
    }
  }

  // ── Copy ────────────────────────────────────────────────────────────────────
  function copySection(section) {
    if (!_pkg) return;
    let text = '';
    if (section === 'titles') {
      text = (_pkg.titles || []).map((t, i) => `${i+1}. ${t}`).join('\\n');
    } else if (section === 'timestamps') {
      text = (_pkg.timestamps || []).map(ts => `${ts.time} ${ts.label}`).join('\\n');
    } else {
      text = _pkg[section] || '';
    }
    navigator.clipboard.writeText(text);
    flash(event.target);
  }

  function copyAll() {
    if (!_pkg) return;
    const parts = [
      '── EDITORIAL FRAME ──',
      _pkg.editorial_frame,
      '',
      '── TITLES ──',
      (_pkg.titles || []).map((t, i) => `${i+1}. ${t}`).join('\\n'),
      '',
      '── THUMBNAIL ──',
      _pkg.thumbnail_copy,
      '',
      '── TIMESTAMPS ──',
      (_pkg.timestamps || []).map(ts => `${ts.time} ${ts.label}`).join('\\n'),
      '',
      '── DESCRIPTION ──',
      _pkg.description,
    ];
    navigator.clipboard.writeText(parts.join('\\n'));
    flash(document.querySelector('[onclick="copyAll()"]'));
  }

  function flash(el) {
    if (!el) return;
    const orig = el.textContent;
    el.textContent = 'Copied!';
    el.classList.add('copied');
    setTimeout(() => { el.textContent = orig; el.classList.remove('copied'); }, 1500);
  }

  // ── Recent Videos ────────────────────────────────────────────────────────────
  let _recentLoaded = false;
  async function toggleRecent() {
    const panel = document.getElementById('recent-panel');
    const visible = panel.style.display === 'block';
    panel.style.display = visible ? 'none' : 'block';
    if (!_recentLoaded && !visible) {
      _recentLoaded = true;
      const res = await fetch('/api/recent-videos');
      const d = await res.json();
      if (d.videos && d.videos.length) {
        panel.innerHTML = d.videos.map(v => `
          <div class="recent-row" onclick="selectVideo('${esc(v.url)}')">
            <span>${esc(v.title)}</span>
            <span class="recent-date">${v.upload_date || ''}</span>
          </div>`).join('');
      } else {
        panel.innerHTML = `<div style="padding:0.75rem 1rem;font-size:0.72rem;color:var(--text-4);">${d.note || 'No videos found'}</div>`;
      }
    }
  }

  function selectVideo(url) {
    document.getElementById('url-input').value = url;
    document.getElementById('recent-panel').style.display = 'none';
  }

  // ── UI Helpers ───────────────────────────────────────────────────────────────
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
  function esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Cost Display ─────────────────────────────────────────────────────────────
  async function loadCosts() {
    try {
      const res = await fetch('/api/costs');
      const d = await res.json();
      document.getElementById('cost-total').textContent = '$' + d.total_usd.toFixed(4);
      document.getElementById('cost-count').textContent = d.count;
      if (d.total_usd > 1.0) {
        document.getElementById('cost-total').classList.add('warn');
      }
    } catch(e) {}
  }

  function updateCostThis(cost_usd) {
    document.getElementById('cost-this').textContent = cost_usd != null ? '$' + cost_usd.toFixed(4) : '—';
  }

  // Enter key triggers generate
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('url-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') generate();
    });
    loadCosts();
  });
</script>
</body>
</html>"""


# ── Entry Point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    os.makedirs(os.path.join(os.path.dirname(__file__), "logs"), exist_ok=True)
    logger.info(f"Post Production Tool — http://localhost:{PORT}")
    logger.info(f"Anthropic key: {'set' if os.getenv('ANTHROPIC_API_KEY') else 'NOT SET'}")
    app.run(host="0.0.0.0", port=PORT, debug=False)
