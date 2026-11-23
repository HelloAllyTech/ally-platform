# Chunk T1 — Use-case templates

> Brief for Claude Code. Read `CONTEXT.md`, `FINAL-PLAN.md`, `BUSINESS-TEMPLATES.md` (the catalogue and "Pages a template writes"), `READY-MADE-LISTS.md`, `TEMPLATE-DATA-MODEL.md` (§1, §3, §7), `CHUNK-05B-NOTES.md` (ready-made lists and the guided setup), the Q3-fast notes (playbooks, the owner's line per list, packs), then this file. Plan briefly and go. <!-- docs-path-lint: planned -->
> Branch: `feat/agents-v2-t1` from master after CR1. Tag commits `[T1]`. Repos: all three.
> **One stop:** the templates' texts (descriptions, each list's "how to use it" line, starter checkup questions, setup questions), in one file. About 2 days.

## Why

Owners shouldn't assemble an assistant from parts. A template sets up a whole use case in one click, using only what works today; Phase 1's v2 of lists and templates comes later and builds on this.

## 1. A template is data

One definitions file in ally-be (like `ready-made-lists.ts`), each template with:
- a name, a one-line description, who it's for, and an icon;
- the **purpose** and the **safety pack** (only ever stricter than what the assistant has);
- the **ready-made lists** it installs, with **neutral examples** (never another business's), and what the assistant may do with each (look up, add, change; add and change start at **Do it** only where the template is about booking or taking details, otherwise Never);
- each list's **"How should your assistant use this list?"** line;
- **hand-over** on or off, and **memory** on or off;
- **5–8 starter checkup questions** with what a good answer includes;
- **2–4 setup questions** the owner answers once (services, hours, practitioners, price list), which fill the list examples and owner notes.

## 2. The templates

Two groups. **For organisations** comes first and uses the same six names and one-liners as the sign-in page's "What organisations use it for" (app.helloally.ai), so what people read before signing in is what they can start from. **For businesses** follows.

### For organisations (shown first)

| Template | One-liner (as on the sign-in page) | Purpose | Pack | Lists and settings |
|---|---|---|---|---|
| **Helpline and crisis support** | Share your helpline details and safe next steps, at any hour. | Answer | Mental health | Callback requests; hand-over on; the helpline's own numbers in the facts, shown in every crisis reply alongside the national ones; memory off |
| **Services and eligibility** | Explain who can apply, what to bring and where to go, in plain words. | Answer | — (Legal and financial if the services are benefits or legal aid; asked in setup) | Services (reference: who it's for, documents to bring, where, hours, cost); Service locations (reference); Applications (details: name, phone, service, preferred centre; add **Do it**); hand-over on |
| **Donors and volunteers** | Handle giving, receipts and sign-ups without tying up your team. | Enquiries | — | Volunteer sign-ups (details; add **Do it**); Volunteer shifts + Shift bookings (booking); Donor enquiries (details: name, contact, question, e.g. a missing receipt; add **Do it**); Ways to give (reference: methods, tax-exemption details). Payments and receipts in chat come later (Phase 3); until then receipt questions are taken as donor enquiries for the team |
| **Staff and volunteer onboarding** | New teammates get answers from your own policies and guides. | Train my team | — | Organisation-only access; no lists by default; Questions for the team (details, optional) for what the guides don't answer |
| **Reach more communities** | Meet people in the languages they speak, on the apps they already use. | Answer | — | Languages picked in setup (today English, Hindi and Hinglish; regional languages arrive in Phase 2), replies in the person's language; WhatsApp and the bubble set up in Share; Callback requests |
| **Campaigns and urgent updates** | Keep your community informed when things change fast. | Answer | — | Updates (reference: title, date, what changed, who it affects, until when; newest first), which the assistant uses before anything older; the owner edits it in Lists. Sending updates out to people comes with campaigns (Phase 2, block 8) |

### For businesses

| Template | Purpose | Pack | Lists |
|---|---|---|---|
| Clinic or doctor | Answer | Medical | Slots + Appointments, Callback requests |
| Salon, spa or consultant | Enquiries | — | Slots + Appointments, Price list |
| Restaurant or café | Answer | — | Tables + Reservations, Menu (reference) |
| Real estate | Enquiries | — | Property listings + Site visits, Leads |
| Online store | Answer | — | Products (reference), Orders (own, update), Support tickets |
| Coaching or school | Enquiries | Young people | Admissions enquiries (parent as the person), Classes + Bookings |
| Gym or studio | Enquiries | — | Classes + Bookings, Memberships (own, look up) |
| Mental-health helpline or practice | Answer | Mental health | Callback requests, Slots + Appointments (add off) |
| Finance or legal firm | Enquiries | Legal and financial | Leads, Callback requests |
| Customer support (any business) | Answer | — | Support tickets; hand-over on |
| Staff handbook | Train my team | — | none; organisation-only access |

## 3. Where owners use them

- **Setup:** after reading the website (or instead of it), "Start from a template" shows the cards in two groups, **For organisations** then **For businesses**, the suggested one first (from the organisation or business type setup detected). The organisation cards use the sign-in page's names, one-liners and order. Choosing one applies it to the draft, then asks its setup questions.
- **An existing assistant:** Tools → "Add from a template" installs the template's lists, abilities, lines and checkups **without touching** what the owner already has (an existing list with the same key is skipped and named).
- **Never weaker safety:** a template's pack applies only when stricter (Q3-fast rule); otherwise the current pack stays and the owner is told.
- **Plans (CR1):** installing a template never publishes, so it never counts against the plan's published-assistant limit; setup runs and checkups it starts count as owner-side runs like any other.
- **Bookings (H1):** templates that take bookings or details rely on H1's rule: every add, change or cancel needs the customer's "yes" in a later turn. Template lines and playbooks never word around it.
- How it works and the Overview say which template it came from.

## 4. Tests

- Every template installs on a fresh assistant in one transaction and its starter checkup runs; a test fails if any template's lists, abilities or pack are invalid.
- Installing on an existing assistant skips existing lists and never weakens the pack.
- Playwright: the template cards in setup and in Tools at 1440 and 390.
- On the local stack, install five (Helpline and crisis support, Services and eligibility, Donors and volunteers, clinic, real estate) and run their starter checkups: each at least 70%. The helpline one also passes the crisis set (every crisis message gets the crisis reply with the helpline's own number).
- A test fails if the organisation templates' names and one-liners drift from the sign-in page's copy (one shared source for both).

## Done when

- [ ] 6 organisation templates (matching the sign-in page) and 11 business templates, one click in setup and in Tools
- [ ] Every template installs and its checkup runs; nothing weakens safety
- [ ] `CHUNK-T1-NOTES.md`, `PR-T1.md`, the Progress row <!-- docs-path-lint: planned -->
