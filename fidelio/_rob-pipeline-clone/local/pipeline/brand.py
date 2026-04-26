"""
Fidelio Pipeline — Brand Profile Loader
Fetches and caches client brand profiles from brand.mokshatools.com.
Injects profile into metadata generation prompts.
"""
import json
import logging
import os
import time
from pathlib import Path

import requests

log = logging.getLogger("fidelio.brand")

CACHE_TTL_SECONDS = 60 * 60 * 6  # Re-fetch every 6 hours


def load_profile(client: dict, cache_dir: Path) -> dict:
    """
    Fetch brand profile for this client.
    Returns a structured dict of voice/tone/title rules.
    Caches locally to avoid repeated fetches.
    """
    client_id = client["client_id"]
    cache_path = cache_dir / f"brand_{client_id}.json"

    # Return cache if fresh
    if cache_path.exists():
        age = time.time() - cache_path.stat().st_mtime
        if age < CACHE_TTL_SECONDS:
            log.info(f"Brand profile cache hit: {client_id}")
            with open(cache_path, encoding="utf-8") as f:
                return json.load(f)

    profile_url = client.get("brand_profile_url")
    if not profile_url:
        log.warning(f"No brand_profile_url in client config for {client_id}")
        return _empty_profile(client)

    log.info(f"Fetching brand profile: {profile_url}")
    try:
        resp = requests.get(profile_url, timeout=10)
        resp.raise_for_status()
        raw_html = resp.text
    except Exception as e:
        log.warning(f"Could not fetch brand profile ({e}) — using cached or empty")
        if cache_path.exists():
            with open(cache_path, encoding="utf-8") as f:
                return json.load(f)
        return _empty_profile(client)

    profile = _parse_profile_html(raw_html, client)

    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(profile, f, ensure_ascii=False, indent=2)
    log.info(f"Brand profile cached: {client_id}")

    return profile


def _parse_profile_html(html: str, client: dict) -> dict:
    """
    Extract structured brand data from the brand profile page HTML.
    The brand.mokshatools.com pages expose profile data.
    Falls back to reasonable defaults if parsing fails.
    """
    # Extract key fields from page text (BeautifulSoup-free, regex-light approach)
    import re

    def extract(pattern, default=""):
        m = re.search(pattern, html, re.IGNORECASE | re.DOTALL)
        return m.group(1).strip() if m else default

    # Try to find structured data or key sections in the page
    # The brand page for dre-alexandra contains these sections as visible text
    voice_match = re.search(r"brand voice[:\s]+([^\n<]{20,200})", html, re.IGNORECASE)
    tone_match = re.search(r"tone[:\s]+([^\n<]{20,200})", html, re.IGNORECASE)
    title_match = re.search(r"title style[:\s]+([^\n<]{20,200})", html, re.IGNORECASE)

    return {
        "client_id": client["client_id"],
        "display_name": client.get("display_name", ""),
        "language": client.get("language", "en"),
        "platforms": client.get("platforms", []),
        "voice": voice_match.group(1).strip() if voice_match else "Professional, warm, accessible",
        "tone": tone_match.group(1).strip() if tone_match else "Educational, reassuring, honest",
        "title_style": title_match.group(1).strip() if title_match else "Clear, descriptive titles",
        # Hard-coded enrichments for known clients
        **_client_enrichments(client["client_id"]),
    }


def _client_enrichments(client_id: str) -> dict:
    """
    Hand-crafted profile data for known clients.
    This supplements whatever is scraped from the profile page.
    """
    enrichments = {
        "dre-alexandra": {
            "voice": "Warm, direct, authentically Québécois — speaks like a physician friend",
            "tone": "Reassuring, empathetic, educational. Reduces anxiety. Never alarmist.",
            "title_style": (
                "Enumeration + practical angle. Pattern: '[Condition 1, Condition 2 : practical angle]'. "
                "Examples: 'Arthrose, lombalgie, douleur chronique : le rôle clé du physio'. "
                "Alternatives: '[Treatment] : hype ou science ?' or '[Topic] en [year]'."
            ),
            "description_template": (
                "Dre Alexandra reçoit [Expert] pour explorer [Subject]. "
                "Ensemble, ils démystifient [Conditions] et expliquent [Practical angle]. "
                "Découvrez ce que vous devez savoir sur [Medical context]. "
                "Ressources : drealexandra.com. Posez vos questions en commentaires !"
            ),
            "thumbnail_style": "Texte minimaliste blanc ou contrastant. Énumération brève (max 3 mots-clés).",
            "colors": ["#E8F0F0", "#101010", "#B0D0D0", "#0088C0"],
            "avoid": [
                "Sensationalism",
                "Unexplained medical jargon",
                "Generic clickbait phrases",
                "English words unless medically standard",
            ],
            "emphasize": [
                "Accessibility — explain why it matters, not just what",
                "Quebec healthcare system context",
                "Scientific honesty — acknowledge uncertainty",
                "Conversational yet credible tone",
            ],
        }
    }
    return enrichments.get(client_id, {})


def _empty_profile(client: dict) -> dict:
    return {
        "client_id": client["client_id"],
        "display_name": client.get("display_name", ""),
        "language": client.get("language", "en"),
        "platforms": client.get("platforms", []),
        "voice": "Professional and approachable",
        "tone": "Educational and clear",
        "title_style": "Clear, descriptive titles relevant to the content",
        "description_template": "",
        "thumbnail_style": "Clean, minimal text overlay",
        "colors": [],
        "avoid": [],
        "emphasize": [],
    }


def build_metadata_system_prompt(profile: dict, content_type: str = "long_form") -> str:
    """
    Build the Claude system prompt for metadata generation.
    Injects brand voice, tone, title rules, and language.
    """
    lang = profile.get("language", "en")
    lang_instruction = (
        "Output MUST be in Quebec French (fr-CA). Natural, conversational Quebec expressions."
        if lang == "fr-CA"
        else f"Output in language: {lang}."
    )

    avoid_list = "\n".join(f"  - {a}" for a in profile.get("avoid", []))
    emphasize_list = "\n".join(f"  - {e}" for e in profile.get("emphasize", []))

    if content_type == "short_form":
        title_rules = (
            "Generate exactly 1 title option and 1 short hook.\n"
            "The title should feel native to short-form platforms and lead with a clear curiosity gap.\n"
            "The hook is for on-screen cover text and should usually be 1 to 3 words.\n"
            "It can go to 4 or 5 words if that sounds much more natural, but it must stay very short.\n"
            "The hook must be concrete and visually punchy.\n"
            "Prefer a concrete noun phrase over a sentence fragment.\n"
            "Good hooks usually name the topic, symptom, treatment, or object directly.\n"
            "Avoid vague fragments, filler words, or half-finished expressions."
        )
        if lang == "fr-CA":
            title_rules += (
                "\nFor short-form Quebec French, the hook should feel native and sharp, examples: "
                '"PRP vaginal", "Gel arthrose", "Sécheresse vaginale", "Mal de tête", "Pilule caillots".'
            )
        output_format = """{
  "title_1": "...",
  "hook": "very short cover text, usually 1 to 3 words",
  "description": "...",
  "tags": "..."
}"""
    else:
        title_rules = (
            f"{profile['title_style']}\n"
            "Generate exactly 3 title options. Each must follow the title style rules above."
        )
        output_format = """{
  "title_1": "...",
  "title_2": "...",
  "title_3": "...",
  "description": "...",
  "tags": "tag1, tag2, tag3, ..."
}"""

    return f"""You are a video metadata specialist for {profile['display_name']}.

{lang_instruction}

BRAND VOICE: {profile['voice']}
TONE: {profile['tone']}

TITLE RULES:
{title_rules}

DESCRIPTION:
{profile.get('description_template', 'Write a clear, engaging description summarizing the video content.')}

AVOID:
{avoid_list or '  - Generic or sensationalist language'}

EMPHASIZE:
{emphasize_list or '  - Clarity and accessibility'}

TAGS: Generate 8-12 relevant tags as a comma-separated list. Mix broad and specific terms.

OUTPUT FORMAT (JSON only, no prose outside the JSON):
{output_format}"""
