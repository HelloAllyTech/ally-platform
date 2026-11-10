# Ally design system (v2 owner and visitor screens)

> Applies to everything new in Agents v2 that owners or visitors see: onboarding (`/chatbots/new`), the assistant's home, Checkup, Look and feel, the bot page (`/b/<slug>`) and the landing page. The rest of the admin dashboard keeps its current look until it's touched.
> The reference mockups are the canvas "Ally Assistant Design" (six screens: 01 onboarding, 02 bot page, 03 assistant home, 04 checkup, 05 landing page, 06 look and feel). Screenshots of them are in `docs/agents-v2/design/`, named by those numbers. When this file and a screenshot disagree, **this file wins**; when this file is silent, match the screenshot.
> Copy is in `ONBOARDING-COPY.md`. Never invent owner-facing text; add new strings there in the same commit.

## 1. Principles

1. **One thing at a time.** Each onboarding screen asks one question or shows one result, with one primary action. Typeform, not a form.
2. **Always alive.** Something moves within 1 second of every action: a streaming line, a ticking step, a card rising in. No lone spinner for more than 2 seconds.
3. **Calm, not flashy.** One signature element (the orb) carries the "futuristic" feel. Everything else is quiet type, space and alignment.
4. **The owner's brand leads on visitor screens.** The bot page and landing page use the owner's logo, colour, images and heading style. Ally's look stays in the background ("Assistant by Ally").
5. **Editable everywhere.** Anything the assistant learned or wrote can be edited, removed or added to, in place, with Undo.
6. **Honest.** Every fact shows where it came from. Nothing that doesn't work yet looks like it works ("Coming soon").

## 2. Tokens

Put these in one place (CSS variables plus a Tailwind theme extension, scoped so the old dashboard is unaffected). Names below are the variable names to use.

### Colour (Ally surfaces: onboarding, home, Checkup, Look and feel)

| Token | Value | Use |
|---|---|---|
| `--ally-bg` | `#F6F5F1` | Page background (warm off-white) |
| `--ally-surface` | `#FFFFFF` | Cards, inputs |
| `--ally-surface-2` | `#FBFAF7` | Option rows, side panels |
| `--ally-sunken` | `#ECEAE4` | Segmented controls, kbd, hover |
| `--ally-line` | `#E4E2DC` | Card borders |
| `--ally-line-strong` | `#DAD8D1` | Input and option borders |
| `--ally-ink` | `#17171C` | Text, primary buttons |
| `--ally-ink-2` | `#3C3B42` | Assistant lines, body in cards |
| `--ally-muted` | `#5F5E66` | Secondary text (≥ 4.5:1 on bg) |
| `--ally-faint` | `#6B6A72` | Labels, footnotes (≥ 4.5:1 on surface) |
| `--ally-accent` | `#3B3BD9` | Progress, selection, focus, links |
| `--ally-accent-soft` | accent at 8% | Selected option fill, focus ring |
| `--ally-good` / `--ally-good-bg` | `#1F6B47` / `#E8F5EE` | Answered, safety on |
| `--ally-warn` / `--ally-warn-bg` | `#9A3412` / `#FDF0E7` | Needs your input |
| `--ally-info` / `--ally-info-bg` | `#2A2AA8` / `#ECECFD` | Handled safely |
| `--ally-danger` | `#A33A1F` | "Never" labels, destructive |

### Colour (visitor surfaces: bot page, landing page)

Derived per bot from its brand settings (§7):
`--brand-accent` (owner's colour, contrast-checked against white text, darkened until ≥ 4.5:1), `--brand-accent-soft` (8%), `--brand-bg` (light `#FBFAF7`, dark `#111114`), `--brand-surface` (light `#FFFFFF`, dark `#1C1C21`), `--brand-ink` (`#17171C` / `#F4F3EF`), `--brand-muted` (`#5F5E66` / `#A3A2AA`), `--brand-line` (`#E6E3DC` / `#2C2C33`). The landing page uses a warm tint of the accent for its background (`#FBF7F3` for Sunrise Mind's terracotta), computed, not hand-picked.

### Type

| Role | Font | Size / line-height | Notes |
|---|---|---|---|
| Display (screen question, page titles) | Instrument Serif 400 | 46–60 px / 1.05 (phone 34–40) | Letter-spacing −0.01em |
| Heading (card titles) | Geist 600 | 16–22 px / 1.3 | |
| Body | Geist 400 | 15–18 px / 1.55 | |
| Small | Geist 400 | 12–14 px / 1.45 | |
| Label (eyebrows, column heads, counters) | Geist Mono 400–500 | 11–12 px, uppercase, +0.08em | |

Fonts are self-hosted (woff2, `font-display: swap`), not loaded from Google at runtime. Visitor surfaces offer three heading styles: **Classic** (Instrument Serif), **Modern** (Geist), **Friendly** (Nunito 700). Body is always Geist.

### Space, radius, elevation

- Spacing scale (px): 4, 6, 8, 10, 12, 14, 16, 18, 22, 24, 28, 32, 40, 48, 64, 72. Screen gutter 24 (16 on phones).
- Radius: inputs and buttons 12, option rows 12, cards 16–20, large panels 20–32, chips 999, phone frame 40/31.
- Elevation: none by default. Hover on cards: `0 10px 30px rgba(23,23,28,.08)` and −2 px lift. Floating (toast, phone frame): `0 12px 30px rgba(0,0,0,.2)` / `0 30px 60px rgba(23,23,28,.18)`.
- Max widths: one-question screens 640, result screens 760–920, design cards 1080, content pages 1120–1180.

## 3. Motion

| Name | Spec | Used for |
|---|---|---|
| `rise` | opacity 0→1, translateY 16→0, 550 ms, `cubic-bezier(.2,.8,.2,1)` | Every screen and card entering |
| stagger | +60 ms per item, max 8 | Lists, cards, options |
| `slide` | translateX 24→0, 450 ms | Next question (pre-chat, gaps one at a time) |
| `pop` | scale .6→1.08→1, 400 ms | Ticks, success marks |
| `breathe` | scale 1↔1.07 with a soft accent glow, 3.2 s loop (1.4 s while working) | The orb |
| progress | width transition 600 ms, same easing | Top progress bar, page counter |
| press | scale .97 on `:active`, 120 ms | Buttons, options |
| typing | ~3 characters per 22 ms (streamed text uses real tokens) | Assistant replies |
| toast | rise in, 3.6 s, fade out | "Changed. Undo" |

Rules: nothing over 600 ms except loops; never animate layout height in a way that shifts the button the user is about to press; **`prefers-reduced-motion: reduce` turns all of these into instant opacity changes** and stops loops.

## 4. Components

Build these once (in a `v2` folder of the admin app's components; the bot page and landing entry import only what they need, so their bundles stay small).

- **Orb.** A 22–56 px circle: radial gradient white → light accent → accent → deep accent, with `breathe`. Shown beside every assistant line and while reading, building or checking. Decorative (`aria-hidden`); the text next to it carries meaning.
- **StepFrame.** Top bar (logo, breadcrumb, Back, "Saved" dot), a 3 px progress bar, the centred screen, and a footer ("Step 4 of 12 · A few questions" and "Your progress is saved…"). Back never loses data.
- **AssistantLine.** Orb plus 16–18 px text in `--ally-ink-2`. This is how the builder speaks on each screen.
- **Question.** Mono eyebrow ("2 QUICK QUESTIONS LEFT"), display-size question, optional subtitle, then the answer control.
- **Option.** A full-width row with a key badge (A, B, C…), label, optional hint, and a tick when selected. Single choice **auto-advances after 380 ms**. Keyboard: the letter keys pick, ↑/↓ move, Enter confirms.
- **Chip.** Pill toggle for multi-select (languages). Selected = ink fill.
- **PrimaryButton** (ink, 50 px tall, radius 12) with an "press Enter ↵" hint beside it on desktop. **Enter submits the current screen** (bound to the screen, not a global handler).
- **FindingLine.** A white row with an accent tick that pops in; text is the copy deck's "Found…" lines with running totals.
- **LearnedCard.** Mono label, headline, detail, a **SourceChip** (link icon + path, opens the page in a new tab), and Edit (pencil) that switches the card to inline inputs.
- **SafetyCard.** Shield icon, "{Pack} is on", the always-on sentence, and three panels: Always / Never / If someone may be at risk.
- **DesignCard.** Serif title, Best for, It will (green ticks), It won't (red crosses), a sample exchange, "Choose this". The Coming soon variant is dimmed with a badge and no button.
- **BuildStep.** Waiting circle → spinner → popped tick.
- **CheckRow.** Status dot, the question in quotes, a status pill (Answered with a source / Politely declined, as it should / Handled a sensitive message safely / Needs your input), and the source.
- **MeasureCard.** Plain-words title, the technical word in mono at the right (Accuracy, Sources, Honesty, Safety), a large number, "of N", a growing bar, a one-line meaning and an expandable explanation.
- **GapCard.** One gap at a time: the question, what it said, an answer box, "Add answer" and "We don't offer this", then a "1 of 2" counter.
- **ImageSlot / Dropzone.** Dashed when empty ("Add image"), filled with the image and its file name when set; click or drop to upload, with Replace and Remove. Shows upload progress and errors from the copy deck.
- **PhonePreview.** A 300 × 560–600 frame that renders the real bot page components with the current draft settings, live.
- **Toast.** Ink pill at the bottom: "Changed" + **Undo**.
- **Kbd.** Mono, sunken background, radius 5.

## 5. Layout patterns

- **Onboarding** (`/chatbots/new`): one screen at a time inside StepFrame (§6 of `archive/chunk-20d.md` maps every step). No two-pane layout. The canvas pieces from 20a-1 become screens.
- **Assistant home** (an existing bot): a left section list (Overview, What it knows, Personality, Safety, Look and feel, Checkup, Conversations, Share), the content in the middle, and the **Change your assistant** panel on the right (20a-2). On narrow screens the list becomes a top menu and the panel a bottom sheet.
- **Visitor surfaces:** mobile first. Bot page: cover → access → pre-chat questions (one per screen with progress) → chat. Landing page: nav, hero with an ask box, then sections.

## 6. Accessibility

Real `<button>`, `<a href>` and labelled inputs everywhere; icon-only buttons get `aria-label`; focus rings use `--ally-accent-soft` 4 px plus a solid border; text contrast ≥ 4.5:1 (check the brand accent automatically); touch targets ≥ 44 px; the option keyboard shortcuts are announced ("Press A, B or C"); live regions for streaming text and step progress; images have alt text (owners can edit it; default "Photo of {name}" or "{Business} cover image").

## 7. Brand settings (per bot)

One `brand` object on the bot page record (extend 12b's settings; don't add a second store):

| Field | Notes |
|---|---|
| `logo` | Image id. Detected from the website in onboarding, then copied into our storage (never hotlinked) |
| `accent` | Hex; contrast-corrected copy stored alongside |
| `headingStyle` | `classic` · `modern` · `friendly` |
| `theme` | `light` · `dark` · `auto` |
| `coverImage` | Optional image id; without it, the bot page shows the orb cover in the brand colour |
| `shareImage` | Optional; used for link previews (Open Graph). Generated from logo + colour if empty |
| `landingImages` | `hero` and up to 6 `gallery` image ids, each with alt text (used by 20e) |
| `peoplePhotos` | Optional map from a team member's name to an image id; used by the landing page now, and by replies once People (chunk 7) lands |

Image rules are in `archive/chunk-20d.md` §4.
