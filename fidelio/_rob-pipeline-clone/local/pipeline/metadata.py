"""
Fidelio Pipeline — 2-Pass Claude Metadata Generation
Pass 1: Draft titles, description, tags from transcript + brand profile
Pass 2: Claude self-refines against brand rules
"""
import json
import logging
import os
import re

import anthropic

log = logging.getLogger("fidelio.metadata")
_client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

MODEL = "claude-sonnet-4-6"
MAX_TRANSCRIPT_CHARS = 8000  # Keep prompts tight


def generate_metadata(
    transcript: dict,
    profile: dict,
    export_name: str,
    content_type: str = "long_form",
) -> dict:
    """
    Run 2-pass Claude metadata generation.
    Returns dict: title_1, title_2, title_3, description, tags
    """
    from local.pipeline.brand import build_metadata_system_prompt

    system_prompt = build_metadata_system_prompt(profile, content_type=content_type)
    transcript_text = transcript.get("text", "")[:MAX_TRANSCRIPT_CHARS]

    # ── Pass 1: Draft ─────────────────────────────────────────
    log.info("[Metadata] Pass 1 — drafting...")
    user_msg_p1 = (
        f"Video file: {export_name}\n\n"
        f"TRANSCRIPT:\n{transcript_text}\n\n"
        "Generate the metadata JSON now."
    )

    resp1 = _client.messages.create(
        model=MODEL,
        max_tokens=1024,
        system=system_prompt,
        messages=[{"role": "user", "content": user_msg_p1}],
    )
    draft_raw = resp1.content[0].text.strip()
    draft = _parse_json(draft_raw)

    if not draft:
        log.warning("[Metadata] Pass 1 returned unparseable JSON — using raw text")
        return _fallback(draft_raw, export_name)

    log.info(f"[Metadata] Pass 1 draft: {draft.get('title_1', '(no title)')[:60]}")

    # ── Pass 2: Refine ────────────────────────────────────────
    log.info("[Metadata] Pass 2 — refining...")
    user_msg_p2 = (
        f"Here is your draft metadata:\n{json.dumps(draft, ensure_ascii=False, indent=2)}\n\n"
        "Review it against the brand rules. Check:\n"
        "1. Do the titles follow the title style exactly?\n"
        "2. Is the tone correct — not too formal, not alarmist?\n"
        "3. Is the description the right length and format?\n"
        "4. Are tags relevant and well-mixed (broad + specific)?\n\n"
        "Return the refined JSON. Only change what needs improving."
    )

    resp2 = _client.messages.create(
        model=MODEL,
        max_tokens=1024,
        system=system_prompt,
        messages=[
            {"role": "user", "content": user_msg_p1},
            {"role": "assistant", "content": draft_raw},
            {"role": "user", "content": user_msg_p2},
        ],
    )
    refined_raw = resp2.content[0].text.strip()
    refined = _parse_json(refined_raw)

    if refined:
        log.info(f"[Metadata] Pass 2 refined: {refined.get('title_1', '')[:60]}")
        return refined

    log.warning("[Metadata] Pass 2 unparseable — using Pass 1 draft")
    return draft


def _parse_json(text: str) -> dict | None:
    """Extract and parse JSON from model output (handles markdown code fences)."""
    # Strip markdown code fences if present
    text = re.sub(r"```(?:json)?\s*", "", text).strip().rstrip("```").strip()

    # Try to find JSON object
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass
    return None


def _fallback(raw_text: str, export_name: str) -> dict:
    """Return a minimal metadata dict if JSON parsing fails completely."""
    log.error("[Metadata] Could not parse any JSON from Claude — returning stub")
    return {
        "title_1": export_name,
        "title_2": export_name,
        "title_3": export_name,
        "description": raw_text[:500] if raw_text else "",
        "tags": "",
    }
