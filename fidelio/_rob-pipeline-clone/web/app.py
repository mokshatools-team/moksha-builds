"""
Fidelio Pipeline — Review UI Web App
Reads from Google Sheets, serves approval interface, calls Blotato on approval.
Deploy to Railway. Accessible to the full team.
"""
import json
import logging
import os
import shutil
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path

from flask import Flask, jsonify, render_template, request, abort, send_file, after_this_request
from dotenv import load_dotenv

load_dotenv(override=True)

log = logging.getLogger("fidelio.web")
app = Flask(__name__)
app.secret_key = os.getenv("FLASK_SECRET_KEY", "change-me")

# Load client configs at startup
CONFIG_DIR = Path(__file__).parent.parent / "config" / "clients"
_THUMB_GEN_DIR = Path(__file__).parent.parent.parent / "thumbnail-generator"


def _load_clients() -> dict:
    clients = {}
    for f in CONFIG_DIR.glob("*.json"):
        with open(f) as fp:
            c = json.load(fp)
            clients[c["client_id"]] = c
    return clients


CLIENTS = _load_clients()


def _get_sheets(client_id: str):
    """Get gspread worksheet client for a given client."""
    client = CLIENTS.get(client_id)
    if not client:
        return None, None
    from local.sheets.connector import get_sheet
    return get_sheet(client["sheets_id"]), client


def _get_platform_availability(client: dict) -> dict[str, bool]:
    configured = [str(p).lower() for p in client.get("platforms", [])]
    try:
        from web.posting.blotato import get_connected_platforms
        connected = get_connected_platforms()
    except Exception:
        connected = set()
    return {platform: platform in connected for platform in configured}


def _queue_status(rows: list[dict]) -> str:
    statuses = [str(r.get("Status", "")).strip() for r in rows if r.get("Status")]
    if not statuses:
        return ""
    if any(status == "Failed" for status in statuses):
        return "Failed"
    if any(status == "Posted" for status in statuses):
        return "Posted"
    if all(status == "Scheduled" for status in statuses):
        return "Scheduled"
    return statuses[0]


def _platform_label(platform: str) -> str:
    return {
        "youtube": "YouTube",
        "instagram": "Instagram",
        "tiktok": "TikTok",
        "facebook": "Facebook",
    }.get(platform.lower(), platform.capitalize())


def _review_url(client_id: str) -> str:
    review_port = int(os.getenv("PORT", 5400))
    return f"http://localhost:{review_port}/review/{client_id}"


def _build_stock_thumbnail_prompt(title: str, description: str, summary: str, tags: str) -> str:
    parts = [title, summary, description]
    tag_text = ", ".join(t.strip() for t in str(tags or "").split(",") if t.strip())
    if tag_text:
        parts.append(f"Keywords: {tag_text}")
    return " ".join(part for part in parts if part).strip()


FFMPEG = "/opt/homebrew/bin/ffmpeg"
FFPROBE = os.getenv("FFPROBE_PATH", "/opt/homebrew/bin/ffprobe")


def _prepend_cover_frames(export_path: Path, cover_image_path: Path, frames: int = 2) -> Path:
    """Prepend N frames of the thumbnail image to a video. Returns temp stitched path."""
    probe = subprocess.run(
        [FFPROBE, "-v", "quiet", "-print_format", "json", "-show_streams", str(export_path)],
        capture_output=True,
        text=True,
        check=True,
    )
    data = json.loads(probe.stdout)
    video_stream = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), None)
    audio_stream = next((s for s in data.get("streams", []) if s.get("codec_type") == "audio"), None)
    if not video_stream:
        raise RuntimeError("No video stream found in export")

    fps_value = video_stream.get("avg_frame_rate") or video_stream.get("r_frame_rate") or "30/1"
    try:
        num, den = fps_value.split("/")
        fps = float(num) / float(den or 1)
    except Exception:
        fps = 30.0
    duration = frames / fps
    width = int(video_stream.get("width") or 1920)
    height = int(video_stream.get("height") or 1080)

    cover_clip = Path(tempfile.mktemp(suffix="_cover.mp4"))
    subprocess.run([
        FFMPEG, "-y",
        "-loop", "1", "-i", str(cover_image_path),
        "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
        "-t", str(duration),
        "-vf", f"scale={width}:{height},format=yuv420p",
        "-r", str(fps),
        "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac",
        str(cover_clip)
    ], check=True, capture_output=True)

    stitched_path = Path(tempfile.mktemp(suffix=f"_stitched{export_path.suffix}"))
    try:
        if audio_stream:
            subprocess.run([
                FFMPEG, "-y",
                "-i", str(cover_clip),
                "-i", str(export_path),
                "-filter_complex", "[0:v:0][0:a:0][1:v:0][1:a:0]concat=n=2:v=1:a=1[v][a]",
                "-map", "[v]",
                "-map", "[a]",
                "-c:v", "libx264",
                "-preset", "veryfast",
                "-c:a", "aac",
                str(stitched_path),
            ], check=True, capture_output=True)
        else:
            subprocess.run([
                FFMPEG, "-y",
                "-i", str(cover_clip),
                "-i", str(export_path),
                "-filter_complex", "[0:v:0][1:v:0]concat=n=2:v=1:a=0[v]",
                "-map", "[v]",
                "-c:v", "libx264",
                "-preset", "veryfast",
                str(stitched_path),
            ], check=True, capture_output=True)
    finally:
        cover_clip.unlink(missing_ok=True)

    return stitched_path


def _save_stitch_debug(export_path: Path, stitched_path: Path, cover_image_path: Path) -> dict:
    """Persist stitched upload + first frames locally so we can verify pre-Blotato."""
    debug_root = Path(os.path.expanduser(os.getenv("DEBUG_UPLOAD_DIR", "~/.fidelio/debug-uploads")))
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    debug_dir = debug_root / f"{export_path.stem}_{stamp}"
    frames_dir = debug_dir / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)

    stitched_copy = debug_dir / f"{export_path.stem}_stitched{export_path.suffix}"
    cover_copy = debug_dir / cover_image_path.name
    shutil.copy2(stitched_path, stitched_copy)
    shutil.copy2(cover_image_path, cover_copy)

    subprocess.run([
        FFMPEG, "-y",
        "-i", str(stitched_copy),
        "-frames:v", "4",
        str(frames_dir / "frame_%02d.jpg"),
    ], check=True, capture_output=True)

    return {
        "dir": str(debug_dir),
        "stitched_video": str(stitched_copy),
        "cover_image": str(cover_copy),
        "frames_dir": str(frames_dir),
    }


def _upsert_publish_row(
    sheets_id: str,
    file_name: str,
    platform: str,
    row_data: dict,
    existing_rows: list[dict] | None = None,
) -> None:
    from local.sheets.connector import append_row, update_cell, get_all_rows

    existing_rows = existing_rows if existing_rows is not None else get_all_rows(sheets_id, "Publish Queue")
    match = next(
        (
            index for index, row in enumerate(existing_rows, start=2)
            if row.get("File Name") == file_name and row.get("Platform", "").strip().lower() == platform.lower()
        ),
        None,
    )
    if match is None:
        append_row(sheets_id, "Publish Queue", row_data)
        return
    for col_name, value in row_data.items():
        update_cell(sheets_id, "Publish Queue", match, col_name, value)


# ── ROUTES ───────────────────────────────────────────────────

@app.route("/")
def index():
    """Redirect to first client's review queue."""
    if not CLIENTS:
        return "No clients configured.", 404
    first_client = list(CLIENTS.keys())[0]
    return review_queue(first_client)


@app.route("/review/<client_id>")
def review_queue(client_id: str):
    client = CLIENTS.get(client_id)
    if not client:
        abort(404)
    platform_availability = _get_platform_availability(client)
    return render_template(
        "review.html",
        client=client,
        clients=CLIENTS,
        platform_availability=platform_availability,
    )


@app.route("/api/<client_id>/queue")
def api_queue(client_id: str):
    """Return pending review items from Sheets."""
    from local.sheets.connector import get_all_rows

    client = CLIENTS.get(client_id)
    if not client:
        return jsonify({"error": "Client not found"}), 404

    sheets_id = client["sheets_id"]

    try:
        exports = get_all_rows(sheets_id, "Exports")
        metadata = get_all_rows(sheets_id, "Metadata")
        publish_queue = get_all_rows(sheets_id, "Publish Queue")
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    # Index metadata and publish status by file name
    meta_index = {r["File Name"]: r for r in metadata if r.get("File Name")}
    pub_index = {}
    for r in publish_queue:
        fn = r.get("File Name", "")
        if fn:
            pub_index.setdefault(fn, []).append(r)

    items = []
    for export in exports:
        fn = export.get("File Name", "")
        if not fn:
            continue
        meta = meta_index.get(fn, {})
        pubs = pub_index.get(fn, [])
        pub_status = _queue_status(pubs)

        items.append({
            "file_name": fn,
            "export_date": export.get("Export Date", ""),
            "content_type": export.get("Content Type", "Long-form"),
            "duration": export.get("Duration", ""),
            "status": export.get("Status", ""),
            "pub_status": pub_status,
            "title_1": meta.get("Title Option 1", ""),
            "title_2": meta.get("Title Option 2", ""),
            "title_3": meta.get("Title Option 3", ""),
            "description": meta.get("Description", ""),
            "tags": meta.get("Tags", ""),
            "thumbnail_url": meta.get("Thumbnail URL", ""),
            "transcript_summary": export.get("Transcript Summary", ""),
        })

    # Deduplicate by file_name — keep the entry with the most advanced status
    _STATUS_PRI = {"Posted": 6, "Scheduled": 5, "Approved": 4, "Ready for Review": 3, "Pending Review": 2}
    seen: dict = {}
    for item in items:
        fn = item["file_name"]
        if fn not in seen:
            seen[fn] = item
        else:
            existing_pri = _STATUS_PRI.get(seen[fn].get("pub_status") or seen[fn].get("status", ""), 0)
            new_pri = _STATUS_PRI.get(item.get("pub_status") or item.get("status", ""), 0)
            if new_pri > existing_pri:
                seen[fn] = item
    items = list(seen.values())

    # Sort: pending first, then by date descending
    def sort_key(item):
        pending = item["status"] == "Ready for Review"
        return (not pending, item["export_date"])

    items.sort(key=sort_key)
    return jsonify({"items": items, "client": client["display_name"]})


@app.route("/api/<client_id>/approve", methods=["POST"])
def api_approve(client_id: str):
    """
    Approve an item and schedule via Blotato.
    Body: { file_name, approved_title, description, tags, platforms, schedule_time, approved_by }
    """
    from local.sheets.connector import update_cell, find_row

    client = CLIENTS.get(client_id)
    if not client:
        return jsonify({"error": "Client not found"}), 404

    data = request.get_json()
    required = ["file_name", "approved_title", "description", "schedule_time"]
    for field in required:
        if not data.get(field):
            return jsonify({"error": f"Missing field: {field}"}), 400

    file_name = data["file_name"]
    approved_title = data["approved_title"]
    description = data["description"]
    tags = data.get("tags", "")
    requested_platforms = [str(p).lower() for p in data.get("platforms", client.get("platforms", []))]
    schedule_time = data["schedule_time"]  # ISO8601
    approved_by = data.get("approved_by", "Team")
    availability = _get_platform_availability(client)
    allowed_platforms = [p for p in requested_platforms if availability.get(p)]
    skipped_platforms = [p for p in requested_platforms if not availability.get(p)]

    sheets_id = client["sheets_id"]
    results = []

    if not allowed_platforms:
        return jsonify({"error": "No connected Blotato platforms selected"}), 400

    # Upload the video file to Blotato once, then schedule per platform
    from web.posting.blotato import upload_local_video, create_scheduled_post
    debug_upload = None
    cover_stitch_status = "Original video"
    try:
        watch_folder = Path(client.get("watch_folder", ""))
        export_path = watch_folder / file_name
        if not export_path.exists():
            return jsonify({"error": f"Export file not found: {export_path}"}), 400

        stitched = None
        try:
            thumb_dir = Path(os.path.expanduser(os.getenv("THUMBNAIL_DIR", "~/.fidelio/thumbnails")))
            cover_image_path = thumb_dir / f"{export_path.stem}_thumb.png"
            if cover_image_path.exists():
                stitched = _prepend_cover_frames(export_path, cover_image_path, frames=2)
                cover_stitch_status = "Stitched"
                if os.getenv("DEBUG_STITCH_UPLOADS", "1") != "0":
                    debug_upload = _save_stitch_debug(export_path, stitched, cover_image_path)
                    log.info("[Approve] Stitch debug saved: %s", debug_upload["dir"])
            else:
                stitched = export_path
            public_url = upload_local_video(str(stitched))
        finally:
            if stitched and stitched != export_path and stitched.exists():
                stitched.unlink(missing_ok=True)
    except Exception as e:
        return jsonify({"error": f"Video upload failed: {e}"}), 500

    tags_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else []
    existing_publish_rows = []
    try:
        from local.sheets.connector import get_all_rows, ensure_column
        ensure_column(sheets_id, "Publish Queue", "Cover Stitch")
        existing_publish_rows = get_all_rows(sheets_id, "Publish Queue")
    except Exception:
        existing_publish_rows = []

    try:
        for platform in allowed_platforms:
            try:
                post_id = create_scheduled_post(
                    platform=platform,
                    media_urls=[public_url],
                    schedule_time_iso=schedule_time,
                    title=approved_title,
                    description=description,
                    tags=tags_list,
                )
                pub_row = {
                    "File Name": file_name,
                    "Review URL": _review_url(client_id),
                    "Approved Title": approved_title,
                    "Platform": _platform_label(platform),
                    "Scheduled Date": _format_schedule(schedule_time),
                    "Posted Date": "—",
                    "Post Link": "—",
                    "Approved By": approved_by,
                    "Cover Stitch": cover_stitch_status,
                    "Status": "Scheduled",
                }
                _upsert_publish_row(sheets_id, file_name, platform, pub_row, existing_publish_rows)
                results.append({"platform": platform, "post_id": post_id, "status": "scheduled"})

            except Exception as e:
                _upsert_publish_row(
                    sheets_id,
                    file_name,
                    platform,
                    {
                        "File Name": file_name,
                        "Review URL": _review_url(client_id),
                        "Approved Title": approved_title,
                        "Platform": _platform_label(platform),
                        "Scheduled Date": _format_schedule(schedule_time),
                        "Posted Date": "—",
                        "Post Link": "—",
                        "Approved By": approved_by,
                        "Cover Stitch": cover_stitch_status,
                        "Status": "Failed",
                    },
                    existing_publish_rows,
                )
                results.append({"platform": platform, "error": str(e), "status": "failed"})

        for platform in skipped_platforms:
            _upsert_publish_row(
                sheets_id,
                file_name,
                platform,
                {
                    "File Name": file_name,
                    "Review URL": _review_url(client_id),
                    "Approved Title": approved_title,
                    "Platform": _platform_label(platform),
                    "Scheduled Date": _format_schedule(schedule_time),
                    "Posted Date": "—",
                    "Post Link": "—",
                    "Approved By": approved_by,
                    "Cover Stitch": cover_stitch_status,
                    "Status": "Failed",
                },
                existing_publish_rows,
            )
            results.append({"platform": platform, "error": "Platform not connected in Blotato", "status": "failed"})
    except Exception as e:
        return jsonify({"error": f"Sheets sync failed: {e}", "results": results}), 500

    all_ok = all(r.get("status") == "scheduled" for r in results)
    export_row = find_row(sheets_id, "Exports", "File Name", file_name)
    if export_row and all_ok:
        update_cell(sheets_id, "Exports", export_row["_row_index"], "Status", "Approved")
    return jsonify({
        "success": all_ok,
        "results": results,
        "message": "Scheduled successfully" if all_ok else "Some platforms failed — check results",
        "debug_upload": debug_upload,
    })


@app.route("/api/<client_id>/build-timeline", methods=["POST"])
def api_build_timeline(client_id: str):
    """
    Build a Resolve timeline from today's ingested clips (reads from Sheets Clip Index).
    Falls back to all clips if none were ingested today.
    Requires DaVinci Resolve to be open on this machine.
    """
    from local.sheets.connector import get_all_rows
    from local.ingest.resolve import build_timeline

    client = CLIENTS.get(client_id)
    if not client:
        return jsonify({"error": "Client not found"}), 404

    sheets_id = client["sheets_id"]
    ingest_folder = Path(client.get("ingest_folder", ""))
    today = datetime.now().strftime("%b %-d, %Y")

    try:
        clip_rows = get_all_rows(sheets_id, "Clip Index")
    except Exception as e:
        return jsonify({"error": f"Could not read Sheets: {e}"}), 500

    # Prefer today's clips; fall back to all clips
    todays = [r for r in clip_rows if r.get("Processed Date") == today]
    source = todays if todays else clip_rows

    if not source:
        return jsonify({"error": "No clips found in Sheets Clip Index"}), 404

    clips_data = [
        {
            "path": ingest_folder / r.get("Clip Name", ""),
            "shoot_date": r.get("Shoot Date", today),
            "transcript_snippet": "",
        }
        for r in source
        if r.get("Clip Name")
    ]

    date_str = datetime.now().strftime("%b %-d %Y")
    timeline_name = f"FIDELIO_{date_str}"

    try:
        project_name = client.get("display_name", client["client_id"])
        success = build_timeline(clips_data, timeline_name=timeline_name, project_name=project_name)
    except Exception as e:
        return jsonify({"error": f"Timeline build failed: {e}"}), 500

    if not success:
        return jsonify({"error": "Resolve not available — open DaVinci Resolve and try again"}), 503

    return jsonify({"success": True, "timeline_name": timeline_name, "clip_count": len(clips_data)})


@app.route("/thumbnails/<path:filename>")
def serve_thumbnail(filename: str):
    """Serve locally generated thumbnails."""
    thumb_dir = Path(os.path.expanduser(os.getenv("THUMBNAIL_DIR", "~/.fidelio/thumbnails")))
    return send_file(thumb_dir / filename)


@app.route("/api/<client_id>/regenerate_thumbnail", methods=["POST"])
def api_regenerate_thumbnail(client_id: str):
    """Regenerate thumbnail for a given export via FAL.

    Body: { file_name, title?, host_frame?, guest_frame?, brand_ref? }
    host_frame / guest_frame: float 0.0–1.0 position in the video
    brand_ref: filename from thumbnail-generator/references/<client_id>/
    """
    from local.pipeline.thumbnail import generate_thumbnail, upload_ref_image, _extract_frame_at
    from local.pipeline.brand import load_profile

    data = request.get_json()
    file_name = data.get("file_name")
    if not file_name:
        return jsonify({"error": "Missing file_name"}), 400

    client = CLIENTS.get(client_id)
    if not client:
        return jsonify({"error": "Client not found"}), 404

    watch_folder = Path(client.get("watch_folder", ""))
    export_path = watch_folder / file_name
    export_exists = export_path.exists()

    thumb_dir = Path(os.path.expanduser(os.getenv("THUMBNAIL_DIR", "~/.fidelio/thumbnails")))
    cache_dir = Path(os.path.expanduser(os.getenv("CACHE_DIR", "~/.fidelio/cache")))

    stem = Path(file_name).stem
    existing = thumb_dir / f"{stem}_thumb.png"
    if existing.exists():
        existing.unlink()

    try:
        profile = load_profile(client, cache_dir)
    except Exception as e:
        return jsonify({"error": f"Could not load brand profile: {e}"}), 500

    content_type = str(data.get("content_type", "")).strip().lower()
    if "short" in content_type:
        content_type = "short_form"
    elif not content_type:
        if export_exists:
            try:
                from local.ingest.ffprobe import extract_metadata, get_content_type
                content_type = get_content_type(extract_metadata(export_path))
            except Exception:
                content_type = "long_form"
        else:
            content_type = "long_form"
    else:
        content_type = "long_form"

    title = data.get("title", "")
    meta_row = {}
    export_row = {}
    if not title:
        try:
            from local.sheets.connector import get_all_rows
            meta_rows = get_all_rows(client["sheets_id"], "Metadata")
            meta_row = next((r for r in meta_rows if r.get("File Name") == file_name), {})
            title = meta_row.get("Title Option 1", export_path.stem)
            export_rows = get_all_rows(client["sheets_id"], "Exports")
            export_row = next((r for r in export_rows if r.get("File Name") == file_name), {})
        except Exception:
            title = export_path.stem

    # ── Collect reference images ──────────────────────────────
    # Order matters for FAL: put host/guest frames FIRST (subject to feature),
    # brand ref LAST (style/format reference only).
    host_guest_urls: list[str] = []
    has_subject_frame = False
    generation_mode = "standard"

    # Host and guest frames (content — goes first)
    brand_ref_name = data.get("brand_ref", "")
    if brand_ref_name.startswith("ig_host"):
        generation_mode = "host"
    elif brand_ref_name.startswith("ig_stock"):
        generation_mode = "stock"

    frame_keys = ()
    if generation_mode == "host":
        frame_keys = ("host_frame",)
    elif generation_mode == "standard":
        frame_keys = ("host_frame", "guest_frame")

    for frame_key in frame_keys:
        pos = data.get(frame_key)
        if pos is None:
            continue
        if not export_exists:
            log.warning(f"[Regen] Skipping {frame_key} — export file not on disk")
            continue
        try:
            t = max(0.0, min(1.0, float(pos)))
            frame_path = _extract_frame_at(export_path, t)
            if frame_path:
                host_guest_urls.append(upload_ref_image(frame_path))
                frame_path.unlink(missing_ok=True)
                has_subject_frame = True
        except Exception as e:
            log.warning(f"[Regen] Could not extract/upload {frame_key}: {e}")

    # Brand reference image (style/format — goes last)
    brand_urls: list[str] = []
    if brand_ref_name:
        refs_dir = _THUMB_GEN_DIR / "references" / client_id
        brand_ref_path = refs_dir / brand_ref_name
        if not brand_ref_path.exists():
            matches = sorted(refs_dir.glob(f"{brand_ref_name}.*"))
            if matches:
                brand_ref_path = matches[0]
        if brand_ref_path.exists():
            try:
                brand_urls.append(upload_ref_image(brand_ref_path))
            except Exception as e:
                log.warning(f"[Regen] Could not upload brand ref: {e}")

    ref_image_urls: list[str] = host_guest_urls + brand_urls
    stock_prompt = ""
    if generation_mode == "stock":
        if not meta_row or not export_row:
            try:
                from local.sheets.connector import get_all_rows
                if not meta_row:
                    meta_rows = get_all_rows(client["sheets_id"], "Metadata")
                    meta_row = next((r for r in meta_rows if r.get("File Name") == file_name), {})
                if not export_row:
                    export_rows = get_all_rows(client["sheets_id"], "Exports")
                    export_row = next((r for r in export_rows if r.get("File Name") == file_name), {})
            except Exception:
                pass
        stock_prompt = _build_stock_thumbnail_prompt(
            title=title,
            description=meta_row.get("Description", ""),
            summary=export_row.get("Transcript Summary", ""),
            tags=meta_row.get("Tags", ""),
        )
    log.info(
        "[Regen] file=%s mode=%s content_type=%s subject_refs=%s brand_refs=%s brand_ref=%s",
        file_name,
        generation_mode,
        content_type,
        len(host_guest_urls),
        len(brand_urls),
        brand_ref_name or "-",
    )

    try:
        thumb_path = generate_thumbnail(
            export_path, profile, title, thumb_dir,
            content_type=content_type,
            generation_mode=generation_mode,
            stock_prompt=stock_prompt,
            custom_prompt=data.get("custom_prompt", ""),
            ref_image_urls=ref_image_urls if ref_image_urls else None,
            has_subject_frame=has_subject_frame,
            subject_frame_count=len(host_guest_urls),
            has_brand_reference=bool(brand_urls),
        )
    except Exception as e:
        return jsonify({"error": f"Generation failed: {e}"}), 500

    if not thumb_path:
        return jsonify({"error": "Thumbnail generation returned no result"}), 500

    thumb_url = f"/thumbnails/{thumb_path.name}"
    try:
        from local.sheets.connector import get_all_rows, update_cell
        meta_rows = get_all_rows(client["sheets_id"], "Metadata")
        match = next((i for i, r in enumerate(meta_rows, start=2) if r.get("File Name") == file_name), None)
        if match:
            update_cell(client["sheets_id"], "Metadata", match, "Thumbnail URL", thumb_url)
    except Exception as e:
        log.warning(f"Could not update Sheets after regen: {e}")

    return jsonify({"success": True, "thumbnail_url": thumb_url})


@app.route("/api/<client_id>/frame")
def api_frame(client_id: str):
    """Extract a single frame from a video at position t (0.0–1.0). Returns JPEG."""
    import subprocess, tempfile

    client = CLIENTS.get(client_id)
    if not client:
        abort(404)

    file_name = request.args.get("file_name", "")
    try:
        t = max(0.0, min(1.0, float(request.args.get("t", "0.1"))))
    except ValueError:
        t = 0.1

    watch_folder = Path(client.get("watch_folder", ""))
    video_path = watch_folder / file_name
    if not video_path.exists():
        abort(404)

    try:
        ffprobe = os.getenv("FFPROBE_PATH", "/opt/homebrew/bin/ffprobe")
        ffmpeg = os.getenv("FFMPEG_PATH", "/opt/homebrew/bin/ffmpeg")
        probe = subprocess.run(
            [ffprobe, "-v", "quiet", "-print_format", "json", "-show_format", str(video_path)],
            capture_output=True, text=True,
        )
        duration = float(json.loads(probe.stdout)["format"]["duration"])
        frame_path = Path(tempfile.mktemp(suffix=".jpg"))
        subprocess.run(
            [ffmpeg, "-y", "-ss", str(duration * t), "-i", str(video_path),
             "-vframes", "1", "-q:v", "3", str(frame_path)],
            capture_output=True, check=True,
        )

        @after_this_request
        def _cleanup(response):
            frame_path.unlink(missing_ok=True)
            return response

        return send_file(frame_path, mimetype="image/jpeg")
    except Exception:
        abort(500)


@app.route("/api/<client_id>/brand-refs")
def api_brand_refs(client_id: str):
    """Return stored brand reference images for this client."""
    refs_dir = _THUMB_GEN_DIR / "references" / client_id
    if not refs_dir.exists():
        return jsonify({"refs": []})
    files = sorted(list(refs_dir.glob("*.png")) + list(refs_dir.glob("*.jpg")) + list(refs_dir.glob("*.jpeg")))
    refs = [{"name": f.stem, "url": f"/brand-refs/{client_id}/{f.name}"} for f in files]
    return jsonify({"refs": refs})


@app.route("/brand-refs/<client_id>/<path:filename>")
def serve_brand_ref(client_id: str, filename: str):
    """Serve a stored brand reference image."""
    return send_file(_THUMB_GEN_DIR / "references" / client_id / filename)


def _format_schedule(iso_str: str) -> str:
    """Format ISO datetime to human-readable for Sheets."""
    try:
        dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
        return dt.strftime("%b %-d, %Y %H:%M")
    except Exception:
        return iso_str


def _check_client_token(client: dict) -> bool:
    """Validate the ?token= query param against the client's review_token."""
    expected = client.get("review_token", "")
    if not expected:
        return False
    return request.args.get("token", "") == expected


@app.route("/client/<client_id>")
def client_review(client_id: str):
    """Client-facing sign-off page. Token auth via ?token= query param."""
    client = CLIENTS.get(client_id)
    if not client:
        abort(404)
    if not _check_client_token(client):
        abort(403)
    return render_template("client_review.html", client=client, token=request.args.get("token", ""))


@app.route("/api/client/<client_id>/queue")
def api_client_queue(client_id: str):
    """Return clips that are Scheduled or already approved (client-facing, token required)."""
    from local.sheets.connector import get_all_rows

    client = CLIENTS.get(client_id)
    if not client:
        return jsonify({"error": "Client not found"}), 404
    if not _check_client_token(client):
        return jsonify({"error": "Unauthorized"}), 403

    try:
        exports = get_all_rows(client["sheets_id"], "Exports")
        metadata = get_all_rows(client["sheets_id"], "Metadata")
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    meta_index = {r["File Name"]: r for r in metadata if r.get("File Name")}
    items = []
    for row in exports:
        fn = row.get("File Name", "")
        status = row.get("Status", "")
        if not fn or status not in ("Scheduled", "Client Approved", "Needs Revision"):
            continue
        meta = meta_index.get(fn, {})
        items.append({
            "file_name": fn,
            "export_date": row.get("Export Date", ""),
            "duration": row.get("Duration", ""),
            "content_type": row.get("Content Type", ""),
            "status": status,
            "review_url": row.get("Review URL", ""),
            "title": meta.get("Title Option 1", fn),
            "description": meta.get("Description", ""),
            "thumbnail_url": meta.get("Thumbnail URL", ""),
        })
    items.sort(key=lambda x: (x["status"] != "Ready for Review", x["export_date"]))
    return jsonify({"items": items, "client": client["display_name"]})


@app.route("/api/client/<client_id>/approve/<path:file_name>", methods=["POST"])
def api_client_approve(client_id: str, file_name: str):
    """Client approves a clip. Writes 'Client Approved' to Exports Status."""
    from local.sheets.connector import find_row, update_cell

    client = CLIENTS.get(client_id)
    if not client:
        return jsonify({"error": "Client not found"}), 404
    if not _check_client_token(client):
        return jsonify({"error": "Unauthorized"}), 403

    try:
        row = find_row(client["sheets_id"], "Exports", "File Name", file_name)
        if not row:
            return jsonify({"error": "Clip not found"}), 404
        update_cell(client["sheets_id"], "Exports", row["_row_index"], "Status", "Client Approved")
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/client/<client_id>/revise/<path:file_name>", methods=["POST"])
def api_client_revise(client_id: str, file_name: str):
    """Client requests revision. Writes 'Needs Revision: <comment>' to Exports Status."""
    from local.sheets.connector import find_row, update_cell

    client = CLIENTS.get(client_id)
    if not client:
        return jsonify({"error": "Client not found"}), 404
    if not _check_client_token(client):
        return jsonify({"error": "Unauthorized"}), 403

    comment = (request.get_json() or {}).get("comment", "").strip()
    status = f"Needs Revision: {comment}" if comment else "Needs Revision"

    try:
        row = find_row(client["sheets_id"], "Exports", "File Name", file_name)
        if not row:
            return jsonify({"error": "Clip not found"}), 404
        update_cell(client["sheets_id"], "Exports", row["_row_index"], "Status", status)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    port = int(os.getenv("PORT", 5400))
    app.run(host="0.0.0.0", port=port, debug=False)
