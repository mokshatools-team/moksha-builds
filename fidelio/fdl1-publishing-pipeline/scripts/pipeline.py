"""
FDL1 Pipeline Orchestrator — mock mode.
Runs the full short-form and long-form pipelines locally for testing,
simulating what n8n would do in production.
"""

import os
import sys
import json
import logging
from datetime import datetime

sys.path.insert(0, os.path.dirname(__file__))

from config_loader import load_config, get_platforms_for_format, get_sheet_columns
from youtube_upload import upload_to_youtube
from whisper_transcribe import transcribe
from sheets_write import create_row, update_cells

logger = logging.getLogger("fdl1.pipeline")

MOCK_MODE = os.environ.get("FDL1_MOCK_MODE", "true").lower() == "true"


def generate_captions_mock(asset_id: str, content_type: str, topic_slug: str,
                           transcript: str, platforms: list, language: str) -> dict:
    """Mock Claude API caption generation. Returns a caption per platform."""
    logger.info(f"[MOCK CLAUDE] Generating captions for {asset_id}")
    logger.info(f"[MOCK CLAUDE] Model: claude-sonnet-4-20250514")
    logger.info(f"[MOCK CLAUDE] Platforms: {platforms}, Language: {language}")

    captions = {}
    for platform in platforms:
        captions[platform] = (
            f"[MOCK CAPTION — {platform}] {topic_slug} | "
            f"Contenu: {content_type} | ID: {asset_id} | "
            f"Langue: {language}"
        )
    return captions


def create_publer_draft_mock(youtube_url: str, platform_key: str,
                              caption: str, account_id: str) -> str:
    """Mock Publer draft creation. Returns a mock publer_id."""
    publer_id = f"MOCK_PUBLER_{platform_key.upper()}_{datetime.now().strftime('%H%M%S')}"
    logger.info(f"[MOCK PUBLER] Draft created for {platform_key}")
    logger.info(f"  URL: {youtube_url}")
    logger.info(f"  Account: {account_id}")
    logger.info(f"  Publer ID: {publer_id}")
    return publer_id


def run_short_form_pipeline(payload: dict, config: dict):
    """
    Execute the full short-form pipeline.
    This simulates what n8n would orchestrate in production.
    """
    asset_id = payload["asset_id"]
    topic_slug = payload["topic_slug"]
    content_type = payload["content_type"]
    session_id = payload["session_id"]
    file_path = payload["file_path"]
    client_id = payload["client_id"]
    format_key = "short_form"

    folder_config = config["folders"][format_key]
    platforms = folder_config["platforms"]
    workbook_id = config["sheets"]["workbook_id"]
    tab_name = folder_config["tab"]
    columns = get_sheet_columns(config, format_key)

    logger.info(f"=== SHORT-FORM PIPELINE START: {asset_id} ===")

    # Step 1: Upload to YouTube
    logger.info("Step 1: YouTube upload")
    youtube_url = upload_to_youtube(
        file_path,
        f"{asset_id} {topic_slug}",
        config=config
    )

    # Step 2: Transcribe
    logger.info("Step 2: Whisper transcription")
    try:
        transcript = transcribe(file_path, config["language"])
    except Exception as e:
        logger.error(f"Whisper failed: {e}. Continuing with topic as fallback.")
        transcript = topic_slug

    # Step 3: Generate captions via Claude
    logger.info("Step 3: Caption generation (Claude API)")
    captions = generate_captions_mock(
        asset_id, content_type, topic_slug,
        transcript, platforms, config["language"]
    )

    # Step 4: Write row to Sheet
    logger.info("Step 4: Write to Google Sheets")
    row_data = {
        "asset_id": asset_id,
        "filename": os.path.basename(file_path),
        "content_type": content_type,
        "session_id": session_id,
        "youtube_url": youtube_url,
        "created_date": datetime.now().isoformat(),
        "pipeline_status": "captions_ready",
    }

    # Add captions
    for platform in platforms:
        row_data[f"caption_{platform}"] = captions.get(platform, "")

    create_row(workbook_id, tab_name, columns, row_data)

    # Step 5: Create Publer drafts
    logger.info("Step 5: Create Publer drafts")
    publer_updates = {}
    for platform_key in platforms:
        platform_config = config["platforms"][platform_key]
        publer_id = create_publer_draft_mock(
            youtube_url,
            platform_key,
            captions.get(platform_key, ""),
            platform_config["publer_account_id"]
        )
        publer_updates[f"publer_id_{platform_key}"] = publer_id

    # Step 6: Update Sheet with Publer IDs and status
    logger.info("Step 6: Update Sheet with Publer IDs")
    publer_updates["pipeline_status"] = "drafted"
    update_cells(workbook_id, tab_name, asset_id, publer_updates)

    logger.info(f"=== SHORT-FORM PIPELINE COMPLETE: {asset_id} ===")
    return True


def run_long_form_pipeline(payload: dict, config: dict):
    """
    Execute the long-form pipeline (stub — stops at pending_copy).
    """
    asset_id = payload["asset_id"]
    topic_slug = payload["topic_slug"]
    content_type = payload["content_type"]
    session_id = payload["session_id"]
    file_path = payload["file_path"]
    format_key = "long_form"

    folder_config = config["folders"][format_key]
    workbook_id = config["sheets"]["workbook_id"]
    tab_name = folder_config["tab"]
    columns = get_sheet_columns(config, format_key)

    # Add transcript column for long form
    if "transcript" not in columns:
        columns.insert(columns.index("pipeline_status"), "transcript")

    logger.info(f"=== LONG-FORM PIPELINE START: {asset_id} ===")

    # Step 1: Upload to YouTube
    logger.info("Step 1: YouTube upload")
    youtube_url = upload_to_youtube(
        file_path,
        f"{asset_id} {topic_slug}",
        config=config
    )

    # Step 2: Transcribe
    logger.info("Step 2: Whisper transcription")
    try:
        transcript = transcribe(file_path, config["language"])
    except Exception as e:
        logger.error(f"Whisper failed: {e}. Continuing without transcript.")
        transcript = ""

    # Step 3: Write row to Sheet — then STOP
    logger.info("Step 3: Write to Google Sheets (pending_copy — pipeline stops here)")
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

    logger.info(f"=== LONG-FORM PIPELINE STOPPED: {asset_id} — pending_copy ===")
    logger.info("FDL3 will pick up pending_copy rows later.")
    return True


def run_pipeline(payload: dict, config: dict):
    """Route to short-form or long-form pipeline based on payload format."""
    format_key = payload["format"]
    if format_key == "short_form":
        return run_short_form_pipeline(payload, config)
    elif format_key == "long_form":
        return run_long_form_pipeline(payload, config)
    else:
        logger.error(f"Unknown format: {format_key}")
        return False


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s"
    )

    # Test short-form pipeline
    config = load_config("dre-alexandra")
    payload = {
        "asset_id": "PS14.1",
        "topic_slug": "test video court",
        "content_type": "Podcast Short",
        "session_id": "14",
        "file_path": "./test-drop/dre-alexandra/short-form/PS14.1 test video court.mp4",
        "format": "short_form",
        "client_id": "dre-alexandra",
    }
    run_pipeline(payload, config)
