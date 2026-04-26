"""
FDL1 Publishing Pipeline — Railway Service.
Two endpoints:
  POST /webhook/pipeline  — watcher sends file detection, runs full pipeline
  POST /webhook/publer    — Publer sends publish status, updates Sheet
"""

import os
import sys
import logging
import threading
from datetime import datetime
from flask import Flask, request, jsonify

# Add scripts to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "scripts"))

from config_loader import load_config, get_platforms_for_format, get_sheet_columns
from youtube_upload import upload_to_youtube
from whisper_transcribe import transcribe
from sheets_write import create_row, update_cells, find_row_by_field

app = Flask(__name__)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s"
)
logger = logging.getLogger("fdl1")

WEBHOOK_SECRET = os.environ.get("WEBHOOK_RECEIVER_SECRET", "mock-secret")
MOCK_MODE = os.environ.get("FDL1_MOCK_MODE", "true").lower() == "true"


# ── Helpers ──────────────────────────────────────────────────────────

def generate_captions(asset_id, content_type, topic_slug, transcript, platforms, language, config):
    """Generate platform-specific captions via Claude API."""
    if MOCK_MODE:
        logger.info(f"[MOCK CLAUDE] Generating captions for {asset_id}")
        captions = {}
        for p in platforms:
            captions[p] = (
                f"[MOCK CAPTION — {p}] {topic_slug} | "
                f"Contenu: {content_type} | ID: {asset_id} | Langue: {language}"
            )
        return captions

    # Real Claude API call — will be implemented at go-live
    raise NotImplementedError("Real Claude API not yet implemented. Set FDL1_MOCK_MODE=true.")


def create_publer_draft(youtube_url, platform_key, caption, account_id):
    """Create a draft post in Publer for one platform."""
    if MOCK_MODE:
        publer_id = f"MOCK_PUBLER_{platform_key.upper()}_{datetime.now().strftime('%H%M%S')}"
        logger.info(f"[MOCK PUBLER] Draft: {platform_key} → {publer_id}")
        return publer_id

    # Real Publer API call — will be implemented at go-live
    raise NotImplementedError("Real Publer API not yet implemented. Set FDL1_MOCK_MODE=true.")


# ── Pipeline ─────────────────────────────────────────────────────────

def run_short_form(payload, config):
    """Full short-form pipeline: YouTube → Whisper → Claude → Sheets → Publer."""
    asset_id = payload["asset_id"]
    topic_slug = payload["topic_slug"]
    content_type = payload["content_type"]
    session_id = payload["session_id"]
    file_path = payload["file_path"]

    folder_config = config["folders"]["short_form"]
    platforms = folder_config["platforms"]
    workbook_id = config["sheets"]["workbook_id"]
    tab_name = folder_config["tab"]
    columns = get_sheet_columns(config, "short_form")

    logger.info(f"=== SHORT-FORM START: {asset_id} ===")

    # 1. YouTube upload
    logger.info("Step 1/6: YouTube upload")
    youtube_url = upload_to_youtube(file_path, f"{asset_id} {topic_slug}", config=config)

    # 2. Transcribe
    logger.info("Step 2/6: Whisper transcription")
    try:
        transcript = transcribe(file_path, config["language"])
    except Exception as e:
        logger.error(f"Whisper failed: {e}. Using topic as fallback.")
        transcript = topic_slug

    # 3. Generate captions
    logger.info("Step 3/6: Claude caption generation")
    captions = generate_captions(
        asset_id, content_type, topic_slug,
        transcript, platforms, config["language"], config
    )

    # 4. Write Sheet row
    logger.info("Step 4/6: Write to Sheets")
    row_data = {
        "asset_id": asset_id,
        "filename": os.path.basename(file_path),
        "content_type": content_type,
        "session_id": session_id,
        "youtube_url": youtube_url,
        "created_date": datetime.now().isoformat(),
        "pipeline_status": "captions_ready",
    }
    for p in platforms:
        row_data[f"caption_{p}"] = captions.get(p, "")
    create_row(workbook_id, tab_name, columns, row_data)

    # 5. Create Publer drafts
    logger.info("Step 5/6: Create Publer drafts")
    publer_updates = {}
    for p in platforms:
        publer_id = create_publer_draft(
            youtube_url, p, captions.get(p, ""),
            config["platforms"][p]["publer_account_id"]
        )
        publer_updates[f"publer_id_{p}"] = publer_id

    # 6. Update Sheet with Publer IDs
    logger.info("Step 6/6: Update Sheet — drafted")
    publer_updates["pipeline_status"] = "drafted"
    update_cells(workbook_id, tab_name, asset_id, publer_updates)

    logger.info(f"=== SHORT-FORM COMPLETE: {asset_id} ===")


def run_long_form(payload, config):
    """Long-form stub: YouTube → Whisper → Sheets (pending_copy) → STOP."""
    asset_id = payload["asset_id"]
    topic_slug = payload["topic_slug"]
    content_type = payload["content_type"]
    session_id = payload["session_id"]
    file_path = payload["file_path"]

    folder_config = config["folders"]["long_form"]
    workbook_id = config["sheets"]["workbook_id"]
    tab_name = folder_config["tab"]
    columns = get_sheet_columns(config, "long_form")
    if "transcript" not in columns:
        columns.insert(columns.index("pipeline_status"), "transcript")

    logger.info(f"=== LONG-FORM START: {asset_id} ===")

    # 1. YouTube upload
    logger.info("Step 1/3: YouTube upload")
    youtube_url = upload_to_youtube(file_path, f"{asset_id} {topic_slug}", config=config)

    # 2. Transcribe
    logger.info("Step 2/3: Whisper transcription")
    try:
        transcript = transcribe(file_path, config["language"])
    except Exception as e:
        logger.error(f"Whisper failed: {e}. Continuing without transcript.")
        transcript = ""

    # 3. Write Sheet row — then STOP
    logger.info("Step 3/3: Write to Sheets — pending_copy")
    row_data = {
        "asset_id": asset_id,
        "filename": os.path.basename(file_path),
        "content_type": content_type,
        "session_id": session_id,
        "youtube_url": youtube_url,
        "created_date": datetime.now().isoformat(),
        "transcript": transcript,
        "pipeline_status": "pending_copy",
        "copy_ready": "FALSE",
    }
    create_row(workbook_id, tab_name, columns, row_data)

    logger.info(f"=== LONG-FORM STOPPED: {asset_id} — pending_copy ===")


# ── Endpoints ────────────────────────────────────────────────────────

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "fdl1-pipeline", "mock_mode": MOCK_MODE})


@app.route("/webhook/pipeline", methods=["POST"])
def pipeline_webhook():
    """
    Watcher sends file detection here. Runs full pipeline.

    Expected payload:
    {
        "asset_id": "PS14.1",
        "topic_slug": "test video court",
        "content_type": "Podcast Short",
        "session_id": "14",
        "file_path": "/path/to/file.mp4",
        "format": "short_form",
        "client_id": "dre-alexandra"
    }
    """
    auth = request.headers.get("X-Webhook-Secret", "")
    if auth != WEBHOOK_SECRET:
        return jsonify({"error": "unauthorized"}), 401

    data = request.get_json()
    if not data:
        return jsonify({"error": "no payload"}), 400

    required = ["asset_id", "topic_slug", "content_type", "session_id",
                "file_path", "format", "client_id"]
    missing = [f for f in required if f not in data]
    if missing:
        return jsonify({"error": f"missing fields: {missing}"}), 400

    client_id = data["client_id"]
    format_key = data["format"]

    try:
        config = load_config(client_id)
    except (FileNotFoundError, ValueError) as e:
        return jsonify({"error": f"config error: {e}"}), 400

    if format_key not in ("short_form", "long_form"):
        return jsonify({"error": f"unknown format: {format_key}"}), 400

    # Acknowledge immediately, run pipeline in background thread
    logger.info(f"Pipeline triggered: {data['asset_id']} ({format_key})")

    def run_in_background():
        try:
            if format_key == "short_form":
                run_short_form(data, config)
            else:
                run_long_form(data, config)
        except Exception as e:
            logger.error(f"Pipeline failed for {data['asset_id']}: {e}", exc_info=True)

    thread = threading.Thread(target=run_in_background, daemon=True)
    thread.start()

    return jsonify({"status": "accepted", "asset_id": data["asset_id"], "format": format_key})


@app.route("/webhook/publer", methods=["POST"])
def publer_webhook():
    """
    Publer sends publish status here. Updates Sheet row.

    Expected payload:
    {
        "publer_id": "...",
        "platform": "ig",
        "status": "published",
        "publish_timestamp": "2026-04-04T14:30:00Z",
        "client_id": "dre-alexandra"
    }
    """
    auth = request.headers.get("X-Webhook-Secret", "")
    if auth != WEBHOOK_SECRET:
        return jsonify({"error": "unauthorized"}), 401

    data = request.get_json()
    if not data:
        return jsonify({"error": "no payload"}), 400

    required = ["publer_id", "platform", "status", "client_id"]
    missing = [f for f in required if f not in data]
    if missing:
        return jsonify({"error": f"missing fields: {missing}"}), 400

    publer_id = data["publer_id"]
    platform = data["platform"]
    status = data["status"]
    publish_timestamp = data.get("publish_timestamp", datetime.now().isoformat())
    client_id = data["client_id"]

    logger.info(f"Publer webhook: {platform} — {status} — {publer_id}")

    try:
        config = load_config(client_id)
    except (FileNotFoundError, ValueError) as e:
        return jsonify({"error": f"config error: {e}"}), 400

    workbook_id = config["sheets"]["workbook_id"]

    for format_key, folder in config["folders"].items():
        tab_name = folder["tab"]
        publer_field = f"publer_id_{platform}"

        row = find_row_by_field(workbook_id, tab_name, publer_field, publer_id)
        if row:
            updates = {
                f"status_{platform}": status,
                f"date_{platform}": publish_timestamp,
            }

            # Check if all platforms are now published
            all_published = True
            for p in folder["platforms"]:
                if p == platform:
                    continue
                if row.get(f"status_{p}") != "published":
                    all_published = False
                    break

            if all_published and status == "published":
                updates["pipeline_status"] = "complete"

            asset_id = row.get("asset_id", publer_id)
            update_cells(workbook_id, tab_name, asset_id, updates)
            logger.info(f"Updated {asset_id}: {platform} = {status}")
            return jsonify({"status": "ok", "updated": True})

    logger.warning(f"No row found for publer_id={publer_id} on {platform}")
    return jsonify({"error": "row not found"}), 404


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
