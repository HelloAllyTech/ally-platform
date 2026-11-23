# Chunk 20d notes: design pass, brand and images

**Brief:** [chunk-20d.md](./archive/chunk-20d.md). **Design:** [DESIGN.md](./DESIGN.md) and the screenshots in `design/`. **Copy:** [ONBOARDING-COPY.md](./ONBOARDING-COPY.md) §15–19. **Branch:** `feat/agents-v2-chunk-12-shared-store`; commits tagged `[20d]`. **Order in slice 1:** 12 → 12b → 20a-1 → **20d** → 20a-2 → 15a → 20e.

## 1. Code map: what exists today (read before building)

Paths are relative to `ally-web/apps/ally-admin-dashboard` (ADMIN) or `ally-be` (BE).

### 20a-1's onboarding: what stays, what's replaced

20a-1 put everything the screens *do* in hooks and the screens only draw (CHUNK-20A-NOTES.md §3). 20d replaces the drawing and keeps the rest.

| File (ADMIN/src/pages/Onboarding/) | Kind | In 20d |
|---|---|---|
| `useOnboardingStart.ts` | Logic: start with a website, description or files; resume | **Keep.** |
| `useOnboardingSession.ts` | Logic: `view`, `reading`, `rows`, `note`, `sending`, `working`, `streaming`, `error`, `questionsLeft`, `sections`, `focusSection`, `building`, `canGoBack`, `canChooseDesign`, `publicAllowed`, `published`, `publishing`, `canvasVersion`; actions `say`, `chooseChip`, `confirmLearned`, `chooseDesign`, `stop`, `back`, `edit`, `publish` | **Keep; extend** with what the one-screen flow needs (below). |
| `useBotDraftSession.ts` | Logic: the draft, `/events` and `/messages/stream`, reconnects | **Keep.** |
| `steps.ts`, `findings.ts`, `types.ts` | Pure helpers | **Keep.** |
| `copy.ts` | Every string, held to the deck by `copy.test.ts` | **Keep; add** §15–19 strings. |
| `OnboardingStart.tsx` | Presentation | **Replace** (screen 1). |
| `OnboardingSession.tsx` | Presentation (two panes, phone tabs) | **Replace** with StepFrame and one screen per step. |
| `Canvas.tsx` | Presentation (cards per section) | **Replace** with screens. Small view logic to move into the hook or a helper first: `parseEmails`, the QR data URL, the building-tick timer. |

The one-screen flow needs from the hook what the two-pane layout didn't: the **current screen** (one of: start, reading, learned, safety, question n, design, make-it-yours, building, share, live), the **step number and total** for the footer, and the builder's **latest line for this screen** (its AssistantLine) with its **options**. These are derived from `view.step`, `conversation` and `rows`, so they're additions to `useOnboardingSession`, not new server calls.

### 12b's bot page

- **Entry:** ADMIN/b.html → `src/botPage/main.tsx`, built by Vite as a second input (`vite.config.ts:85-97`, `rollupOptions.input = {main, botPage}`). No `manualChunks`. The dev server and `vite preview` rewrite `/b/<slug>` to `b.html` (`vite.config.ts:17-29`); production rewrites are in CloudFront and Caddy, outside this repo.
- **Kept small by an ESLint import fence** (`ally-web/apps/ally-admin-dashboard/eslint.config.mjs`, lines 13–60): `src/botPage/**` can't import `@api`, `@components`, `@constants`, `@hooks`, `@store`, `@utils`, `@ally-ui-mono/*`, `@carbon/*`, MUI, Redux or PostHog. It imports only `hooks/chatStream/sse.ts` and `utils/brandColour.ts`, by relative path.
- **Components** (`src/botPage/`): `BotPageApp.tsx` (the visit's state machine: loading, error, cover, email, code, prechat, chat), `screens/Cover.tsx`, `screens/Access.tsx`, `screens/Prechat.tsx`, `screens/Chat.tsx`, `screens/ErrorState.tsx`, `components/parts.tsx` (heading, avatar, header, typing dots, sources, buttons, footer), `components/Turnstile.tsx`, `api.ts`, `theme.ts` (`--bp-accent`, `--bp-on-accent`), `types.ts`, `copy/{en,hi,index}.ts` (the page's own strings, with Hindi), `botPage.css`.
- **The dashboard preview:** `BotPagePreview.tsx` renders the real Cover and Chat screens, `aria-hidden` and inert, inside `pages/WhatsAppBot/BotPageTab.tsx` (Settings → Bot page) in a 300 × 600 phone frame. <!-- docs-path-lint: ignore -->
- **Size today** (last build; gzipped): page JS 9.7 KB + a shared chunk of React and `sse.ts` 46.9 KB + CSS **22.4 KB** = about 79 KB. The CSS is large because `botPage.css` compiles the app's whole Tailwind (content glob `src/**`). No size check exists in CI.
- **Fonts:** the live page uses the system stack; the dashboard preview adds `font-sans`, which this app maps to IBM Plex Serif, so preview and page don't match today.
- **Cache:** the deploy workflow sets `immutable` on hashed assets and `no-cache` on `*.html`.

### 12b's bot page settings record (where the brand object lives)

- **Entity:** BE/src/chatbot/entity/chatbot-page.entity.ts, table `chatbot_pages`: `chatbot_id` (unique), `slug`, `status`, `access`, `settings` jsonb.
- **Shape** (BE/src/chatbot/type/bot-page.type.ts): `settings = {branding, suggestedQuestions, prechat, limits, language}`; `branding = {logoUrl, accentColour, title, subtitle, assistantName, avatarUrl, disclaimer, footerLink}`.
- **Merge:** `mergeBotPageSettings` is per field over defaults, branding merged key by key, so a new branding key gets its default on pages saved before it existed.
- **Validation:** `BotPageBrandingDto` (BE/src/chatbot/dto/bot-page.dto.ts:42-86): https logo and avatar URLs, hex colour, length limits.
- **To visitors:** `GET v1/public/bots/:slug` (`no-store`) returns the whole merged `branding` plus suggestions, pre-chat, `maxMessageChars`, language and the Turnstile key. The OTP email uses title, logo and colour.
- **The `brand` object from DESIGN.md §7 goes here:** `settings.brand`, beside `branding` (see the plan for how the two relate).

### Image upload and storage today

- **12b's logo upload:** `POST v1/chatbots/:id/page/logo-url` (EDITOR) → `BotPageService.logoUploadUrl` → `S3Service.getPresignedUrlForImageUpload` (BE/src/aws/service/s3.service.ts:368-398).
  - Bucket `ASSETS_S3_BUCKET` (public media, stored as full URLs). Key `bot-page-logos/<chatbotId>-<uuid>/<ms>-<name>`.
  - PNG, JPEG or WebP by the **claimed** content type; 2 MB by the **claimed** size (not enforced by S3); presigned PUT, 10 minutes.
  - Served as a plain public bucket URL (`https://<bucket>.s3.<region>.amazonaws.com/<key>`): no CloudFront, no cache headers, no signed GET.
  - The browser PUTs straight to S3, so **ally-be never sees the bytes**: no magic-byte check, no re-encode, no EXIF strip.
- **Knowledge library uploads** use the same bucket and presign helper (PDF, DOCX, EPUB; 50 MB).
- **S3Service** has what a server-side pipeline needs: `uploadStream`, `getObjectBuffer`, `copyObject`, `deleteObject`, `getHeadObject`, `generatePresignedUrl` (get or put).
- **Image libraries in ally-be:** none (no `sharp`, `jimp`, `image-size` or `file-type` in package.json). `file-type` 21 is present only as a transitive dependency.

### Tests that assert on text or selectors

| Test | Kind | What it pins |
|---|---|---|
| `pages/Onboarding/__tests__/copy.test.ts` | Text | Every `COPY` string appears in `ONBOARDING-COPY.md` |
| `pages/Onboarding/__tests__/Canvas.test.tsx` | Text and behaviour | Card texts through `COPY`, roles (radio disabled), the patches and publish calls | <!-- docs-path-lint: ignore -->
| `pages/Onboarding/__tests__/useOnboardingSession.test.tsx` | Behaviour only | The hook's decisions; no markup |
| `pages/WhatsAppBot/__tests__/BotPageTab.test.tsx` | Text, roles, test ids | `bot-page-preview` test id, labels, buttons, preview text, save payloads <!-- docs-path-lint: ignore --> |
| `botPage/__tests__/BotPageFlow.test.tsx` | Behaviour through roles and English/Hindi strings | The visit end to end (cover → code → pre-chat → chat), headings, labels, alerts, `lang` |

- **No Playwright, no axe tooling, no bundle-size check** in ally-web. `axe-core` exists only transitively (from `eslint-plugin-jsx-a11y`).

### Fonts and Tailwind

- **tailwind.config.js** (one for the app): content `src/**` plus Nx dependency globs (ui-shared); **`theme` replaces** fontFamily (everything IBM Plex Serif, mono IBM Plex Mono), fontWeight (300/400/600 only) and borderRadius (0 except `sm` and `full`); `extend` adds the brand ramp and Carbon colours. No presets, no plugins.
- **styles.css** self-hosts IBM Plex Serif and Mono via `@font-face`; sets `html, body` to IBM Plex Serif in `@layer base`; loaded twice (index.html link and `main.tsx` import).
- **Google Fonts:** only Material Symbols, from index.html. b.html loads no fonts.
- **No per-file `@config`** anywhere (one broke the dashboard in 12b).
- **framer-motion** 12.38 is installed; `useReducedMotion` is used in Onboarding and Bug Hunter. The bot page uses `matchMedia` and `motion-reduce:` instead.

**Consequence for 20d:** the new tokens can't use the app's `theme` keys as-is (radius 0, weights capped at 600, every font IBM Plex Serif). They need their own names, scoped so the old dashboard is unaffected; see the plan.

## 2. Plan (approved 2026-11-08)

### A. Tokens and fonts

- **Tokens:** `src/v2/tokens.css` defines DESIGN.md §2 as CSS variables under two scopes: `.ally-v2` (the Ally surfaces: onboarding, and later assistant home, Checkup, Look and feel) and `.brand-surface` (visitor surfaces), where the `--brand-*` values are set inline from the bot's brand. Nothing is set on `:root`, so the old dashboard never sees them.
- **Tailwind:** `theme.extend` gains **new, prefixed keys only**: colours `ally-*`, fonts `font-display`/`font-ui`/`font-label`, radii `rounded-ally-{sm,md,lg,xl}`, shadows, and the motion keyframes. Existing keys (`sans`, radius 0, weights) are untouched, so every existing class renders as before. No per-file `@config` (it broke the dashboard in 12b).
- **Fonts:** self-hosted woff2 in `src/assets/fonts/v2/`: Geist (variable 400–600), Geist Mono, Instrument Serif 400, Nunito 700. Latin, plus Devanagari where the font has it (Nunito: no; the Geist family: no; so Hindi falls back to Noto Sans Devanagari in the system stack, as today). `font-display: swap`; preload only Instrument Serif and Geist on `/chatbots/new` and the bot page. **Needs your OK:** where the files come from (see Risks).

### B. Components (`src/components/v2/`)

Split in two so the bot page stays inside its import fence and budget:
- `v2/core/`: dependency-free (React only, CSS variables, CSS animations, no framer-motion, no aliases): **Orb, PrimaryButton, Option, Chip, Kbd, Toast, ImageSlot, AssistantLine, Question, ProgressBar**. Importable by relative path from `src/botPage/` and, later, the landing entry. A lint rule keeps `v2/core` free of aliases.
- `v2/`: dashboard-only, may use framer-motion: **StepFrame, FindingLine, LearnedCard, SafetyCard, DesignCard, BuildStep, PhonePreview** (renders the real bot page screens), **Dropzone, ColourPicker, ToneSwitch, TellMeSomethingElse**; 20a-2 adds CheckRow, MeasureCard and GapCard in this folder.
- Motion: `rise`, stagger, `slide`, `pop`, `breathe`, progress and press as CSS classes in `tokens.css` (shared), with framer-motion only where layout animation needs it on dashboard screens. One `prefers-reduced-motion: reduce` block turns every class into an instant opacity change and stops loops; the dashboard side also checks `useReducedMotion`.
- A gallery route `/dev/v2-components` (dev builds only) shows every component in light and dark, for review and screenshots.

### C. Onboarding, one screen at a time (`/chatbots/new`)

Every screen renders inside **StepFrame** and takes everything from `useOnboardingSession` (start: `useOnboardingStart`). The hook gains `screen` (which screen to show), `stepNumber`/`stepTotal`/`stepName` for the footer, and `line` + `options` (the builder's latest message and quick replies for this screen), all derived from what it already has.

| # | Screen | Hook fields and actions | Primary action |
|---|---|---|---|
| 1 | Start | `useOnboardingStart`: `startWithWebsite`, `startWithFiles`, `startWithDescription`, `resume` | Start with my website |
| 2 | Reading your website | `reading` (domain, count, findings with running totals, done) | Auto-advance 1.2 s after done, or "See what I learned" |
| 3 | What we learned | `view.learned`, `edit`, `confirmLearned`; LearnedCards grouped by section, each with SourceChip and inline Edit | Looks right |
| 4 | Safety | `view.safety` (SafetyCard: Always / Never / If someone may be at risk) | Continue |
| 5…n | One question per screen | `line`, `options`, `questionsLeft`, `chooseChip`, `say` (typed answer) | Option (auto-advance 380 ms) or OK |
| n+1 | Choose a design | `view.designs`, `chooseDesign` (20a-2 swaps in purposes; the screen takes cards from the hook) | Choose this |
| n+2 | Building | `building`, BuildSteps (the builder drafts the assistant here, as in 20a-1) | Continue |
| n+3 | **Make it yours** (new) | `view.draft` + `edit` (name, tone, opening line), the brand (logo, cover, colour) through the image and brand API, PhonePreview | Continue to Share (20a-2: "Run the checkup") |
| n+4 | Who can use it? | `publicAllowed`, `publish` | Publish |
| n+5 | Your assistant is live | `published` (link, QR, WhatsApp share, open page, "Want it on WhatsApp too?"; "Give it a landing page" hidden until 20e) | Copy link |

- **Order (decided at approval):** Choose a design → Building → Make it yours → Checkup (20a-2) → Share. The server's step machine is unchanged: choosing a design drafts the assistant (Building), and Make it yours edits that result through draft patches, so nothing builds twice. Make it yours is a client screen between the server's `building` and `share` steps; the hook remembers it was passed (so Back and Resume land right).
- **Back** uses `back()` (server step back, answers kept); **Resume** opens the screen for the draft's step. **Keyboard:** Enter submits the screen (bound per screen), A–D pick options, ↑/↓ move, Esc closes "Tell me something else". **Phone:** full width; PhonePreview moves below the controls.

### D. "Tell me something else"

A collapsed line at the foot of every screen; it opens a one-line input. Sending calls `say(text)` (the same builder turn as today: a typed gap answer becomes an Owner note, a correction becomes a patch). The reply replaces the screen's AssistantLine while streaming (`streaming`, `working`); if the turn changed the canvas (`canvasVersion` moved), the screen's content re-renders with `rise`. Esc closes it; Stop cancels the turn (20a-1's Stop). A test checks it on every screen type.

### E. The bot page restyle and its budget

- Same `BotPageApp` state machine, endpoints and copy; new presentation per screenshots `02-bot-page-*`: Cover (cover image or the orb in the brand colour, logo tile, heading style, Start, disclaimer), Access and Pre-chat one per screen with `slide`, a progress bar and "1 / 2", lettered options that auto-advance, then Chat (orb or logo header with a status line, outlined suggestion chips, the visitor's bubble in the brand colour, streamed text with a caret, source chips once, New chat, round send button). Crisis replies unchanged.
- Theme (light, dark, auto) and heading style from the brand; `--brand-accent` contrast-corrected server-side (stored) and checked client-side.
- **Budget** (gzipped, fonts excluded): JS ≤ 70 KB, CSS ≤ 25 KB; LCP < 2 s on Lighthouse mobile. Today: 56.6 KB JS, 22.4 KB CSS (the CSS is mostly unused dashboard utilities). Plan: the bot page stops compiling the app's Tailwind; its stylesheet becomes `tokens.css` + `v2/core` CSS + a small `botPage.css` (estimated 8–12 KB); no framer-motion on the page (CSS motion only). A new size script <!-- docs-path-lint: planned --> `ally-web/scripts/check-bot-page-size.mjs` reads the built assets and fails over budget; added to the CI test workflow after `build:admin`.
- **Tests to update for markup** (behaviour unchanged): `BotPageFlow.test.tsx` keeps its roles and strings (the page copy doesn't change), so it should pass as is; `BotPageTab.test.tsx` keeps the `bot-page-preview` test id. Any test that has to change will be listed with the reason.

### F. The image pipeline (ally-be + ally-web)

- **Upload through ally-be**, not presigned direct to S3, because every image must be checked and re-encoded: `POST v1/chatbots/:id/images` (multipart, multer, which is already in `@nestjs/platform-express`), EDITOR; rate-limited per user (Redis, 30 a minute).
- **Validation:** read the first bytes for the type (PNG, JPEG, WebP; SVG for `kind=logo` only); refuse anything else whatever its name; ≤ 5 MB; ≤ 6000 px on the longest side and a decompression-bomb pixel cap.
- **SVG decision: rasterise.** A logo SVG is rendered to PNG at 1024 px and stored only as raster variants; we never serve SVG, so there's no script, handler, external reference or `foreignObject` to sanitise and no sanitiser to keep correct. Cost: a logo isn't vector-sharp past 1024 px, which no surface here needs.
- **Re-encode** every image (which strips EXIF and GPS), auto-rotate from EXIF first; store variants 256, 768 and 1600 px WebP (never upscaled) plus the original re-encoded. **Needs `sharp`** (see Risks).
- **Storage:** a new table `bot_images` (id, chatbot_id, tenant_id, kind, content_hash, width, height, variants, alt, original_name, status, created_by, detached_at). Objects at `bot-images/<tenantId>/<chatbotId>/<hash>-<size>.webp` (content-hashed names, `immutable` cache headers).
- **Visibility:** all objects live in the existing private bucket under `bot-images/<tenantId>/<chatbotId>/`. The dashboard (drafts, Look and feel) reads them through short-lived signed URLs. Visitors read them through `GET v1/public/bot-images/:slug/:file`, which serves the bytes only while that page is published and the image is attached to it, with `Cache-Control: public, max-age=31536000, immutable` (names are content-hashed, so a change is a new URL). No copies to a public bucket.
- **Limits:** 50 images per bot. **Removing** detaches at once (and deletes public copies); a daily sweep (`scheduledTaskRegistry`) deletes files 30 days after detaching, so Undo works within that window.
- **Onboarding logo:** the crawl's detected logo is fetched through the same guarded, same-site fetcher and stored like an upload (no hotlinking); `branding.logoUrl` stops pointing at the site.
- **Alt text:** stored per image; defaults from DESIGN.md §6; editable in Look and feel.
- **Errors:** copy §19.

### G. The brand object and Look and feel

- **`settings.brand`** on 12b's `chatbot_pages` record (DESIGN.md §7): `logo`, `accent`, `accentContrast` (stored), `headingStyle`, `theme`, `coverImage`, `shareImage`, `landingImages {hero, gallery[≤6]}` with alt text, `peoplePhotos`. Validated by a `BrandDto` (hex, enums, image ids that belong to this bot). `mergeBotPageSettings` gives defaults, so pages saved before 20d keep working.
- **Relation to 12b's `branding`:** `branding` keeps title, subtitle, assistant name, disclaimer and footer link; its `logoUrl` and `accentColour` become **derived** from `brand` on save (the OTP email and older clients keep reading them). One store, no second record.
- **Public view:** resolves image ids to public URLs and `srcset` variants; still `no-store`.
- **Look and feel** (screenshot `06-look-and-feel`): a Settings section beside "Bot page" (and linked from it): Logo, Images (cover, link preview; landing slots hidden until 20e), Team photos (names from learned team facts), Style (heading style, colour, theme), and a live PhonePreview. **Saves as you go:** each change is a debounced (600 ms) brand PATCH through the same service as 12b's settings; a Toast "Changed. Undo" restores the previous brand; "Saved. Live on your page now." after a save on a published page.

### H. Tests

- **ally-web:** Playwright screenshots of every onboarding screen and bot page screen at 1440 and 390 px, light and dark, against fixed data (mocked API), checked in as baselines; a keyboard-only run from start to publish; a reduced-motion run asserting no animation classes are active; axe on every screen (0 serious or critical); the bot page size check; Look and feel (preview updates, Undo restores, save debounces); component tests for Option (keys, auto-advance), StepFrame (Back, Enter), ImageSlot (states and errors). **Needs Playwright and `@axe-core/playwright`** (see Risks).
- **ally-be:** the upload cases from the brief (a `.exe` renamed `.png`, over 5 MB, too many pixels, an SVG with a script rasterised safely, EXIF and GPS gone, variants made, the 50 limit, a draft image not public, a removed image gone after the purge), the brand DTO and contrast correction, and 12b's settings tests unchanged.

### I. Commit sequence (each `[20d]`)

1. Docs: copy §15–19 merged, current chunk 20d, this code map and plan.
2. Foundation: tokens, fonts, Tailwind extension, motion, `v2/core` and `v2` components, the gallery route.
3. ally-be: `bot_images`, the upload pipeline, visibility on publish, the purge sweep, the brand object and DTO.
4. Onboarding: StepFrame and every screen, the hook additions, Tell me something else, keyboard.
5. Make it yours: logo, cover, colour, tone, opening line, PhonePreview.
6. Bot page restyle, its own stylesheet, the size check in CI.
7. Look and feel.
8. Tests: Playwright screenshots, keyboard, reduced motion, axe.
9. Notes: before and after screenshots, budgets measured, the text-only test updates listed, open items for 20a-2 and 20e.

### J. Decisions at approval (2026-11-08)

1. **Dependencies:** `sharp` (pinned; must build in the ally-be Docker image); `@playwright/test` and `@axe-core/playwright` as dev dependencies. Fonts from `@fontsource` packages, importing only the weights used; plus **Noto Sans Devanagari**, loaded only for Hindi text (Geist has no Devanagari).
2. **Draft images:** a `bot-images/<org>/<bot>/` prefix in the **existing private bucket**; no new bucket for now (**launch item**). Published images are served through an ally-be route that checks the page is published, with content-hashed names and long cache headers. Drafts use short-lived signed URLs.
3. **Screen order:** Choose a design → Building → Make it yours → Checkup (20a-2; until then Continue goes to Share). Server unchanged. Step map, footer step names and buttons updated in the deck.
4. **Hindi:** new bot page strings drafted by me, marked "needs review" in the strings file. Owner screens stay English.
5. **Screenshots vs the deck:** the deck wins; each difference is listed in §3.

Remaining risks: the bot page budget (the shared React chunk is 47 KB of the 70 KB JS budget); screenshot baselines differ by OS font rendering, so they're generated in the Playwright Docker image.

## 3. What was built (2026-11-09)

Branch `feat/agents-v2-chunk-12-shared-store`, not pushed.

| Commit | What |
|---|---|
| `921249d68` | Plan approved; screen order Design → Building → Make it yours; deck and step map updated |
| `62e42e1bc` | Foundation: tokens, fonts, motion, `components/v2/core` and `components/v2`, dev gallery `/dev/v2-components` |
| `03070547e` | ally-be: `bot_images`, the upload pipeline, publish-checked public route, purge, `settings.brand` |
| `9eecb9432` | ally-be fix: an onboarding page's link is named from the assistant, not the early logo page |
| `494e26757` | Onboarding one screen at a time (StepFrame, every screen, keyboard, "Tell me something else") |
| `ebd25928c` | Make it yours: logo, cover, colour, tone, opening line, live phone preview (`useBrandEditor`) |
| `1aadaa4d6` | ally-be fix: `BotImage` registered with TypeORM (the entity glob is `*/entity/*.entity.js`) |
| `fed1a48db` | Bot page restyle in the owner's brand, its own stylesheet, the size check in CI |
| `02933f5ab` | Look and feel (Settings section), team photos, `GET v1/chatbots/:id/team-names` |
| `889a6b15d` | Browser tests (Playwright, axe), fixture harness `/dev/onboarding`, a11y fixes |
| (this) | These notes |

Also on the branch: `70d761be3` (the 5 wrong declines, diagnosed in `CHUNK-20A-EVAL.md`) and `c22288279` (a 20a-1 gap: `bot-draft` missing from the builder capabilities guard).

### Components (DESIGN.md §4)

- `components/v2/core` (React and CSS only, ESLint-fenced so the bot page can import it): Orb, Button, PrimaryButton (with the Enter hint), Kbd, OptionList (letters, arrows, 380 ms auto-advance, announced keys), Chip, AssistantLine, Question, ProgressBar, Toast, ImageSlot; `useEnterToSubmit`; `tokens.css`, `fonts.css`, `core.css`.
- `components/v2` (dashboard): StepFrame, TellMeSomethingElse, FindingLine, SourceChip, LearnedCard, SafetyCard, DesignCard, BuildSteps, Segmented, ColourPicker, PhonePreview.
- 20a-2 adds CheckRow, MeasureCard and GapCard in `components/v2`.

### Logic and presentation

- Onboarding logic stays in `useOnboardingSession`. The screen model is pure (`flow.ts`: `screenFor`, `flowFor`, `stepPosition`, `splitQuestion`, `passedFromStep`). What only the browser knows (past the reading result, the safety screen, the finished build, Make it yours) is remembered per draft in `localStorage`, so Resume opens the last screen.
- `OnboardingView` draws a session's state. The route feeds it the real hooks; `/dev/onboarding` (development only) feeds it fixtures for review and the browser tests.
- The page's look is `useBrandEditor` (`hooks/brand`), shared by Make it yours and Look and feel.

### Images: storage choice, SVG decision, visibility

- **Storage:** the existing private bucket (`BOT_IMAGES_S3_BUCKET`, else `AUDIO_STORAGE_S3_BUCKET`) under `bot-images/<tenant>/<chatbot>/<hash>-<size>`. A bucket of its own is a **launch item**.
- **Upload:** through ally-be (`POST v1/chatbots/:id/images`, multipart). The type comes from the bytes. Limits: 5 MB, 6000 px on the longest side, a pixel-bomb cap, 50 images per bot, 30 uploads a minute per user.
- **Processing:** sharp 0.35.5 re-encodes everything, which removes EXIF and GPS, and turns the image upright first. It stores WebP at 256, 768 and 1600 px (never enlarged) plus the original.
- **SVG: rasterised, for logos only.** An SVG is rendered to a 1024 px PNG and never stored or served as SVG. Before rendering, it is refused if it has a DOCTYPE or entities, a script, foreignObject, iframe, object, embed, an external href, url() or @import. Rasterising means nothing executable is ever served. The checks mean the renderer never fetches anything.
- **Visibility:**
  - The dashboard gets signed URLs that last 15 minutes.
  - Visitors use `GET v1/public/bot-images/:slug/:file`. It serves a WebP variant only while the page is live and its brand uses that image. Responses are cached `immutable` for a year and carry `Cross-Origin-Resource-Policy: cross-origin`.
  - Removing an image detaches it at once; Undo restores it. A daily task deletes the files after 30 days.
- **Onboarding logo:** fetched through the crawl's guarded fetcher (`guardedFetchBuffer`) and stored like an upload. Publish no longer copies the site's logo URL, so nothing is hotlinked.
- **Checked in the image:** sharp works on `node:24-alpine` for both arm64 and x64. The full production image build ran out of memory in `nest build` locally (the known Docker VM memory limit), not in the npm install that brings sharp.

### Brand object

- **Where it lives:** `settings.brand` on the bot page record. It holds the logo, cover and share image ids, the accent and its contrast-corrected copy, heading style, theme, landing images and team photos.
- **Saving:** `PATCH v1/chatbots/:id/page/brand` sends only the fields that change. Image ids must belong to this bot and be attached. The accent is darkened until white reads on it at 4.5:1. The first save creates the page, off.
- **Bot page tab:** its save keeps the brand and ignores a brand sent there.
- **Public view:** `branding.logoUrl` and `branding.accentColour` are derived from the brand, and the look is added as `branding.look`. It is nested so the public view's top-level field list, which a privacy test pins, is unchanged.

### Budgets (measured)

| | Before 20d | After | Budget |
|---|---|---|---|
| Bot page JS (gzipped) | 56.6 KB | 57.5 KB | 70 KB |
| Bot page CSS (gzipped, fonts excluded) | 22.4 KB | 4.7 KB | 25 KB |

- `ally-web/scripts/check-bot-page-size.mjs` runs in CI (job "Bot page size budget").
- The page no longer compiles the app's Tailwind.
- LCP on Lighthouse mobile was not measured here: no Lighthouse run in this session. That is an open item.

### Tests

- **ally-be:**
  - The upload cases from the brief, with real sharp: a `.exe` renamed `.png`, over 5 MB, too many pixels, SVG with a script or external references refused, EXIF and GPS gone, the image upright, variants made and never enlarged.
  - Service tests: the 50 limit, rate limit, dedupe, a draft image not public, a live page serving only images its brand uses and never the original, removal / Undo / purge after 30 days, brand validation and contrast, the Bot page tab keeping the brand.
  - Others: the slug fix, team names.
  - The full suite passes apart from the pre-existing capabilities guard, which is now fixed.
- **ally-web unit:**
  - flow, keyboard (letters, arrows, 380 ms auto-advance, Enter to submit, Esc), `useBrandEditor` (debounced save, Undo, image removal and restore, upload errors), Look and feel (preview follows the brand, viewer can't change).
  - The admin suite passes (555 files, 8,618 tests).
- **Browser (Playwright 1.64.1 + axe 4.14.0, `apps/ally-admin-dashboard/e2e`):**
  - Every onboarding screen, plus the bot page cover, email, pre-chat and chat in light and dark, at 1440 and 390 px. Each is screenshotted, and axe finds no serious or critical issues.
  - A keyboard-only run from the read to published.
  - Reduced motion: nothing animates.
  - 44 tests. Baselines are made in the Playwright Linux image (`e2e/README.md`); CI job "Browser tests (Playwright)".
  - Screenshots are taken with reduced motion, because entrance animations made them differ run to run. The live screen waits for its QR code. The config starts Vite directly rather than `nx serve`, whose task lock outlived a killed run and blocked the next.
  - axe found three real issues, all fixed:
    - the phone preview was `aria-hidden` but focusable; it is now `inert`;
    - the text on the visitor's bubble used bone instead of white;
    - initials on the dark logo tile were low contrast; the tile is now white in every theme.

**Tests changed, and why** (no behaviour test changed):
- `pages/Onboarding/__tests__/Canvas.test.tsx` → `Screens.test.tsx`. Canvas.tsx was replaced by one component per screen. Every case was ported with the same assertions against the new screens. <!-- docs-path-lint: ignore -->
- Unchanged and passing: `useOnboardingSession.test.tsx`, `copy.test.ts`, `botPage/__tests__/BotPageFlow.test.tsx`, `pages/WhatsAppBot/__tests__/BotPageTab.test.tsx`, ally-be's bot page, publish and crawl specs. New dependencies were added last and optional in existing constructors, so the specs construct services unchanged.

### Where the screenshots and the deck differ (the deck was followed)

1. **Make it yours:** the screenshot's button is "Build my assistant". With the approved order (Building comes before it), the deck now says Continue (and "Run the checkup" with 20a-2).
2. **Cover hint:** the screenshot says "PNG, JPG or SVG". The deck says "PNG, JPG or WebP, up to 5 MB", and SVG is accepted for logos only.
3. **Safety:** the screenshot shows the three panels open. The deck keeps "See what this covers", so they open from that link.
4. **Pre-chat counter:** the screenshot shows "1 / 2". The page keeps its own "Question 1 of 2" (and the bar).
5. **Bot page footer:** the 12b "Powered by Ally" stays. The screenshots' "Assistant by Ally" is the 20e landing page credit (copy §18).
6. **Look and feel:** the landing slots, landing preview switch and "click to remove" captions are not built. Landing waits for 20e; images have Replace and Remove under them.
7. **Onboarding has no dark mode:** DESIGN.md defines dark tokens only for visitor surfaces, so onboarding baselines are light only. The bot page is tested in light and dark.

### Open items

- **20a-2:**
  - The 5 wrong Preview declines come first (`CHUNK-20A-EVAL.md`: passage selection band; heading-only chunks).
  - The checkup slots in after Make it yours: `flow.ts` already names the step, and Make it yours' button becomes "Run the checkup".
  - CheckRow, MeasureCard and GapCard.
  - Changing the tone doesn't rewrite the introduction yet. That needs a builder turn, which is a new builder ability; the tone is saved and the opening line stays editable.
- **20e:** landing images and the landing preview in Look and feel; `brand.landingImages` is stored and validated already. The "Give it a landing page" card stays hidden.
- **Launch:**
  - A private bucket of its own for bot images.
  - A Lighthouse mobile LCP run for the bot page.
  - Hindi strings marked "needs review" in `botPage/copy/hi.ts`.
  - The local production image build runs out of memory in `nest build`, a Docker VM memory limit.
- **Process:** the pre-commit hook runs the helpline suite on whatever Node is first on PATH. On Node 24, about 20 files fail on `AbortSignal` and wait out a 15-minute timeout. On Node 22, the version ally-web requires, it passes. These commits were made with Node 22 first on PATH.

### How Shehbaz tests it

1. **Onboarding:**
   - Go to AI Chatbots → New assistant and enter `http://host.docker.internal:8701` (the fixture server).
   - Each step is its own screen and findings tick in. Enter submits, A–D pick, Back works.
   - "Tell me something else" sends to the builder.
2. **Make it yours:**
   - Replace the logo, add a cover, change the colour, tone and opening line, and watch the phone.
   - Undo appears after each change.
3. **Publish and visit:**
   - Publish invite-only and open the link.
   - The cover, logo, colour and heading match.
   - Code from `docker logs --since 5m ally-be-app-1 2>&1 | grep "Bot page code"`.
4. **Look and feel:**
   - Settings → Look and feel (or the link in Bot page → Branding).
   - Change the heading style, colour and theme (dark), press Undo, then reload the bot page.
5. **Uploads:**
   - Upload a 12 MB photo, an `.exe` renamed `.jpg`, and a phone photo with location.
   - The first two are refused with copy §19's lines; the third is stored without EXIF or GPS.
6. **Crisis:** send a crisis phrase on the bot page; still only the crisis reply (12b behaviour, unchanged).
7. **Browser tests:** see `e2e/README.md`. Review screens without a backend at `/dev/onboarding?screen=make` and `/dev/v2-components`.

## 4. Plan: the assistant home (20d continuation, for approval)

**Why:** Shehbaz's manual test (irisgo.ai, 2026-11-09). After creation the assistant's page is still the 12b-era dashboard: 8 tabs and 7 Settings sections in the old style. The same thing is editable in two or three places through different endpoints, so one save can overwrite another. "Who can use it" is three separate systems. Preview looks nothing like the bot page.

**Decided (2026-11-09):**
- Build the assistant home now; Checkup, "Change your assistant" and the wrong-decline fix stay in 20a-2.
- Advanced is visible to every editor, collapsed.
- A temporary "Classic view" link keeps the old tabs reachable while testing.
- I write the copy into the deck.

### A. The page (screenshot `03-assistant-home`, built from `components/v2`)

- **Layout:**
  - Header: "Assistants / {name}", a status pill, **Try it**, **Open page**.
  - A left section list (a top menu on phones) and the content in the middle.
  - **Try it** opens a phone panel on the right (a bottom sheet on phones).
  - 20a-2 later docks "Change your assistant" in the same right panel.
- **One save model:** every control saves on its own (debounced, "Changed · Undo" toast, "Saved" dot), as Look and feel and onboarding already do. No page-level Save buttons, so there's no unsaved-changes guard to fall through. Each control patches only its own field; nothing sends a whole object built from a stale read.
- **Route:**
  - `/chatbots/:botId` renders the new `AssistantHome`.
  - `?view=classic` renders today's `ChatbotPage`, unchanged (that keeps `WhatsAppBot.test.tsx` and the other tab tests as they are).
  - Old deep links (`?tab=connectors`, `?tab=settings&section=…`) map to the new sections.

### B. Sections, with where each control comes from (code map: the inventory of 2026-11-09)

| Section | Shows and edits | From today |
|---|---|---|
| **Overview** | Status and the one on/off (publish / pause the bot). The live link with Copy and QR. This week's numbers. "Needs your input" (open unanswered count). Archive (owner only) | Overview tab; its checklist is replaced by "what needs attention", and "who can use it" checks page access too |
| **What it knows** | **From your website:** the learned facts by section, each with its source chip (read-only). **Your notes:** the Owner notes document, editable; a correction goes here. **Documents:** pages read, uploads, library documents (view, upload, add from library, remove). **Needs your input:** unanswered questions, with Answer (creates a document) and Dismiss | Knowledge tab + panels, Unanswered tab, onboarding's learned card |
| **Personality** | Assistant name (one field: `persona.displayName` and the page's `branding.assistantName` together). Opening line (`persona.greeting`). Tone. Languages. Suggested questions (up to 4). Questions before the chat (up to 8). When it doesn't know (`declineText`). Instructions (`systemPrompt`, collapsed, "for fine-tuning") | Instructions tab, Bot page tab (suggested, pre-chat, language), General (decline) |
| **Safety** | The pack card (Always / Never / If someone may be at risk; locked). **Your own rules** (add, edit, remove; the pack's lines can't be removed). Disclaimer (one field: per-bot `disclaimerText` and the page's `branding.disclaimer` together). Crisis reply and helpline. Crisis check and consent (can only be tightened) | General → Safety and messages; `chatbots.rules` has **no editor today** |
| **Page** | Look and feel (logo, cover, link preview image, team photos, heading style, colour, theme) with the live phone. The page switch, its link (slug check), title and tagline, footer link, limits | Look and feel + Bot page tab. **The Bot page Branding card's logo URL and colour fields go**: the brand is the one place |
| **Conversations** | As today, restyled: list, filters, thread drawer, reveal / block / erase | Conversations tab |
| **Share** | **Who can use it**, two clearly labelled cards: *On your page* (page access mode and list) and *On WhatsApp* (audience mode and list). They stay separate lists (12b: a page list can't widen WhatsApp). **Channels**: WhatsApp numbers, connect, check. **Team**: who can edit (owner only) | Bot page tab access, Access (people), Channels |
| **Advanced** (collapsed) | Answer mode, model, temperature. Quick replies. The other WhatsApp messages (fallback, unrecognised number, unsupported media, too many messages). Rate limits. Retrieval and idle time. Show typing (platform admins). Analytics (lazy, as now) | Agent, Quick replies, General (rest), Analytics |

**Try it:**
- It replaces Preview with the real bot page `Chat` screen in a `PhonePreview`, in the page's brand. It sends through today's `/chatbots/:id/test/stream` (same hook, same fallback), so answers, sources and the crisis path match the live page.
- For platform admins, a "Details" toggle under each reply keeps today's engine, steps and run id.
- The Personality and Advanced controls feed it the unsaved draft as today (`chatbot-draft:<id>`).

### C. Data and API changes (ally-be)

- **`PATCH /v1/chatbots/:id/rules`** `{never: string[]}` (EDITOR). It edits the owner's own Never lines. The pack's lines are never stored there, so nothing can weaken the pack (the existing safety lock applies).
- **Assistant name and disclaimer, one field each:** the page writes them in both stored places in one call (`PATCH /chatbots/:id/persona-page`, or two calls made together by one hook; to decide in code, recorded in the notes).
- **Small field endpoints** so each control saves only its field: `PATCH /chatbots/:id/page/settings` (suggested, pre-chat, language, limits, title, tagline, footer) in place of the whole-object PUT. The PUT stays for the classic view and its tests.
- **What it knows → Your notes:** reuses `PATCH …/documents/:docId` (Owner notes is a private paste document). If no Owner notes exists yet (a bot made by the old form), "Add a note" creates it.
- **No schema change.**

### D. The fixes from the test, in the same pass

1. **An edited fact becomes "From you"**: `byOwner: true` and source "From you" when the owner edits its text (ally-be `applyPatch` on `/facts/n/text`; `bot-draft.service.ts`).
2. **The reader skips installers**: `.dmg .exe .msi .pkg .apk .deb .rpm .iso .appimage .bin` added to `ASSET` (`crawl/url-scope.ts:100`), with a test.
3. **Design samples:** the designs prompt (ally-ai `builder/designs`) asks for alternating turns. A code check splits a turn that holds a question and an answer, and drops a sample line with a number, email or URL that's not in the read pages (the same grounding rule as facts).
4. **Logo choice:** prefer the header `<img>` named logo, then the apple-touch icon, then `og:image` only if it's roughly square (aspect ≤ 2:1); a 1200×630 banner is never the logo (`crawl/brand.ts`).
5. **"503" on streams:** not a server error (ally-be logged none). Confirm in DevTools once; nothing to fix unless a real 503 shows.

### E. Copy (deck §20, new)

Section names (Overview · What it knows · Personality · Safety · Page · Conversations · Share · Advanced), "From your website", "Your notes", "Needs your input", "Your own rules", "On your page" / "On WhatsApp", "Team", "Try it", "Classic view", and their one-line explanations. Written in the deck's voice; `copy.test.ts` holds the strings to it.

### F. Tests

- **ally-web:**
  - Each section's controls save their own field (payloads).
  - Undo.
  - Viewer is read-only.
  - Old deep links land on the right section.
  - Try it sends through the test stream and draws the bot page `Chat`.
  - "Who can use it" shows both lists.
  - Classic view still renders the old page (`WhatsAppBot.test.tsx` and the tab tests unchanged).
  - Playwright screenshots of each section at 1440 and 390 px, plus axe.
- **ally-be:** the rules endpoint (add, edit, remove; can't touch pack lines; viewer refused), the page settings PATCH, the one-field name and disclaimer, the four fixes.
- **ally-ai:** design samples split and grounding.

### G. Commit sequence (`[20d]`)

1. Docs: this plan, copy §20.
2. ally-be: rules endpoint, page settings PATCH, name and disclaimer in one call.
3. ally-be + ally-ai: fixes 1–4.
4. ally-web: AssistantHome shell, left list, routing, Classic view, Overview.
5. What it knows.
6. Personality and Safety.
7. Page and Share.
8. Conversations, Advanced, Try it.
9. Tests (unit, Playwright, axe) and notes.

### H. Open questions

1. **Correcting a website fact:** a page we read can't be edited (it's that site's text). Proposed: "Correct this" adds the correction to **Your notes**, the fact shows "Corrected by you", and both stay searchable, notes first. Alternative: re-read the page. OK?
2. **Instructions (`systemPrompt`)** in Personality, collapsed, or in Advanced? Proposed: Personality, collapsed, since owners do tune it.
3. **Classic view:** remove after your sign-off, in a follow-up commit?

### 4.1 Approved 2026-11-09, with these answers and changes (they override §4 where they differ)

1. **Correct this replaces the original for the assistant.**
   - The correction is stored as an owner note linked to the original fact.
   - The original is hidden from search but stays viewable through "Show original"; the fact shows "Corrected by you".
   - If a later re-read changes that page, it is flagged so the owner chooses which to keep.
   - How: ally-be finds the sentence(s) in the page's stored text that the fact came from (word-overlap match). It replaces them in that page document with the correction, keeps the original text on the fact, and re-indexes the document, so search no longer finds the old line. The owner note records the correction against the fact id. With no confident match, the correction still goes into the notes and the owner is told the original line couldn't be found. Each correction stores the page's content hash for the re-read check (re-reading isn't built yet; the check runs when it is).
2. **Extra instructions** (`systemPrompt`) sit in Personality, collapsed, with the note that safety rules always come first. The existing length limit stays.
3. **Classic view** stays until 20a-2's Checkup lands plus about a week of use, then goes in a follow-up. Until then a test keeps `?view=classic` loading.
4. **Checkup** is in the left list, with an empty state ("Your first checkup runs after your next change") until 20a-2 fills it.
5. **Pre-chat questions** move to Page; WhatsApp doesn't use them.
6. **No Advanced section.** Its items move:
   - quick replies → Personality, next to suggested questions;
   - the other WhatsApp messages → Share, inside "On WhatsApp";
   - rate limits → Page, with the page limits;
   - analytics → Overview ("this week");
   - model and answer mode → a **platform-admin-only** engine panel (a header toggle). Owners never see these, or the word "model".
   - Owner sections: **Overview, What it knows, Personality, Safety, Page, Checkup, Conversations, Share.**
7. **The old "Advanced setup" form is removed** from AI Chatbots. Onboarding is the only way to create an assistant; platform admins keep engine controls through the panel above. Tests that used the form are updated or removed and listed.
8. **Concurrency:** each field save sends the value it was based on (`base`). ally-be refuses a stale save with 409 and the current value, and the UI shows it. A test edits one field from two tabs.
9. **The right side** is left ready for 20a-2's "Change your assistant" panel; Try it uses it for now.
10. **Own safety rules** sit after the owner's instructions and only add to the pack. 20a-2's "topics to avoid" check enforces them later. A test checks that a rule can be added, and that a pack rule can't be removed or edited.
11. **Owner-facing text** goes into `ONBOARDING-COPY.md` in the same commit, in the deck's voice.

**Revised commit sequence (`[20d]`):**
1. Docs.
2. ally-be: the field save API with `base`/409, own rules, corrections.
3. ally-be + ally-ai: the four fixes.
4. ally-web: the AssistantHome shell, left list, routing, Classic view, Overview, Checkup empty state.
5. What it knows.
6. Personality and Safety.
7. Page and Share.
8. Conversations, Try it, the admin engine panel, the old form removed.
9. Tests, screenshots and notes.

## 5. What was built: the assistant home (2026-11-09)

Commits, all `[20d]`: `c10855e54` docs · `f59149354` ally-be home API · `11537d910` the four fixes · `dc931b8b6` the home · then the browser tests and these notes.

### ally-be (`src/bot-draft/home/`)

- **`GET v1/chatbots/:id/home`**: every owner-editable field with a version, the safety view (pack plus own rules) and the learned facts.
- **`PATCH v1/chatbots/:id/home` `{field, value, version}`**:
  - The version is a 16-character hash of the value the edit started from (keys sorted).
  - A stale save returns 409 `stale` with the current value and version.
  - Saves of one bot run under a row lock on `chatbots`, so the check and the write can't interleave.
  - Different fields never conflict.
- **The field registry** (`home-fields.ts`) maps each field to every place it's stored:
  - assistant name → persona and page branding;
  - disclaimer → settings and page branding, and a pack's disclaimer can't be dropped;
  - business name → bot name and page title;
  - page on/off and page access → the page row (public is refused while the platform forbids it);
  - the rest → one store each.
  - A bot without a page gets one, off and invite-only, on its first page save.
- **`PATCH v1/chatbots/:id/rules` `{op, id?, text?, version}`**: add, edit or remove an own rule. `pack-<n>` ids are refused as `safety_locked`. Limits: 20 own rules, 200 characters each, no duplicates.
- **`POST v1/chatbots/:id/facts/:factId/correction` `{text, version}`**: as §4.1.1.
  - It word-matches the fact to a sentence of its page document, replaces that sentence and re-indexes the document.
  - With no match (under 60% of the fact's content words), it goes into the notes only, and the owner is told.
  - It always adds the correction to the Owner notes, building on the notes document as the owner last edited it.
  - The fact keeps `correction {text, originalText, appliedTo, documentId, notesDocumentId, pageHash, at}`. A second correction keeps the first original.
- **The four fixes** (§4D): an edited fact becomes "From you" (and Undo restores its source); installers are skipped; logo order is header logo, then touch icon, then og:image only if its declared size is ≤ 2:1; design samples have one speaker per line and are grounded (ally-ai).

### ally-web (`pages/AssistantHome/`)

- **Routing:** `/chatbots/:botId` opens the home (edge to edge). `?view=classic` opens the old `ChatbotPage`, unchanged. Old `?tab=` and `?tab=settings&section=` links land on the section that holds them now (`sections.ts`); `?tab=test` opens Try it.
- **Saving:** `useHomeField` shows a value at once and saves after 600 ms or on blur, with the version it started from.
  - On a 409 it puts the other tab's value in the field and shows the server's words.
  - Each save offers "Changed · Undo", which saves the previous value the same way.
  - The header shows Saving… / Saved / Couldn't save.
- **Sections, and where each old control went:**

  | Section | Built in v2 | Still the classic component inside (to redraw) |
  |---|---|---|
  | Overview | live switch, link + QR, last 30 days, needs-you, Remove | "All numbers" (the usage charts, loaded only when opened) |
  | What it knows | facts with Correct this / Show original, Your notes, document list | "Upload or remove documents" (collapsed); the unanswered list when there is one |
  | Personality | name, introduction, tone, languages, suggested questions, when it doesn't know, Extra instructions (collapsed) | Quick replies (shown only once WhatsApp is connected) |
  | Safety | pack card, own rules, disclaimer, at-risk reply | none |
  | Page | on/off, business name, questions before the chat, limits, too-many-messages | Look and feel was already v2 |
  | Checkup | empty state | none |
  | Conversations | heading | the conversation list and drawer |
  | Share | who can open the page (3 choices); WhatsApp messages (collapsed, once connected) | the page's access list, WhatsApp audience, numbers, team |

- **Try it** (right panel; a bottom sheet on phones): the bot page's own `Chat` screen in the page's brand, through `/test/stream` with the plain endpoint as fallback.
- **Engine** (header button, platform admins only): the classic AgentTab.
- **The old "Advanced setup" form** (`CreateChatbotPanel`) is deleted. "New assistant" and the empty-state and connectors actions all go to onboarding.
- **Copy:** `ONBOARDING-COPY.md` §20. Words the deck already had (safety card, tones, share options, Changed · Undo) come from onboarding's COPY. "This week" became "Last 30 days", because the bot's stats cover 30 days.

### Decisions in code (not in §4.1)

- **Commits:** the home landed as one ally-web commit, not five per-section ones. The shell imports every section, so a partial commit wouldn't build.
- **The 30-day window:** stats are 30 days, so the tiles say so.
- **Page on/off and access** became home fields, not the whole-page PUT, so no control sends a whole object.
- **WhatsApp-only controls** (audience, WhatsApp messages, quick replies) appear once a number is connected; before that, Share shows deck §11's "Connect your WhatsApp number…" and the Connect button.
- **The Owner notes document** is edited directly from What it knows and saved on blur, because each save retrains it.

### Tests changed or removed

- `WhatsAppBot.test.tsx`: removed its `vi.mock("../CreateChatbotPanel")`, because the file is deleted. No assertion changed; the "member sees no New chatbot" test still passes.
- `RouteLayout.test.tsx`: added a mock of `AssistantHome` and one test: the home at `/chatbots/:id`, and the classic page at `?view=classic`.
- `crawl-helpers.spec.ts` "uses a logo-shaped og:image…" and `site-crawl.service.spec.ts` "finds the brand": their fixtures now declare a square og:image, because an undeclared one is no longer trusted (approved fix 4).
- `memory-drafts.ts` (test helper): `findOne` also matches by `chatbotId`.
- Nothing else changed; no test was removed.

### New tests

- **ally-be `assistant-home.spec.ts` (57):** the field registry; two tabs on the same field (sequential and simultaneous); different fields don't conflict; refusals; a rule can be added but a pack rule can't be removed or edited; corrections (page, notes only, second correction, notes as last edited); the server's words against the deck.
- **ally-be `assistant-home.pg.spec.ts` (2, Postgres):** two tabs saving at once, where one wins and the other gets the winner's value, and both stores hold it; adding a rule.
- **ally-be fixes:** "From you" plus Undo; installers; logo order.
- **ally-ai `test_flow.py`:** one speaker per sample line; ungrounded samples are replaced.
- **ally-web:**
  - `copy.test.ts` (every string is the deck's; none says "model");
  - `sections.test.ts` (deep links);
  - `fields.test.ts` (saves after a pause with its version; blur saves one field; 409 shows the other tab's words; viewer read-only; add rule with the list's version; no Edit on a pack rule);
  - the classic-view route test.
- **Playwright `assistantHome.e2e.ts`:** each section at 1440 and 390 px against baselines, with axe; Try it; a field changed in another tab; viewer read-only; Engine for platform admins only. The dev harness is `/dev/assistant-home/<id>` (dev builds only; it isn't in the production bundle), with every API call answered by `assistantHome.fixture.ts`.

### Suites (2026-11-09)

- ally-be: 1009 suites, 14,560 passed, 65 skipped (the Postgres specs without a test database). With `CHATBOT_STORE_TEST_DB`: the 6 bot-draft Postgres tests pass.
- ally-ai: 2,019 passed, 38 skipped; flake8 clean.
- ally-web admin: 560 files, 8,820 passed; typecheck clean; `build:admin` succeeds; eslint clean on everything this work touched. `IdeaCapture.tsx` and `types/bugHunter.ts` have prettier errors from before.

### How to test

1. Open an onboarded assistant from AI Chatbots. It opens on Overview.
2. Change its name in Personality, then reload. The page's assistant name changed too (Page → the phone, or Try it).
3. Open the same assistant in two tabs. Change Introduction in one, then in the other. The second shows "This changed while you were editing…" with the first tab's text.
4. In Safety, add a rule, edit it and remove it. Pack rules have no Edit or Remove.
5. In What it knows, use Correct this on a website fact. Show original shows the old line. Ask Try it the question: it answers with the correction.
6. Open `?view=classic`: the old tabs.

### Open

- **To redraw in v2:** the conversation list and drawer, the documents upload panel, the unanswered list, the page access list, the WhatsApp audience, numbers and team, quick replies, and the usage charts.
- **Unused create path:** the `useCreateChatbotMutation` and `POST v1/chatbots` stay for now (platform scripts may use the endpoint). Remove them with the classic view.
- **Re-reading a corrected page:** `pageHash` is stored; the "choose which to keep" flag needs re-reading, which isn't built.
- **The designs prompt's default text** changed (one speaker per line, no ungrounded details). The live Skills Store version needs a push with the `prompts` CLI (needs a Skills Store key). The code check applies either way.
