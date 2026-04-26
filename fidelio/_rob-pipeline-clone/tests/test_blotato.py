import os
import tempfile
import unittest
from unittest.mock import Mock, patch


class BlotatoClientTests(unittest.TestCase):
    @patch.dict(os.environ, {"BLOTATO_API_KEY": "test-key"}, clear=False)
    def test_upload_local_video_returns_public_url(self):
        from web.posting.blotato import upload_local_video

        create_upload = Mock()
        create_upload.status_code = 201
        create_upload.json.return_value = {
            "presignedUrl": "https://upload.example.com/put",
            "publicUrl": "https://cdn.example.com/video.mp4",
        }
        upload_result = Mock(status_code=200, text="")

        with tempfile.NamedTemporaryFile(suffix=".mp4") as handle:
            with patch("web.posting.blotato.requests.Session.request", return_value=create_upload) as request:
                with patch("web.posting.blotato.requests.put", return_value=upload_result) as put_request:
                    public_url = upload_local_video(handle.name)

        self.assertEqual(public_url, "https://cdn.example.com/video.mp4")
        _, kwargs = request.call_args
        self.assertEqual(kwargs["method"], "POST")
        self.assertIn("/media/uploads", kwargs["url"])
        self.assertEqual(kwargs["json"]["filename"], os.path.basename(handle.name))
        put_request.assert_called_once()

    @patch.dict(os.environ, {"BLOTATO_API_KEY": "test-key"}, clear=False)
    def test_create_scheduled_post_uses_account_id_and_media_urls(self):
        from web.posting.blotato import create_scheduled_post

        accounts = Mock()
        accounts.status_code = 200
        accounts.json.return_value = {"items": [{"id": "32469", "platform": "youtube"}]}
        create_post = Mock()
        create_post.status_code = 201
        create_post.json.return_value = {"postSubmissionId": "post_456"}

        with patch("web.posting.blotato.requests.Session.request", side_effect=[accounts, create_post]) as request:
            post_id = create_scheduled_post(
                platform="youtube",
                media_urls=["https://cdn.example.com/video.mp4"],
                schedule_time_iso="2026-04-07T10:00:00Z",
                title="Launch clip",
                description="Episode description",
                tags=["launch", "clinic"],
            )

        self.assertEqual(post_id, "post_456")
        _, kwargs = request.call_args_list[-1]
        self.assertEqual(kwargs["method"], "POST")
        self.assertIn("/posts", kwargs["url"])
        self.assertEqual(kwargs["json"]["post"]["accountId"], "32469")
        self.assertEqual(kwargs["json"]["post"]["content"]["platform"], "youtube")
        self.assertEqual(kwargs["json"]["post"]["content"]["mediaUrls"], ["https://cdn.example.com/video.mp4"])
        self.assertEqual(kwargs["json"]["scheduledTime"], "2026-04-07T10:00:00Z")
        self.assertEqual(kwargs["json"]["post"]["target"]["targetType"], "youtube")

    @patch.dict(os.environ, {"BLOTATO_API_KEY": "test-key"}, clear=False)
    def test_get_post_status_normalizes_response(self):
        from web.posting.blotato import get_post_status

        response = Mock()
        response.status_code = 200
        response.json.return_value = {
            "post": {
                "status": "published",
                "post_url": "https://instagram.com/p/example",
            }
        }

        with patch("web.posting.blotato.requests.Session.request", return_value=response):
            status = get_post_status("post_456")

        self.assertEqual(
            status,
            {
                "status": "published",
                "post_url": "https://instagram.com/p/example",
            },
        )

    @patch.dict(os.environ, {"BLOTATO_API_KEY": "test-key"}, clear=False)
    def test_api_errors_include_status_code_and_body(self):
        from web.posting.blotato import BlotatoAPIError, get_post_status

        response = Mock()
        response.status_code = 429
        response.text = '{"error":"slow down"}'

        with patch("web.posting.blotato.requests.Session.request", return_value=response):
            with self.assertRaises(BlotatoAPIError) as exc:
                get_post_status("post_456")

        self.assertIn("429", str(exc.exception))
        self.assertIn("slow down", str(exc.exception))


if __name__ == "__main__":
    unittest.main()
