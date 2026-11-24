---
title: Assistants — Builder Home, Create and Build, Channels
tags: [platform, assistants, chatbot, admin, onboarding, channels]
summary: How a builder creates and runs an Assistant after the Assistants build (stages 2, 3, 7): the two-option home, the six sections, the one-screen Create and Build with working copy versus live and Apply, the bot page address, widget, custom domain, and where the cutover runbook lives.
last_reconciled: 2026-11-23
---

# Assistants — Builder Home, Create and Build, Channels

Status: built on the `feat/agents-v2-sb1` branch, not released. Backend ships first, then the dashboard (see the
[cutover runbook](https://github.com/HelloAllyTech/ally-platform/blob/master/ally-be/docs/assistants-cutover-runbook.md)).
Vocabulary: [Core Concepts, Assistants](concepts.md#assistants). Companion pages:
[Credits and access](assistants-credits-and-access.md), [Safety and customer data](assistants-safety-and-data.md).

## The builder home

The home has two options: **Create** and **Open**. Open is a card grid with "Show archived" and a waiting count
for editors and owners. Blank and archived chatbots are left out of the grid and the counts. A builder with one
chatbot and no create right opens straight into it. The corner menu holds Plan (credits), profile and log out.
Create is blocked on a narrow screen with an "open on a laptop" message, so no blank is created that cannot be
built. A person whose only role is Responder sees Conversations and nothing else.

Defaults, Library and Connectors moved to a staff route (`/admin/chatbot-support`), behind the staff permission.

## The six sections

Build, How it's doing (Overview, Conversations), Knowledge, Channels, Team, Settings. Old `?section=` links
redirect. Overview shows counts only, with the small-group rule: groups under five are hidden in breakdowns and in
the top-unanswered list; time series show plain totals.

## Create and Build

One screen with a split view: the test chatbot on the right, the build on the left.

- **Blank chatbots.** Clicking Create makes a blank at once that answers with a free starter reply. Create is
  idempotent: it reuses the builder's newest untouched blank (cap three). "Untouched" is an explicit flag set by the
  first meaningful action. A cleanup deletes untouched blanks after 24 hours, skipping any with a source, edit, test
  message, other member, budget or running crawl.
- **Start paths.** Pick a template, or start from scratch with a website, documents or an interview (Copilot).
  Templates are Ally-owned chatbots with real knowledge, copied for the builder, offered only while the chatbot is
  blank. Ally pays to index template knowledge (R4), so a template works at $0.
- **Copilot or the form.** Copilot after a start path, the direct form after a template or for an existing chatbot;
  the last mode is remembered per chatbot.
- **Working copy versus live.** Before the first go-live, edits apply as you type. After go-live the test chatbot
  runs the **working copy** at once but customers see the **live** configuration until the builder presses
  **Apply**. Staged (wait for Apply): name, greeting, tone, instructions, languages, suggested questions, decline
  text, rules, quick replies, sources. Immediate: access list, people, budgets, status, archive, retention. A test
  never writes the live row.
- **Apply** runs the crisis and instruction check only when a safety-relevant field changed, and fails closed. Name,
  greeting and suggested questions apply with no model call. At $0 safety-relevant fields are disabled with a prompt
  to contact Ally; the other fields still work.
- **Conflicts.** One version per field; a refused or conflicting edit keeps the typed text marked "not applied" with
  Reload and Overwrite.

Code: `ally-be/src/bot-draft/working-copy/`, `bot-draft/blank/`, `bot-draft/templates/`, `bot-draft/copilot/`;
dashboard `pages/Onboarding/create/`, `components/v2/SplitBuild.tsx`.

## The bot page address, widget and custom domain

- Every bot page has an Ally-assigned address, `<BOT_PAGE_CHAT_URL>/<public_id>` (eight random characters, not
  owner-editable). Old `/b/<slug>` links and widget embeds keep working and redirect.
- The website widget may load on any site; the Channels section lists the "sites seen". Chatting still needs
  sign-in.
- A **custom domain** is added in Channels (one per assistant). Ally shows a CNAME and a TXT record and checks DNS on
  request. Verified does not mean live: certificates and host routing are infrastructure outside the repository, and
  the dashboard says "we'll confirm when your domain is ready". The default address always keeps working.
  Details: [custom-domains.md](https://github.com/HelloAllyTech/ally-platform/blob/master/ally-be/docs/custom-domains.md).

## Cutover runbook

Stage 10 is the runbook: announce, grant credits, snapshot, migrate, dry-run reports, switch each feature on through
its kill switch, verify, then the irreversible steps (memory delete, retention sweep, unpublish backfill).
Source: [assistants-cutover-runbook.md](https://github.com/HelloAllyTech/ally-platform/blob/master/ally-be/docs/assistants-cutover-runbook.md).
Release risk to know: the responder agreement is enforced by default, so release the backend with
`RESPONDER_AGREEMENT_ENFORCED=false` and remove the override once the dashboard is live.
