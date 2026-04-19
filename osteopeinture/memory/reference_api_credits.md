---
name: Anthropic API credits are separate from claude.ai subscription
description: OP Hub uses API credits (console.anthropic.com), not the Claude Max plan. They don't share a balance. Monitor API credits separately.
type: reference
---

**Two separate billing systems:**
- **claude.ai / Claude Code** — Max plan subscription with CA$140 extra usage balance. For personal use + VS Code.
- **console.anthropic.com** — API credits (pay-per-token). What OP Hub uses on Railway.

They do NOT share a balance. Buying credits on claude.ai doesn't add to the API balance.

**API credits location:** console.anthropic.com → Billing → Credit balance
**API key:** console.anthropic.com → API keys (org: Loric's Ind...)

**Cost reduction measures implemented (2026-04-19):**
- Conversation trimming: last 14 messages only (~50% savings on long sessions)
- Interior prompt trim: ~5K fewer tokens per interior request
- Hardcoded email templates: zero tokens for quote_send
- Rate limit: 30K input tokens/min on current plan
