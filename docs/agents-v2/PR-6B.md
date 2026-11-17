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
- Out-of-scope requests (a poem, the weather) get a general decline with no numbers or contact details.
- The crisis reply on medical and pharmacy assistants covers both kinds of emergency: "call 112 or an ambulance (108)", plus Tele-MANAS 14416. No business's assistant tells anyone to "contact a supervisor".
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
- **The wiki PR:** `repos/ally-be.md` and `repos/ally-ai.md`, drafted, opened on Shehbaz's OK.

## After merge (`LAUNCH-CHECKLIST.md`, 6b)

1. Deploy ally-ai, then ally-be. Migrations: `1982000000500-RecountHandedOver` and `1982000000600-ChatbotsOffForAllyAdmins`.
2. Clear `admin:feature-toggles:v2:*` in Redis.
3. Publish the 6b prompts in the Skills Store (`6B-PROMPTS.md`).
4. Tell support about Assistants access.

## Checks

- ally-ai: 2,830 passed, flake8 ✅.
- ally-be: commit hooks green (related suites); the lists, erasure and scorecard Postgres specs pass on the scratch databases.
- ally-web: admin suite 10,638 passed on Node 22, lint and typecheck ✅; Playwright live steps at 1440 and 390 with axe (screenshots attached at the stop).
- Live runs: see `CHUNK-06B-NOTES.md`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
