"""
YouTube upload + processing poll for FDL1 Publishing Pipeline.
In mock mode: returns a hardcoded URL after a short delay.
"""

import os
import time
import logging

logger = logging.getLogger("fdl1.youtube")

MOCK_MODE = os.environ.get("FDL1_MOCK_MODE", "true").lower() == "true"
POLL_INTERVAL = 30  # seconds
POLL_TIMEOUT = 1800  # 30 minutes
MAX_RETRIES = 3


def upload_to_youtube(file_path: str, title: str, description: str = "", config: dict = None) -> str:
    """
    Upload video to YouTube as Unlisted.
    Returns the YouTube video URL.

    In mock mode: returns a fake URL after a brief delay.
    In real mode: uses YouTube Data API v3 with OAuth.
    """
    if MOCK_MODE:
        return _mock_upload(file_path, title)

    return _real_upload(file_path, title, description, config)


def _mock_upload(file_path: str, title: str) -> str:
    """Mock upload — simulates a successful YouTube upload."""
    logger.info(f"[MOCK] Uploading to YouTube: {title}")
    logger.info(f"[MOCK] File: {file_path}")
    time.sleep(2)  # Simulate upload time
    mock_video_id = "MOCK_VIDEO_" + title.replace(" ", "_")[:20]
    mock_url = f"https://www.youtube.com/watch?v={mock_video_id}"
    logger.info(f"[MOCK] Upload complete. URL: {mock_url}")
    logger.info(f"[MOCK] Processing status: succeeded")
    return mock_url


def _real_upload(file_path: str, title: str, description: str, config: dict) -> str:
    """
    Real YouTube upload via Data API v3.
    Requires OAuth credentials in environment variables.
    """
    # This will be implemented when real credentials are available.
    # Steps:
    # 1. Authenticate with OAuth using refresh token from env
    # 2. Upload video as Unlisted via videos.insert
    # 3. Poll processing status every POLL_INTERVAL seconds
    # 4. Return YouTube URL on success, raise on timeout

    raise NotImplementedError(
        "Real YouTube upload not yet implemented. Set FDL1_MOCK_MODE=true."
    )


def poll_processing_status(video_id: str) -> bool:
    """
    Poll YouTube for video processing status.
    Returns True when processing is complete, raises on timeout.
    """
    if MOCK_MODE:
        logger.info(f"[MOCK] Processing complete for {video_id}")
        return True

    elapsed = 0
    while elapsed < POLL_TIMEOUT:
        # Real implementation: call videos.list with processingDetails
        # Check processingStatus == "succeeded"
        time.sleep(POLL_INTERVAL)
        elapsed += POLL_INTERVAL

    raise TimeoutError(f"YouTube processing timed out after {POLL_TIMEOUT}s for {video_id}")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    url = upload_to_youtube("/tmp/test.mp4", "Test Video Upload")
    print(f"YouTube URL: {url}")
