"""
File system watcher for FDL1 Publishing Pipeline.
Monitors configured folder paths for new .mp4 files.
On detection: validates filename, triggers webhook or rejects.
"""

import os
import re
import sys
import time
import shutil
import logging
from pathlib import Path

# Add parent dir to path for imports
sys.path.insert(0, os.path.dirname(__file__))

from config_loader import load_config, get_content_type
from webhook_trigger import trigger_webhook

logger = logging.getLogger("fdl1.watcher")

# Regex: asset_id is letters + numbers + dots only
ASSET_ID_PATTERN = re.compile(r'^[A-Za-z]+[0-9]+(?:\.[0-9]+)?$')


def parse_filename(filename: str, config: dict):
    """
    Parse and validate a filename.
    Format: [ASSET_ID] [topic in plain language].mp4

    Returns dict with asset_id, topic_slug, content_type, session_id, prefix
    or None if invalid.
    """
    if not filename.endswith(".mp4"):
        logger.warning(f"Rejected: not .mp4 — {filename}")
        return None

    # Must contain at least one space
    if " " not in filename:
        logger.warning(f"Rejected: no space in filename — {filename}")
        return None

    # Split on first space
    name_without_ext = filename[:-4]  # strip .mp4
    space_idx = name_without_ext.index(" ")
    asset_id = name_without_ext[:space_idx]
    topic_slug = name_without_ext[space_idx + 1:]

    # Validate asset_id characters (letters, numbers, dots only)
    if not ASSET_ID_PATTERN.match(asset_id):
        logger.warning(f"Rejected: invalid asset_id format '{asset_id}' — {filename}")
        return None

    # Extract prefix (letters before first digit)
    prefix = re.match(r'^[A-Za-z]+', asset_id).group()

    # Look up prefix in config content_types
    content_type_info = get_content_type(config, prefix)
    if content_type_info is None:
        logger.warning(f"Rejected: unknown prefix '{prefix}' — {filename}")
        return None

    # Extract session number
    numbers = re.findall(r'[0-9]+', asset_id)
    session_id = numbers[0] if numbers else ""

    return {
        "asset_id": asset_id,
        "topic_slug": topic_slug,
        "content_type": content_type_info["name"],
        "content_type_format": content_type_info["format"],
        "session_id": session_id,
        "prefix": prefix,
    }


def determine_format_from_path(file_path: str, config: dict):
    """Determine if a file is in a short_form or long_form folder based on its path."""
    abs_path = os.path.abspath(file_path)
    for format_key, folder in config["folders"].items():
        folder_abs = os.path.abspath(folder["local_path"])
        if abs_path.startswith(folder_abs):
            return format_key
    return None


def handle_new_file(file_path: str, config: dict) -> bool:
    """
    Handle a newly detected .mp4 file.
    Validates, parses, and triggers webhook or rejects.
    Returns True if processed successfully, False if rejected.
    """
    filename = os.path.basename(file_path)
    client_id = config["client_id"]

    logger.info(f"New file detected: {filename}")

    # Parse and validate
    parsed = parse_filename(filename, config)
    if parsed is None:
        reject_file(file_path, config)
        return False

    # Determine format from folder path
    folder_format = determine_format_from_path(file_path, config)
    if folder_format is None:
        logger.warning(f"Could not determine format from path: {file_path}")
        reject_file(file_path, config)
        return False

    # Verify content type format matches folder
    if parsed["content_type_format"] != folder_format:
        logger.warning(
            f"Content type '{parsed['prefix']}' is {parsed['content_type_format']} "
            f"but file is in {folder_format} folder"
        )
        reject_file(file_path, config)
        return False

    # Build webhook payload
    payload = {
        "asset_id": parsed["asset_id"],
        "topic_slug": parsed["topic_slug"],
        "content_type": parsed["content_type"],
        "session_id": parsed["session_id"],
        "file_path": file_path,
        "format": folder_format,
        "client_id": client_id,
    }

    trigger_webhook(payload)
    return True


def reject_file(file_path: str, config: dict):
    """Move invalid file to the rejected folder."""
    # Determine which base folder this came from
    base_dir = None
    for folder in config["folders"].values():
        folder_abs = os.path.abspath(folder["local_path"])
        if os.path.abspath(file_path).startswith(folder_abs):
            base_dir = os.path.dirname(folder_abs.rstrip("/"))
            break

    if base_dir is None:
        base_dir = os.path.dirname(os.path.dirname(file_path))

    rejected_dir = os.path.join(base_dir, "rejected")
    os.makedirs(rejected_dir, exist_ok=True)

    dest = os.path.join(rejected_dir, os.path.basename(file_path))
    if os.path.exists(file_path):
        shutil.move(file_path, dest)
        logger.info(f"Moved to rejected: {dest}")


def watch_folders(config: dict):
    """
    Watch all configured folders for new .mp4 files.
    Uses watchdog library for file system events.
    """
    try:
        from watchdog.observers import Observer
        from watchdog.events import FileSystemEventHandler
    except ImportError:
        logger.error("watchdog library not installed. Run: pip install watchdog")
        sys.exit(1)

    class Mp4Handler(FileSystemEventHandler):
        def on_created(self, event):
            if event.is_directory:
                return
            if event.src_path.endswith(".mp4"):
                # Brief delay to ensure file is fully written
                time.sleep(1)
                handle_new_file(event.src_path, config)

    observer = Observer()
    handler = Mp4Handler()

    for format_key, folder in config["folders"].items():
        path = os.path.abspath(folder["local_path"])
        os.makedirs(path, exist_ok=True)
        observer.schedule(handler, path, recursive=False)
        logger.info(f"Watching: {path} ({folder['name']})")

    observer.start()
    logger.info("Watcher started. Press Ctrl+C to stop.")

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s"
    )

    client_id = sys.argv[1] if len(sys.argv) > 1 else "dre-alexandra"
    config = load_config(client_id)
    watch_folders(config)
