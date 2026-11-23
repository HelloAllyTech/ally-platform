---
title: Assistants — Safety Core, Customer Data, Staff View, Safety Packs
tags: [platform, assistants, safety, crisis, privacy, retention, staff]
summary: The go-live gate, fixed crisis text, alerts and holding message, retention and erase, memory consent, the staff read-only view and safety pack releases.
last_reconciled: 2026-11-23
---

# Assistants — Safety Core, Customer Data, Staff View, Safety Packs

See also [Credits and access](assistants-credits-and-access.md). Code: `ally-be/src/chatbot/safety/`,
`chatbot/privacy/`, `chatbot/staff/`, `bot-draft/safety-pack/`. All wording marked `COPY: needs approval` in the
code still needs a named approver.

## Safety core

- **Go-live gate** on every path (publish, status change, page toggle): audience age, a way to reach a person,
  purpose, terms accepted, and the crisis check passing in every enabled language. A failing language is turned off.
  Chatbots already live are unpublished until the owner completes it (D10).
- **Crisis text default** is the findahelpline.com link only; the builder's own numbers show first when set. Open
  question: the link-only default has no emergency-services line.
- **Alerts** go through an outbox with retry, to responders and owners by email (never fully off), with staff Slack as
  a second channel and a metric when a flag stays untaken. A one-minute job runs the timers.
- **Holding message** is sent at flag time, in the person's language: someone will reply, plus the crisis link. The
  "no one is available" message follows if nobody takes over. Wording needs sign-off.
- A base safety block applies to every chatbot; the Apply check judges safety-relevant edits and fails closed.

## Customer data

- **Retention**: per-chatbot days, default 90, across every store with message content; flagged conversations are
  kept 12 months. The sweep is blocked until the crisis flag backfill is done and a snapshot exists.
- **Erase in chat**: the customer asks in their own language, confirms, and conversations, memory and contact details
  are erased; the person stays on the access list and can sign in again. The customer is told what was erased and
  kept; the owner is told.
- **Memory consent**: stored per end person, age-aware wording; existing memory is deleted at cutover (D7).
- Knowledge: personal-data detection needs owner approval; conflicts handled at answer time; "Read again" nudge.

## Staff read-only view

Ally staff get a read-only scope. Access to conversations is owner-granted and time-limited, every read writes a view
log entry (a log failure blocks the read), and owners see a "who looked" list. Kill switch
`ASSISTANT_STAFF_VIEW_ENABLED`.

## Safety pack releases

Pack content moves from code into released data with versions and test results, a curator permission
(`manage:safety-packs`), automatic application with an owner notice and one-click rollback. Kill switch
`ASSISTANT_PACK_RELEASES_ENABLED`; off falls back to the code constants.
