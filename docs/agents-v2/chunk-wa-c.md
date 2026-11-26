# Chunk WA-C — WhatsApp campaigns (ROADMAP Phase 2, Stage C)

> Brief for Claude Code. Read `CONTEXT.md`, `ROADMAP.md`, `WHATSAPP-GAPS-PLAN.md` (Stage C), `chunk-wa-b.md` (the send engine and contacts this builds on), `CHUNK-ASSISTANTS-NOTES.md` (SB1: credits, quick replies), then this file. Plan briefly. <!-- docs-path-lint: planned -->
> Branch: `feat/agents-v2-wa-c` from master. Tag commits `[WA-C]`. **Runs in parallel with WA-A and WA-B** (decided 25 Nov). **Builds on WA-B's `ally-be/src/whatsapp/outbound/outbound.types.ts`**: fetch WA-B's branch and use its interfaces; until WA-B merges, test against a fake `OutboundSender`. Rebase on master after WA-B merges, before the PR.
> **Speed over polish** for the internal launch; opt-out, quiet hours and crisis-first are never relaxed. **One stop:** every new fixed text, in one file. About 3 days alone; aim for 1.5 with the parallel plan.

## Why

"Every broadcast is a conversation" is claim 5: a campaign reaches the people who agreed to hear from an organisation, and their replies are answered by the assistant with the campaign in mind (registering for the drive, asking about the moved camp), which Wati and AiSensy don't do.

## Boundaries

- **WA-C owns:** a new module `ally-be/src/whatsapp/campaigns/` (campaigns, recipients, results, the auto-pause), its migrations, the **Campaigns** screen under Channels → WhatsApp, and one small hook in the engine that adds the campaign as context to a reply (see 3).
- **Uses, doesn't change:** WA-B's `OutboundSender`, `Segment`, `TemplateRef`, contacts and the opt-in ledger. If an interface is missing something, ask WA-B's owner (Shehbaz) rather than editing `outbound/`.
- **Doesn't touch:** inbound media, status webhooks and Inbox ticks (WA-A); templates and contacts screens (WA-B).
- Only one session uses the live Docker stack at a time.

## 1. Build a campaign

- Pick an assistant, an **audience** (a segment: tags, list entries such as "registered for Saturday's drive", last chat; only people opted in for that purpose), an **approved template** with its variables, and **now or a scheduled time**.
- **Preview before sending:** how many will get it, how many are skipped and why (opted out, no opt-in for this purpose, quiet hours, at-risk in the last 24 hours, duplicate), the template category, and the **cost estimate in rupees** from the WhatsApp rates (CR1), against the credits (SB1).
- **A test send** to the owner's own number first.
- "Describe it" drafting: "remind everyone registered for Saturday's drive that it starts at 9 am" → a suggested template, audience and preview for the owner to approve. Nothing sends without the owner's Send.

## 2. Send and watch

- Sends through `OutboundSender` (paced to the daily limit, idempotent per recipient).
- **Results** per campaign: sent, delivered, read (from WA-A's status webhooks, by message id; until merged, from WA-B's send results), replied, opted out, failed with reasons; per recipient on click.
- **Re-send to people who didn't read**, as a new campaign from the same audience.
- **Auto-pause** when failures pass a threshold (more than 10% failed or any quality warning from Meta's webhook), with the reason shown and a Resume.

## 3. Replies answered in context

- When someone replies within 7 days of a campaign message, the assistant's run gets one line of context: the campaign's name and the text they received. It answers from that and its own information, and can use its tools as usual (register, book, request a callback, with consent and BT1 cards).
- **Crisis wins:** an at-risk reply gets the crisis reply, and the campaign context is never used to push anything to that person.
- STOP stops this campaign and all future marketing for that person (WA-B's opt-out).

## Tests

- Preview counts and skip reasons; the cost estimate against the rates table; scheduled sends at the right time in the assistant's time zone.
- Idempotency: a retried campaign never sends twice to one person.
- Auto-pause on a forced failure spike; resume.
- A reply after a campaign gets the campaign context; an at-risk reply after a campaign gets the crisis reply; STOP after a campaign opts out.
- Live (after deploy, payment method in, templates approved): a 3-person test campaign to the team's phones, results matching Meta's, replies answered in context.

## Done when

- [ ] Campaigns: audience, template, preview with skips and cost, test send, now or scheduled
- [ ] Results, re-send to non-readers, auto-pause
- [ ] Replies answered with the campaign as context; crisis first; STOP
- [ ] Texts approved; `CHUNK-WA-C-NOTES.md`, `PR-WA-C.md`, the Progress row <!-- docs-path-lint: planned -->
