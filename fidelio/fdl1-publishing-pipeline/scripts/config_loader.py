"""
Config loader for FDL1 Publishing Pipeline.
Reads and validates CLIENT.json for a given client.
"""

import json
import os
import sys

REQUIRED_TOP_LEVEL = [
    "client_id", "client_name", "language",
    "folders", "content_types", "platforms",
    "sheets", "youtube", "publer", "caption_prompts"
]

REQUIRED_FOLDER_FIELDS = ["name", "tab", "local_path", "platforms", "copy_module_required"]
REQUIRED_PLATFORM_FIELDS = ["name", "type", "publer_account_id"]


def load_config(client_id: str, base_path: str = None) -> dict:
    """Load and validate CLIENT.json for the given client_id."""
    if base_path is None:
        base_path = os.path.join(os.path.dirname(__file__), "..", "clients")

    config_path = os.path.join(base_path, client_id, "CLIENT.json")

    if not os.path.exists(config_path):
        raise FileNotFoundError(f"Config not found: {config_path}")

    with open(config_path, "r", encoding="utf-8") as f:
        config = json.load(f)

    validate_config(config)
    return config


def validate_config(config: dict):
    """Validate that all required fields are present in the config."""
    # Top-level fields
    for field in REQUIRED_TOP_LEVEL:
        if field not in config:
            raise ValueError(f"Missing required top-level field: {field}")

    # Folders
    if not config["folders"]:
        raise ValueError("Config must have at least one folder defined")

    for folder_key, folder in config["folders"].items():
        for field in REQUIRED_FOLDER_FIELDS:
            if field not in folder:
                raise ValueError(f"Folder '{folder_key}' missing field: {field}")

        # Check that folder platforms reference valid platform keys
        for platform_key in folder["platforms"]:
            if platform_key not in config["platforms"]:
                raise ValueError(
                    f"Folder '{folder_key}' references unknown platform: {platform_key}"
                )

    # Platforms
    for platform_key, platform in config["platforms"].items():
        for field in REQUIRED_PLATFORM_FIELDS:
            if field not in platform:
                raise ValueError(f"Platform '{platform_key}' missing field: {field}")

    # Content types
    for ct_key, ct in config["content_types"].items():
        if "name" not in ct or "format" not in ct:
            raise ValueError(f"Content type '{ct_key}' missing 'name' or 'format'")
        if ct["format"] not in config["folders"]:
            raise ValueError(
                f"Content type '{ct_key}' references unknown format: {ct['format']}"
            )

    # Sheets
    if "workbook_id" not in config["sheets"]:
        raise ValueError("sheets.workbook_id is required")

    # YouTube
    if "channel_id" not in config["youtube"]:
        raise ValueError("youtube.channel_id is required")

    # Publer
    if "workspace_id" not in config["publer"]:
        raise ValueError("publer.workspace_id is required")


def get_platforms_for_format(config: dict, format_key: str) -> list:
    """Return list of platform keys for a given format (short_form/long_form)."""
    folder = config["folders"].get(format_key)
    if not folder:
        return []
    return folder["platforms"]


def get_content_type(config: dict, prefix: str):
    """Look up content type by prefix (e.g. 'PS', 'POD')."""
    return config["content_types"].get(prefix)


def get_sheet_columns(config: dict, format_key: str) -> list:
    """Generate sheet column list dynamically based on active platforms for a format."""
    platforms = get_platforms_for_format(config, format_key)

    # Fixed columns
    columns = [
        "asset_id", "filename", "content_type", "session_id",
        "youtube_url", "created_date"
    ]

    # Caption columns per platform
    for p in platforms:
        columns.append(f"caption_{p}")

    # Date columns per platform
    for p in platforms:
        columns.append(f"date_{p}")

    # Publer ID columns per platform
    for p in platforms:
        columns.append(f"publer_id_{p}")

    # Status columns per platform
    for p in platforms:
        columns.append(f"status_{p}")

    # Trailing fixed columns
    columns.extend(["flagged", "flag_note", "copy_ready", "pipeline_status"])

    return columns


if __name__ == "__main__":
    # Quick test
    client_id = sys.argv[1] if len(sys.argv) > 1 else "dre-alexandra"
    config = load_config(client_id)
    print(f"Loaded config for: {config['client_name']}")
    print(f"Language: {config['language']}")
    print(f"Folders: {list(config['folders'].keys())}")
    print(f"Content types: {list(config['content_types'].keys())}")
    print(f"Platforms: {list(config['platforms'].keys())}")
    print(f"\nShort-form columns ({len(get_sheet_columns(config, 'short_form'))}):")
    for col in get_sheet_columns(config, "short_form"):
        print(f"  {col}")
    print(f"\nLong-form columns ({len(get_sheet_columns(config, 'long_form'))}):")
    for col in get_sheet_columns(config, "long_form"):
        print(f"  {col}")
