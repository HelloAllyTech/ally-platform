# Chunk 20d-2 — Restyle pass (the parts still in the old look)

> Brief for Claude Code. Read `DESIGN.md`, `ONBOARDING-COPY.md`, `CHUNK-20D-NOTES.md` (§5 lists what's still old), the screenshots in `docs/agents-v2/design/`, then this file.
> Branch: the Slice 1 branch. Tag commits `[20d-2]`. Repos: ally-web (ally-be only if an endpoint must change shape; it shouldn't).
> **Part of the POC:** 20a-2 → Q2a → 13 → 11a → **20d-2** → CL1.

## Why

The assistant home is in the new style, but some parts inside it still use old components. Before pilots see it, every screen an owner touches should look and behave the same: one design system, autosave with Undo, plain words.

## Scope

Redraw in the `DESIGN.md` style, keeping today's behaviour and endpoints:

| Part | Section | Notes |
|---|---|---|
| Document upload and the document list | What it knows | Dropzone, progress, file-type and size errors from the copy deck; remove with Undo |
| Page access list (invited emails, organisations) | Share → On your page | Chips with add and remove; Undo |
| WhatsApp audience and numbers | Share → On WhatsApp | Shown only when a number is connected |
| Team | Share | Members and roles as today, in the new table style |
| Quick replies | Personality | Inline add, edit, reorder, delete; Undo |

**Skip:** the conversation list (replaced by the 11a inbox), the unanswered list and the usage charts (replaced by Q2a).

**Every control** saves on its own with the version check from 20d (409 on a stale save), shows "Changed · Undo", and uses copy from `ONBOARDING-COPY.md` (add new strings there in the same commit).

## Out of scope

New features. Behaviour changes. Removing the old components (CL1 does that).

## Tests

Screenshot baselines for each restyled part at 1440 and 390 px, light and dark; axe 0 serious issues; keyboard reachability; existing behaviour tests unchanged.

## Done when

- [ ] No old-style component remains inside the assistant home (except those replaced by 11a and Q2a, which are gone)
- [ ] All suites and screenshot baselines pass
- [ ] `CHUNK-20D2-NOTES.md`: before and after screenshots, and the list of old components now unused (input to CL1)
