# PR: chunk 6b — reliable booking you can watch, and assistants only for their people

Branch `feat/agents-v2-6b` → `master`. All three apps. Brief: `chunk-6b.md`; notes: `CHUNK-06B-NOTES.md`; prompt text for review: `6B-PROMPTS.md`.

## What people notice

**Visitors on the bot page and the website bubble**
- They see what the assistant is doing while it works: "Checking free times…", "Booking Thu 19 Nov, 11:00…". After 12 s with nothing new: "Still working on it…".
- Under the reply: a quiet "Checked free times · Booked Thu 19 Nov, 11:00" line that opens to the steps, and a card for a booking or change, read from the saved entry.
- A crisis reply still arrives whole, with no steps. WhatsApp is unchanged.

**Booking**
- "Thursday evening" with nothing free gets "Nothing's free on Thursday evening. The latest is 16:00…", cited, instead of a decline or a hand-over.
- A time confirmed a few messages back still books, and "at 4" means 16:00.
- It asks for a name or an optional detail once only.
- A shortened id gets one retry.
- A run never fails at the forced-search step.

**Owners**
- A Time zone in How it works.
- The Overview's "Handed to a person" counts chats handed over.
- Erasing a person also removes their list entries.

**Leads:** an Answer questions assistant with a Leads or Callback list offers to take someone's details when it can't answer (an unpublished price), and saves them once given without asking again. Example choices ("Consultation / Follow-up / Check-up") are never read out to visitors; Leads' examples are now "A demo / Pricing / Something else".

**Safety and declines**
- Out-of-scope requests (a poem, the weather) get a general decline with no numbers or contact details. Someone asking for a staff member's number is pointed to the owner's own contact.
- Every crisis reply has a real number, on every assistant. Medical and pharmacy: "call 112 or an ambulance (108)", plus Tele-MANAS 14416. Every other assistant: 112 and Tele-MANAS 14416 (free, 24×7), plus its helplines. A bot's own wording still wins, with the numbers added if it has none. No assistant tells anyone to "contact a supervisor".
- The instructions name the channel the chat is on ("over WhatsApp", "on the website", "in this chat"), instead of always saying WhatsApp.
- Prices after "Rs." are no longer cut off.
- Memory never says what it won't remember.

**Access (added by Shehbaz)**
- Being on an assistant's team is enough to open it.
- Someone with nothing else sees only their assistant: no Sidebar, just their email and Log out.
- Ally admins have Assistants switched off by default.
- "Assistants" is the name everywhere people see it.
- A custom login can have "No organisation" (Ally's own).

## What pilots can turn on now

- **Bookings:** Add and Change on a pilot's lists, once its action cases pass on those lists and the 6b prompts are published (`LAUNCH-CHECKLIST.md`, 6b).
- **Lead-taking:** Answer questions with Leads or Callback requests on Do it.

## Before merge

- **Labels:**
  - `prompt-default-refresh`: the default `.txt` files change with their contracts, as CI's prompt rule 3 needs;
  - `docs:skip` only if the docs map asks for an entity doc (there's no entity change).
- **The wiki PR:** branch `docs/agents-v2-6b` on `helloallytech.github.io` (`repos/ally-be.md`, `repos/ally-ai.md`: routes and what they do; nothing on how the gateway authenticates or how tokens are signed). Open it: https://github.com/HelloAllyTech/helloallytech.github.io/pull/new/docs/agents-v2-6b

**Publish the lists prompt and the other approved texts to production's Skills Store before deploying.** Until then, production runs the old lists text: ally-be never sent the lists prompt's code before 6b, so ally-ai always used its built-in default.

## After merge (`LAUNCH-CHECKLIST.md`, 6b)

1. Deploy ally-ai, then ally-be. Migrations: `1982000000500-RecountHandedOver` and `1982000000600-ChatbotsOffForAllyAdmins`.
2. Clear `admin:feature-toggles:v2:*` in Redis.
3. Publish the lists prompt and the other approved texts to production's Skills Store before deploying. (`6B-PROMPTS.md`; locally: Lists v8, Instructions v5, Memory v3, Answer questions (takes details) v2, Bring in customers v3 and (can book) v3, each matching its seed.)
4. Tell support about Assistants access.

## Checks

- **ally-ai:** pytest 2,838 passed, 51 skipped; flake8 ✅.
- **ally-be:** lint ✅, typecheck ✅, `npm test` 1,167 suites / 17,378 tests passed; build ✅ (needs an 8 GB heap locally: `NODE_OPTIONS=--max-old-space-size=8192`). The lists, erasure and scorecard Postgres specs pass on the scratch databases.
- **ally-web (Node 22):** `npm test` ✅ (admin 10,638, helpline 383); admin `tsc` ✅; Playwright live steps at 1440 and 390 with axe ✅. `npm run lint` and `format:check` fail on master's files, none touched here: one import-order error in `DebriefProgressCard.tsx` (from `77284290f`) and 71 unformatted files.
- **Live runs (local, the published texts):** basics action cases 8/8 × 3; Ledgerly leads 6/6, 5/6, 5/6; 8a memory 6/8, 7/8, 6/8 (the same "uncited small talk" misses as SP1); Sunrise checkups 0 hard fails, 0 wrong declines, 0 fallbacks; fixture checkups (onboarding eval) 0 hard fails of 13. Details in `CHUNK-06B-NOTES.md`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
