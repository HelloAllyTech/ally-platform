# Chunk TF1 — One complete pass, then fix in a loop

> Brief for Claude Code. Read `CONTEXT.md`, `ROADMAP.md`, `CHUNK-ASSISTANTS-NOTES.md` (SB1: Create and Build, access and sign-in, credits, memory, retention, go-live gate), `CHUNK-BT1-NOTES.md` (act by tap), `CHUNK-Q4-NOTES.md`, `CHUNK-08A-NOTES.md` (memory), `CHUNK-11A-NOTES.md` (Inbox), `CHUNK-12-NOTES.md` and `CHUNK-12B-NOTES.md` (contacts, pre-chat), `chunk-t1.md` (the templates), then this file. <!-- docs-path-lint: planned -->
> **Fresh start:** a clean worktree from `origin/master` (with Q4, SB1, the crisis fix and BT1 merged) and a new, empty Postgres database `ally_tf1`; `ally_local` and the main checkout are left alone. Tag commits `[TF1]`; one PR at the end.
> **No new features.** Speed over polish (internal launch); safety and "no write without a yes" are never relaxed.
> **Stops:** after the pass (`ISSUES-TF1.md`, fix nothing before approval); after each fix round; any new customer-facing text, in one file.

## Why

Testing on 24 Nov found that the assistant doesn't remember names or bookings, every link looked public, and conversations weren't tied to the person chatting. Before more features, one complete pass through the product as an owner and as the people they serve, on the six organisation templates, finds everything that's broken; then a loop fixes it.

## The pass: one assistant per organisation template, end to end

Six fictional non-profits, each with a short PDF written for the test (not the demo organisations):

1. **Helpline and crisis support:** a youth mental-health helpline, 10 am–10 pm, callback requests (Mental health pack)
2. **Services and eligibility:** a disability-services NGO (certificates, aids and appliances, two centres), applications
3. **Donors and volunteers:** an animal shelter (donations with 80G, weekend volunteer shifts, adoption enquiries)
4. **Staff and volunteer onboarding:** a literacy NGO's volunteer handbook (staff and volunteers only, safeguarding section)
5. **Reach more communities:** a women's health NGO in Hindi, Hinglish and English, callback requests
6. **Campaigns and urgent updates:** a flood-relief NGO with two current updates (a camp moved, a donation drive extended)

For each, go through every step a real owner and real people would, in order, and note every problem:

1. **Owner builds it:** sign in, Create, the template card, its questions, the PDF, what it learned, the safety pack chosen (and correcting it), lists and abilities, the checkup and its score, Try it (typed and by tap), change by chat.
2. **Goes live and shares it:** the go-live gate; Share / Channels: the link and slug, who may chat (the default, public, organisation only, invited), inviting by email and by phone, the sign-in code, removing someone, QR code, the website bubble, the WhatsApp link.
3. **People use it:** at least two people per assistant (plus a stranger on invite-only links), on the bot page and the WhatsApp path (recorded webhooks), each over at least two separate chats: the template's own use case typed and by tap, facts from the PDF (English, Hindi, Hinglish), something not in the PDF, an off-topic message, and the safety must-pass cases.
4. **The owner runs it:** the Inbox (who each conversation is, the crisis flag, taking over and handing back), list entries (who made them, with what details), memory per person, how it's doing, credits used.

Check these throughout, first:

- **Identity:** is every conversation tied to a person (a contact with name, phone or email): on a public page, an invite-only page, a page with pre-chat questions, WhatsApp?
- **Memory:** in a new chat, does it know the person's name, what they asked, and their booking or request? Does one person ever see another's details?
- **Links and access:** the default for a new assistant; does a change take effect at once; what does a stranger see on an invite-only link (crisis information before any code; nothing revealing who is invited); can anyone reach another assistant's page, conversations or entries by guessing a slug, id or API call; what an unpublished or blocked link shows.
- **Bookings and requests:** saved once, with consent and the right name; findable later by the same person ("what did I book?"); cancellable and movable by them only.

## Report, then the loop

`ISSUES-TF1.md`: each issue with severity (**Serious** / fix before customers / polish), the template and step, steps to reproduce, what happened, what should happen, its cause in the code if found, and whether it's a bug or **by design** (and what the design should be). Stop for approval.

Then fix the approved issues one at a time, a commit and a test each; re-run the affected steps; update `ISSUES-TF1.md` (fixed, still failing). Stop after each round with the table. At most 3 rounds; Serious issues block.

## Done when

- [ ] The pass done on all six templates; `ISSUES-TF1.md` approved
- [ ] Every approved issue fixed or moved with a reason; Serious ones all fixed
- [ ] Texts approved; `CHUNK-TF1-NOTES.md`, `PR-TF1.md` <!-- docs-path-lint: planned -->
