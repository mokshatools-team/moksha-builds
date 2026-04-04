import os
import re
import json
import math
import base64
import tempfile
import uuid
from datetime import datetime
from urllib.parse import parse_qs, urlparse

from flask import Flask, request, jsonify, render_template, send_file, redirect, session, url_for
from werkzeug.middleware.proxy_fix import ProxyFix
import anthropic
from dotenv import load_dotenv

from transcript_fetcher import fetch_transcript_entries

load_dotenv()

app = Flask(__name__)
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "toa-local-dev-key-change-in-prod")
app.config['MAX_CONTENT_LENGTH'] = 4 * 1024 * 1024 * 1024  # 4 GB max upload

WATCH_FOLDER_PATH = os.environ.get("WATCH_FOLDER_PATH", "").strip()
SUPPORTED_EXTS    = {".mp4", ".mov", ".mxf", ".avi"}
YOUTUBE_OAUTH_SCOPES = [
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/youtube.force-ssl",
]

# Temp dir for uploaded files (Railway mode) or ffmpeg-extracted audio
TEMP_DIR = tempfile.gettempdir()


def _load_google_client_secrets_file():
    direct_path = os.environ.get("GOOGLE_CLIENT_SECRETS_FILE", "").strip()
    if direct_path:
        return direct_path if os.path.isfile(direct_path) else None

    encoded = os.environ.get("GOOGLE_CLIENT_SECRETS", "").strip()
    if not encoded:
        return None

    try:
        payload = base64.b64decode(encoded)
        json.loads(payload.decode("utf-8"))
    except Exception:
        return None

    tmp = tempfile.NamedTemporaryFile(
        prefix="toa-google-client-secrets-",
        suffix=".json",
        delete=False,
        dir=TEMP_DIR,
    )
    tmp.write(payload)
    tmp.flush()
    tmp.close()
    return tmp.name


GOOGLE_CLIENT_SECRETS_PATH = _load_google_client_secrets_file()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def seconds_to_timestamp(seconds: float) -> str:
    minutes = int(seconds // 60)
    secs    = int(seconds % 60)
    return f"{minutes}:{secs:02d}"


def parse_offset(offset_str: str) -> float:
    """Parse 'HH:MM:SS' or 'H:MM:SS' to float seconds. Returns 0.0 on failure."""
    if not offset_str:
        return 0.0
    m = re.match(r"^(\d{1,2}):(\d{2}):(\d{2})$", offset_str.strip())
    if m:
        h, mn, s = int(m.group(1)), int(m.group(2)), int(m.group(3))
        return float(h * 3600 + mn * 60 + s)
    return 0.0


def detect_offset_from_filename(filename: str) -> float:
    """Detect timecode from filename patterns like '01h23m45s'. Returns 0.0 if not found."""
    m = re.search(r"(\d{1,2})h(\d{2})m(\d{2})s", filename, re.IGNORECASE)
    if m:
        h, mn, s = int(m.group(1)), int(m.group(2)), int(m.group(3))
        return float(h * 3600 + mn * 60 + s)
    return 0.0


def target_overlay_range(duration_seconds: float):
    minutes = duration_seconds / 60
    base    = (minutes / 3) * 22
    lo      = max(12, math.floor(base * 0.8))
    hi      = min(60, math.ceil(base * 1.2))
    return lo, hi


def _iso8601_seconds(duration: str) -> int:
    match = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", (duration or "").strip())
    if not match:
        return 0
    hours = int(match.group(1) or 0)
    minutes = int(match.group(2) or 0)
    seconds = int(match.group(3) or 0)
    return hours * 3600 + minutes * 60 + seconds


def extract_youtube_video_id(value: str) -> str:
    raw = (value or "").strip()
    if not raw:
        return ""

    if re.fullmatch(r"[\w-]{6,}", raw):
        return raw

    try:
        parsed = urlparse(raw)
    except ValueError:
        return ""

    host = (parsed.netloc or "").lower()
    if host.startswith("www."):
        host = host[4:]

    if host == "youtu.be":
        return parsed.path.strip("/").split("/")[0]
    if host in {"youtube.com", "m.youtube.com"}:
        if parsed.path == "/watch":
            return (parse_qs(parsed.query).get("v") or [""])[0]
        if parsed.path.startswith(("/shorts/", "/embed/")):
            parts = parsed.path.strip("/").split("/")
            return parts[1] if len(parts) > 1 else ""
    return ""


def _import_google_oauth():
    try:
        from google_auth_oauthlib.flow import Flow
        from google.oauth2.credentials import Credentials
        from google.auth.transport.requests import Request as GoogleRequest
        from googleapiclient.discovery import build
        return Flow, Credentials, GoogleRequest, build
    except ImportError as exc:
        raise RuntimeError("Google OAuth dependencies are not installed.") from exc


def _require_google_client_secrets():
    if not GOOGLE_CLIENT_SECRETS_PATH:
        raise RuntimeError(
            "Google OAuth is not configured. Set GOOGLE_CLIENT_SECRETS or GOOGLE_CLIENT_SECRETS_FILE."
        )
    return GOOGLE_CLIENT_SECRETS_PATH


def _google_oauth_redirect_uri(client_secrets_path: str) -> str:
    configured_redirect = os.environ.get("GOOGLE_OAUTH_REDIRECT_URI", "").strip()
    if configured_redirect:
        return configured_redirect

    try:
        with open(client_secrets_path, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, ValueError, TypeError):
        payload = {}

    web_config = payload.get("web") if isinstance(payload, dict) else None
    redirect_uris = web_config.get("redirect_uris") if isinstance(web_config, dict) else None
    if isinstance(redirect_uris, list):
        for uri in redirect_uris:
            if isinstance(uri, str) and uri.strip():
                return uri.strip()

    return url_for("auth_callback", _external=True)


def _serialize_google_credentials(creds):
    expiry = getattr(creds, "expiry", None)
    return {
        "token": creds.token,
        "refresh_token": creds.refresh_token,
        "token_uri": creds.token_uri,
        "client_id": creds.client_id,
        "client_secret": creds.client_secret,
        "scopes": list(creds.scopes or []),
        "expiry": expiry.isoformat() if expiry else None,
    }


def _google_credentials_from_session():
    stored = session.get("google_credentials")
    if not stored:
        return None

    _, Credentials, _, _ = _import_google_oauth()

    expiry = stored.get("expiry")
    if expiry:
        try:
            stored = dict(stored)
            stored["expiry"] = datetime.fromisoformat(expiry)
        except ValueError:
            stored = dict(stored)
            stored.pop("expiry", None)

    return Credentials(**stored)


def _refresh_google_credentials(creds):
    if not creds:
        return None

    _, _, GoogleRequest, _ = _import_google_oauth()
    if creds.expired and creds.refresh_token:
        creds.refresh(GoogleRequest())
        session["google_credentials"] = _serialize_google_credentials(creds)
    return creds


def _youtube_service_from_session():
    creds = _google_credentials_from_session()
    if not creds:
        return None

    creds = _refresh_google_credentials(creds)
    _, _, _, build = _import_google_oauth()
    return build("youtube", "v3", credentials=creds, cache_discovery=False)


def _fetch_youtube_video_title(service, video_id: str) -> str:
    try:
        response = service.videos().list(part="snippet", id=video_id).execute()
    except Exception:
        return ""

    items = response.get("items") or []
    if not items:
        return ""
    return (((items[0] or {}).get("snippet") or {}).get("title") or "").strip()


def _parse_caption_timestamp(value: str) -> float:
    match = re.match(r"^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$", value.strip())
    if not match:
        return 0.0
    hours = int(match.group(1))
    minutes = int(match.group(2))
    seconds = int(match.group(3))
    millis = int(match.group(4))
    return hours * 3600 + minutes * 60 + seconds + (millis / 1000.0)


def _caption_text_to_entries(caption_text: str):
    entries = []
    blocks = re.split(r"\n\s*\n", (caption_text or "").strip())
    for block in blocks:
        lines = [line.strip() for line in block.splitlines() if line.strip()]
        if len(lines) < 2:
            continue

        timing_line = lines[1] if re.search(r"-->", lines[1]) else lines[0]
        if "-->" not in timing_line:
            continue

        start_raw = timing_line.split("-->", 1)[0].strip()
        text_lines = lines[2:] if timing_line == lines[1] else lines[1:]
        text = re.sub(r"<[^>]+>", "", " ".join(text_lines)).strip()
        if not text:
            continue

        entries.append({
            "time": seconds_to_timestamp(_parse_caption_timestamp(start_raw)),
            "text": text,
        })

    return entries


def _fetch_caption_entries_via_oauth(service, video_id: str):
    captions = service.captions().list(part="id,snippet", videoId=video_id).execute()
    items = captions.get("items") or []
    if not items:
        raise ValueError("No YouTube captions are available for this video.")

    def caption_rank(item):
        snippet = item.get("snippet") or {}
        return (
            1 if snippet.get("trackKind") == "standard" else 0,
            1 if not snippet.get("isDraft") else 0,
        )

    best = sorted(items, key=caption_rank, reverse=True)[0]
    payload = service.captions().download(id=best["id"], tfmt="srt").execute()
    caption_text = payload.decode("utf-8", errors="ignore") if isinstance(payload, bytes) else str(payload)
    entries = _caption_text_to_entries(caption_text)
    if not entries:
        raise ValueError("YouTube captions were found but could not be parsed.")
    return entries


def _normalize_transcript_segments(raw_segments):
    entries = []
    for segment in raw_segments or []:
        if isinstance(segment, dict):
            start = float(segment.get("start", 0))
            text = str(segment.get("text", "")).strip()
        else:
            start = float(getattr(segment, "start", 0))
            text = str(getattr(segment, "text", "")).strip()
        if text:
            entries.append({"time": seconds_to_timestamp(start), "text": text})
    return entries


def _fetch_transcript_entries_via_youtube_transcript_api(video_id: str):
    try:
        import youtube_transcript_api as yta
    except ImportError as exc:
        raise RuntimeError("youtube_transcript_api is not installed.") from exc

    api_cls = getattr(yta, "YouTubeTranscriptApi", None)
    if api_cls is None:
        raise RuntimeError("youtube_transcript_api is unavailable.")

    if hasattr(api_cls, "get_transcript"):
        return _normalize_transcript_segments(api_cls.get_transcript(video_id))

    api = api_cls()
    if hasattr(api, "fetch"):
        result = api.fetch(video_id)
        if hasattr(result, "to_raw_data"):
            return _normalize_transcript_segments(result.to_raw_data())
        return _normalize_transcript_segments(result)
    if hasattr(api, "get_transcript"):
        return _normalize_transcript_segments(api.get_transcript(video_id))

    raise RuntimeError("youtube_transcript_api does not expose a supported transcript method.")


@app.route("/api/mode")
def api_mode():
    mode = "local" if WATCH_FOLDER_PATH else "upload"
    return jsonify({"mode": mode})


# ---------------------------------------------------------------------------
# Routes — YouTube OAuth
# ---------------------------------------------------------------------------

@app.route("/auth/youtube")
def auth_youtube():
    try:
        client_secrets = _require_google_client_secrets()
        Flow, _, _, _ = _import_google_oauth()
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 500

    flow = Flow.from_client_secrets_file(
        client_secrets,
        scopes=YOUTUBE_OAUTH_SCOPES,
        redirect_uri=_google_oauth_redirect_uri(client_secrets),
    )
    authorization_url, state = flow.authorization_url(
        access_type="offline",
        prompt="consent",
    )
    session["google_oauth_state"] = state
    code_verifier = getattr(flow, "code_verifier", None)
    if code_verifier:
        session["google_oauth_code_verifier"] = code_verifier
    return redirect(authorization_url)


@app.route("/auth/callback")
def auth_callback():
    try:
        client_secrets = _require_google_client_secrets()
        Flow, _, _, _ = _import_google_oauth()
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 500

    flow = Flow.from_client_secrets_file(
        client_secrets,
        scopes=YOUTUBE_OAUTH_SCOPES,
        state=session.get("google_oauth_state"),
        redirect_uri=_google_oauth_redirect_uri(client_secrets),
    )
    code_verifier = session.get("google_oauth_code_verifier")
    if code_verifier:
        flow.code_verifier = code_verifier

    try:
        flow.fetch_token(authorization_response=request.url)
    except Exception as exc:
        return jsonify({"error": f"Google OAuth callback failed: {exc}"}), 400

    session["google_credentials"] = _serialize_google_credentials(flow.credentials)
    session.pop("google_oauth_state", None)
    session.pop("google_oauth_code_verifier", None)
    return redirect(url_for("index"))


@app.route("/auth/status")
def auth_status():
    return jsonify({"connected": bool(session.get("google_credentials"))})


@app.route("/auth/disconnect", methods=["POST"])
def auth_disconnect():
    session.pop("google_credentials", None)
    session.pop("google_oauth_state", None)
    session.pop("google_oauth_code_verifier", None)
    return jsonify({"connected": False})


@app.route("/api/videos")
def api_videos():
    service = _youtube_service_from_session()
    if not service:
        return jsonify({"authenticated": False}), 401

    try:
        channel_response = service.channels().list(
            part="contentDetails",
            mine=True,
        ).execute()
        items = channel_response.get("items") or []
        if not items:
            return jsonify({"error": "No YouTube channel found for this account."}), 404

        uploads_id = (((items[0] or {}).get("contentDetails") or {}).get("relatedPlaylists") or {}).get("uploads")
        if not uploads_id:
            return jsonify({"error": "No uploads playlist found for this account."}), 404

        playlist_response = service.playlistItems().list(
            part="snippet,status",
            playlistId=uploads_id,
            maxResults=25,
        ).execute()

        candidate_ids = []
        meta_by_id = {}
        for item in playlist_response.get("items") or []:
            snippet = (item or {}).get("snippet") or {}
            status = (item or {}).get("status") or {}
            resource = snippet.get("resourceId") or {}
            video_id = (resource.get("videoId") or "").strip()
            privacy_status = (status.get("privacyStatus") or "").strip()
            if not video_id or privacy_status not in {"public", "unlisted"}:
                continue

            candidate_ids.append(video_id)
            thumbs = snippet.get("thumbnails") or {}
            meta_by_id[video_id] = {
                "title": snippet.get("title") or video_id,
                "thumbnail": (thumbs.get("medium") or thumbs.get("default") or {}).get("url", ""),
                "publishedAt": snippet.get("publishedAt", ""),
                "privacyStatus": privacy_status,
            }

        if not candidate_ids:
            return jsonify({"authenticated": True, "videos": []})

        duration_response = service.videos().list(
            part="contentDetails",
            id=",".join(candidate_ids),
        ).execute()
        durations = {}
        for item in duration_response.get("items") or []:
            durations[item.get("id")] = _iso8601_seconds(((item.get("contentDetails") or {}).get("duration", "")))

        videos = []
        for video_id in candidate_ids:
            if durations.get(video_id, 0) <= 180:
                continue
            videos.append({"videoId": video_id, **meta_by_id[video_id]})
            if len(videos) == 10:
                break

        return jsonify({"authenticated": True, "videos": videos})
    except Exception as exc:
        session.pop("google_credentials", None)
        return jsonify({"authenticated": False, "error": str(exc)}), 401


# ---------------------------------------------------------------------------
# Routes — file listing (local mode)
# ---------------------------------------------------------------------------

@app.route("/api/files")
def api_files():
    if not WATCH_FOLDER_PATH:
        return jsonify({"files": [], "watch_folder": "", "error": "WATCH_FOLDER_PATH is not set."})

    if not os.path.isdir(WATCH_FOLDER_PATH):
        return jsonify({
            "files": [],
            "watch_folder": WATCH_FOLDER_PATH,
            "error": f"Watch folder not found: {WATCH_FOLDER_PATH}",
        })

    entries = []
    for name in os.listdir(WATCH_FOLDER_PATH):
        ext = os.path.splitext(name)[1].lower()
        if ext in SUPPORTED_EXTS:
            full = os.path.join(WATCH_FOLDER_PATH, name)
            entries.append((os.path.getmtime(full), name))

    entries.sort(reverse=True)
    return jsonify({
        "files":        [e[1] for e in entries],
        "watch_folder": WATCH_FOLDER_PATH,
    })


# ---------------------------------------------------------------------------
# Routes — file upload (Railway mode)
# ---------------------------------------------------------------------------

@app.route("/upload", methods=["POST"])
def upload_file():
    if "file" not in request.files:
        return jsonify({"error": "No file provided."}), 400

    f    = request.files["file"]
    name = f.filename or ""
    ext  = os.path.splitext(name)[1].lower()
    if ext not in SUPPORTED_EXTS:
        return jsonify({"error": f"Unsupported file type: {ext}. Use mp4, mov, mxf, or avi."}), 400

    safe_name = f"{uuid.uuid4().hex}{ext}"
    dest      = os.path.join(TEMP_DIR, safe_name)
    f.save(dest)

    return jsonify({"temp_filename": safe_name, "original_name": name})


# ---------------------------------------------------------------------------
# Routes — transcription
# ---------------------------------------------------------------------------

@app.route("/transcript/youtube-oauth", methods=["POST"])
def transcript_youtube_oauth():
    if not session.get("google_credentials"):
        return jsonify({"error": "YouTube account not connected."}), 401

    data = request.get_json(force=True) or {}
    video_id = extract_youtube_video_id(data.get("video_id") or "")
    if not video_id:
        return jsonify({"error": "Provide a valid YouTube video URL or video ID."}), 400

    title = ""

    try:
        service = _youtube_service_from_session()
        if service:
            title = _fetch_youtube_video_title(service, video_id)
            try:
                entries = _fetch_caption_entries_via_oauth(service, video_id)
                return jsonify({"entries": entries, "title": title or video_id})
            except Exception:
                pass

        try:
            entries = _fetch_transcript_entries_via_youtube_transcript_api(video_id)
            return jsonify({"entries": entries, "title": title or video_id})
        except Exception:
            pass

        url = f"https://www.youtube.com/watch?v={video_id}"
        entries = fetch_transcript_entries(url, offset_seconds=0.0)
        return jsonify({"entries": entries, "title": title or video_id})
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 500
    except Exception as exc:
        return jsonify({"error": f"Could not fetch YouTube transcript: {exc}"}), 500


@app.route("/transcribe", methods=["POST"])
def transcribe():
    data        = request.get_json(force=True) or {}
    filename    = (data.get("filename") or "").strip()
    youtube_url = (data.get("youtube_url") or "").strip()
    offset_s    = (data.get("offset_str") or "").strip()

    if filename and youtube_url:
        return jsonify({"error": "Choose either a file or a YouTube URL, not both."}), 400
    if not filename and not youtube_url:
        return jsonify({"error": "Choose a file or paste a YouTube URL before analyzing."}), 400

    # Resolve file path — watch folder OR temp dir (upload mode)
    source = youtube_url
    full_path = None
    if filename:
        if WATCH_FOLDER_PATH:
            full_path = os.path.realpath(os.path.join(WATCH_FOLDER_PATH, filename))
            # Path traversal guard
            if not full_path.startswith(os.path.realpath(WATCH_FOLDER_PATH)):
                return jsonify({"error": "Invalid filename."}), 400
        else:
            full_path = os.path.join(TEMP_DIR, filename)

        if not os.path.isfile(full_path):
            return jsonify({"error": f"File not found: {filename}"}), 400

        source = full_path

    # Determine offset
    offset = parse_offset(offset_s)
    if offset == 0.0 and filename:
        offset = detect_offset_from_filename(filename)

    try:
        entries = fetch_transcript_entries(source, offset_seconds=offset)
    except FileNotFoundError as exc:
        return jsonify({"error": str(exc)}), 400
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 500
    finally:
        # Clean up uploaded temp file after transcription (upload mode only)
        if full_path and not WATCH_FOLDER_PATH and os.path.exists(full_path):
            os.unlink(full_path)

    return jsonify({"entries": entries, "offset_applied": offset})


# ---------------------------------------------------------------------------
# Routes — Claude analysis
# ---------------------------------------------------------------------------

@app.route("/analyze", methods=["POST"])
def analyze():
    data    = request.get_json(force=True) or {}
    project = (data.get("project") or "").strip()
    entries = data.get("entries") or []

    if not project:
        return jsonify({"error": "Please enter a project name."}), 400
    if not entries:
        return jsonify({"error": "No transcript entries provided."}), 400

    # Format transcript for Claude
    lines = []
    for entry in entries:
        ts   = entry.get("time", "0:00")
        text = entry.get("text", "").replace("\n", " ").strip()
        lines.append(f"[{ts}] {text}")

    transcript_text = "\n".join(lines)

    # Estimate duration from last timestamp
    def ts_to_secs(ts: str) -> float:
        parts = ts.split(":")
        try:
            if len(parts) == 2:
                return int(parts[0]) * 60 + float(parts[1])
            elif len(parts) == 3:
                return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
        except ValueError:
            pass
        return 0.0

    duration_secs = ts_to_secs(entries[-1].get("time", "0:00"))
    duration_min  = duration_secs / 60

    density = int(data.get("density", 1))
    lo, hi  = target_overlay_range(duration_secs)

    density_scales = {0: 0.4, 1: 1.0, 2: 1.4, 3: 2.0}
    scale = density_scales.get(density, 1.0)
    lo    = max(3,  math.floor(lo * scale))
    hi    = min(80, math.ceil(hi  * scale))

    density_instructions = {
        0: (
            "DENSITY MODE: MINIMAL\n"
            "• Use CHAPTER overlays only (3–6 total) to mark major section transitions\n"
            "• Add a LIST overlay ONLY when the speaker explicitly rattles off 3+ items (0–2 max)\n"
            "• Do NOT use KEYWORD overlays at all\n"
            "• Be highly selective — only the most essential structural markers"
        ),
        1: (
            "DENSITY MODE: BALANCED\n"
            "• Use all three types at natural density\n"
            "• CHAPTER: 3–6 per video for major shifts\n"
            "• LIST: only for clear rapid enumerations\n"
            "• KEYWORD: tips, warnings, and the most memorable phrases only"
        ),
        2: (
            "DENSITY MODE: DETAILED\n"
            "• Use all three types generously\n"
            "• CHAPTER: mark every meaningful topic shift\n"
            "• LIST: any enumeration of 2+ items qualifies\n"
            "• KEYWORD: highlight key terms, statistics, actionable advice, and important facts\n"
            "• Err toward more coverage rather than less"
        ),
        3: (
            "DENSITY MODE: MAXIMUM\n"
            "• Use all three types at maximum density\n"
            "• CHAPTER: mark every topic shift, even minor ones\n"
            "• LIST: any grouping of 2+ items\n"
            "• KEYWORD: anything notable — terms, names, numbers, tips, warnings, conclusions\n"
            "• Produce the richest, most fully annotated output possible"
        ),
    }
    density_note = density_instructions.get(density, density_instructions[1])

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return jsonify({"error": "ANTHROPIC_API_KEY is not set. Add it to .env and restart."}), 500

    client = anthropic.Anthropic(api_key=api_key)

    prompt = f"""You are a professional video editor's assistant. Your job is to watch a transcript and recommend which moments to highlight on screen using text overlays — so viewers can follow along, remember key information, and understand the structure of the video.

Video duration: {duration_min:.1f} minutes
Target highlight count: {lo}–{hi} text highlights total

{density_note}

────────────────────────────────────────
YOUR TASK
────────────────────────────────────────

Return a JSON object with three fields: "summary", "strategy", and "overlays".

1. "summary"
   2–3 sentences. What this video covers, who presents it (if clear from context),
   and the main takeaway a viewer walks away with.

2. "strategy"
   2–3 sentences. Explain how you read the structure of this video, what types of
   moments you chose to highlight, and what you want viewers to notice or retain.
   Be specific — name the sections or themes you identified.

3. "overlays"
   Array of highlight objects, sorted chronologically. Each object has:
     "time"   — timestamp in M:SS format (from the transcript)
     "type"   — one of CHAPTER, LIST, or KEYWORD
     "text"   — the overlay text (see rules below)
     "reason" — 1 sentence explaining why this specific moment is worth highlighting
     "quote"  — the verbatim sentence(s) from the transcript where this moment occurs (1–2 sentences max)

────────────────────────────────────────
HIGHLIGHT TYPES
────────────────────────────────────────

CHAPTER
• Marks a major section transition — a new topic, phase, or step is beginning
• Use 3–6 per video regardless of length
• Title-case, 2–5 words (e.g. "Surface Preparation", "Final Assembly")
• Place at the exact moment the new section starts, not before

LIST
• Highlights a quick enumeration of items the speaker rattles off:
  tools, materials, ingredients, options, steps listed in one breath
• Only use when the speaker actually lists 2+ items in rapid sequence
• Do NOT use for topics that each get their own extended explanation — those get CHAPTER
• Join all items with " / " (e.g. "TSP Cleaner / Spackling Compound / 120-grit Sandpaper")

KEYWORD
• Highlights a short phrase that is important, actionable, or memorable
• 2–6 words, exact or near-exact from the transcript
• Pick warnings, tips, strong advice, or anything the viewer should retain
• These display in italic on screen

────────────────────────────────────────
OUTPUT FORMAT
────────────────────────────────────────
Return ONLY valid JSON — no markdown, no code fences, no explanation before or after.

{{
  "summary": "In this video, ...",
  "strategy": "The video divides into ... I highlighted ...",
  "overlays": [
    {{
      "time": "0:15",
      "type": "CHAPTER",
      "text": "Surface Preparation",
      "reason": "Opens the first major workflow phase.",
      "quote": "Okay so before we do anything else we need to prep the surface properly."
    }}
  ]
}}

────────────────────────────────────────
TRANSCRIPT
────────────────────────────────────────
{transcript_text}"""

    try:
        message = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=8192,
            messages=[{"role": "user", "content": prompt}],
        )
    except anthropic.AuthenticationError:
        return jsonify({"error": "Invalid ANTHROPIC_API_KEY. Check your key and try again."}), 500
    except anthropic.RateLimitError:
        return jsonify({"error": "Claude API rate limit hit. Wait a moment and try again."}), 429
    except Exception as e:
        return jsonify({"error": f"Claude API error: {e}"}), 500

    raw = message.content[0].text.strip()

    json_match = re.search(r"\{[\s\S]*\}", raw)
    if not json_match:
        return jsonify({"error": f"Claude returned an unexpected format. Raw: {raw[:200]}"}), 500
    try:
        result = json.loads(json_match.group())
        if not isinstance(result, dict):
            raise ValueError("Expected a JSON object")
    except (json.JSONDecodeError, ValueError):
        return jsonify({"error": f"Could not parse Claude's response as JSON. Raw: {raw[:200]}"}), 500

    overlays = result.get("overlays", [])
    if not isinstance(overlays, list):
        overlays = []

    return jsonify({
        "project":  project,
        "summary":  result.get("summary", ""),
        "strategy": result.get("strategy", ""),
        "overlays": overlays,
    })


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/download/script")
def download_script():
    script_path = os.path.join(os.path.dirname(__file__), "place_overlays.py")
    return send_file(script_path, as_attachment=True, download_name="place_overlays.py")


if __name__ == "__main__":
    port  = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_ENV", "development") != "production"
    app.run(host="0.0.0.0", port=port, debug=debug)
