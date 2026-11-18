# Chunk 11a — Inbox (light): live chats and a person stepping in

> Brief for Claude Code. Read `docs/agents-v2/CONTEXT.md`, `v2-chunks.md`, `DESIGN.md`, `ONBOARDING-COPY.md`, `CHUNK-12-NOTES.md` (shared store, ConversationService), `CHUNK-12B-NOTES.md`, the 3c notes (streaming), `CHUNK-13-NOTES.md`, then this file.
> Branch: the Slice 1 branch. Tag commits `[11a]`. Repos: ally-be, ally-web.
> **Completes the POC:** 20d → 20a-2 → Q2a → 13 → **11a**.

## Why

The assistant answers most questions, but some need a person: a complaint, a complex case, or a visitor who asks for one. Today the owner can read Conversations but can't step in. The inbox makes chats live and lets a team member take over, reply and hand back, on every channel, without the assistant replying at the same time.

## Scope

### 1. The inbox (dashboard)

- A new **Inbox** in the main navigation (and the restyled Conversations list becomes its "All" view).
- **Live:** new conversations and messages appear without refresh (server-sent events or the repo's existing realtime path; choose and note it). Unread counts per chat and in the nav.
- **Filters:** Needs a person · Live now · All; and by channel (WhatsApp, Bot page, Website) and by assistant.
- **A chat view:** the full thread with sources under assistant answers, pre-chat answers at the top, channel badge, and the visitor's thumbs ratings (Q2a).

### 2. Handing over to a person

A chat moves to **Needs a person** when:
- the visitor asks for a person ("talk to someone", "human", and the Hindi equivalents), detected by the existing turn-type step;
- the assistant can't help twice in a row in the same chat;
- an owner rule says so (for example "always hand over complaints"), later via abilities (Stage 2+);
- **never for crisis messages:** those keep the crisis-only reply and the existing alert, and are also flagged in the inbox as **Safety** at the top.

The visitor gets one message (copy §23): "I've asked the team to join. They usually reply within {hours}." Outside the owner's hours: "The team is away now. They'll reply when they're back at {time}."

### 3. Taking over and handing back

- **Take over** (button on the chat): the assistant **pauses in this chat only**. Any message from the visitor while paused is shown to the team and is not answered by the assistant.
- The team member replies from the inbox; replies go out on the chat's channel (WhatsApp send, or the bot page and widget stream), are stored in the shared store with `role: agent_human` and the team member's id, and show the person's first name to the visitor.
- **Hand back to assistant:** the assistant resumes on the next visitor message, with the human replies as part of the history.
- Auto hand-back after N hours with no team reply (owner setting, default 12), with a polite message.
- Two team members can't both take over: the first wins; the other sees who has it.
- The engine checks a per-conversation `handled_by` (assistant or a person) before running; this is the single switch. Add it to `chatbot_conversations` (one small migration) or its metadata, by repo conventions.

### 4. Notifications

- A browser notification and sound (with a mute toggle) for Needs a person and Safety.
- An email to the owner for Needs a person if nobody opens it within 15 minutes (configurable), reusing the existing email path; no message text in the subject.

### 5. Roles

- Owners and team members of the organisation can use the inbox for their assistants; existing dashboard permissions decide who sees which assistant.

## Out of scope

Assigning to specific people, internal notes, tags, canned replies, SLAs and routing (11b). Mobile app. The owner replying from their own WhatsApp (17).

## Tests

- **ally-be:** while `handled_by` is a person the engine never runs for that chat (all channels); hand-back resumes; auto hand-back; two take-overs, first wins; human replies delivered on WhatsApp, bot page and widget and stored with the right role; crisis messages still get the crisis reply and never wait for a person; "talk to a human" in English and Hindi triggers hand-over.
- **ally-web:** live updates, unread counts, filters, take over, reply, hand back, notifications; screenshots at 1440 and 390 px.
- e2e: a visitor on the bot page asks for a person, a team member takes over and replies, hands back, and the assistant answers the next message.

## Done when

- [ ] All chats from all channels appear live in one inbox, with unread counts and filters
- [ ] A visitor can ask for a person, and the team is notified
- [ ] A team member takes over, replies on the same channel, and hands back; the assistant never replies while a person has the chat
- [ ] Crisis handling is unchanged and shown as Safety in the inbox
- [ ] `CHUNK-11A-NOTES.md`: the realtime choice, the `handled_by` switch, channel delivery, screenshots, open items for 11b
