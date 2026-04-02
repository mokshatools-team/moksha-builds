"""Shell routes for the Video Post Studio app."""

import re

from flask import Blueprint, Response, abort, render_template, request

from app.models.contracts import Workspace
from app.services.toa_adapter import build_toa_workspace_summary
from app.services.workspaces import build_demo_workspace, import_source_with_mock_transcript

shell_bp = Blueprint("shell", __name__)
ALLOWED_SOURCE_TYPES = ("upload", "public_url", "owned_account")
_workspace_state = build_demo_workspace()

MODULES = {
    "import": {
        "label": "Import",
        "description": "Source ingestion for uploads and imports.",
    },
    "toa": {
        "label": "TOA",
        "description": "Overlay assembly for timed text burns.",
    },
    "transcript-chat": {
        "label": "Transcript Chat",
        "description": "Conversation tools built on the shared transcript.",
    },
}


def _workspace_for_module(active_module: str) -> Workspace:
    return Workspace(
        id=_workspace_state.id,
        name=_workspace_state.name,
        active_module=active_module,
        active_transcript_session=_workspace_state.active_transcript_session,
        source_assets=_workspace_state.source_assets,
    )


def reset_workspace_state():
    global _workspace_state

    _workspace_state = build_demo_workspace()


def _build_shell_context(active_module: str, form_data=None, errors=None):
    workspace = _workspace_for_module(active_module)
    module_info = MODULES[active_module]
    return {
        "workspace": workspace,
        "active_module_key": active_module,
        "active_module_label": module_info["label"],
        "active_module_description": module_info["description"],
        "workspace_summary": f"{len(workspace.source_asset_ids)} source assets",
        "modules": MODULES,
        "allowed_source_types": ALLOWED_SOURCE_TYPES,
        "toa_workspace_summary": (
            build_toa_workspace_summary(workspace) if active_module == "toa" else None
        ),
        "form_data": form_data
        or {
            "source_type": ALLOWED_SOURCE_TYPES[0],
            "title": "",
            "source_value": "",
        },
        "errors": errors or [],
    }


def _validate_import_form(form_data):
    errors = []

    if not form_data["title"]:
        errors.append("Title is required.")

    if not form_data["source_value"]:
        errors.append("Source value is required.")

    if form_data["source_type"] not in ALLOWED_SOURCE_TYPES:
        errors.append(
            "Source type must be one of upload, public_url, owned_account."
        )

    return errors


def _active_transcript_filename(workspace: Workspace) -> str:
    """Build a plain-text transcript filename from the active source title."""

    if workspace.source_assets:
        title = workspace.source_assets[0].title.strip().lower()
        safe_title = re.sub(r"[^a-z0-9]+", "-", title).strip("-")
        if safe_title:
            return f"{safe_title}-transcript.txt"

    return "transcript.txt"


@shell_bp.route("/")
def home():
    return render_template("base.html", **_build_shell_context("import"))


@shell_bp.route("/import", methods=["GET", "POST"])
def import_page():
    global _workspace_state

    form_data = {
        "source_type": request.form.get("source_type", ALLOWED_SOURCE_TYPES[0]).strip(),
        "title": request.form.get("title", "").strip(),
        "source_value": request.form.get("source_value", "").strip(),
    }

    if request.method == "POST":
        errors = _validate_import_form(form_data)
        if not errors:
            _workspace_state = import_source_with_mock_transcript(
                _workspace_state,
                source_type=form_data["source_type"],
                title=form_data["title"],
                source_value=form_data["source_value"],
            )

            form_data = {
                "source_type": ALLOWED_SOURCE_TYPES[0],
                "title": "",
                "source_value": "",
            }
            return render_template(
                "module.html",
                **_build_shell_context("import", form_data=form_data),
            )

        return render_template(
            "module.html",
            **_build_shell_context("import", form_data=form_data, errors=errors),
        )

    return render_template("module.html", **_build_shell_context("import", form_data=form_data))


@shell_bp.route("/transcripts/active.txt")
def download_active_transcript():
    transcript_session = _workspace_state.active_transcript_session
    if transcript_session is None:
        abort(404)

    return Response(
        transcript_session.transcript_text,
        mimetype="text/plain",
        headers={
            "Content-Disposition": (
                f'attachment; filename="{_active_transcript_filename(_workspace_state)}"'
            )
        },
    )


@shell_bp.route("/<module_key>")
def module_page(module_key: str):
    if module_key not in MODULES:
        abort(404)

    return render_template("module.html", **_build_shell_context(module_key))
