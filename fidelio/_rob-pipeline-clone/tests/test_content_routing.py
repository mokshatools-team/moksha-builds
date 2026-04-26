import types
import unittest
from pathlib import Path
from unittest.mock import patch


class ContentTypeTests(unittest.TestCase):
    def test_get_content_type_returns_short_form_for_portrait_video(self):
        from local.ingest.ffprobe import get_content_type

        self.assertEqual(get_content_type({"width": 1080, "height": 1920}), "short_form")

    def test_get_content_type_returns_long_form_for_landscape_and_missing_data(self):
        from local.ingest.ffprobe import get_content_type

        self.assertEqual(get_content_type({"width": 1920, "height": 1080}), "long_form")
        self.assertEqual(get_content_type({"width": None, "height": 1920}), "long_form")


class BrandPromptTests(unittest.TestCase):
    def test_short_form_prompt_uses_hook_output_format(self):
        from local.pipeline.brand import build_metadata_system_prompt

        profile = {
            "display_name": "Dre Alexandra",
            "language": "fr-CA",
            "voice": "Warm",
            "tone": "Direct",
            "title_style": "Existing long-form rule",
            "description_template": "Describe it",
            "avoid": [],
            "emphasize": [],
        }

        prompt = build_metadata_system_prompt(profile, content_type="short_form")

        self.assertIn('"hook": "..."', prompt)
        self.assertNotIn('"title_2": "..."', prompt)
        self.assertIn("punchy hook-first 1-liner", prompt)


class WatcherRoutingTests(unittest.TestCase):
    def test_ingest_handler_skips_pass1_for_short_form(self):
        from local.watcher import IngestHandler

        handler = IngestHandler(client={}, cache_dir=Path("/tmp/cache"), thumb_dir=Path("/tmp/thumbs"))
        path = Path("/tmp/reel.mp4")

        with patch("local.watcher._wait_for_stable", return_value=True), \
             patch.dict("sys.modules", {"local.pipeline.pass1": types.SimpleNamespace(run_pass1=object())}), \
             patch("local.ingest.ffprobe.extract_metadata", return_value={"width": 1080, "height": 1920}), \
             patch("local.ingest.ffprobe.get_content_type", return_value="short_form"), \
             patch("local.pipeline.pass1.run_pass1") as run_pass1:
            handler._handle(path)

        run_pass1.assert_not_called()

    def test_export_handler_passes_content_type_to_pass2(self):
        from local.watcher import ExportHandler

        handler = ExportHandler(client={}, cache_dir=Path("/tmp/cache"), thumb_dir=Path("/tmp/thumbs"))
        path = Path("/tmp/reel.mp4")

        with patch("local.watcher._wait_for_stable", return_value=True), \
             patch.dict("sys.modules", {"local.pipeline.pass2": types.SimpleNamespace(run_pass2=object())}), \
             patch("local.ingest.ffprobe.extract_metadata", return_value={"width": 1080, "height": 1920}), \
             patch("local.ingest.ffprobe.get_content_type", return_value="short_form"), \
             patch("local.pipeline.pass2.run_pass2") as run_pass2:
            handler._handle(path)

        run_pass2.assert_called_once_with(
            path,
            {},
            Path("/tmp/cache"),
            Path("/tmp/thumbs"),
            content_type="short_form",
        )


class Pass2RoutingTests(unittest.TestCase):
    def test_short_form_run_pass2_skips_thumbnail_and_marks_export(self):
        from local.pipeline.pass2 import run_pass2

        client = {"sheets_id": "sheet-123", "language": "fr-CA"}
        export_path = Path("/tmp/reel.mp4")

        with patch("local.ingest.transcribe.transcribe", return_value={"text": "Transcript"}), \
             patch("local.ingest.transcribe.transcript_summary", return_value="Summary"), \
             patch("local.pipeline.brand.load_profile", return_value={"display_name": "Dre Alexandra"}), \
             patch("local.ingest.ffprobe.extract_metadata", return_value={"duration_formatted": "59s"}), \
             patch("local.pipeline.metadata.generate_metadata", return_value={
                 "title_1": "Title",
                 "hook": "Hook",
                 "description": "Desc",
                 "tags": "tag1, tag2",
             }) as generate_metadata, \
             patch("local.pipeline.thumbnail.generate_thumbnail") as generate_thumbnail, \
             patch("local.sheets.connector.append_row") as append_row, \
             patch("local.sheets.connector.find_row", return_value={"_row_index": 7}), \
             patch("local.sheets.connector.update_cell") as update_cell:
            run_pass2(export_path, client, Path("/tmp/cache"), Path("/tmp/thumbs"), content_type="short_form")

        generate_thumbnail.assert_not_called()
        generate_metadata.assert_called_once_with(
            transcript={"text": "Transcript"},
            profile={"display_name": "Dre Alexandra"},
            export_name="reel",
            content_type="short_form",
        )
        export_row = append_row.call_args_list[0].args[2]
        metadata_row = append_row.call_args_list[1].args[2]
        self.assertEqual(export_row["Content Type"], "Short-form Reel")
        self.assertEqual(metadata_row["Thumbnail URL"], "")
        update_cell.assert_called_once_with("sheet-123", "Exports", 7, "Status", "Ready for Review")


class QueueApiTests(unittest.TestCase):
    def test_api_queue_includes_content_type_and_defaults_to_long_form(self):
        from web.app import app

        def fake_get_all_rows(_sheets_id, tab_name):
            if tab_name == "Exports":
                return [
                    {"File Name": "portrait.mp4", "Content Type": "Short-form Reel"},
                    {"File Name": "landscape.mp4"},
                ]
            return []

        with patch("local.sheets.connector.get_all_rows", side_effect=fake_get_all_rows):
            client = app.test_client()
            response = client.get("/api/dre-alexandra/queue")

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        items = {item["file_name"]: item for item in payload["items"]}
        self.assertEqual(items["portrait.mp4"]["content_type"], "Short-form Reel")
        self.assertEqual(items["landscape.mp4"]["content_type"], "Long-form")


if __name__ == "__main__":
    unittest.main()
