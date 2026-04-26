"""
Fidelio Pipeline — Pass 1 Orchestrator
Fires when raw footage drops in the ingest folder.
Steps: ffprobe → Whisper → Sheets write → Resolve setup
"""
import logging
from datetime import datetime
from pathlib import Path

log = logging.getLogger("fidelio.pass1")


def run_pass1(clip_path: Path, client: dict, cache_dir: Path):
    """Full Pass 1 pipeline for a single raw clip."""
    from local.monitor import emit_progress
    from local.ingest.ffprobe import extract_metadata
    from local.ingest.transcribe import transcribe, transcript_summary, marker_text
    from local.ingest.resolve import setup_project, add_clip_markers
    from local.sheets.connector import append_row, update_cell, find_row

    sheets_id = client["sheets_id"]
    language = client.get("language")
    stem = clip_path.stem

    log.info(f"[Pass 1] {clip_path.name} — starting")

    try:
        # ── Step 1: ffprobe metadata ──────────────────────────────
        log.info(f"[Pass 1] Extracting metadata...")
        meta = extract_metadata(clip_path)
        shoot_date = meta.get("shoot_date", datetime.now().strftime("%b %-d, %Y"))

        # ── Step 2: Whisper transcription ─────────────────────────
        emit_progress(stem, "Transcribing", stage_num=1, total=4)
        log.info(f"[Pass 1] Transcribing...")
        transcript = transcribe(clip_path, cache_dir, pass_num=1, language=language)
        summary = transcript_summary(transcript, max_chars=200)
        marker = marker_text(transcript, max_chars=100)

        # ── Step 3: Sheets write-back ─────────────────────────────
        emit_progress(stem, "Writing to Sheets", stage_num=2, total=4)
        log.info(f"[Pass 1] Writing to Sheets...")

        # Clip Index tab — one row per clip
        clip_row = {
            "Clip Name": clip_path.name,
            "Duration": meta.get("duration_formatted", ""),
            "Shoot Date": shoot_date,
            "FPS": meta.get("fps", ""),
            "Resolution": meta.get("resolution", ""),
            "Status": "Transcribed",
            "Processed Date": datetime.now().strftime("%b %-d, %Y"),
        }
        append_row(sheets_id, "Clip Index", clip_row)

        # Transcripts tab — full readable text
        transcript_row = {
            "Clip Name": clip_path.name,
            "Full Transcript": transcript.get("text", ""),
            "Processed Date": datetime.now().strftime("%b %-d, %Y"),
        }
        append_row(sheets_id, "Transcripts", transcript_row)

        log.info(f"[Pass 1] Sheets updated")

        # ── Step 4: Resolve setup ─────────────────────────────
        emit_progress(stem, "Resolve Import", stage_num=3, total=4)
        log.info(f"[Pass 1] Setting up Resolve...")
        project_name = client.get("display_name", client["client_id"])

        success = setup_project(
            clip_paths=[clip_path],
            shoot_date=shoot_date,
            project_name=project_name,
        )

        if success:
            add_clip_markers(
                clip_paths=[clip_path],
                transcripts={clip_path.stem: marker},
            )

        emit_progress(stem, "Done", status="done", stage_num=4, total=4)
        log.info(f"[Pass 1] Complete: {clip_path.name}")
    except Exception as e:
        emit_progress(stem, f"Error: {e}", status="error", stage_num=0, total=4)
        raise
