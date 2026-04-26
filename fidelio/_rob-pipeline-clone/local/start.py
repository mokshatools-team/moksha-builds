#!/usr/bin/env python3
"""
Fidelio Pipeline — Entry Point
Usage: python local/start.py --client dre-alexandra
"""
import argparse
import json
import os
import subprocess
import sys
import logging
import threading
import time
import webbrowser
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(override=True)

BASE_DIR = Path(__file__).parent.parent
CONFIG_DIR = BASE_DIR / "config" / "clients"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("fidelio")


def load_client(client_id: str) -> dict:
    config_path = CONFIG_DIR / f"{client_id}.json"
    if not config_path.exists():
        log.error(f"Client config not found: {config_path}")
        sys.exit(1)
    with open(config_path, encoding="utf-8") as f:
        return json.load(f)


def ensure_dirs():
    cache_dir = Path(os.path.expanduser(os.getenv("CACHE_DIR", "~/.fidelio/cache")))
    thumb_dir = Path(os.path.expanduser(os.getenv("THUMBNAIL_DIR", "~/.fidelio/thumbnails")))
    cache_dir.mkdir(parents=True, exist_ok=True)
    thumb_dir.mkdir(parents=True, exist_ok=True)
    return cache_dir, thumb_dir


def main():
    parser = argparse.ArgumentParser(description="Fidelio Pipeline Daemon")
    parser.add_argument("--client", required=True, help="Client ID (e.g. dre-alexandra)")
    parser.add_argument("--pass1-only", action="store_true", help="Only watch ingest folder (skip export watch)")
    parser.add_argument("--pass2-only", action="store_true", help="Only watch export folder (skip ingest watch)")
    args = parser.parse_args()

    client = load_client(args.client)
    cache_dir, thumb_dir = ensure_dirs()

    log.info(f"Starting Fidelio Pipeline — client: {client['display_name']}")
    log.info(f"Cache: {cache_dir}")
    log.info(f"Thumbnails: {thumb_dir}")

    ingest_folder = Path(client["ingest_folder"])
    watch_folder = Path(client["watch_folder"])

    if not ingest_folder.exists():
        log.warning(f"Ingest folder not found (will watch when it appears): {ingest_folder}")
    if not watch_folder.exists():
        log.warning(f"Watch folder not found (will watch when it appears): {watch_folder}")

    from local.monitor import start_monitor_server
    start_monitor_server(port=5401)
    log.info("Monitor: http://localhost:5401")

    # Start Review UI alongside daemon
    review_port = int(os.getenv("PORT", 5400))

    def _start_review_ui():
        env = os.environ.copy()
        env["PORT"] = str(review_port)
        subprocess.run(
            [sys.executable, str(BASE_DIR / "web" / "app.py")],
            env=env,
        )

    review_thread = threading.Thread(target=_start_review_ui, daemon=True, name="review-ui")
    review_thread.start()
    log.info(f"Review UI: http://localhost:{review_port}/review/{client['client_id']}")

    # Import here so we fail fast if watchdog isn't installed
    from local.watcher import start_watchers

    # Open browser tabs after a brief delay so servers are ready
    review_url = f"http://localhost:{review_port}/review/{client['client_id']}"
    sheets_url = f"https://docs.google.com/spreadsheets/d/{client['sheets_id']}"

    def _open_browser():
        time.sleep(1.5)
        webbrowser.open("http://localhost:5401")
        webbrowser.open(review_url)
        webbrowser.open(sheets_url)

    threading.Thread(target=_open_browser, daemon=True, name="browser-open").start()

    start_watchers(client, args, cache_dir, thumb_dir)


if __name__ == "__main__":
    main()
