# Chunk 20e — Landing page

> Brief for Claude Code. Read `docs/agents-v2/CONTEXT.md`, `v2-chunks.md`, `CHUNK-12B-NOTES.md`, `CHUNK-20D-NOTES.md`, **`DESIGN.md`**, **`ONBOARDING-COPY.md` §18**, screenshot `05-landing-page`, then this file.
> Branch: the slice 1 branch, or its follow-up branch if slice 1 has merged; tag commits `[20e]`. Repos: ally-web, ally-be.
> **When:** after 15a, because a landing page is public by nature and needs `botPagePublicAllowed` (gate G1b).

## Why

Many small businesses (a therapist, a clinic, a coach) have a weak website or none. The assistant already knows their services, prices, hours, team and common questions, each with a source. A one-page site built from that, with the assistant built in, gives them something to share that looks professional in a minute, and gives visitors a reason to ask.

## Scope

### 1. What the page is

- Lives at `<BOT_PAGE_BASE_URL>/<slug>` (the bot page stays at `/b/<slug>`). If the landing page is off, `/<slug>` redirects to `/b/<slug>`.
- Turned on per bot from **Look and feel** (20d) and from the "Give it a landing page" card after publishing.
- **Public only.** Available when the bot page's access is "Anyone with the link" (so after `botPagePublicAllowed`). For organisation or invite-only bots, the option is shown disabled with copy §18's note.

### 2. Sections (each can be turned off and reordered)

| Section | Content comes from | Notes |
|---|---|---|
| Nav | Logo, business name, section links, "Ask a question" | |
| Hero | Eyebrow (what, where, how), headline, subtitle, the **ask box** (types out the suggested questions; opens the bot page with the question filled in), suggested-question chips, the safety disclaimer, the hero image | Headline and subtitle are **drafted by the builder once** from what it learned, shown to the owner to approve or edit, and never regenerated silently |
| Services and fees | Learned services (name, length, fee) and discounts | Only items with a source |
| Team | Learned team members (name, role, languages) and their photos | Photo slot shows initials until a photo is added |
| Gallery ("Inside {business}") | Up to 6 landing images | Hidden when empty |
| Visit | Hours, area, contact links | Contact details only from a source |
| Common questions | Learned FAQs, as an accordion | |
| Call to action | "Not sure who to see?" style band opening the bot page | Wording per business type from the copy deck |
| Footer | Business name, the pack's disclaimer, "Assistant by Ally" | The disclaimer can't be removed for health packs |

**Nothing invented.** Every fact on the page comes from the bot's learned items or Owner notes, the same ones the assistant uses. When the owner edits a fact in "What it knows", the page shows the new version on its next build.

### 3. Editing

- **Look and feel → Landing page** opens the page in an edit mode: click a text block to edit it inline; Replace logo and Replace image buttons on every image; "+ Add images" in the gallery; a section list to show, hide and reorder; and the colour, heading style and theme from 20d.
- Changes save as you go with "Changed. Undo".
- **Publishing** the landing page is a separate button the first time ("Publish landing page"); after that, edits go live on save, like the bot page.

### 4. Rendering, speed and search

- Choose the lightest way to serve real HTML to search engines and link previews (for example, prerendering static HTML at publish time and on each save, served from the same CDN as the bot page). Justify it in the notes.
- Lighthouse mobile: performance ≥ 90, accessibility ≥ 95, SEO ≥ 95. Images use the 20d variants with `srcset` and lazy loading below the fold.
- Title, description, Open Graph and Twitter tags (using the share image), a canonical URL, `LocalBusiness` structured data from the learned facts (or `MedicalBusiness` for medical packs, without clinical claims), and a sitemap entry.
- `noindex` until the owner turns on "Show in search engines" (default off for the first version, so owners opt in).

### 5. Safety

- Health packs: the disclaimer is shown in the hero and footer and can't be removed; the ask box opens the same bot page, so crisis handling is unchanged.
- No visitor data is collected on the landing page itself; all conversation happens on the bot page.
- The page carries no third-party scripts or trackers. Basic analytics (visits, ask-box clicks, chats started) go to our own events.

## Out of scope

Custom domains. Multiple pages. Blog. A form builder. Booking (after chunk 6). The public template gallery (v3).

## Tests

- **ally-be:** availability rules per access mode and `botPagePublicAllowed`; only sourced facts appear; editing a fact rebuilds the page; disclaimer can't be removed for health packs; prerender output contains the facts and meta tags; `noindex` by default.
- **ally-web:** edit mode (inline text, replace image, reorder and hide sections, Undo); the ask box opens the bot page with the question; screenshots at 1440 and 390 px; axe 0 serious issues; Lighthouse budgets in CI on a fixture.

## Done when

- [ ] A published public bot can turn on a landing page built from what it learned, with logo and images, in under a minute
- [ ] Every section can be edited, hidden and reordered, with Undo
- [ ] The ask box opens the bot page with the question; crisis handling unchanged
- [ ] Lighthouse budgets met; real HTML for crawlers; `noindex` until the owner opts in
- [ ] `CHUNK-20E-NOTES.md`: rendering choice, budgets measured, screenshots, open items (custom domains, more pages)

## How Shehbaz tests it

1. With `botPagePublicAllowed` on locally, make Sunrise Mind public and click "Give it a landing page".
2. Check every fact against the Sunrise Mind PDF. Add a main photo, two gallery photos and a team photo; replace the logo.
3. Edit the headline, hide the gallery, move Team above Services, then Undo once.
4. Open it on your phone. Tap a suggested question: the bot page opens and answers it.
5. Change a fee in "What it knows" and reload the landing page: the new fee shows.
6. Switch the bot to invite-only: the landing page goes offline and `/<slug>` redirects to the bot page.
