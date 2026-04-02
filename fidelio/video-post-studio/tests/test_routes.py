import unittest

from app.app import create_app
from app.routes import shell as shell_routes


class RouteTests(unittest.TestCase):
    def setUp(self):
        shell_routes.reset_workspace_state()
        self.client = create_app().test_client()

    def test_home_page_renders_video_post_studio_and_transcript_chat(self):
        response = self.client.get("/")

        self.assertEqual(response.status_code, 200)
        self.assertIn(b"Video Post Studio", response.data)
        self.assertIn(b"Demo Workspace", response.data)
        self.assertIn(b"import", response.data)
        self.assertIn(b"Transcript Chat", response.data)
        self.assertIn(b"Current workspace", response.data)
        self.assertIn(b"0 source assets", response.data)
        self.assertIn(b'href="/import"', response.data)
        self.assertIn(b'href="/toa"', response.data)
        self.assertIn(b'href="/transcript-chat"', response.data)

    def test_import_module_page_preserves_shell_navigation(self):
        response = self.client.get("/import")

        self.assertEqual(response.status_code, 200)
        self.assertIn(b"Video Post Studio", response.data)
        self.assertIn(b"Import", response.data)
        self.assertIn(b"Source ingestion", response.data)
        self.assertIn(b'<form action="/import" method="post">', response.data)
        self.assertIn(b'name="source_type"', response.data)
        self.assertIn(b'name="title"', response.data)
        self.assertIn(b'name="source_value"', response.data)
        self.assertIn(b'href="/toa"', response.data)
        self.assertIn(b'href="/transcript-chat"', response.data)

    def test_import_post_adds_source_to_workspace(self):
        response = self.client.post(
            "/import",
            data={
                "source_type": "upload",
                "title": "Episode 12",
                "source_value": "episode-12.mp4",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertIn(b"Episode 12", response.data)
        self.assertIn(b"episode-12.mp4", response.data)
        self.assertIn(b"1 source assets", response.data)

    def test_import_post_shows_transcript_actions_when_transcript_is_ready(self):
        response = self.client.post(
            "/import",
            data={
                "source_type": "public_url",
                "title": "Reference video",
                "source_value": "https://example.com/video",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertIn(b"Copy Transcript", response.data)
        self.assertIn(b"Download Transcript", response.data)
        self.assertIn(b'href="/transcripts/active.txt"', response.data)
        self.assertIn(b"Open TOA", response.data)
        self.assertIn(b'href="/toa"', response.data)
        self.assertIn(b'<textarea id="active-transcript-preview"', response.data)
        self.assertIn(
            b"navigator.clipboard.writeText(document.getElementById('active-transcript-preview').value).catch",
            response.data,
        )
        self.assertIn(
            b"Mock transcript for Reference video from public_url: https://example.com/video",
            response.data,
        )

    def test_transcript_download_returns_plain_text_file(self):
        self.client.post(
            "/import",
            data={
                "source_type": "upload",
                "title": "Episode 12",
                "source_value": "episode-12.mp4",
            },
        )

        response = self.client.get("/transcripts/active.txt")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.mimetype, "text/plain")
        self.assertEqual(
            response.headers["Content-Disposition"],
            'attachment; filename="episode-12-transcript.txt"',
        )
        self.assertEqual(
            response.get_data(as_text=True),
            "Mock transcript for Episode 12 from upload: episode-12.mp4",
        )

    def test_import_post_rerenders_form_with_validation_errors(self):
        response = self.client.post(
            "/import",
            data={
                "source_type": "not-valid",
                "title": "",
                "source_value": "",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertIn(b"Title is required.", response.data)
        self.assertIn(b"Source value is required.", response.data)
        self.assertIn(b"Source type must be one of upload, public_url, owned_account.", response.data)
        self.assertIn(b"0 source assets", response.data)

    def test_toa_module_page_preserves_shell_navigation(self):
        response = self.client.get("/toa")

        self.assertEqual(response.status_code, 200)
        self.assertIn(b'data-active-module="toa"', response.data)
        self.assertIn(b"TOA", response.data)
        self.assertIn(b"Active module: TOA", response.data)
        self.assertIn(b"Workspace: Demo Workspace", response.data)
        self.assertIn(b"Video Post Studio", response.data)
        self.assertIn(b'href="/import"', response.data)
        self.assertIn(b'href="/transcript-chat"', response.data)

    def test_toa_page_shows_empty_state_without_shared_transcript(self):
        response = self.client.get("/toa")

        self.assertEqual(response.status_code, 200)
        self.assertIn(b"Transcript available: No", response.data)
        self.assertIn(b"Transcript length: 0 characters", response.data)
        self.assertIn(b"Transcript preview: None", response.data)
        self.assertIn(b"No shared transcript is ready for TOA yet.", response.data)

    def test_toa_page_shows_adapter_status_from_shared_transcript_workspace(self):
        self.client.post(
            "/import",
            data={
                "source_type": "upload",
                "title": "Episode 12",
                "source_value": "episode-12.mp4",
            },
        )

        response = self.client.get("/toa")

        self.assertEqual(response.status_code, 200)
        self.assertIn(b"TOA workspace status", response.data)
        self.assertIn(b"Transcript available: Yes", response.data)
        self.assertIn(b"Transcript length:", response.data)
        self.assertIn(
            b"Transcript preview: Mock transcript for Episode 12 from upload:",
            response.data,
        )
        self.assertIn(
            b"TOA can now operate from the shared transcript layer.",
            response.data,
        )

    def test_transcript_chat_module_page_preserves_shell_navigation(self):
        response = self.client.get("/transcript-chat")

        self.assertEqual(response.status_code, 200)
        self.assertIn(b"Transcript Chat", response.data)
        self.assertIn(b"Video Post Studio", response.data)
        self.assertIn(b'href="/import"', response.data)
        self.assertIn(b'href="/toa"', response.data)

    def test_unknown_module_route_returns_404(self):
        response = self.client.get("/unknown-module")

        self.assertEqual(response.status_code, 404)

    def test_run_module_builds_the_shell_from_the_app_factory(self):
        from run import create_app as run_create_app

        response = run_create_app().test_client().get("/")

        self.assertEqual(response.status_code, 200)
        self.assertIn(b"Video Post Studio", response.data)
        self.assertIn(b"Transcript Chat", response.data)
