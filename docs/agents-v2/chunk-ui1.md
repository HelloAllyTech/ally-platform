# Chunk UI1 — A chat that feels alive

> Brief for Claude Code. Read `CONTEXT.md`, `FINAL-PLAN.md`, `DESIGN.md`, `ONBOARDING-COPY.md`, `CHUNK-12B-NOTES.md` (the bot page), `CHUNK-13-NOTES.md` (the bubble), `CHUNK-06B-NOTES.md` (live steps and confirmation cards), then this file. Plan briefly. <!-- docs-path-lint: planned -->
> Branch: `feat/agents-v2-ui1` from master after T1. Tag commits `[UI1]`. Repos: ally-web (bot page and bubble), ally-be and ally-ai for the structured parts.
> **Two stops:** (1) a design pass: screenshots at 1440 and 390 of the welcome, a booking, a product answer and a list of options, before building everything (Shehbaz may send reference screenshots of chats he likes); (2) any prompt text that changes. About 1.5 days.

## Why

The page every customer sees feels empty: a title, a box, and text replies. It should feel like a well-made app: inviting before the first message, and quick to use, with things to tap instead of type.

## 1. The welcome

- Cover image (from the site or uploaded), logo, the assistant's name, one line on what it helps with.
- **Cards:** hours (open now / closes at), location (with a map link), contact (call, email, WhatsApp), from the business's facts; shown only when known.
- **Suggested-question chips** (from the owner's suggestions, else generated from the template and facts at publish).
- What it can do, in chips ("Book an appointment", "Check my order", "Talk to a person"), from its tools.

## 2. Structured replies (from the run, never from parsing text)

The run returns optional parts alongside the reply, built from tool results and passages, never invented:
- **Chips:** options to pick (free times, choices in a list's select, "Yes, book it" / "Change time"), and 2–3 suggested next questions after an answer. Tapping sends that text.
- **Cards:** list entries (products, listings, slots, menu items, classes) with title, photo, price, two or three details, and a button ("Book this", "Ask about this"); up to 6 in a scrollable row.
- **Media:** images, videos (YouTube or files) and documents (PDF brochure, menu) from the business's pages and lists, shown inline with their source; images open full-size.
- **Confirmation cards** (6b) for bookings and changes, from the stored record.
- **Contact cards** when the reply gives a way to reach the team.

ally-ai adds a `parts` field to the reply (chips, cards, media) only from passages and tool results it cited; ally-be checks every URL is from the business's own sources or uploads; the page renders them. WhatsApp keeps text for now (Phase 2 adds buttons there).

## 3. Feel

- Message bubbles, avatars, timestamps on hover; smooth streaming; the live steps (6b) in the same style.
- The composer: send on Enter, attach nothing yet, chips above it when relevant.
- A **sign-out** for signed-in visitors; New chat; the page language follows the setting.
- Phone first: thumb-reachable chips, cards that swipe, no sideways scroll; dark mode follows the device.
- Empty, loading, error and offline states designed.
- `aria-live` for replies, focus order, reduced motion, axe clean.

## 4. Owners control it

In Share → Page: cover, colours, suggested questions, which welcome cards show, and a preview at phone and desktop width.

## Tests

- Parts are only built from cited passages and tool results (a test with a reply that mentions an uncited product shows no card).
- Every media URL is from the business's sources or uploads.
- Playwright at 1440 and 390, light and dark, axe clean: the welcome, a booking with chips and a confirmation card, a product answer with cards and an image, a crisis reply (no chips, no cards).
- The bubble on a test page shows the same.

## Done when

- [ ] The welcome, chips, cards, media and confirmation cards on the bot page and bubble
- [ ] Nothing shown that the run didn't cite; crisis replies stay plain
- [ ] `CHUNK-UI1-NOTES.md`, `PR-UI1.md`, the Progress row <!-- docs-path-lint: planned -->
