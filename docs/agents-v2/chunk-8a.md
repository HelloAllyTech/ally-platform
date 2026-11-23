# Chunk 8a — Memory, light

> Brief for Claude Code. Read `CONTEXT.md`, `TEMPLATE-DATA-MODEL.md` (§2, People and memory), `FAST-TRACK.md` (8a), `CHUNK-12-NOTES.md` and `CHUNK-12B-NOTES.md` (contacts, identities, the visitor cookie, erasure), `CHUNK-11A-NOTES.md` (the Inbox), `CHUNK-03B-NOTES.md` and `CHUNK-06-NOTES.md` (the gateway, preview writes), `CHUNK-15A-NOTES.md` (the crisis check), then this file. Plan first, as usual. <!-- docs-path-lint: planned -->
> Branch: `feat/agents-v2-fast-track`. Tag commits `[8a]`. Repos: ally-be, ally-ai, ally-web.
> You're the only session on the branch. Start after 5b's last commit. In your first docs commit, commit this brief, `ROADMAP-NEXT.md` and `BUSINESS-TEMPLATES.md`, and set the root `CLAUDE.md`'s current-chunk line to 8a (`chunk-8a.md`). <!-- docs-path-lint: planned -->
> **One stop for Shehbaz:** the text of the three new prompts (below), plus the "can book" variant of Bring in customers (§7), before they're synced. Draft them first and keep building while you wait.
> **Time:** this is the last chunk before the merge to master. Aim for about 8 hours. If time runs short, cut in this order: the owner's edit of a line (keep forget), then the never-store editor (keep the defaults).

## Why

Today a run sees the last 10 messages, and everything older is gone: a long chat forgets its start, and a returning person is a stranger. 8a gives the assistant two kinds of memory, both kept in ally-be (never the checkpointer), so Forget and retention cover them:
1. **A rolling summary** of each conversation once it passes 10 messages.
2. **Memory lines about each person,** each with its source, that the owner can see and forget.

## What exists

- `chatbot_contacts` (per bot), `chatbot_contact_identities` (WhatsApp number, web visitor, verified email), `chatbot_conversations.summary` (exists, nothing writes it), `chatbot_messages`.
- **Identity:** a bot-page visitor's cookie lasts 7 days, a verified email 30 days (12b); WhatsApp is the number. `resolveVerifiedContact` gives one contact across devices.
- **Erasure:** `eraseContact` (WhatsApp and web), `blankBefore` and `eraseConversations` for retention (12, 12b, H0).
- **The run:** ally-be sends the last 10 messages (`recentHistory`); 3b's gateway and run token; 6's preview writes are rolled back and marked.
- **The Inbox (11a):** a conversation view with take over and hand back.

## Scope

### 1. Memory lines (ally-be)

- **A new table, `memory_entries`:** `id`, `chatbot_id`, `contact_id`, `section` (`preferences`, `context`, `open_items`), `text` (at most 200 characters), `source_message_id`, `source_kind` (`person`, `owner`), `run_id`, `status` (`active`, `done`, `forgotten`), `expires_at`, `created_at`, `updated_at`. Index on (`chatbot_id`, `contact_id`, `status`).
- **Expiry by section:** open items 30 days, context 180 days, preferences none. The retention sweep removes expired and forgotten lines (deleted, not blanked: they're derived data).
- **Limits:** at most 40 active lines per person; past that, the oldest context line is dropped.
- **Erasure:** `eraseContact` and Forget this person delete the person's lines and blank their conversations' summaries.

### 2. How the agent remembers (ally-ai, then ally-be after the reply)

- **One tool, `remember`,** offered when memory is on for the bot:
  - `{ op: "add" | "replace" | "done" | "forget", section?, text?, id? }`;
  - lines are shown to the agent with short ids (`m1`, `m2`…), so `replace`, `done` and `forget` point at one;
  - `forget` is only for when the person asks ("forget that I…").
- **It's run-local:** the tool records the intent and returns "Noted." It never calls the gateway mid-run. The run's result carries `memory_writes`, with the id of the person message each came from.
- **ally-be applies them after the reply has been sent,** in the background:
  - not at all if the run ended with the crisis reply, Safety, a hand-over or an error;
  - not in Try it or Preview: they're shown in the trace as "would remember", and nothing is saved;
  - **the checks, in ally-be:** the section is allowed; the text is short and non-empty; it doesn't match the bot's never-store list; the source message exists and belongs to this contact;
  - **on bots with the medical, pharmacy or mental-health pack,** each line also goes through `ally_ai_memory_check` (a new ally-ai endpoint and prompt): keep only non-clinical details ("prefers evenings", "comes with his mother"), never symptoms, conditions, medicines, diagnoses or anything about self-harm. **It fails closed:** an error or a timeout drops the line.
- **No added wait for the person:** the writes happen after the reply.

### 3. What the run gets (ally-be → ally-ai)

- **A block, "What you know about this person",** in a new prompt section `ally_ai_agent_memory`, only when memory is on and the person has lines:
  - open items first, then preferences, then context; each line with its id and date;
  - within a budget of 1,500 characters, newest first.
- **The rolling summary** of this conversation, when there is one, before the last 10 messages.
- **The rules the prompt must say:**
  - use what you know to help (offer evening slots to someone who prefers evenings), and don't recite it back unprompted;
  - memory is never a source for facts about the business, and never overrides documents, lists or the safety rules;
  - remember only what the person said about themselves and their needs; never health details on health assistants, never what someone said about another person;
  - if the person asks what you know about them, tell them plainly; if they ask you to forget something, use `forget` and confirm;
  - an open item that's been answered or done is marked `done`.

### 4. The rolling summary (ally-be + ally-ai)

- **After a reply,** when the conversation has more than 10 messages and messages have left the window since the last summary, ally-be asks ally-ai to fold them into `chatbot_conversations.summary` (a new endpoint and prompt, `ally_ai_conversation_summary`, at most about 800 characters).
- **In the background,** never while someone waits; at most one at a time per conversation; on failure, the old summary stays and the next reply tries again.
- **It's this conversation's only:** a new conversation starts without it. Across conversations, the person's memory lines carry what matters.
- **The summary follows the same rule as memory lines** on health packs: it describes what was asked and decided, never clinical details. Retention and erasure already blank it.

### 5. Settings (ally-be + ally-web)

- **Per bot, `memory`:** off by default, with an owner switch, "Remember people between chats", in the assistant home's How it works. The rolling summary is on for every v2 bot (it's within one chat, like today's history).
- **Never store:** the bot's list of things never to remember, with defaults per safety pack (health packs: symptoms, conditions, medicines, diagnoses; every bot: payment details, passwords, ID numbers). The owner can add lines; the defaults can't be removed (safety only tightens).
- **Who carries over:** a WhatsApp number and a verified email keep their memory; an unverified visitor's lasts as long as their cookie. Memory isn't carried across channels yet.

### 6. The owner sees it (ally-web)

- **In the Inbox, beside a conversation:** "What your assistant remembers about {name}", by section, each line with its date and a link to the message it came from.
- **Forget** on each line; **Edit** a line's text (it becomes `source_kind: owner`); **Forget this person** (lines and summaries, with one confirmation). Editors only.
- **When memory is off:** one line, "Your assistant doesn't remember people between chats," with a link to the switch.
- **Try it:** a reply whose run would remember something shows "Would remember: prefers evenings" under it, with "Test only: this wasn't saved."
- **Copy deck §28, "Memory (8a)":** every owner-facing string.

### 7. Bring in customers, when the assistant can book (carried over from 5b)

5b found that on a Bring in customers assistant with Add on, the purpose's instructions (collect a name and number, pass the enquiry on) fight the lists instructions: it said "the team will confirm" while listing free times, and asked for details before booking.
- **A "can book" variant** of the Bring in customers purpose section, chosen in code when the run offers any `create_` tool (the way 20a-2 picks the purpose layer). Today's text stays for assistants without one.
- **What the variant must say:**
  - book directly, under the lists instructions; never say "the team will confirm" unless the list's new entries start as requested (Site visits);
  - ask for the person's name once, together with confirming the booking, only when it isn't known (memory or the contact); never ask for a number on WhatsApp;
  - still take an enquiry and pass it on for anything the lists can't do.
- **Its text is part of this chunk's stop,** with the three memory prompts.
- **Test:** 6's six action cases on a Bring in customers bot with ready-made Appointments (as 5b ran on Lakeview) pass 3 times; asking for a name once is a pass. Then remove the checklist line "don't turn Add on for an enquiries pilot".

## Decided

- **Memory writes never wait for the crisis check, and never happen in a run the crisis check won.**
- **Memory lives in ally-be's tables,** never in the checkpointer.
- **No `recall` (search across past chats) in 8a.** It moves to 16a.
- **No custom profile fields, no nightly tidy, no notebook, no carrying memory across channels.** They come with 8, the rest (sprint 4).
- **In 4a,** these rows are shown to the agent as `/contacts/<id>/USER.md`. Keep the rendering in one function so 4a can reuse it.

## Out of scope

Recall. Relations. The People page. Memory of staff (7a). Export of a person's data (21a).

## Tests

- **ally-be:**
  - the migration and its down; the limits and expiry; retention deletes expired and forgotten lines;
  - writes are applied after the reply, never for a crisis, Safety, hand-over or failed run, never in preview;
  - never-store and the pack defaults refuse a line; the health check is called for health packs and fails closed;
  - a line can't be written for another contact or another bot;
  - erasure and Forget this person delete lines and blank summaries;
  - the summary job: triggered past 10 messages, one at a time, the old one kept on failure;
  - the Inbox routes: viewers read, editors forget and edit.
- **ally-ai:**
  - `remember` is offered only when memory is on; its writes come back in the result;
  - the memory block and the summary appear only when present, within the budget;
  - with memory off and no summary, the prompt is exactly today's;
  - the memory check and summary endpoints, with their prompts from the Skills Store.
- **ally-web:** the Inbox panel, forget, edit, Forget this person, the off state, the switch, Try it's line, the copy against the deck.
- **Evals** (the 3a conversation eval gains memory cases, locally, on a test bot with memory on):
  - "evenings work better for me" in one chat; a new chat, "book me something next week" offers evening slots first;
  - on a mental-health bot, "I'm on sertraline and I prefer evenings" keeps only the preference;
  - a never-store item isn't kept;
  - "forget that I prefer evenings" removes it, and the next chat doesn't know;
  - another person on the same bot sees nothing of the first person's memory;
  - a 25-message chat still knows a detail from message 3 (the summary);
  - a crisis message stores nothing.
  Plus the Sunrise and fixture checkups, with memory off and on: 0 hard fails and 0 wrong declines.
- **Latency:** the run with memory loaded, against without (it should add under 50 ms); the time from reply to the line being stored.
- Full suites, lint and typecheck in all three apps.

## Report (`CHUNK-08A-NOTES.md`) <!-- docs-path-lint: planned -->

The code map, the approved prompts, the eval results, the latency, mismatches with this brief, and the lines added to `LAUNCH-CHECKLIST.md`:
- push `ally_ai_agent_memory`, `ally_ai_memory_check` and `ally_ai_conversation_summary` with the code;
- memory stays off for every assistant until its memory cases pass; turn it on first for one pilot;
- run 8a's migration with the others in the release.

## Done when

- [ ] A returning person's preference is used in their next chat, on the bot page and on WhatsApp
- [ ] The Inbox shows it with its source; Forget removes it, and the next run doesn't know it
- [ ] Clinical details on health packs, never-store items and anything from a crisis run are never stored
- [ ] A long chat keeps its start through the summary, with no added wait
- [ ] With memory off, runs are exactly as before; the checkups are unchanged
- [ ] The three prompts approved and live locally; `CHUNK-08A-NOTES.md`; 8a's row in `v2-chunks.md`'s Progress table; the checklist lines <!-- docs-path-lint: planned -->

## How Shehbaz tests it

1. **On a local test bot,** turn on "Remember people between chats" in How it works.
2. **On its bot page:** "I'm Rahul, evenings work better for me." Close the tab.
3. **Open the page again in a new chat:** "Can I book something next week?" Evening times come first.
4. **In the Inbox,** open Rahul's chat: "Prefers evenings", with a link to his message. Forget it, then ask again in a new chat: no evening preference.
5. **On Sunrise (mental health):** "I'm on sertraline and I like mornings." The Inbox shows only "Prefers mornings".
6. **Chat 25 messages,** then ask about something from the start: it still knows.
7. **In Try it:** "Would remember: …" with "Test only: this wasn't saved."
