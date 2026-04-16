---
name: Email "informal" tone has two levels — measured by default, very-casual only for known clients
description: Loric flagged that "Hésite pas si tu as / Fais-moi signe quand tu es prêt" sounds right for FICCA (personal relationship) but too chummy for clients he just met. Default informal should be friendly-but-measured.
type: feedback
---

**Rule:** the informal (tu-form) email tone is NOT a single setting. There are two levels inside it:

- **Very-informal** — "Salut [Name], ... Hésite pas si tu as ... Fais-moi signe quand tu es prêt à ... pour qu'on te réserve la place ..." → use ONLY when past-email examples for this signer/client clearly show personal closeness (e.g. FICCA, where Loric knows the client personally).
- **Default informal** — "Bonjour [Name], Voici la soumission. Hésite pas si tu veux ajuster quoi que ce soit. Une fois que tu es prête à confirmer, le dépôt nous permet de bloquer ta place dans le calendrier." → friendly + tu-form but not buddy-buddy. Use this for standard informal drafts where there's no signal of personal relationship.

**Why:** chummy phrasing on a first contact reads as fake-familiar from someone the client doesn't know. Loric's actual writing is friendly but professional with new clients; close-friend phrasing is reserved for repeat/known clients.

**How to apply:**
- The hard-coded prompt example in `/api/email/standalone-draft` should NEVER prescribe FICCA-level chumminess as the default — it gets copied wholesale.
- Defer the closeness signal to past-email examples: if the corpus for this signer + client shows a measured tone, match that; if it shows close phrasing, match that instead.
- "Bonjour" is a safer default opener than "Salut" for clients with no relationship history.
- Forbidden: "Salut" + "Hésite pas si tu as" + "Fais-moi signe quand tu es prêt" all together — that's the FICCA combo, save it for FICCA-types.

**Commit:** `447acc4` — softened the prompt's hard-coded informal-FR example.
