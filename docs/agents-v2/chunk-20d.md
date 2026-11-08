# Chunk 20d — Design pass: one screen at a time, brand and images

> Brief for Claude Code. Read `docs/agents-v2/CONTEXT.md`, `SLICE-1.md`, `v2-chunks.md`, `CHUNK-12B-NOTES.md`, `CHUNK-20A-NOTES.md` (especially where the logic/presentation boundary is), **`DESIGN.md`**, **`ONBOARDING-COPY.md` (use its text exactly; §15–19 are new)**, the screenshots in `docs/agents-v2/design/`, then this file.
> Branch: the slice 1 branch (`feat/agents-v2-chunk-12-shared-store`); tag commits `[20d]`. Repos: ally-web (most of it), ally-be (images, brand settings), ally-ai only if the builder needs a new canvas event (it shouldn't).
> **Order in slice 1:** 12 → 12b → 20a-1 → **20d** → 20a-2 → 15a → 20e. 20a-2 is then built directly in this style.

## Why

20a-1 and 12b work, but they look like the rest of the admin dashboard. The first thing a customer sees has to feel like the best product they've used: one clear thing per screen, with motion that shows progress, and their own brand on everything their clients see. This chunk changes **presentation**, adds **logo and image uploads** and a **Look and feel** screen. It does not change what the builder does, the draft model, the safety rules or the bot page's access and streaming behaviour.

## Rules for this chunk

- **No logic rewrites.** Reuse 20a-1's hooks and services and 12b's page logic. If a screen needs data the hooks don't expose, add it to the hook; don't fetch from components.
- **Every existing test keeps passing.** Tests that only check text or selectors may be updated for the new markup; list each one in the notes with the reason. Behaviour tests must not change.
- **Copy from the deck only.** New strings go into `ONBOARDING-COPY.md` in the same commit.
- **The old dashboard is untouched.** Tokens are scoped to the new surfaces.

## Scope

### 1. Foundation (ally-web)

- Tokens from `DESIGN.md` §2 as CSS variables plus a scoped Tailwind extension.
- Self-hosted fonts (Geist, Geist Mono, Instrument Serif, Nunito 700), subset to Latin and Devanagari where the font has it; `font-display: swap`; preload only the two used above the fold.
- The components in `DESIGN.md` §4, with stories or a simple gallery route for review (`/dev/v2-components`, dev only).
- Motion utilities from `DESIGN.md` §3, all honouring `prefers-reduced-motion`.

### 2. Onboarding: one screen at a time (`/chatbots/new`)

Replace the two-pane layout with **StepFrame** and one screen per step. The builder still leads: its message for each step is the screen's **AssistantLine**, and its quick replies are the screen's **Options**.

| # | Screen | From 20a-1 | Primary action |
|---|---|---|---|
| 1 | Start | Start screen | Start with my website (or Upload documents / Describe my business) |
| 2 | Reading your website | Reading section and its events | Auto-advances when the crawl finishes, after a 1.2 s pause showing "Read {n} pages in {seconds} seconds"; button "See what I learned" |
| 3 | What we learned | Learned card | Looks right |
| 4 | Safety | Pack card | Continue |
| 5…n | One gap or setup question per screen | Gap questions, audience, languages, "don't know" | Option (auto-advance) or OK |
| n+1 | Choose a design | Design cards | Choose this |
| n+2 | Make it yours | "Your assistant" canvas section | Build my assistant |
| n+3 | Building | Building steps | Run the checkup (20a-2) or, until 20a-2, Continue |
| n+4 | Checkup | 20a-2 | (20a-2) |
| n+5 | Who can use it? | Share section | Publish |
| n+6 | Your assistant is live | Live state | Copy link, QR, WhatsApp, Open page; "Want it on WhatsApp too?"; "Give it a landing page" (hidden until 20e) |

- **Talk to the builder on any screen.** A collapsed line at the bottom of every screen, "Tell me something else", opens a small input. What the owner types goes to the builder as today (a typed gap answer becomes an Owner note; a correction becomes a patch). The builder's reply appears as the AssistantLine; if it changes the canvas, the screen updates with a `rise`.
- **Make it yours** (new screen, built from 20a-1's "Your assistant" fields): name, logo (detected or uploaded), cover image, colour (first swatch from the logo, then 4 harmonious picks, then a custom picker), tone (Warm / Balanced / Formal, which updates the introduction), the opening line (editable), and a live **PhonePreview**. Everything here is a draft patch.
- **Back** goes to the previous screen without losing anything. **Resume** opens the last screen the owner was on.
- **Keyboard:** Enter submits the screen; A–D pick options; Esc closes the "Tell me something else" input. The whole flow can be completed without a mouse.
- **Phone:** the same flow at full width; the phone preview on "Make it yours" moves below the controls.
- The reading screen keeps 20a-1's live findings, with running totals and the page counter.

### 3. Bot page restyle (12b)

Same behaviour, same endpoints, same tests; new presentation following screenshot `02-bot-page-*`:

- **Cover:** cover image (or the orb in the brand colour), logo tile, serif title and subtitle in the chosen heading style, Start, and the disclaimer.
- **Access** screen (email, then code) and **pre-chat questions**: one per screen, `slide` in, progress bar and "1 / 2", lettered options that auto-advance, OK for text fields.
- **Chat:** header with the orb (or logo), name and a status line ("Looking up…", "Typing…"), the greeting, suggested questions as outlined chips, the visitor's bubble in the brand colour, the status dots while waiting, streamed text with a caret, source chips under the answer (once), New chat, and the composer with a round send button. Crisis replies keep 12b's behaviour exactly (nothing typed first).
- **Theme:** light, dark or auto; heading style; contrast-corrected accent.
- **Budget:** the bot page entry stays under 70 KB of JavaScript and 25 KB of CSS gzipped (excluding fonts), and its largest contentful paint is under 2 s on a mid-range phone over 4G (Lighthouse mobile). Add a size check to CI.

### 4. Images (ally-be + ally-web)

Find the existing upload and storage path (the knowledge library or 12b's logo upload) and reuse it. Record the choice in the notes.

- **Accepted:** PNG, JPEG and WebP up to **5 MB** and 6000 px on the longest side. **SVG only for logos**, and only after sanitising (no scripts, event handlers, external references or `foreignObject`), or rasterise it to PNG; choose one and justify it.
- **Checked by content, not file name** (magic bytes). Re-encode every image, **strip EXIF and location data**, and store size variants (256, 768 and 1600 px WebP plus the original).
- **Stored per organisation and bot**, under content-hashed names; served with long cache headers. Images are publicly readable only while attached to a **published** bot page or landing page; drafts use signed URLs.
- **Limits:** 50 images per bot; rate limit uploads per user.
- **Removing** an image detaches it at once and deletes the files after 30 days (so Undo works).
- **Onboarding:** the detected logo is downloaded through the crawl's same-domain fetcher and stored like an upload. Never hotlink.
- **Alt text:** every image has it; defaults from `DESIGN.md` §6; editable.
- Errors use copy §19.

### 5. Look and feel (ally-web + ally-be)

A screen on every bot (screenshot `06-look-and-feel`). Put it where 12b put the Bot page settings (a Settings section), titled **Look and feel**, and link it from the bot page section.

- **Left:** Logo; Images (bot page cover, link preview image; landing images appear after 20e); Team photos (by team member, from what the assistant learned; used by 20e, and by replies once People lands); Style (heading style, colour, theme).
- **Right:** a live preview with a Bot page / Landing page switch (Landing page appears after 20e).
- **Saves as you go** (debounced patches through the same service as 12b's settings), with "Changed. Undo" and a "Saved. Live on your page now." note.
- Stored in the one `brand` object from `DESIGN.md` §7, inside 12b's bot page settings.

### 6. Notes for 20a-2 (don't build them here)

20a-2 builds these directly in this style, following screenshots `03-assistant-home` and `04-checkup`:
- **Checkup** in plain words: the four MeasureCards (Gets facts right · Shows where it found it · Says when it doesn't know · Handles sensitive messages safely), the summary sentence, the gaps one at a time, and the full list with filters.
- **Assistant home, "What it knows":** every learned item and Owner note as editable rows and cards with **add, edit and delete**, each as a draft patch with Undo, plus "Change your assistant" on the right.
- **Try it:** the real bot page components in a phone frame against the draft.

## Out of scope

The landing page (20e). Images inside replies (people cards: after chunk 7). Restyling the rest of the dashboard. New builder abilities.

## Tests

**ally-web:**
- Screenshot tests (Playwright) of every onboarding screen and every bot page screen at 1440 and 390 px wide, light and dark, checked in as the baseline.
- Keyboard-only e2e: start → publish without a mouse.
- `prefers-reduced-motion`: no animation classes active.
- axe: 0 serious or critical issues on every screen.
- The bundle size check for the bot page.
- Look and feel: preview updates on change, Undo restores, save debounces.

**ally-be:**
- Uploads: wrong type renamed as `.png`, over 5 MB, too many pixels, SVG with a script (rejected or neutralised), EXIF and GPS removed, variants created, the per-bot limit, a draft image not publicly readable, a removed image unreadable after purge.
- The brand object: validation (hex, enums), contrast correction, and that 12b's existing settings tests still pass.

Full suites, lint, typecheck and build for each app. No `--no-verify`.

## Done when

- [ ] Onboarding is one screen at a time, matches the screenshots, and can be completed by keyboard in under 5 minutes on a fixture site
- [ ] The bot page matches the screenshots in light and dark, with the owner's logo, cover, colour and heading style, and meets its size and speed budget
- [ ] Logo and images upload safely, with variants, stripped metadata and correct visibility
- [ ] Look and feel saves as you go, with Undo and a live preview
- [ ] No behaviour test changed; text-only test updates are listed in the notes
- [ ] `CHUNK-20D-NOTES.md`: the component list, screenshots before and after, the image storage choice, the SVG decision, budgets measured, and open items for 20a-2 and 20e

## How Shehbaz tests it

1. Start a new assistant from a fixture site. Each step is its own screen; findings tick in; Back works; Enter and A–D work.
2. On "Make it yours", replace the logo, add a cover image, change the colour and tone, and watch the phone preview change.
3. Publish (invite-only) and open the link on your phone. The cover, logo, colour and font match. Answer the pre-chat questions and ask 3 questions. Try dark mode from Look and feel and reload the page.
4. Upload a 12 MB photo, a `.exe` renamed to `.jpg`, and a phone photo with location. The first two are refused with friendly messages; the third uploads without its location.
5. In Look and feel, change the colour, then press Undo.
6. Send a crisis phrase on the bot page: still only the crisis reply.
