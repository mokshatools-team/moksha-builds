"""
post_producer.py — YouTube content package generator.

Backend: "claude" (default) or "openai". Set POST_BACKEND in .env to switch.
Two-pass approach:
  Pass 1 — generate raw content package (titles, description, timestamps, etc.)
  Pass 2 — automatic revision pass (polished before the user ever sees it)
"""

import json
import logging
from typing import Optional, Callable

logger = logging.getLogger(__name__)

import os
# Backend: "claude" (default) or "openai"
POST_BACKEND = os.getenv("POST_BACKEND", "claude")
MODEL = os.getenv("POST_MODEL", "claude-haiku-4-5-20251001")
MAX_TOKENS = 4096

# Per-million-token pricing (USD)
_PRICING = {
    "gpt-4o-mini":       {"input": 0.15,  "output": 0.60},
    "gpt-4o":            {"input": 5.00,  "output": 15.00},
    "claude-haiku-4-5":  {"input": 0.80,  "output": 4.00},
    "claude-sonnet-4-6": {"input": 3.00,  "output": 15.00},
}
_DEFAULT_PRICING = {"input": 0.15, "output": 0.60}


def _calc_cost(input_tokens: int, output_tokens: int, model: str) -> float:
    p = _PRICING.get(model, _DEFAULT_PRICING)
    return round((input_tokens / 1_000_000) * p["input"] + (output_tokens / 1_000_000) * p["output"], 6)

SYSTEM_PROMPT = """\
You are a senior YouTube content producer. You analyze video transcripts and produce publication-ready metadata packages.

LANGUAGE DIRECTIVE — CRITICAL: This channel is French Canadian. Work directly from the French source — do NOT translate to English as an intermediate step. All output must be in French Canadian. Pull title hooks and key phrases directly from the speaker's own words. Preserve her natural voice and cadence.

Output ONLY a valid JSON object with exactly these keys:

{
  "editorial_frame": "2-3 sentence internal brief: what this video is really about, the core insight or story, written for the editor",
  "titles": [
    "Option 1 — most direct, benefit-driven",
    "Option 2 — curiosity or question angle",
    "Option 3 — story or emotional hook"
  ],
  "description": "Full YouTube description (300-500 words). Cover key topics, value proposition, relevant keywords. End with 5-7 hashtags.",
  "timestamps": [
    {"time": "0:00", "label": "Introduction"},
    {"time": "4:30", "label": "Titre du chapitre"},
    {"time": "12:00", "label": "Autre section"}
  ],
  "thumbnail_copy": "Short punchy thumbnail overlay text (3-7 words max)"
}

RULES:
- Every timestamp MUST include both "time" AND "label". A timestamp with no label is invalid.
- Timestamp labels are short French Canadian chapter titles (2-5 words).
- No text outside the JSON. No markdown fences. Just the JSON object.\
"""

REVISION_INSTRUCTION = """\
Review the content package you just generated. Make it sharper, more accurate \
to the video content, and more engaging. Improve title hooks, tighten the \
description, and verify timestamps are plausible given the transcript length.

All content must remain in French Canadian. Stay close to the speaker's actual \
words and phrasing from the transcript — do not anglicize or genericize the voice.

Output ONLY the refined JSON object. No other text.\
"""


def _build_user_text(transcript: str, video_title: str, channel: str, profile: dict) -> str:
    brand_block = f"""\
Brand/Channel: {profile.get('name', channel or 'Unknown')}
Voice: {profile.get('voice', 'Professional, engaging, clear')}
Tone: {profile.get('tone', 'Conversational but authoritative')}
Format notes: {profile.get('format_notes', 'Standard YouTube format')}
Title style: {profile.get('title_style', 'Clear, benefit-driven')}
Thumbnail style: {profile.get('thumbnail_style', 'Bold statement or question')}
"""
    if profile.get('description_example'):
        brand_block += f"\nExample description style:\n{profile['description_example']}\n"
    return f'Video: "{video_title}" by {channel}\n\n{brand_block}\nTRANSCRIPT:\n{transcript}\n\nGenerate the complete content package.'


def _chat(messages: list) -> tuple:
    """Call the configured LLM backend. Returns (text, input_tokens, output_tokens)."""
    if POST_BACKEND == "claude":
        import anthropic
        client = anthropic.Anthropic()
        # Extract system message (always first in our message lists)
        system = ""
        chat_msgs = []
        for m in messages:
            if m["role"] == "system":
                system = m["content"]
            else:
                chat_msgs.append(m)
        resp = client.messages.create(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            system=system,
            messages=chat_msgs,
        )
        text = resp.content[0].text if resp.content else ""
        return text, resp.usage.input_tokens, resp.usage.output_tokens
    else:
        import openai
        client = openai.OpenAI()
        resp = client.chat.completions.create(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            messages=messages,
        )
        text = resp.choices[0].message.content or ""
        return text, resp.usage.prompt_tokens, resp.usage.completion_tokens


def generate_package(
    transcript: str,
    video_title: str,
    channel: str,
    profile: dict,
    progress_cb=None,
) -> dict:
    """Two-pass generation. Returns the final parsed content package dict."""
    user_text = _build_user_text(transcript, video_title, channel, profile)

    # ── Pass 1 ─────────────────────────────────────────────────────────────────
    if progress_cb:
        progress_cb("Pass 1 — generating content package…")

    msgs1 = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user",   "content": user_text},
    ]
    pass1_text, in1, out1 = _chat(msgs1)
    cost1 = _calc_cost(in1, out1, MODEL)
    logger.info(f"Pass 1 — {in1} in / {out1} out tokens — ${cost1:.5f}")

    # ── Pass 2 — revision ─────────────────────────────────────────────────────
    if progress_cb:
        progress_cb("Pass 2 — revision pass…")

    msgs2 = msgs1 + [
        {"role": "assistant", "content": pass1_text},
        {"role": "user",      "content": REVISION_INSTRUCTION},
    ]
    pass2_text, in2, out2 = _chat(msgs2)
    cost2 = _calc_cost(in2, out2, MODEL)
    total_cost = round(cost1 + cost2, 6)
    logger.info(f"Pass 2 — {in2} in / {out2} out tokens — ${cost2:.5f} | Total: ${total_cost:.5f}")

    package = _parse_json(pass2_text) or _parse_json(pass1_text) or _fallback(video_title)
    package["_cost_usd"] = total_cost
    package["_model"] = MODEL
    return package


def revise_section(
    current_package: dict,
    section_name: str,
    instruction: str,
    transcript_snippet: str,
    profile: dict,
) -> dict:
    """Revise one section of the content package per user instruction."""
    prompt = f"""\
Current content package:
{json.dumps(current_package, indent=2)}

Transcript snippet (context):
{transcript_snippet[:3000]}

User instruction for "{section_name}": {instruction}

Brand voice: {profile.get('voice', 'Professional, engaging')}

Revise the "{section_name}" field based on the instruction. \
Output the COMPLETE updated JSON package with ALL fields preserved. No other text.\
"""
    msgs = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user",   "content": prompt},
    ]
    text, in_tok, out_tok = _chat(msgs)
    cost = _calc_cost(in_tok, out_tok, MODEL)
    logger.info(f"Revise {section_name} — ${cost:.5f}")
    result = _parse_json(text) or current_package
    result["_cost_usd"] = round(current_package.get("_cost_usd", 0) + cost, 6)
    result["_model"] = MODEL
    return result


def _parse_json(text: str) -> Optional[dict]:
    """Extract and parse JSON from a string, tolerating markdown fences."""
    if not text:
        return None
    # Strip markdown code fences if present
    text = text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        text = "\n".join(lines[1:-1] if lines[-1] == "```" else lines[1:])
    try:
        start = text.find("{")
        end = text.rfind("}") + 1
        if start >= 0 and end > start:
            return json.loads(text[start:end])
    except json.JSONDecodeError as e:
        logger.warning(f"JSON parse failed: {e}")
    return None


def _fallback(title: str) -> dict:
    return {
        "editorial_frame": "Generation failed — please retry.",
        "titles": [title, title, title],
        "description": "",
        "timestamps": [{"time": "0:00", "label": "Introduction"}],
        "thumbnail_copy": title[:30],
    }
