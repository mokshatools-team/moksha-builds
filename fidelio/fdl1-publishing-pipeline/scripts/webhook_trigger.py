"""
Webhook trigger for FDL1 Publishing Pipeline.
POSTs file detection events to the FDL1 Railway service.
In mock mode: prints the payload instead of sending.
"""

import os
import json
import logging

logger = logging.getLogger("fdl1.webhook")

MOCK_MODE = os.environ.get("FDL1_MOCK_MODE", "true").lower() == "true"


def trigger_webhook(payload: dict) -> bool:
    """
    POST payload to FDL1 pipeline service.
    payload: { asset_id, topic_slug, content_type, session_id, file_path, format, client_id }
    """
    if MOCK_MODE:
        return _mock_trigger(payload)

    return _real_trigger(payload)


def _mock_trigger(payload: dict) -> bool:
    """Mock trigger — prints payload to console."""
    logger.info(f"[MOCK WEBHOOK] Would POST to FDL1 pipeline service:")
    logger.info(json.dumps(payload, indent=2, ensure_ascii=False))
    return True


def _real_trigger(payload: dict) -> bool:
    """
    Real trigger — POSTs to FDL1_PIPELINE_URL/webhook/pipeline.
    """
    import requests

    pipeline_url = os.environ.get("FDL1_PIPELINE_URL")
    if not pipeline_url:
        raise ValueError("FDL1_PIPELINE_URL environment variable not set")

    webhook_secret = os.environ.get("WEBHOOK_RECEIVER_SECRET", "")

    url = f"{pipeline_url.rstrip('/')}/webhook/pipeline"
    headers = {"X-Webhook-Secret": webhook_secret}

    try:
        response = requests.post(url, json=payload, headers=headers, timeout=30)
        response.raise_for_status()
        logger.info(f"Pipeline triggered: {response.json()}")
        return True
    except requests.RequestException as e:
        logger.error(f"Pipeline trigger failed: {e}")
        raise


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    trigger_webhook({
        "asset_id": "PS14.1",
        "topic_slug": "test video court",
        "content_type": "Podcast Short",
        "session_id": "14",
        "file_path": "./test-drop/dre-alexandra/short-form/PS14.1 test video court.mp4",
        "format": "short_form",
        "client_id": "dre-alexandra"
    })
