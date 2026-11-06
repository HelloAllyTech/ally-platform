# Agents v2 — building blocks and templates

Read with `CONTEXT.md`. This file defines **what every bot is made of**. Every chunk from 4 onwards builds one of these blocks, and nothing may be built for one industry only.

## The idea

Like Notion, where pages and databases make up any workspace, every bot is assembled from **seven generic blocks**. A "clinic bot", "gym bot" or "HR bot" is not code. It's a **template**: a saved arrangement of blocks that anyone can install, change, and save again as their own template to share.

If a feature only makes sense for one industry, it's built as a block setting, a field type or a template, never as special code.

## The seven blocks

| Block | What it is | Examples across industries |
|---|---|---|
| **1. Pages** | Markdown pages in a virtual file tree: always-loaded layers (`/org`, `/agent`, `/roles/*`) and on-demand knowledge (`/knowledge/*`, `/updates/*` with expiry). Versioned and restorable | About the clinic, persona and tone, fee policy, help centre, this month's offer, holiday hours |
| **2. Collections** | User-defined databases. A collection has typed fields, constraints, views and permissions. Rows are records | Slots, Appointments, Products, Orders, Listings, Site visits, Classes, Memberships, Enquiries, Tickets, Leave requests, Eligibility rules, Students |
| **3. People** | Contacts (who chats) and team members (who works), each with profile fields, memory notes, files and **relations** to other people or records | Patient, parent ↔ students, employee ↔ manager, lead ↔ assigned agent |
| **4. Memory and history** | What the agent knows from past conversations, visible and editable: a **profile memory per contact** (USER.md: preferences, context, open items, each with a source and date), the **agent's notebook** (business-level notes it keeps, which the owner can read), and **conversation history** with summaries. Configurable: what to remember, what never to store, how long to keep. Edit and Forget everywhere | "Prefers evening slots", "Rahul's mother; speaks Marathi", "Asked about refunds twice", "Ordered Coorg Medium in October" |
| **5. Abilities** | Actions the agent can take, each set to Do it / Ask me first / Never, with an approver (owner, the assigned person, or a related person such as the manager). Generated automatically for collections, plus built-ins | Book a slot, create an order, cancel a booking, send a quote, hand over, send a document, notify the team |
| **6. Channels and messages** | Where conversations happen and what a message can contain: text, documents, images, buttons, lists, location; voice and photos in | WhatsApp, website widget, Preview (v3: Slack, Teams, more) |
| **7. Rules** | Safety and policy around everything: the platform safety layer (locked), the Never list, grounding (facts need a source), contact-detail checks, data rules (never store, mask, retain for N days) | No medical advice; never discuss salaries; mask ID numbers; keep chat history 1 year |

**A template** is a bundle of all seven: some pages, some collection schemas (with optional sample rows), people fields and relations, memory settings (what to remember, never store, retention), ability settings, the persona and Never list, and **eval cases** that prove it works.

## Collections: the heart of "any bot"

Collections replace the separate ideas of Facts, Records, profile extras, listings and rules. They're one engine.

**Field types:** text, long text, number, money, date, date and time, duration, select, multi-select, yes/no, phone, email, URL, file, **relation** (to a person or another collection), **rollup** (count or sum over a relation), formula (simple, computed in code).

**Recurrence:** a record can repeat (every Tuesday until a date); each occurrence is its own record, so constraints apply to each one.

**Constraints (declared, enforced in code inside a transaction):**
- `unique`: one booking per slot, one membership per person.
- `capacity`: at most N records sharing a value, such as 20 per class session, with an optional **waitlist**.
- `limit_per_person`: such as 12 class bookings per month for this plan field.
- `required`, `min`/`max`, `allowed_transitions` for status (booked → confirmed → completed or cancelled).

**Views (dashboard):** table, board by status, calendar by a date field, list. Saved filters. CSV import and export.

**Permissions:** per collection and per field: who can see and edit (owner, team, assigned person, the contact themselves), and what the **agent** may read or write. A field can be `never_store`, `masked` (keep the last 4 characters) or retained for N days.

**Rules tables:** a collection whose rows are conditions → outcome (eligibility, pricing tiers). They're evaluated in code by a generic `check_rules` tool. The model never decides eligibility itself.

## Generated agent tools

For every collection the agent may use, tools are generated from the schema. **No code per template.**

| Tool | What it does | Safety |
|---|---|---|
| `find_<collection>` | Filter (equals, range, contains), sort, limit, count and sum | Only fields the agent may read; results are passages it must cite |
| `create_<collection>` | Validates types and constraints, and returns the new record or the reason it failed (\"slot taken\", \"plan limit reached\") | An ability with Do it / Ask me first / Never and an approver |
| `update_<collection>` | Allowed fields and status transitions only | Same |
| `check_rules(<rules collection>, inputs)` | Returns the outcome and the missing inputs | Deterministic |

Built-in tools stay: `search_knowledge`, `read`/`list`/`grep` over pages, `remember`/`recall`/`search_history` (memory and history), `note` (the agent's notebook), `send_document`, `send_message` with buttons, lists and media, `hand_over`, `notify_team`.

## Templates

**Format:** one `template.yaml` plus folders, versioned:

```yaml
template: clinic-appointments
version: 1.2.0
title: Clinic appointments
description: Patients book, reschedule and cancel; staff approve late cancellations.
author: ally            # or an organisation or user id
locale: [en, hi]
pages:
  org: pages/ORG.md          # with {{business_name}}-style setup answers
  agent: pages/AGENT.md
  roles: { patient: pages/roles/patient.md, staff: pages/roles/staff.md }
collections:
  - file: collections/slots.yaml
  - file: collections/appointments.yaml     # fields, constraints, views, permissions
people:
  contact_fields: [name, age, preferred_doctor]
memory:
  remember: [preferences, language, open_items]
  never_store: [symptoms_free_text]
  retain_history_days: 365
abilities:
  create_appointments: { mode: do_it }
  update_appointments.cancel_within_24h: { mode: ask_me_first, approver: owner }
  medical_advice: { mode: never }
rules:
  never: [diagnosis, medication advice, comments on other patients]
setup_questions:              # asked during onboarding, filled into pages and sample rows
  - business_name
  - doctors_and_hours
evals: evals/cases.yaml        # conversations the template must pass
```

**Lifecycle:**
- **Install:** onboarding asks the setup questions and creates the pages, collections and settings in the bot. The bot owns its copy.
- **Customise:** the owner changes anything (fields, pages, abilities) in the dashboard. Changes are versioned.
- **Save as template:** any bot can be exported as a new template (without its records or people), and edited as files or in the dashboard.
- **Share:** in v2, within the organisation and by private link (import a template file or link). In v3, a public gallery with authors, ratings and updates.
- **Update:** v2 doesn't upgrade installed bots automatically. A new template version applies only to new installs; v3 adds "update available, review changes".

**What a template can never do:** remove or weaken the platform safety layer (crisis handling, consent, STOP, grounding, contact-detail checks). Templates can only add rules on top of it.

**Every template ships with eval cases.** A template is publishable only when its evals pass with 0 hard fails.

## How the ten walkthrough businesses map to blocks

| Business | Pages | Collections | People relations | Key abilities |
|---|---|---|---|---|
| Mental health FAQ | ORG, AGENT, policies | none | none | none (answers only) |
| Clinic | ORG, AGENT, fees | Slots, Appointments | patient → appointments | book (do it), late cancel (ask) |
| Travel agent | packages, Updates | Packages, Enquiries | lead → agent | quote (ask) |
| Coffee seller | story, care guide | Products, Orders | customer → orders | order (do it), discount (never) |
| SaaS support | help centre, Updates (incidents) | Plans, Tickets | customer → tickets | ticket (do it), refund (never) |
| Coaching institute | prospectus | Batches, Enquiries, Fees | parent → students | enquiry (do it) |
| Real estate | area guides | Listings, Leads, Site visits | lead → agent | visit (do it) |
| Gym | class guide | Classes (capacity, waitlist), Memberships | member → bookings | book (do it), freeze (ask) |
| NGO helpdesk | scheme guides | Eligibility rules, Applications | applicant → volunteer | check_rules, apply (do it) |
| HR assistant | policies (by role) | Leave requests | employee → manager | leave (ask, approver: manager) |

If a new business can't be described in this table, a block is missing. Fix the block, not the business.
