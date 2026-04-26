"""
Fidelio Pipeline — Pass 2 Orchestrator
Fires when an edited export drops in the watch folder.
Steps: Whisper (final cut) → brand profile → Sheets write → metadata gen → thumbnail gen
"""
import logging
import os
import re
import zlib
from datetime import datetime
from pathlib import Path

log = logging.getLogger("fidelio.pass2")

_COVER_STOP_WORDS = {
    "a", "à", "au", "aux", "ce", "cet", "cette", "ces", "de", "des", "du", "en",
    "et", "est", "fait", "faire", "font", "il", "ils", "je", "la", "le", "les",
    "leur", "ma", "mes", "mon", "ne", "nos", "notre", "on", "ou", "par", "pas",
    "peut", "plus", "pour", "pourquoi", "que", "qui", "sa", "se", "ses", "son",
    "sur", "ta", "te", "tes", "ton", "tu", "un", "une", "vos", "votre", "vraiment",
    "y", "ça", "c", "d", "l", "m",
}

_MEDICAL_KEYWORDS = {
    "arthrose", "arthritic", "articulation", "articulations", "caillot", "caillots",
    "céphalée", "ceinture", "contraceptive", "douleur", "douleurs", "gel", "headache",
    "hyaluronique", "infiltration", "injection", "migraine", "pilule", "prp", "sécheresse",
    "tension", "viscosuppléance",
}
_HOST_LEAN_WORDS = {
    "pourquoi", "comment", "quand", "voici", "voilà", "explique", "parle", "médecin",
    "dre", "alexandra", "ton", "votre", "tu", "vous",
}
_HOOK_REPLACEMENTS = {
    "ceinture autour": "Mal de tête",
    "autour tête": "Mal de tête",
    "pilule contraceptive": "Pilule caillots",
    "gel acide": "Gel arthrose",
}


def _review_url(client: dict) -> str:
    review_port = int(os.getenv("PORT", 5400))
    client_id = client.get("client_id", "")
    return f"http://localhost:{review_port}/review/{client_id}"


def _cover_text(text: str, max_words: int = 4) -> str:
    text = str(text or "").strip()
    if not text:
        return ""
    words = re.findall(r"[A-Za-zÀ-ÿ0-9']+", re.sub(r"[—–/:!?.,()]+", " ", text))
    if not words:
        return text
    if len(words) <= max_words:
        result = " ".join(words)
        lowered = result.lower()
        return _HOOK_REPLACEMENTS.get(lowered, result)
    filtered = [w for w in words if w.lower() not in _COVER_STOP_WORDS]
    selected = filtered[:max_words] or words[:max_words]
    result = " ".join(selected)
    lowered = result.lower()
    if lowered in _HOOK_REPLACEMENTS:
        return _HOOK_REPLACEMENTS[lowered]

    joined_filtered = " ".join(filtered).lower()
    if "mal" in filtered[:2] and ("tête" in joined_filtered or "cephal" in joined_filtered or "céphal" in joined_filtered):
        return "Mal de tête"
    if "pilule" in joined_filtered and ("caillot" in joined_filtered or "coagul" in joined_filtered):
        return "Pilule caillots"
    if ("gel" in joined_filtered or "hyaluron" in joined_filtered) and "arthros" in joined_filtered:
        return "Gel arthrose"
    return result


def _thumbnail_title(metadata: dict) -> str:
    hook = _cover_text(metadata.get("hook", ""))
    if hook:
        return hook
    return _cover_text(metadata.get("title_1", ""))


def _auto_short_form_mode(export_name: str) -> str:
    """Stable per-file split so auto covers feel varied without changing on reruns."""
    bucket = zlib.crc32(export_name.encode("utf-8")) % 100
    return "stock" if bucket < 35 else "standard"


def _stock_thumbnail_prompt(metadata: dict, summary: str) -> str:
    hook = _cover_text(metadata.get("hook", ""))
    title = str(metadata.get("title_1", "")).strip()
    description = str(metadata.get("description", "")).strip()
    tags = [t.strip() for t in str(metadata.get("tags", "")).split(",") if t.strip()]

    scene_hint = ""
    corpus = " ".join([hook, title, description, summary, " ".join(tags)]).lower()
    if any(k in corpus for k in ("caillot", "coagul", "pilule")):
        scene_hint = "A contraceptive pill pack beside or above a blood clot inside a blood vessel medical illustration."
    elif any(k in corpus for k in ("arthros", "hyaluron", "gel", "infiltration", "viscosuppl")):
        scene_hint = "A syringe or gel injection near a knee joint or cartilage in a clean medical scene."
    elif any(k in corpus for k in ("tête", "migraine", "céphal", "cephal")):
        scene_hint = "One person holding their head in pain or a clean headache-focused scene."
    elif any(k in corpus for k in ("sécheresse", "menopause", "ménopause", "vaginal")):
        scene_hint = "A tasteful medical wellness scene related to vaginal dryness or menopause, not explicit."
    else:
        topic = hook or _cover_text(title) or tags[0] if tags else ""
        scene_hint = f"One clear medical or wellness scene illustrating: {topic or title}"

    tag_hint = ", ".join(tags[:5])
    parts = [
        scene_hint,
        f"Topic: {title}" if title else "",
        f"Context: {summary}" if summary else "",
        f"Notes: {description}" if description else "",
        f"Keywords: {tag_hint}" if tag_hint else "",
    ]
    return " ".join(part for part in parts if part)


def _semantic_short_form_mode(metadata: dict, summary: str, export_name: str) -> str:
    corpus = " ".join(
        str(part).lower()
        for part in (
            metadata.get("hook", ""),
            metadata.get("title_1", ""),
            metadata.get("description", ""),
            metadata.get("tags", ""),
            summary,
        )
    )
    medical_hits = sum(1 for word in _MEDICAL_KEYWORDS if word in corpus)
    host_hits = sum(1 for word in _HOST_LEAN_WORDS if word in corpus)
    if medical_hits >= 2 and medical_hits > host_hits:
        return "stock"
    if host_hits >= 2 and host_hits >= medical_hits:
        return "standard"
    return _auto_short_form_mode(export_name)


def run_pass2(
    export_path: Path,
    client: dict,
    cache_dir: Path,
    thumb_dir: Path,
    content_type: str = "long_form",
):
    """Full Pass 2 pipeline for a final edited export."""
    from local.monitor import emit_progress
    from local.ingest.transcribe import transcribe, transcript_summary
    from local.pipeline.brand import load_profile
    from local.pipeline.metadata import generate_metadata
    from local.pipeline.thumbnail import generate_thumbnail
    from local.sheets.connector import append_row, update_cell, find_row

    sheets_id = client["sheets_id"]
    language = client.get("language")
    stem = export_path.stem

    log.info(f"[Pass 2] {export_path.name} — starting")

    try:
        # ── Step 1: Whisper on final cut ──────────────────────────
        emit_progress(stem, "Transcribing", stage_num=1, total=6)
        log.info(f"[Pass 2] Transcribing final export...")
        transcript = transcribe(export_path, cache_dir, pass_num=2, language=language)
        summary = transcript_summary(transcript, max_chars=200)

        # ── Step 2: Brand profile ─────────────────────────────────
        emit_progress(stem, "Loading Brand Profile", stage_num=2, total=6)
        log.info(f"[Pass 2] Loading brand profile...")
        profile = load_profile(client, cache_dir)

        # ── Step 3: Sheets — Exports tab ─────────────────────────
        emit_progress(stem, "Writing to Sheets", stage_num=3, total=6)
        log.info(f"[Pass 2] Writing export to Sheets...")
        from local.ingest.ffprobe import extract_metadata
        meta = extract_metadata(export_path)

        export_row = {
            "File Name": export_path.name,
            "Review URL": "",
            "Export Date": datetime.now().strftime("%b %-d, %Y"),
            "Duration": meta.get("duration_formatted", ""),
            "Content Type": "Short-form Reel" if content_type == "short_form" else "Long-form",
            "Transcript Summary": summary,
            "Status": "Generating Metadata",
        }
        append_row(sheets_id, "Exports", export_row)

        # ── Step 4: Metadata generation ───────────────────────────
        emit_progress(stem, "Generating Metadata", stage_num=4, total=6)
        log.info(f"[Pass 2] Generating metadata (2-pass Claude)...")
        metadata = generate_metadata(
            transcript=transcript,
            profile=profile,
            export_name=export_path.stem,
            content_type=content_type,
        )

        # ── Step 5: Thumbnail generation ─────────────────────────
        thumbnail_url = ""
        emit_progress(stem, "Creating Thumbnail", stage_num=5, total=6)
        log.info(f"[Pass 2] Generating thumbnail...")
        thumbnail_title = _thumbnail_title(metadata)
        generation_mode = "standard"
        stock_prompt = ""
        if content_type == "short_form":
            generation_mode = _semantic_short_form_mode(metadata, summary, export_path.name)
            if generation_mode == "stock":
                stock_prompt = _stock_thumbnail_prompt(metadata, summary)
            log.info(f"[Pass 2] Auto short-form thumbnail mode: {generation_mode}")
        thumbnail_path = generate_thumbnail(
            export_path=export_path,
            profile=profile,
            title=thumbnail_title,
            thumb_dir=thumb_dir,
            content_type=content_type,
            generation_mode=generation_mode,
            stock_prompt=stock_prompt,
        )
        thumbnail_url = f"/thumbnails/{thumbnail_path.name}" if thumbnail_path else ""

        # ── Upload video to Dropbox for client review ───────────
        review_video_url = ""
        try:
            import dropbox
            import dropbox.files
            import dropbox.sharing
            dbx_token = os.getenv("DROPBOX_ACCESS_TOKEN", "")
            if dbx_token:
                dbx = dropbox.Dropbox(dbx_token)
                dest = f"/Fidelio/Review/{client.get('client_id', 'client')}/{export_path.name}"
                file_size = export_path.stat().st_size
                chunk = 100 * 1024 * 1024  # 100 MB
                with open(export_path, "rb") as fv:
                    if file_size <= 150 * 1024 * 1024:
                        dbx.files_upload(fv.read(), dest, mode=dropbox.files.WriteMode.overwrite)
                    else:
                        sess = dbx.files_upload_session_start(fv.read(chunk))
                        cursor = dropbox.files.UploadSessionCursor(session_id=sess.session_id, offset=fv.tell())
                        commit = dropbox.files.CommitInfo(path=dest, mode=dropbox.files.WriteMode.overwrite)
                        while fv.tell() < file_size:
                            remaining = file_size - fv.tell()
                            if remaining <= chunk:
                                dbx.files_upload_session_finish(fv.read(chunk), cursor, commit)
                            else:
                                dbx.files_upload_session_append_v2(fv.read(chunk), cursor)
                                cursor.offset = fv.tell()
                try:
                    link_meta = dbx.sharing_create_shared_link_with_settings(dest)
                except dropbox.exceptions.ApiError:
                    links = dbx.sharing_list_shared_links(path=dest, direct_only=True)
                    link_meta = links.links[0] if links.links else None
                if link_meta:
                    review_video_url = link_meta.url.replace("www.dropbox.com", "dl.dropboxusercontent.com").replace("?dl=0", "")
                log.info(f"[Pass 2] Uploaded for review: {review_video_url}")
        except Exception as e:
            log.warning(f"[Pass 2] Dropbox upload for review skipped: {e}")

        # ── Step 6: Sheets — Metadata tab ────────────────────────
        log.info(f"[Pass 2] Writing metadata to Sheets...")
        metadata_row = {
            "File Name": export_path.name,
            "Review URL": _review_url(client),
            "Title Option 1": metadata.get("title_1", ""),
            "Title Option 2": metadata.get("title_2", ""),
            "Title Option 3": metadata.get("title_3", ""),
            "Description": metadata.get("description", ""),
            "Tags": metadata.get("tags", ""),
            "Thumbnail URL": thumbnail_url,
        }
        append_row(sheets_id, "Metadata", metadata_row)

        # Update Export row status → Ready for Review
        export_rows = find_row(sheets_id, "Exports", "File Name", export_path.name)
        if export_rows:
            # find_row returns first matching row index
            if review_video_url:
                update_cell(sheets_id, "Exports", export_rows["_row_index"], "Review URL", review_video_url)
            update_cell(sheets_id, "Exports", export_rows["_row_index"], "Status", "Ready for Review")

        emit_progress(stem, "Done", status="done", stage_num=6, total=6)
        log.info(f"[Pass 2] Complete: {export_path.name} — ready for review")
    except Exception as e:
        emit_progress(stem, f"Error: {e}", status="error", stage_num=0, total=6)
        raise
