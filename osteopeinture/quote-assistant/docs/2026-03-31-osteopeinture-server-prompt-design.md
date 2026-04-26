# Ostéopeinture Server Prompt Design

**Date:** 2026-03-31

## Goal

Rewrite the quote assistant system prompt in `osteopeinture-quote-assistant/server.js` so the conversation flow matches the new interior quoting logic: branch early between quick ballpark and full quote, collect the right estimating inputs, and force assumption confirmation before final quote generation.

## Scope

This design covers prompt and prompt-adjacent default behavior in `server.js` for the interior quote assistant.

It does not cover:
- exterior quoting structure
- scraping past quotes
- Gmail or PDF ingestion
- frontend redesign
- replacing the JSON format

## Current State

The current system prompt has a single intake path. It asks generally for room scope and job details, but it does not:
- ask early whether the user wants a quick ballpark or a full quote
- explicitly prefer measured inputs when available
- collect door/window/closet/setup assumptions in a disciplined way
- distinguish room-average fallback logic from measured-surface logic in a structured way
- force the assistant to disclose estimating mode and assumptions before JSON generation

## Required Intake Branch

After collecting the basic client and project overview, the assistant must ask:

`Do you want a quick ballpark or a full quote?`

That choice determines the rest of the conversation flow.

## Quick Ballpark Path

The quick ballpark path is a legitimate estimating mode, not a casual shortcut.

It should:
- proceed without recommending that the user go measure the space
- use standards and room-average logic by room
- still gather enough detail to produce a structured rough estimate

Required intake for quick ballpark:
- room list
- floor grouping when relevant
- whether the home/room style is modern or Victorian
- whether the project should be treated as low-end, mid-end, or high-end
- what surfaces are included in each room
- whether closets are included when relevant

The assistant should estimate using task buckets such as:
- protection / covering
- prep
- priming when applicable
- walls
- ceilings
- baseboards / trim
- doors
- windows
- closets
- touch-ups / cleanup share

Quick ballpark should remain transparent that it is based on standards and averages rather than measured surfaces.

## Full Quote Path

The full quote path should gather measured inputs when available, but proceed even if they are not.

Required intake for full quote:
- room-by-room and floor-by-floor scope
- ask whether the user has paintable sqft, floor plans, or room dimensions
- if measured data is available, prefer measured-surface logic
- if measured data is not available, proceed using room-average fallback logic
- door-face count
- window count
- window type (modern vs Victorian/ancestral)
- whether closets are included
- relevant special conditions only when triggered by scope

The assistant must not pause to recommend getting dimensions first. It should continue and quote using fallback logic when needed.

## Default Production Assumptions

The prompt should encode these default operational assumptions:
- initial setup + teardown: `3h` once for the whole job
- daily setup: `30 min/day`
- productivity assumption for day-count estimation: `6h/day x 3 guys`
- work-week framing: `5 days/week`

The assistant should already approximate the number of work days from total labour hours using those defaults, unless the user gives more specific scheduling information.

## Mode-Specific Estimating Behavior

The prompt should clearly distinguish:

### Ballpark mode
- use standards and room-average task assumptions
- build rough totals by room
- use style/tier signals such as modern vs Victorian and low-/mid-/high-end to shape allowances

### Full quote mode
- use measured-surface logic where measurements are available
- use count-based door/window logic
- use fallback room averages only where measurements are missing

This distinction should be explicit in the prompt so the assistant does not blur the two estimating modes.

## Pre-Generation Review

Before outputting JSON, the assistant must present a summary for confirmation.

For quick ballpark, the review must clearly state:
- this is a ballpark estimate
- it is based on standards / room averages
- the assumed home style: modern or Victorian
- the assumed tier: low-end, mid-end, or high-end

For full quote, the review must clearly state:
- which parts were measured vs estimated
- door and window assumptions
- closet inclusion
- setup and day-count assumptions
- any provisional benchmark used

This review should appear before final JSON generation, and the assistant must ask the user to confirm or adjust assumptions first.

## Email Default Alignment

`server.js` currently includes default email subject/body behavior. Those defaults should be aligned with the finalized operating defaults already defined in `QUOTING_LOGIC.md` so the app does not carry conflicting communication behavior.

## Constraints

- Keep the JSON output shape intact unless there is an obvious prompt-only improvement.
- Keep the app conversational and concise.
- Ask one or two questions at a time.
- Avoid forcing measured data collection when it is not available.
- Preserve the assistant as an interior-focused quoting flow for now.

## Success Criteria

The prompt rewrite is successful if:
- the assistant branches early between quick ballpark and full quote
- quick ballpark can produce a rough by-room estimate from standards and averages
- full quote asks for measured inputs when available but still proceeds without them
- doors, windows, closets, setup, and day-count assumptions are gathered or stated explicitly
- the review step clearly surfaces estimating mode and assumptions before JSON output
- email defaults in `server.js` do not conflict with the quoting logic file
