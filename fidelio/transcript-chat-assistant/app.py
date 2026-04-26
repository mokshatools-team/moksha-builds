import base64
import json
import os
import re
import tempfile
import uuid
from datetime import datetime

from flask import Flask, Response, jsonify, redirect, render_template, request, session, url_for
from werkzeug.middleware.proxy_fix import ProxyFix

from transcript_fetcher import fetch_transcript_entries, fetch_youtube_title

try:
    from dotenv import load_dotenv
except ImportError:
    def load_dotenv():
        return False


load_dotenv()

app = Flask(__name__)
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "transcript-chat-local-dev-key-change-in-prod")
app.config["MAX_CONTENT_LENGTH"] = 4 * 1024 * 1024 * 1024

TEMP_DIR = tempfile.gettempdir()
SUPPORTED_EXTS = {".mp4", ".mov", ".mxf", ".avi"}
YOUTUBE_OAUTH_SCOPES = ["https://www.googleapis.com/auth/youtube.force-ssl"]


def _blank_state():
    return {
        "title": "",
        "source_label": "",
        "entries": [],
        "transcript_text": "",
        "messages": [],
    }


_active_state = _blank_state()


def reset_app_state():
    global _active_state
    _active_state = _blank_state()


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
        prefix="transcript-chat-google-client-secrets-",
        suffix=".json",
        delete=False,
        dir=TEMP_DIR,
    )
    tmp.write(payload)
    tmp.flush()
    tmp.close()
    return tmp.name


GOOGLE_CLIENT_SECRETS_PATH = _load_google_client_secrets_file()


def _sanitize_title(raw_title: str) -> str:
    return re.sub(r"\s+", " ", (raw_title or "").strip())


def _title_from_filename(filename: str) -> str:
    stem = os.path.splitext(os.path.basename(filename or ""))[0]
    stem = re.sub(r"[_-]+", " ", stem)
    return _sanitize_title(stem) or "Transcript Session"


def _slugify_filename(title: str) -> str:
    safe_title = re.sub(r"[^a-z0-9]+", "-", (title or "").strip().lower()).strip("-")
    return safe_title or "transcript"


def _build_transcript_text(entries):
    return " ".join((entry.get("text") or "").strip() for entry in entries if (entry.get("text") or "").strip())


def _set_active_state(title: str, source_label: str, entries):
    global _active_state
    _active_state = {
        "title": _sanitize_title(title) or "Transcript Session",
        "source_label": source_label,
        "entries": entries,
        "transcript_text": _build_transcript_text(entries),
        "messages": [],
    }
    return _active_state


def _download_payload(file_format: str):
    if not _active_state["transcript_text"]:
        return None

    if file_format == "txt":
        body = _active_state["transcript_text"]
        mimetype = "text/plain"
    elif file_format == "md":
        body = f"# {_active_state['title']}\n\n{_active_state['transcript_text']}\n"
        mimetype = "text/markdown"
    else:
        return None

    filename = f"{_slugify_filename(_active_state['title'])}-transcript.{file_format}"
    return body, mimetype, filename


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


def _extract_youtube_video_id(value: str) -> str:
    raw = (value or "").strip()
    if not raw:
        return ""

    match = re.fullmatch(r"[\w-]{6,}", raw)
    if match:
        return raw

    from urllib.parse import parse_qs, urlparse

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


def _fetch_youtube_video_title(service, video_id: str) -> str:
    try:
        response = service.videos().list(part="snippet", id=video_id).execute()
    except Exception:
        return ""

    items = response.get("items") or []
    if not items:
        return ""
    return (((items[0] or {}).get("snippet") or {}).get("title") or "").strip()


def _chat_with_transcript(transcript_text: str, prior_messages, user_message: str) -> str:
    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set.")

    try:
        import anthropic
    except ImportError as exc:
        raise RuntimeError("The Anthropic SDK is not installed.") from exc

    client = anthropic.Anthropic(api_key=api_key)
    prompt_messages = []
    for message in prior_messages:
        prompt_messages.append({"role": message["role"], "content": message["content"]})
    prompt_messages.append({"role": "user", "content": user_message})

    response = client.messages.create(
        model=os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6"),
        max_tokens=8000,
        system=(
            "You are a transcript research assistant helping a video editor study and "
            "analyze video transcripts. Ground your answers in the provided transcript — "
            "quote or paraphrase specific moments when relevant. You may reasonably "
            "interpret and summarize; don't be robotic about word-matching.\n\n"
            "Format every response in clean markdown. Use `##` and `###` headings for "
            "structure, `-` bullet lists for enumerations, `**bold**` for key terms, "
            "and blockquotes (`>`) for direct pulls from the transcript. Always finish "
            "your thought completely — never stop mid-outline or mid-sentence.\n\n"
            "If the transcript genuinely doesn't cover something the user asks about, "
            "say so plainly and suggest what related content the transcript does have.\n\n"
            f"Transcript:\n{transcript_text}"
        ),
        messages=prompt_messages,
    )

    parts = []
    for block in getattr(response, "content", []) or []:
        text = getattr(block, "text", "")
        if text:
            parts.append(text)
    reply = "\n".join(parts).strip()
    if not reply:
        raise RuntimeError("The assistant returned an empty reply.")
    return reply


@app.route("/")
def index():
    return render_template("index.html", state=_active_state)


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
        redirect_uri=url_for("auth_callback", _external=True),
    )
    authorization_url, state = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
    )
    session["google_oauth_state"] = state
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
        redirect_uri=url_for("auth_callback", _external=True),
    )

    try:
        flow.fetch_token(authorization_response=request.url)
    except Exception as exc:
        return jsonify({"error": f"Google OAuth callback failed: {exc}"}), 400

    session["google_credentials"] = _serialize_google_credentials(flow.credentials)
    session.pop("google_oauth_state", None)
    return redirect(url_for("index"))


@app.route("/auth/status")
def auth_status():
    return jsonify({"connected": bool(session.get("google_credentials"))})


@app.route("/auth/disconnect", methods=["POST"])
def auth_disconnect():
    session.pop("google_credentials", None)
    session.pop("google_oauth_state", None)
    return jsonify({"connected": False})


@app.route("/transcript/youtube-oauth", methods=["POST"])
def transcript_youtube_oauth():
    global _active_state

    if not session.get("google_credentials"):
        return jsonify({"error": "YouTube account not connected."}), 401

    data = request.get_json(force=True) or {}
    video_ref = data.get("video_id") or ""
    video_id = _extract_youtube_video_id(video_ref)
    if not video_id:
        return jsonify({"error": "Provide a valid YouTube video URL or video ID."}), 400

    title = ""
    try:
        service = _youtube_service_from_session()
        if service:
            title = _fetch_youtube_video_title(service, video_id)

        url = f"https://www.youtube.com/watch?v={video_id}"
        entries = fetch_transcript_entries(url, offset_seconds=0.0)

        state = _set_active_state(
            title=title or video_id,
            source_label=url,
            entries=entries,
        )
        return jsonify(state)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 500
    except Exception as exc:
        return jsonify({"error": f"Could not fetch YouTube transcript: {exc}"}), 500


@app.route("/transcribe", methods=["POST"])
def transcribe():
    global _active_state

    uploaded_file = request.files.get("file")
    if uploaded_file is not None:
        original_name = uploaded_file.filename or ""
        ext = os.path.splitext(original_name)[1].lower()
        if ext not in SUPPORTED_EXTS:
            return jsonify({"error": f"Unsupported file type: {ext}. Use mp4, mov, mxf, or avi."}), 400

        safe_name = f"{uuid.uuid4().hex}{ext}"
        full_path = os.path.join(TEMP_DIR, safe_name)
        uploaded_file.save(full_path)

        try:
            entries = fetch_transcript_entries(full_path, offset_seconds=0.0)
        except FileNotFoundError as exc:
            return jsonify({"error": str(exc)}), 400
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        except RuntimeError as exc:
            return jsonify({"error": str(exc)}), 500
        finally:
            if os.path.exists(full_path):
                os.unlink(full_path)

        state = _set_active_state(
            title=_title_from_filename(original_name),
            source_label=original_name,
            entries=entries,
        )
        return jsonify(state)

    data = request.get_json(force=True) or {}
    youtube_url = (data.get("youtube_url") or "").strip()
    if not youtube_url:
        return jsonify({"error": "Choose a file or paste a YouTube URL before fetching a transcript."}), 400

    try:
        entries = fetch_transcript_entries(youtube_url, offset_seconds=0.0)
        title = fetch_youtube_title(youtube_url) or _extract_youtube_video_id(youtube_url) or "YouTube Transcript"
        state = _set_active_state(title=title, source_label=youtube_url, entries=entries)
        return jsonify(state)
    except FileNotFoundError as exc:
        return jsonify({"error": str(exc)}), 400
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/chat", methods=["POST"])
def chat():
    global _active_state

    if not _active_state["transcript_text"]:
        return jsonify({"error": "Load a transcript before chatting."}), 400

    data = request.get_json(force=True) or {}
    user_message = (data.get("message") or "").strip()
    if not user_message:
        return jsonify({"error": "Enter a message before sending."}), 400

    prior_messages = list(_active_state["messages"])
    try:
        reply = _chat_with_transcript(
            transcript_text=_active_state["transcript_text"],
            prior_messages=prior_messages,
            user_message=user_message,
        )
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 500

    _active_state["messages"] = prior_messages + [
        {"role": "user", "content": user_message},
        {"role": "assistant", "content": reply},
    ]
    return jsonify({"reply": reply, "messages": _active_state["messages"]})


@app.route("/download/transcript.<file_format>")
def download_transcript(file_format: str):
    payload = _download_payload(file_format)
    if payload is None:
        return Response(status=404)

    body, mimetype, filename = payload
    return Response(
        body,
        mimetype=mimetype,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5055)), debug=True)
