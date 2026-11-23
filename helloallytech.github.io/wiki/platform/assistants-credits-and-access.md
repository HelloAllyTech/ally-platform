---
title: Assistants — Credits, Budgets, Access, Roles
tags: [platform, assistants, billing, credits, access, roles, auth]
summary: The credits ledger and per-chatbot budgets, the blocked state and its kill switch, invite-only access and sign-in, roles as a set, and the responder agreement.
last_reconciled: 2026-11-23
---

# Assistants — Credits, Budgets, Access, Roles

Part of the Assistants build; see [Builder home and Create](assistants-build.md). Code: `ally-be/src/billing/`,
`ally-be/src/chatbot/members/`, `ally-be/src/chatbot/access/`.

## Credits and budgets

- Every builder starts at $0. Ally staff grant dollars; all AI spend under the builder comes out of it. Old seats and
  plan counters are retired (team members are never counted).
- The ledger (`billing_accounts`, `credit_grants`, `chatbot_budgets`, reservations, per-person spend) tracks granted,
  set aside, spent and reserved. Spend is a reconciled estimate: a reservation (atomic conditional update) is made
  before each model call and settled when recorded, so concurrent turns cannot overshoot. Unpriced models use a
  pessimistic fallback price and raise an alert. A nightly job rebuilds counters from events.
- A builder sets aside a **budget** per chatbot from the free balance, and daily, weekly and monthly limits per
  user. Free balance funds building and testing; chatbot budgets fund customers, so building can never darken a live
  chatbot (R2). Lowering a budget is clamped at spent; archiving returns unspent budget. Warning emails at 50, 80 and
  95 percent, once per threshold per grant.
- Placeholder amounts (waiting for sign-off): reserve warning $5.00, starting credits $20.00, starting chatbot
  budget $2.00, in `billing/constants/credits.constants.ts`.
- **Blocked state.** No budget means no model call: the chatbot shows its fixed crisis notification. The free keyword
  crisis check still runs first and flags and alerts (R1). Three separately named states exist: out of credits,
  removed from the access list, abuse block. STOP always wins. A fixed notice goes once per 24 hours per number.
- **Kill switch.** `global_settings` row `assistant_credits` (`enforcement`, `warningEmails`). Off means the old
  limits apply and spend is still recorded. Default off in production until the row exists, on locally.
- Background AI with nobody watching (crawl, re-index, checkup) pauses with a visible "out of credits" state and
  resumes on a grant.

## Invite-only access and sign-in

Access is by invitation, by phone number or email, kept in the chatbot's access list (every list starts empty at
cutover). Everyone signs in. Phone numbers are stored as E.164, short numbers are rejected, and each entry shows
matched or never matched. Removing someone blocks them at once; history stays until erase.
The web sign-in screen shows crisis information before any code is requested and never confirms whether an address
is on the list; codes are rate-capped per number, address and day. WhatsApp checks the list before a contact record
is created. Public access returns later; the code keeps that mode.

## Roles as a set

Members hold a **set** of roles: Owner, Editor, Responder, Viewer (`chatbot_members.roles`). The old single `role` is
dual-written by a trigger until a later contract release. Take-over and reply are Responder permissions. The chatbot
row is locked for member changes, so the last owner cannot be removed or leave; the creator cannot be removed until
ownership and budgets move. Invites are bound to the email by the emailed code, a shared link cannot be claimed by
someone else, platform admins cannot be invited, and removal revokes sessions.

## Responder agreement

A responder (and an owner who responds) must accept the current agreement version before taking over, replying or
reading as responder-only. A new version blocks only new take-overs, not conversations already open. Enforcement is
behind `RESPONDER_AGREEMENT_ENFORCED` (default on); see the release order in the runbook.
