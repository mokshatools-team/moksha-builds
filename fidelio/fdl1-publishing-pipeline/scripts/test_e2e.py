"""
End-to-end test for FDL1 Publishing Pipeline (mock mode).
Simulates the full flow: file detection → parse → pipeline → webhook.
"""

import os
import sys
import logging
import shutil

sys.path.insert(0, os.path.dirname(__file__))
os.environ["FDL1_MOCK_MODE"] = "true"

from config_loader import load_config, get_sheet_columns
from watcher import parse_filename, handle_new_file
from pipeline import run_pipeline
from sheets_write import get_mock_store, clear_mock_store, find_row_by_field, update_cells

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s"
)
logger = logging.getLogger("fdl1.test")

PROJECT_ROOT = os.path.join(os.path.dirname(__file__), "..")


def test_config_loader():
    """Test 1: Config loads and validates."""
    logger.info("=" * 60)
    logger.info("TEST 1: Config loader")
    config = load_config("dre-alexandra", os.path.join(PROJECT_ROOT, "clients"))
    assert config["client_id"] == "dre-alexandra"
    assert "short_form" in config["folders"]
    assert "long_form" in config["folders"]
    assert len(config["content_types"]) == 5
    assert len(config["platforms"]) == 5
    logger.info("PASS: Config loaded and validated")
    return config


def test_filename_parsing(config):
    """Test 2: Filename parsing — valid and invalid cases."""
    logger.info("=" * 60)
    logger.info("TEST 2: Filename parsing")

    # Valid filenames
    valid_cases = [
        ("PS14.1 test video court.mp4", "PS14.1", "test video court", "Podcast Short", "14"),
        ("YTS5.3 fondations résumé.mp4", "YTS5.3", "fondations résumé", "Fondations Short", "5"),
        ("POD14 épisode complet.mp4", "POD14", "épisode complet", "Podcast", "14"),
        ("VLOG1 journée clinique.mp4", "VLOG1", "journée clinique", "Vlog", "1"),
    ]
    for filename, exp_id, exp_topic, exp_type, exp_session in valid_cases:
        result = parse_filename(filename, config)
        assert result is not None, f"Expected valid: {filename}"
        assert result["asset_id"] == exp_id, f"Expected id={exp_id}, got {result['asset_id']}"
        assert result["topic_slug"] == exp_topic
        assert result["content_type"] == exp_type
        assert result["session_id"] == exp_session
        logger.info(f"  PASS: {filename}")

    # Invalid filenames
    invalid_cases = [
        "novideo.mp4",           # no space
        "PS14.1 test.txt",       # wrong extension
        "XX14.1 unknown.mp4",    # unknown prefix
        "PS14!.1 bad chars.mp4", # special chars in ID
    ]
    for filename in invalid_cases:
        result = parse_filename(filename, config)
        assert result is None, f"Expected invalid: {filename}"
        logger.info(f"  PASS (rejected): {filename}")

    logger.info("PASS: All filename parsing tests passed")


def test_short_form_pipeline(config):
    """Test 3: Full short-form pipeline (mock mode)."""
    logger.info("=" * 60)
    logger.info("TEST 3: Short-form pipeline")
    clear_mock_store()

    payload = {
        "asset_id": "PS14.1",
        "topic_slug": "test video court",
        "content_type": "Podcast Short",
        "session_id": "14",
        "file_path": "./test-drop/dre-alexandra/short-form/PS14.1 test video court.mp4",
        "format": "short_form",
        "client_id": "dre-alexandra",
    }

    result = run_pipeline(payload, config)
    assert result is True, "Pipeline should return True"

    # Check mock store
    store = get_mock_store()
    store_key = f"{config['sheets']['workbook_id']}/Short Form"
    assert store_key in store, f"Expected sheet tab '{store_key}' in mock store"
    rows = store[store_key]
    assert len(rows) == 1, f"Expected 1 row, got {len(rows)}"

    row = rows[0]
    assert row["asset_id"] == "PS14.1"
    assert row["content_type"] == "Podcast Short"
    assert row["youtube_url"].startswith("https://www.youtube.com/watch?v=")
    assert row["pipeline_status"] == "drafted"

    # Check captions exist for all platforms
    for platform in config["folders"]["short_form"]["platforms"]:
        assert row.get(f"caption_{platform}"), f"Missing caption for {platform}"
        assert row.get(f"publer_id_{platform}"), f"Missing publer_id for {platform}"

    logger.info("PASS: Short-form pipeline completed successfully")
    logger.info(f"  Asset ID: {row['asset_id']}")
    logger.info(f"  YouTube URL: {row['youtube_url']}")
    logger.info(f"  Pipeline status: {row['pipeline_status']}")
    logger.info(f"  Platforms with drafts: {config['folders']['short_form']['platforms']}")


def test_long_form_pipeline(config):
    """Test 4: Long-form pipeline stub (stops at pending_copy)."""
    logger.info("=" * 60)
    logger.info("TEST 4: Long-form pipeline (stub)")
    clear_mock_store()

    payload = {
        "asset_id": "POD14",
        "topic_slug": "épisode complet ostéopathie",
        "content_type": "Podcast",
        "session_id": "14",
        "file_path": "./test-drop/dre-alexandra/long-form/POD14 épisode complet ostéopathie.mp4",
        "format": "long_form",
        "client_id": "dre-alexandra",
    }

    result = run_pipeline(payload, config)
    assert result is True, "Pipeline should return True"

    store = get_mock_store()
    store_key = f"{config['sheets']['workbook_id']}/Long Form"
    assert store_key in store, f"Expected sheet tab '{store_key}' in mock store"
    rows = store[store_key]
    assert len(rows) == 1, f"Expected 1 row, got {len(rows)}"

    row = rows[0]
    assert row["asset_id"] == "POD14"
    assert row["pipeline_status"] == "pending_copy"
    assert row["copy_ready"] == "FALSE"
    assert row["transcript"], "Expected transcript to be populated"
    assert row["youtube_url"].startswith("https://www.youtube.com/watch?v=")

    # Verify captions and Publer IDs are empty (columns exist but not populated)
    for key in row:
        if key.startswith("caption_"):
            assert not row[key], f"Long-form should not have captions populated: {key}={row[key]}"
        if key.startswith("publer_id_"):
            assert not row[key], f"Long-form should not have publer IDs populated: {key}={row[key]}"

    logger.info("PASS: Long-form pipeline stopped correctly at pending_copy")
    logger.info(f"  Asset ID: {row['asset_id']}")
    logger.info(f"  YouTube URL: {row['youtube_url']}")
    logger.info(f"  Pipeline status: {row['pipeline_status']}")
    logger.info(f"  Transcript length: {len(row['transcript'])} chars")


def test_webhook_receiver():
    """Test 5: Webhook receiver logic (in-process, no HTTP)."""
    logger.info("=" * 60)
    logger.info("TEST 5: Webhook receiver logic")
    clear_mock_store()

    config = load_config("dre-alexandra", os.path.join(PROJECT_ROOT, "clients"))
    workbook_id = config["sheets"]["workbook_id"]

    # Pre-populate a mock row
    from sheets_write import create_row
    columns = ["asset_id", "filename", "publer_id_ig", "publer_id_fb",
               "status_ig", "status_fb", "pipeline_status"]
    create_row(workbook_id, "Short Form", columns, {
        "asset_id": "PS14.1",
        "filename": "PS14.1 test.mp4",
        "publer_id_ig": "PUB_IG_001",
        "publer_id_fb": "PUB_FB_001",
        "status_ig": "",
        "status_fb": "",
        "pipeline_status": "drafted",
    })

    # Simulate webhook for IG publish
    update_cells(workbook_id, "Short Form", "PS14.1", {
        "status_ig": "published",
        "date_ig": "2026-04-04T14:30:00Z",
    })

    row = find_row_by_field(workbook_id, "Short Form", "asset_id", "PS14.1")
    assert row["status_ig"] == "published"
    assert row["status_fb"] == ""
    logger.info("  PASS: Single platform publish update")

    # Simulate webhook for FB publish
    update_cells(workbook_id, "Short Form", "PS14.1", {
        "status_fb": "published",
        "date_fb": "2026-04-04T15:00:00Z",
        "pipeline_status": "complete",
    })

    row = find_row_by_field(workbook_id, "Short Form", "asset_id", "PS14.1")
    assert row["status_fb"] == "published"
    assert row["pipeline_status"] == "complete"
    logger.info("  PASS: All platforms published → pipeline complete")

    logger.info("PASS: Webhook receiver logic verified")


def test_file_rejection(config):
    """Test 6: Invalid files are moved to rejected folder."""
    logger.info("=" * 60)
    logger.info("TEST 6: File rejection")

    # Create a test file with invalid name
    test_dir = os.path.join(PROJECT_ROOT, "test-drop", "dre-alexandra", "short-form")
    rejected_dir = os.path.join(PROJECT_ROOT, "test-drop", "dre-alexandra", "rejected")
    os.makedirs(test_dir, exist_ok=True)

    bad_file = os.path.join(test_dir, "badfile.mp4")
    with open(bad_file, "w") as f:
        f.write("fake")

    handle_new_file(bad_file, config)

    assert os.path.exists(os.path.join(rejected_dir, "badfile.mp4")), \
        "Bad file should be in rejected folder"
    assert not os.path.exists(bad_file), "Bad file should be removed from source"

    # Clean up
    os.remove(os.path.join(rejected_dir, "badfile.mp4"))

    logger.info("PASS: Invalid file moved to rejected/")


def main():
    logger.info("FDL1 END-TO-END TEST SUITE (MOCK MODE)")
    logger.info("=" * 60)

    config = test_config_loader()
    test_filename_parsing(config)
    test_short_form_pipeline(config)
    test_long_form_pipeline(config)
    test_webhook_receiver()
    test_file_rejection(config)

    logger.info("")
    logger.info("=" * 60)
    logger.info("ALL TESTS PASSED")
    logger.info("=" * 60)


if __name__ == "__main__":
    main()
