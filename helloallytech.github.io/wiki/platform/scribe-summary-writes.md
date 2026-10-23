---
title: Scribe Summary Writes — Merge Semantics & Client Rules
tags: [platform, scribe, data-integrity, deployment, sdlc]
summary: Why scribe session notes appeared not to save, the merge-based write contract that replaced the destructive one, and the backend-first deploy rule every scribe client depends on.
last_reconciled: 2026-07-28
---

# Scribe Summary Writes — Merge Semantics & Client Rules

Counsellors reported for months that scribe session notes "wouldn't save". The
cause was not the UI and not any single bug: **the write itself was
destructive**. Every client edit replaced the whole summary document, so any
difference between what a client had loaded and what the database held became
silent data loss.

This page documents the write contract that replaced it, the rules a client must
follow, and the deploy ordering those rules impose. Read it before changing
anything that writes a session summary.

## The failure class

A session summary is a single JSON document (the `summary` column on the
call-details record). It is written by several independent parties:

- the counsellor, editing fields in a client
- AI summary generation, which lands asynchronously after the call ends
- AI custom-field fill, which lands separately again
- summary regeneration (manual retry, or the auto-retry cron)
- tag positivity ratings

The old backend handler took the client's payload and wrote it over the stored
document wholesale. The clients, in turn, sent their entire in-memory copy of the
summary. Combined, that meant a save wrote back **the snapshot the form was
seeded with** — reverting anything that had arrived since. A counsellor typing
while AI generation completed would save, see a confirmation, and find their work
replaced by the generated text; or find generated fields blanked by their older
snapshot. Nothing errored, and nothing in the logs indicated a problem.

The same class produced several distinct-looking complaints:

| Report | Actual cause |
|---|---|
| "My edit didn't save" | A later write replaced it, or a refetch reseeded the form over it |
| "My tags disappeared" | The rating call failed, the client sent an empty/stale tag list, and the replace committed it |
| "Saving takes minutes" | The save awaited a synchronous LLM call for tag ratings |
| "A field I cleared came back" | The client sent `undefined`, which serialises away; the backend read the absent key as "leave unchanged" |
| "Other fields got wiped" | Whole-document replace from a stale snapshot |

## The write contract

**The backend merges; it never replaces.** The summary patch is applied key-wise
inside the UPDATE statement, so there is no read-modify-write window for a
concurrent writer to fall into.

Key semantics — the same convention custom-field values already used:

- **Key present with a value** → set it.
- **Key present with `null`** → clear it.
- **Key absent** → leave the stored value untouched.

That last rule is what makes concurrent writers safe, and it is why the third
rule below matters so much on the client side.

**Clients must send only the keys the user actually edited.** A client that sends
its whole form re-establishes the original bug: every key is present, so every
key is overwritten with a possibly-stale value. The merge only protects fields a
client omits.

**Clients must diff against the values they were seeded with — never against the
live server copy.** A server value can change for reasons unrelated to this user
(an AI fill, another editor, a regeneration landing). Diffing against the live
copy counts that drift as a local edit and writes the stale seeded value back
over it. The correct baseline is a snapshot captured when the form was seeded,
updated only when a write succeeds — and updated *per written key*, so an edit
made while a request was in flight stays dirty rather than being marked saved.

**Nothing on a save path may call an LLM.** Tags are stored as typed, keeping
whatever rating each tag already had and starting new ones neutral. A rating
service that is slow, wedged, or returning nothing must be able to degrade the
colour of a chip, never delay or discard a counsellor's note.

## Deploy ordering — backend first, always

The clients depend on merge semantics that only the newer backend has. This makes
the deploy order a correctness requirement, not a preference:

> **Deploy the backend before any scribe client. Roll back clients before the
> backend.**

Deploying a client first is silent data loss, not an error:

- A client sends a partial patch to a *replacing* backend → that session's whole
  summary collapses to the single edited key.
- A client sends bare tag names to a backend without tag normalisation → tags are
  stored as a plain string array, breaking every reader (tag filters, the
  call-log tag column, the mobile chip renderer).

The reverse direction is safe by design: the newer backend accepts whole-document
payloads and honours a caller-supplied tag rating, so **older clients already
installed in the field keep working unchanged**. This matters most for mobile,
where app updates roll out over days and stale versions are guaranteed.

Two practical consequences:

- Confirm the *specific environment* has the backend change before pointing a
  client build at it. "The backend is deployed" is ambiguous when environments
  deploy through different mechanisms.
- Mobile raises the stakes: a rollback is a store release, not a redeploy. Hold
  mobile clients until the backend is confirmed live.

## Seeding a form without destroying edits

The read side has its own failure mode. A form seeded from the server must be
re-seeded when the server copy legitimately changes (generation finishing, a
retry landing) but must not discard what the user is typing.

Rules that emerged from fixing this:

- **Key seeding on the session, not on a status field.** Keying on something like
  a summary-status enum means the effect never fires when a user moves between
  two sessions that share the same status — so the form keeps the previous
  session's values under the new session's id, and a save writes them to the
  wrong record. Verify the payload's id matches the session before adopting it.
- **Merge the server copy *under* unsaved edits, not over them.** Unsaved values
  win; everything else takes the fresh server value.
- **Never reset the baseline while discarding an edit.** Doing both in one pass
  makes the loss undetectable afterwards — the form reports no unsaved changes,
  so nothing prompts the user and nothing can retry.
- **A shared baseline must live in shared state.** Where a form hook is
  instantiated many times on one screen (per-section wrappers, for example), a
  per-instance baseline gives each copy its own idea of what changed — and the
  instance that saves is not the one that took the edit.

## Autosave

Explicit-save-only is the reason a bug in any of the above is *lossy* rather than
merely annoying: the work exists solely in component state until the user presses
a button, so anything that unmounts the form first discards it silently — a tab
switch, closing a panel, navigating away.

The pattern used on web:

- Pending edits live in a **ref**, so the value written is the latest regardless
  of render timing.
- Writes are **debounced** (~800ms) and **serialised**; if edits arrive during a
  request, one follow-up write is queued rather than run concurrently.
- Dirty state clears **only on a confirmed write**, and only for the exact values
  that were sent.
- Pending edits are **flushed on unmount** and warned about on page unload.
- The explicit Save button becomes a force-flush, and a visible
  saving/saved/error indicator is mandatory — autosave you cannot see is worse
  than no autosave, because a failed write is indistinguishable from a
  successful one.

A caveat for any client where the form hook is instantiated more than once per
screen: the debounce timer needs a single owner, or every instance becomes an
independent writer and one keystroke produces N identical writes.

## Related

- [Architecture & Data Flow](architecture.md) — how the services and queues that
  write summaries fit together.
- [Cross-Repo Agent Guide](agent-guide.md) — conventions and gotchas when
  changing behaviour across repos.
- [Contributing Guide](../contributing/guide.md) — SDLC and release rules.
- [ally-be](../repos/ally-be.md), [ally-web](../repos/ally-web.md),
  [ally-mobile](../repos/ally-mobile.md) — the three repos this contract spans.
