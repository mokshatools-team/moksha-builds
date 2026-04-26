---
name: Output format — single copyable blocks
description: User wants base64 strings and other long single-line outputs as one unbroken block, not wrapped across lines
type: feedback
---

When outputting long strings meant to be copied (base64, tokens, keys), output them as a single paragraph of text — not in a code block, not wrapped. This way the user can triple-click to select the whole thing without grabbing surrounding whitespace.

**Why:** Code blocks and wrapped lines cause selection issues — clicking to copy grabs newlines and surrounding spaces on each line.

**How to apply:** For any base64 string, API key, or other "copy this whole thing" output, put it as a plain unwrapped paragraph, not fenced code.
