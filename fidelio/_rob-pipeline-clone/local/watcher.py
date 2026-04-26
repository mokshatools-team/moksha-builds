"""
Fidelio Pipeline — File System Watchers
Watches ingest_folder (Pass 1) and export folders (Pass 2).
Uses watchdog for FSEvents on macOS.
"""
import time
import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

log = logging.getLogger("fidelio.watcher")

VIDEO_EXTENSIONS = {".mov", ".mp4", ".mxf", ".m4v", ".avi", ".mkv", ".r3d", ".braw"}

# Seconds to wait after last size change before treating file as stable
INGEST_STABILITY_SECS = 3
EXPORT_STABILITY_SECS = 8  # exports are large


def _is_video(path: Path) -> bool:
    return path.suffix.lower() in VIDEO_EXTENSIONS


def _wait_for_stable(path: Path, stability_secs: int) -> bool:
    """Poll until file size stops changing. Returns False if file disappears."""
    log.info(f"Waiting for file to stabilise: {path.name}")
    prev_size = -1
    stable_count = 0
    needed = max(2, stability_secs)  # at least 2 checks

    for _ in range(120):  # max ~2 min
        try:
            size = path.stat().st_size
        except FileNotFoundError:
            return False
        if size == prev_size:
            stable_count += 1
            if stable_count >= needed:
                log.info(f"File stable at {size / 1024 / 1024:.1f} MB: {path.name}")
                return True
        else:
            stable_count = 0
            prev_size = size
        time.sleep(1)

    log.warning(f"File never stabilised after 2 min: {path.name}")
    return False


class IngestHandler(FileSystemEventHandler):
    """Handles new files in the ingest folder — triggers Pass 1."""

    IDLE_SECS = 30  # seconds after last ingest before triggering timeline build

    def __init__(self, client: dict, cache_dir: Path, thumb_dir: Path):
        self.client = client
        self.cache_dir = cache_dir
        self.thumb_dir = thumb_dir
        self._seen = set()
        # Timeline batch tracking
        self._session_clips: list[dict] = []
        self._build_timer: threading.Timer | None = None
        self._session_lock = threading.Lock()
        self._pool = ThreadPoolExecutor(max_workers=3, thread_name_prefix="pass1")

    def on_created(self, event):
        if event.is_directory:
            return
        path = Path(event.src_path)
        if not _is_video(path):
            return
        if str(path) in self._seen:
            return
        self._seen.add(str(path))
        self._pool.submit(self._handle, path)

    def _handle(self, path: Path):
        if not _wait_for_stable(path, INGEST_STABILITY_SECS):
            return
        from local.ingest.ffprobe import extract_metadata, get_content_type

        metadata = extract_metadata(path)
        content_type = get_content_type(metadata)
        if content_type == "short_form":
            log.info(f"[Pass 1] Skipping short-form ingest: {path.name}")
            return

        log.info(f"[Pass 1] Starting ingest: {path.name}")
        try:
            from local.pipeline.pass1 import run_pass1
            run_pass1(path, self.client, self.cache_dir)
        except Exception as e:
            log.error(f"[Pass 1] Error processing {path.name}: {e}", exc_info=True)
            return

        # Collect clip for batch timeline build
        shoot_date = metadata.get("shoot_date", datetime.now().strftime("%b %-d, %Y"))
        with self._session_lock:
            self._session_clips.append({
                "path": path,
                "shoot_date": shoot_date,
                "transcript_snippet": "",
            })
        self._schedule_timeline_build()

    def _schedule_timeline_build(self):
        """Reset the idle timer. Timeline builds 30s after last clip completes."""
        with self._session_lock:
            if self._build_timer:
                self._build_timer.cancel()
            self._build_timer = threading.Timer(self.IDLE_SECS, self._build_timeline_now)
            self._build_timer.daemon = True
            self._build_timer.start()

    def _build_timeline_now(self):
        """Called by idle timer. Assembles a Resolve timeline from all session clips."""
        with self._session_lock:
            if not self._session_clips:
                return
            clips = list(self._session_clips)
            self._session_clips.clear()
            self._build_timer = None

        date_str = datetime.now().strftime("%b %-d %Y")
        timeline_name = f"FIDELIO_{date_str}"
        log.info(f"[Pass 1] Building Resolve timeline: {timeline_name} ({len(clips)} clips)")
        try:
            from local.ingest.resolve import build_timeline
            project_name = self.client.get("display_name", self.client["client_id"])
            build_timeline(clips, timeline_name=timeline_name, project_name=project_name)
        except Exception as e:
            log.error(f"[Pass 1] Timeline build failed: {e}", exc_info=True)


class ExportHandler(FileSystemEventHandler):
    """Handles new files in the watch folder — triggers Pass 2."""

    def __init__(self, client: dict, cache_dir: Path, thumb_dir: Path):
        self.client = client
        self.cache_dir = cache_dir
        self.thumb_dir = thumb_dir
        self._seen = set()
        self._pool = ThreadPoolExecutor(max_workers=3, thread_name_prefix="pass2")

    def on_created(self, event):
        if event.is_directory:
            return
        path = Path(event.src_path)
        if not _is_video(path):
            return
        if str(path) in self._seen:
            return
        self._seen.add(str(path))
        self._pool.submit(self._handle, path)

    def _handle(self, path: Path):
        if not _wait_for_stable(path, EXPORT_STABILITY_SECS):
            return
        from local.ingest.ffprobe import extract_metadata, get_content_type

        metadata = extract_metadata(path)
        content_type = get_content_type(metadata)
        log.info(f"[Pass 2] Export detected: {path.name}")
        try:
            from local.pipeline.pass2 import run_pass2
            run_pass2(path, self.client, self.cache_dir, self.thumb_dir, content_type=content_type)
        except Exception as e:
            log.error(f"[Pass 2] Error processing {path.name}: {e}", exc_info=True)


def _get_export_folders(client: dict) -> list[Path]:
    folders = []
    for key in ("watch_folder", "watch_folder_long", "watch_folder_short"):
        folder = client.get(key)
        if not folder:
            continue
        path = Path(folder)
        if path not in folders:
            folders.append(path)
    return folders


def start_watchers(client: dict, args, cache_dir: Path, thumb_dir: Path):
    observer = Observer()

    ingest_folder = Path(client["ingest_folder"])
    export_folders = _get_export_folders(client)

    # Ensure folders exist (create if missing — editors may not have drives mounted yet)
    ingest_folder.mkdir(parents=True, exist_ok=True)
    for export_folder in export_folders:
        export_folder.mkdir(parents=True, exist_ok=True)

    if not args.pass2_only:
        ingest_handler = IngestHandler(client, cache_dir, thumb_dir)
        observer.schedule(ingest_handler, str(ingest_folder), recursive=False)
        log.info(f"Watching ingest folder:  {ingest_folder}")

    if not args.pass1_only:
        export_handler = ExportHandler(client, cache_dir, thumb_dir)
        for export_folder in export_folders:
            observer.schedule(export_handler, str(export_folder), recursive=False)
            log.info(f"Watching export folder:  {export_folder}")

    observer.start()
    log.info("Watchers running. Press Ctrl+C to stop.")

    try:
        while True:
            time.sleep(5)
    except KeyboardInterrupt:
        log.info("Shutting down...")
        observer.stop()
    observer.join()
