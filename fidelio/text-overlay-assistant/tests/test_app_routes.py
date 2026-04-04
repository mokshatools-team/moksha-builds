import json
import os
import tempfile
import unittest
from unittest import mock

from app import app


class RouteValidationTests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_index_contains_youtube_input(self):
        response = self.client.get("/")

        self.assertEqual(response.status_code, 200)
        self.assertIn(b"Paste a YouTube URL", response.data)

    def test_transcribe_rejects_both_filename_and_youtube_url(self):
        response = self.client.post(
            "/transcribe",
            json={
                "filename": "clip.mp4",
                "youtube_url": "https://www.youtube.com/watch?v=abc123",
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("either a file or a YouTube URL", response.get_json()["error"])

    def test_transcribe_rejects_neither_filename_nor_youtube_url(self):
        response = self.client.post("/transcribe", json={})

        self.assertEqual(response.status_code, 400)
        self.assertIn("Choose a file or paste a YouTube URL", response.get_json()["error"])

    @mock.patch(
        "app.fetch_transcript_entries",
        return_value=[
            {"time": "0:12", "text": "Line one"},
            {"time": "0:37", "text": "Line two"},
        ],
    )
    def test_transcribe_accepts_youtube_url_and_builds_entries(self, fetch_transcript_entries):
        response = self.client.post(
            "/transcribe",
            json={"youtube_url": "https://www.youtube.com/watch?v=abc123"},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["entries"][0]["time"], "0:12")
        self.assertEqual(payload["entries"][1]["time"], "0:37")
        fetch_transcript_entries.assert_called_once_with(
            "https://www.youtube.com/watch?v=abc123",
            offset_seconds=0.0,
        )

    def test_auth_youtube_prefers_redirect_uri_from_client_secrets(self):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as tmp:
            json.dump(
                {
                    "web": {
                        "client_id": "client-id",
                        "client_secret": "client-secret",
                        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                        "token_uri": "https://oauth2.googleapis.com/token",
                        "redirect_uris": ["https://toa.example.com/auth/callback"],
                    }
                },
                tmp,
            )
            tmp_path = tmp.name

        flow_instance = mock.Mock()
        flow_instance.authorization_url.return_value = ("https://google.test/auth", "oauth-state")
        flow_instance.code_verifier = "pkce-verifier"
        flow_class = mock.Mock()
        flow_class.from_client_secrets_file.return_value = flow_instance

        try:
            with mock.patch("app._require_google_client_secrets", return_value=tmp_path), mock.patch(
                "app._import_google_oauth",
                return_value=(flow_class, None, None, None),
            ):
                response = self.client.get("/auth/youtube", base_url="https://generated-host.example")
        finally:
            os.unlink(tmp_path)

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.location, "https://google.test/auth")
        flow_class.from_client_secrets_file.assert_called_once_with(
            tmp_path,
            scopes=[
                "https://www.googleapis.com/auth/youtube.readonly",
                "https://www.googleapis.com/auth/youtube.force-ssl",
            ],
            redirect_uri="https://toa.example.com/auth/callback",
        )

    def test_auth_youtube_stores_pkce_verifier_in_session(self):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as tmp:
            json.dump(
                {
                    "web": {
                        "client_id": "client-id",
                        "client_secret": "client-secret",
                        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                        "token_uri": "https://oauth2.googleapis.com/token",
                        "redirect_uris": ["https://toa.example.com/auth/callback"],
                    }
                },
                tmp,
            )
            tmp_path = tmp.name

        flow_instance = mock.Mock()
        flow_instance.authorization_url.return_value = ("https://google.test/auth", "oauth-state")
        flow_instance.code_verifier = "pkce-verifier"
        flow_class = mock.Mock()
        flow_class.from_client_secrets_file.return_value = flow_instance

        try:
            with mock.patch("app._require_google_client_secrets", return_value=tmp_path), mock.patch(
                "app._import_google_oauth",
                return_value=(flow_class, None, None, None),
            ):
                response = self.client.get("/auth/youtube")
                with self.client.session_transaction() as session_state:
                    stored_verifier = session_state.get("google_oauth_code_verifier")
        finally:
            os.unlink(tmp_path)

        self.assertEqual(response.status_code, 302)
        self.assertEqual(stored_verifier, "pkce-verifier")

    def test_auth_callback_restores_pkce_verifier_before_fetch_token(self):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as tmp:
            json.dump(
                {
                    "web": {
                        "client_id": "client-id",
                        "client_secret": "client-secret",
                        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                        "token_uri": "https://oauth2.googleapis.com/token",
                        "redirect_uris": ["https://toa.example.com/auth/callback"],
                    }
                },
                tmp,
            )
            tmp_path = tmp.name

        flow_instance = mock.Mock()
        flow_instance.credentials = mock.Mock(
            token="token",
            refresh_token="refresh",
            token_uri="https://oauth2.googleapis.com/token",
            client_id="client-id",
            client_secret="client-secret",
            scopes=["https://www.googleapis.com/auth/youtube.force-ssl"],
            expiry=None,
        )
        flow_class = mock.Mock()
        flow_class.from_client_secrets_file.return_value = flow_instance

        try:
            with self.client.session_transaction() as session_state:
                session_state["google_oauth_state"] = "oauth-state"
                session_state["google_oauth_code_verifier"] = "pkce-verifier"

            with mock.patch("app._require_google_client_secrets", return_value=tmp_path), mock.patch(
                "app._import_google_oauth",
                return_value=(flow_class, None, None, None),
            ):
                response = self.client.get("/auth/callback?code=abc&state=oauth-state")
        finally:
            os.unlink(tmp_path)

        self.assertEqual(response.status_code, 302)
        self.assertEqual(flow_instance.code_verifier, "pkce-verifier")
        flow_instance.fetch_token.assert_called_once()

    def test_auth_youtube_does_not_request_incremental_granted_scopes(self):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as tmp:
            json.dump(
                {
                    "web": {
                        "client_id": "client-id",
                        "client_secret": "client-secret",
                        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                        "token_uri": "https://oauth2.googleapis.com/token",
                        "redirect_uris": ["https://toa.example.com/auth/callback"],
                    }
                },
                tmp,
            )
            tmp_path = tmp.name

        flow_instance = mock.Mock()
        flow_instance.authorization_url.return_value = ("https://google.test/auth", "oauth-state")
        flow_instance.code_verifier = "pkce-verifier"
        flow_class = mock.Mock()
        flow_class.from_client_secrets_file.return_value = flow_instance

        try:
            with mock.patch("app._require_google_client_secrets", return_value=tmp_path), mock.patch(
                "app._import_google_oauth",
                return_value=(flow_class, None, None, None),
            ):
                response = self.client.get("/auth/youtube")
        finally:
            os.unlink(tmp_path)

        self.assertEqual(response.status_code, 302)
        flow_instance.authorization_url.assert_called_once_with(
            access_type="offline",
            prompt="consent",
        )

    def test_api_videos_lists_public_and_unlisted_videos_longer_than_three_minutes(self):
        youtube = mock.Mock()
        youtube.channels.return_value.list.return_value.execute.return_value = {
            "items": [
                {
                    "contentDetails": {
                        "relatedPlaylists": {
                            "uploads": "uploads-playlist",
                        }
                    }
                }
            ]
        }
        youtube.playlistItems.return_value.list.return_value.execute.return_value = {
            "items": [
                {
                    "snippet": {
                        "title": "Published long video",
                        "publishedAt": "2026-04-01T10:00:00Z",
                        "resourceId": {"videoId": "videoA"},
                        "thumbnails": {"medium": {"url": "https://img.example/a.jpg"}},
                    },
                    "status": {"privacyStatus": "public"},
                },
                {
                    "snippet": {
                        "title": "Short clip",
                        "publishedAt": "2026-04-01T09:00:00Z",
                        "resourceId": {"videoId": "videoB"},
                        "thumbnails": {"medium": {"url": "https://img.example/b.jpg"}},
                    },
                    "status": {"privacyStatus": "public"},
                },
                {
                    "snippet": {
                        "title": "Private draft",
                        "publishedAt": "2026-04-01T08:00:00Z",
                        "resourceId": {"videoId": "videoC"},
                        "thumbnails": {"medium": {"url": "https://img.example/c.jpg"}},
                    },
                    "status": {"privacyStatus": "private"},
                },
                {
                    "snippet": {
                        "title": "Unlisted long video",
                        "publishedAt": "2026-04-01T07:00:00Z",
                        "resourceId": {"videoId": "videoD"},
                        "thumbnails": {"medium": {"url": "https://img.example/d.jpg"}},
                    },
                    "status": {"privacyStatus": "unlisted"},
                },
            ]
        }
        youtube.videos.return_value.list.return_value.execute.return_value = {
            "items": [
                {"id": "videoA", "contentDetails": {"duration": "PT4M1S"}},
                {"id": "videoB", "contentDetails": {"duration": "PT59S"}},
                {"id": "videoC", "contentDetails": {"duration": "PT8M0S"}},
                {"id": "videoD", "contentDetails": {"duration": "PT12M0S"}},
            ]
        }

        with mock.patch("app._youtube_service_from_session", return_value=youtube):
            response = self.client.get("/api/videos")

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload["authenticated"])
        self.assertEqual(
            payload["videos"],
            [
                {
                    "videoId": "videoA",
                    "title": "Published long video",
                    "thumbnail": "https://img.example/a.jpg",
                    "publishedAt": "2026-04-01T10:00:00Z",
                    "privacyStatus": "public",
                },
                {
                    "videoId": "videoD",
                    "title": "Unlisted long video",
                    "thumbnail": "https://img.example/d.jpg",
                    "publishedAt": "2026-04-01T07:00:00Z",
                    "privacyStatus": "unlisted",
                },
            ],
        )
