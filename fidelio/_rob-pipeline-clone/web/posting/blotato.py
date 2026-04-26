import mimetypes
import os
from pathlib import Path
from typing import Any

import requests


BASE_URL = "https://backend.blotato.com/v2"
SUPPORTED_PLATFORMS = {"youtube", "instagram", "tiktok", "facebook"}


class BlotatoAPIError(RuntimeError):
    pass


class BlotatoClient:
    def __init__(self, api_key: str | None = None, base_url: str = BASE_URL) -> None:
        self.api_key = api_key or os.getenv("BLOTATO_API_KEY")
        if not self.api_key:
            raise ValueError("BLOTATO_API_KEY is not set")
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()
        self.session.headers.update({"blotato-api-key": self.api_key, "Accept": "application/json"})
        self._accounts_by_platform: dict[str, dict[str, Any]] | None = None

    def get_accounts(self) -> list[dict[str, Any]]:
        payload = self._request("GET", "/users/me/accounts")
        items = payload.get("items", [])
        if not isinstance(items, list):
            raise BlotatoAPIError(f"Unexpected accounts response: {payload}")
        self._accounts_by_platform = {
            str(item.get("platform", "")).lower(): item
            for item in items
            if isinstance(item, dict) and item.get("platform") and item.get("id")
        }
        return items

    def get_account_id(self, platform: str) -> str:
        normalized = platform.lower()
        if normalized not in SUPPORTED_PLATFORMS:
            supported = ", ".join(sorted(SUPPORTED_PLATFORMS))
            raise ValueError(f"Unsupported platform '{platform}'. Expected one of: {supported}")
        if self._accounts_by_platform is None:
            self.get_accounts()
        account = (self._accounts_by_platform or {}).get(normalized)
        if not account:
            raise BlotatoAPIError(f"No Blotato account found for platform '{platform}'")
        return str(account["id"])

    def get_connected_platforms(self) -> set[str]:
        if self._accounts_by_platform is None:
            self.get_accounts()
        return set((self._accounts_by_platform or {}).keys())

    def upload_local_video(self, file_path: str) -> str:
        path = Path(file_path).expanduser()
        if not path.is_file():
            raise FileNotFoundError(f"Video file not found: {path}")

        payload = self._request("POST", "/media/uploads", json={"filename": path.name}, expected_statuses=(201,))
        presigned_url = self._extract_required(payload, ("presignedUrl",))
        public_url = self._extract_required(payload, ("publicUrl", "url"))
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"

        with path.open("rb") as handle:
            response = requests.put(presigned_url, data=handle, headers={"Content-Type": content_type}, timeout=120)
        if response.status_code not in {200, 201, 204}:
            raise BlotatoAPIError(
                f"Blotato presigned upload failed with status {response.status_code}: {response.text}"
            )
        return public_url

    def create_post(
        self,
        *,
        platform: str,
        media_urls: list[str],
        schedule_time_iso: str,
        title: str,
        description: str,
        tags: list[str] | None,
    ) -> str:
        normalized = platform.lower()
        account_id = self.get_account_id(normalized)
        payload = self._request(
            "POST",
            "/posts",
            json={
                "post": {
                    "accountId": account_id,
                    "content": {
                        "text": self._build_text(description, tags),
                        "mediaUrls": media_urls,
                        "platform": normalized,
                    },
                    "target": self._build_target(normalized, title),
                },
                "scheduledTime": schedule_time_iso,
            },
            expected_statuses=(200, 201),
        )
        return self._extract_required(payload, ("postSubmissionId", "id"))

    def get_post_status(self, post_id: str) -> dict[str, Any]:
        payload = self._request("GET", f"/posts/{post_id}")
        post = payload.get("post") if isinstance(payload.get("post"), dict) else payload
        status = self._extract_optional(post, ("status", "state"))
        post_url = self._extract_optional(post, ("post_url", "url", "permalink"))
        result = {"status": status}
        if post_url:
            result["post_url"] = post_url
        return result

    def _request(
        self,
        method: str,
        path: str,
        *,
        expected_statuses: tuple[int, ...] = (200,),
        **kwargs: Any,
    ) -> dict[str, Any]:
        response = self.session.request(method=method, url=f"{self.base_url}{path}", timeout=30, **kwargs)
        if response.status_code not in expected_statuses:
            raise BlotatoAPIError(
                f"Blotato API request failed with status {response.status_code}: {response.text}"
            )
        try:
            payload = response.json()
        except ValueError as exc:
            raise BlotatoAPIError(f"Blotato API returned invalid JSON: {response.text}") from exc
        if not isinstance(payload, dict):
            raise BlotatoAPIError(f"Blotato API returned unexpected payload: {payload!r}")
        return payload

    @staticmethod
    def _build_text(description: str, tags: list[str] | None) -> str:
        if not tags:
            return description
        return f"{description}\n\nTags: {', '.join(tags)}"

    @staticmethod
    def _build_target(platform: str, title: str) -> dict[str, Any]:
        if platform == "youtube":
            return {
                "targetType": "youtube",
                "title": title,
                "privacyStatus": "public",
                "shouldNotifySubscribers": False,
            }
        if platform == "tiktok":
            return {
                "targetType": "tiktok",
                "privacyLevel": "PUBLIC_TO_EVERYONE",
                "disabledComments": False,
                "disabledDuet": False,
                "disabledStitch": False,
                "isBrandedContent": False,
                "isYourBrand": False,
                "isAiGenerated": False,
                "title": title[:90],
            }
        if platform in {"instagram", "facebook"}:
            return {"targetType": platform}
        raise ValueError(f"Unsupported platform '{platform}'")

    @classmethod
    def _extract_required(cls, payload: dict[str, Any], candidates: tuple[str, ...]) -> str:
        value = cls._extract_optional(payload, candidates)
        if value:
            return value
        for key in ("post", "media", "data"):
            nested = payload.get(key)
            if isinstance(nested, dict):
                value = cls._extract_optional(nested, candidates)
                if value:
                    return value
        raise BlotatoAPIError(f"Blotato API response missing required field {candidates}: {payload}")

    @staticmethod
    def _extract_optional(payload: dict[str, Any], fields: tuple[str, ...]) -> str | None:
        for field in fields:
            value = payload.get(field)
            if isinstance(value, str) and value:
                return value
        return None


def upload_local_video(file_path: str) -> str:
    return BlotatoClient().upload_local_video(file_path)


def create_scheduled_post(
    *,
    platform: str,
    media_urls: list[str],
    schedule_time_iso: str,
    title: str,
    description: str,
    tags: list[str] | None,
) -> str:
    return BlotatoClient().create_post(
        platform=platform,
        media_urls=media_urls,
        schedule_time_iso=schedule_time_iso,
        title=title,
        description=description,
        tags=tags,
    )


def get_post_status(post_id: str) -> dict[str, Any]:
    return BlotatoClient().get_post_status(post_id=post_id)


def get_connected_platforms() -> set[str]:
    return BlotatoClient().get_connected_platforms()
