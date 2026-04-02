import io
import unittest
from unittest import mock

from app import app, reset_app_state


class TranscriptChatRouteTests(unittest.TestCase):
    def setUp(self):
        reset_app_state()
        self.client = app.test_client()

    def test_home_page_renders_transcript_chat_shell(self):
        response = self.client.get("/")

        self.assertEqual(response.status_code, 200)
        self.assertIn(b"Transcript Chat Assistant", response.data)
        self.assertIn(b"Paste a public video URL", response.data)
        self.assertIn(b"Connect your Google account", response.data)
        self.assertIn(b"Chat with the transcript", response.data)

    def test_transcribe_rejects_missing_source(self):
        response = self.client.post("/transcribe", json={})

        self.assertEqual(response.status_code, 400)
        self.assertIn("Choose a file or paste a YouTube URL", response.get_json()["error"])

    @mock.patch("app.fetch_transcript_entries")
    @mock.patch("app.fetch_youtube_title", return_value="Hook Breakdown")
    def test_transcribe_accepts_youtube_url_and_builds_active_session(
        self,
        fetch_youtube_title,
        fetch_transcript_entries,
    ):
        fetch_transcript_entries.return_value = [
            {"time": "0:00", "text": "First line"},
            {"time": "0:12", "text": "Second line"},
        ]

        response = self.client.post(
            "/transcribe",
            json={"youtube_url": "https://www.youtube.com/watch?v=abc123"},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["title"], "Hook Breakdown")
        self.assertEqual(payload["transcript_text"], "First line\n\nSecond line")
        self.assertEqual(payload["entries"][1]["time"], "0:12")
        self.assertEqual(payload["messages"], [])
        fetch_youtube_title.assert_called_once_with("https://www.youtube.com/watch?v=abc123")
        fetch_transcript_entries.assert_called_once_with(
            "https://www.youtube.com/watch?v=abc123",
            offset_seconds=0.0,
        )

    @mock.patch("app.fetch_transcript_entries")
    def test_upload_transcribe_uses_filename_as_default_title(self, fetch_transcript_entries):
        fetch_transcript_entries.return_value = [{"time": "0:00", "text": "Uploaded clip"}]

        response = self.client.post(
            "/transcribe",
            data={"file": (io.BytesIO(b"fake video bytes"), "Client Hooks.mov")},
            content_type="multipart/form-data",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["title"], "Client Hooks")
        self.assertEqual(payload["transcript_text"], "Uploaded clip")

    def test_download_requires_active_transcript(self):
        response = self.client.get("/download/transcript.txt")

        self.assertEqual(response.status_code, 404)

    @mock.patch("app.fetch_transcript_entries", return_value=[{"time": "0:00", "text": "Alpha"}, {"time": "0:03", "text": "Beta"}])
    def test_download_txt_returns_plain_text_transcript(self, fetch_transcript_entries):
        self.client.post(
            "/transcribe",
            json={"youtube_url": "https://www.youtube.com/watch?v=abc123"},
        )

        response = self.client.get("/download/transcript.txt")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.mimetype, "text/plain")
        self.assertIn("attachment; filename=", response.headers["Content-Disposition"])
        self.assertEqual(response.get_data(as_text=True), "Alpha\n\nBeta")

    @mock.patch("app.fetch_transcript_entries", return_value=[{"time": "0:00", "text": "Alpha"}])
    def test_chat_requires_active_transcript(self, fetch_transcript_entries):
        response = self.client.post("/chat", json={"message": "Summarize this"})

        self.assertEqual(response.status_code, 400)
        self.assertIn("Load a transcript before chatting.", response.get_json()["error"])

    @mock.patch("app._chat_with_transcript", return_value="It is about narrative hooks.")
    @mock.patch("app.fetch_transcript_entries", return_value=[{"time": "0:00", "text": "Alpha"}])
    def test_chat_responds_with_transcript_grounded_reply(self, fetch_transcript_entries, chat_with_transcript):
        self.client.post(
            "/transcribe",
            json={"youtube_url": "https://www.youtube.com/watch?v=abc123"},
        )

        response = self.client.post("/chat", json={"message": "What is the core idea?"})

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["reply"], "It is about narrative hooks.")
        self.assertEqual(payload["messages"][0]["role"], "user")
        self.assertEqual(payload["messages"][1]["role"], "assistant")
        chat_with_transcript.assert_called_once()

    @mock.patch("app._chat_with_transcript", return_value="Old reply")
    @mock.patch("app.fetch_transcript_entries")
    def test_new_transcript_resets_prior_chat_messages(self, fetch_transcript_entries, chat_with_transcript):
        fetch_transcript_entries.side_effect = [
            [{"time": "0:00", "text": "First transcript"}],
            [{"time": "0:00", "text": "Second transcript"}],
        ]

        self.client.post(
            "/transcribe",
            json={"youtube_url": "https://www.youtube.com/watch?v=first123"},
        )
        self.client.post("/chat", json={"message": "Tell me more"})

        response = self.client.post(
            "/transcribe",
            json={"youtube_url": "https://www.youtube.com/watch?v=second123"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["messages"], [])
