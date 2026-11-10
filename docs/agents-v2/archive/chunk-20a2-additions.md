# Chunk 20a-2 additions: purposes and choosing pages

> Adds to the "20a-2 additions" section of `chunk-20a.md`. Read with `DESIGN.md`, `chunk-20d.md` and `ONBOARDING-COPY.md`. Merge the copy in §4 into `ONBOARDING-COPY.md` as section 20.
> Tag commits `[20a]` as usual. These are behaviour changes, so they belong in 20a-2 (after 20d), not in the design pass. 20d only restyles the screen they appear on.

## 1. Purposes: what the assistant is for

The owner picks one **purpose**. It replaces the free-form "designs" of 20a-1: the builder still tailors each card to the business (title, Best for, It will, It won't, sample exchange), but every card is one of these five. The builder recommends one, shown first with a "Recommended for you" badge.

**A purpose changes how the assistant uses what it knows, never what it knows.** Every purpose reads the same pages and documents, answers anything covered there with a source, and declines what isn't. Safety packs apply on top of every purpose and are never weakened by one.

| Purpose (`purpose`) | Default audience and access | How it talks | Pre-chat questions | Checkup questions added | Honest limits shown now |
|---|---|---|---|---|---|
| **Answer questions** (`answer`) | Clients; access as the owner chooses | Short, direct, sourced answers; points to the "don't know" contact | None | Facts, policies, follow-ups, out of scope (as 20a) | — |
| **Bring in customers** (`enquiries`) | Clients; access as the owner chooses | Recommends the best-fit service or product from the information, asks **one** qualifying question at a time, then offers to pass details on | Name, phone, "What are you looking for?" (choice built from learned services) | "Which service fits X?" (right recommendation, with source); "Does it ask for contact details before ending?"; "Does it avoid promising slots or discounts not in the information?" | Can't book or take payment yet (coming soon); leads arrive as alerts, not a list, until Collections |
| **Train my team** (`training`) | My team; **organisation-only** access by default | Explains procedures from documents in short steps; quizzes on request ("Test me on refunds"), one question at a time, then explains the right answer with its source | None (staff are signed in) | Procedure questions; quiz answers marked correctly; "Does it refuse to make up a procedure?" | Doesn't track each person's progress yet (after People and Memory) |
| **Guide people step by step** (`guide`) | Clients or team, as the owner chooses | One step at a time; asks "Done?" before the next; never skips or reorders steps from the source; always includes a step marked as a safety step | None | "Are the steps in the source's order?"; "Was any step skipped?"; "Does it stop and point to help if a step fails?" | — |
| **Something else** (`custom`) | Asked | The owner describes it in a sentence; the builder drafts the style and shows it for approval | Asked | The standard set | — |

**Stored as** `purpose` on the `BotDraft` and on the published bot config, plus the defaults it filled in. Defaults are only defaults: changing the purpose later re-proposes them as a before and after (change by chat), never silently overwriting the owner's edits.

**Into the agent:** a short purpose section in the bot's instructions (ally-ai), placed after the owner's instructions and **before** the safety rules, so safety still wins. Add it to the seed prompt registry with a contract test per purpose.

### Lead alert (enquiries only)

- When a visitor on an `enquiries` assistant gives contact details (from pre-chat or during the chat), ally-be sends the owner **one alert per conversation**: the name, phone, what they're looking for, a two-line summary and a link to the conversation.
- Delivered by email now (reusing the 12b daily-cap alert path); WhatsApp to the owner after chunk 17.
- Contact details are stored only on the conversation (the shared store). They're not copied into logs or alert subjects. Alerts respect the existing PHI rules: for health packs, the summary says only what the visitor asked about, never health details.
- Collections (chunks 5–6) later turn this into a **Leads** list; record the handoff in the notes.

### Eval

Add to the onboarding eval: for each fixture, the recommended purpose is sensible (mental health practice → Answer questions or Bring in customers; a lab → Guide step by step for test preparation; a SaaS help centre → Answer questions). Add purpose-specific conversation cases with **0 hard fails**:
- an enquiries assistant that promises an unlisted discount
- a training assistant that invents a procedure
- a guide that skips a step
- any purpose weakening the safety pack

## 2. Choosing which pages it reads

On the start screen and on the reading screen, the owner can choose **Read everything** (the default) or **Choose pages**.

- **Choose pages** shows the site's pages found so far, grouped by section (from the URL path and the sitemap), each with a checkbox, plus "Leave out blog and news" and "Leave out careers" shortcuts.
- Facts come only from chosen pages; unchosen pages are never fetched (or are dropped if already fetched).
- The choice is saved on the draft (`sources.website.include` / `exclude` patterns) and reused when the site is re-read later.
- Afterwards, in the assistant's home → What it knows → **Sources**, each page can be removed or added back, with Undo. Removing a page removes the facts that came only from it, after showing which ones.
- Also available: **Topics to avoid** (a short list, for example "prices") as an owner rule the checker enforces, set in "Make it yours" under "Anything it shouldn't talk about?" and in change by chat.

## 3. The screen (built in the 20d style)

- "Choose a design" becomes **"What should your assistant do?"**: five option cards, with the recommended one first and badged. Each card has the purpose name, a tailored "Best for", "It will", "It won't" and a two-line sample exchange in the business's own words.
- Picking a purpose shows a short confirmation of the defaults it set ("Pre-chat: name, phone, what they're looking for · Access: anyone you choose"), each changeable on "Make it yours".

## 4. Copy (merge into `ONBOARDING-COPY.md` as section 20)

- **Screen title:** What should your assistant do?
- **Builder message:** Based on what I learned, here's what I'd suggest. You can pick something else, and change it later.
- **Badge:** Recommended for you
- **Purpose names and one-liners:**
  - **Answer questions:** Replies to questions about your services, prices, hours and policies, with a link to where it found each answer.
  - **Bring in customers:** Helps people find the right service, then passes their name and number to you.
  - **Train my team:** Explains your procedures to staff and quizzes them when they ask.
  - **Guide people step by step:** Walks people through a process one step at a time, like test preparation or setting up a product.
  - **Something else:** Describe what you need, and I'll set it up.
- **Something else prompt:** What should your assistant help with? A sentence or two is plenty.
- **Defaults confirmation:** I've set it up for {purpose}: {defaults}. You can change any of this on the next screen.
- **Honest limits:**
  - Enquiries: It can't book or take payments yet. It sends you each new enquiry by email.
  - Training: It doesn't keep track of each person's progress yet.
- **Lead alert email subject:** New enquiry from your assistant
- **Lead alert body:** {name} asked about {topic}. Phone: {phone}. {summary} Open the conversation: {link}
- **Reading choice:** Read everything · Choose pages
- **Choose pages title:** Which pages should it read?
- **Choose pages shortcuts:** Leave out blog and news · Leave out careers
- **Choose pages note:** It only learns from the pages you choose. You can change this later.
- **Topics to avoid label:** Anything it shouldn't talk about?
- **Topics to avoid placeholder:** For example, prices or other clinics
- **Removing a source:** Remove {page}? Your assistant will forget {n} details that came only from this page.

## 5. Tests

- **ally-be:**
  - The purpose is stored and its defaults applied.
  - Changing the purpose re-proposes the defaults without overwriting owner edits.
  - The lead alert is sent once per conversation, holds no health details for health packs, and nothing is logged.
  - Page include and exclude patterns are respected by the crawl and the re-read.
  - Removing a source removes only the facts unique to it, with Undo.
- **ally-ai:**
  - A purpose section contract test per purpose.
  - The safety rules still come after the purpose section.
  - The purpose eval cases pass with 0 hard fails.
- **ally-web:**
  - The purpose screen recommends one, the keyboard works, and the defaults confirmation shows.
  - Choose pages: grouping, shortcuts, and saving the choice.
  - The Sources list: remove, then Undo.

## 6. How Shehbaz tests it

1. Start from Sunrise Mind's site. The builder recommends a purpose. Pick **Bring in customers**: the pre-chat now asks name, phone and what you're looking for.
2. On the bot page, say you want couples therapy and give a test name and number. Check your email for one lead alert, with no health details in it.
3. Make a second assistant with **Train my team** from a short SOP document. It's organisation-only by default. Ask "Test me on cancellations".
4. Start a third with **Choose pages**, leaving out the blog. Ask something only the blog says: it doesn't know.
5. In What it knows → Sources, remove the fees page. It tells you how many details go; confirm, ask about fees (it doesn't know), then Undo.
