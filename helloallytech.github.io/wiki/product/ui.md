---
title: UI & Interaction
tags: [product, best-practices, ui, ux, design, accessibility, i18n]
summary: DEPRECATED 2026-08-07, superseded by the Stacks MCP — kept for history. How Ally screens should behave — states before styling, hierarchy, permission-aware UI, latency as a design problem, accessibility and localisation.
last_reconciled: 2026-08-06
---

# UI & Interaction

*Part of [Product Management Best Practices](best-practices.md).* **Maturity: Deprecated (2026-08-07) — was Draft.**

> [!WARNING]
> **Deprecated — superseded by the Stacks MCP.** Product guidance is now retrieved from the
> external Stacks corpus at planning time; see
> [Planning with the Stacks MCP](../contributing/planning-with-stacks.md). This page is kept for
> history and because other pages cite its principles by number — do not add new principles here,
> and treat anything that conflicts with current Stacks guidance as superseded.

## Why this matters for Ally

Ally's surfaces are unusually stateful: a counsellor in a live voice session, a learner in a
simulated roleplay, a trainer scrubbing a recorded session, an admin configuring a scenario.
Most of the difficulty is not in the "happy" screen — it is in what the screen does while
something is loading, streaming, partially failed, permission-denied, or translated into a
language with 40% longer labels.

## Principles

1. **States before styling.** Every screen spec must define: empty, loading (and *slow*
   loading, > ~3 s), partial/streaming, error (recoverable vs terminal), permission-denied,
   and saturated (hundreds of rows). If those six aren't written down, the screen isn't
   specified yet.
2. **One primary action per view.** If two things are equally emphasised, neither is primary.
   Everything else is secondary, tertiary, or in an overflow.
3. **Latency is a UI decision.** LLM and voice paths take real time. Choose deliberately
   between: optimistic UI, skeletons, streaming partials, or an honest progress narrative
   ("generating summary…"). Never a spinner with no ceiling and no explanation.
4. **Destructive and irreversible actions get friction; everything else gets none.** Confirm
   deletes, publishes, and anything a tenant's learners will immediately see. Do not confirm
   saves.
5. **Permission-aware, not permission-surprised.** Gate on the permission set, not on a
   single role — a user can be both learner and counsellor. Prefer *hiding* what a user can
   never access and *explaining* what they could access with a different role, over rendering
   a control that 403s.
6. **Reuse the component before you invent one.** New one-off components are a maintenance
   tax and a consistency leak; extend the shared library
   ([ally-web](../repos/ally-web.md) `libs/ui-shared/`) instead.
7. **Consistency across surfaces beats local optimisation.** The same concept (a session, a
   review, a badge) should be named and shaped the same way on web, admin, and
   [mobile](../repos/ally-mobile.md). Divergence is a decision, not an accident.
8. **Write the copy in the design.** Placeholder lorem hides the real problem — that the
   label is ambiguous. See the copy item in the backlog on [the hub](best-practices.md).
9. **Design the mobile width first for anything a counsellor uses in the field**, and the
   dense desktop layout first for anything an admin uses all day. They are different products.
10. **Accessibility is table stakes**: keyboard reachable, visible focus, adequate contrast,
    real labels on inputs, touch targets large enough, and never colour as the only carrier of
    meaning (this last one also governs [Data Visualisation](data-visualisation.md)).
11. **A row you hide is a row nobody can edit.** Filtering records out of a management list is
    a legitimate default, but it removes every action attached to them — so pair the exclusion
    with a way back in: an opt-in filter for the role that is allowed to see them, or a second
    surface that owns those records outright. Otherwise the only route left is the API, and
    the product has a hole nobody can see. (Ally case: platform-role accounts are excluded from
    the admin Users list, which also made their roles unmanageable — so Ally staff could not be
    given consumer-app access without a hand-rolled API call.)
12. **When one editor can't manage the whole record, say what it won't touch.** If a form owns
    a subset of a record's fields and another surface owns the rest, show the untouched values
    as read-only in the form, name the surface that does own them, and re-send them on save.
    A "replace the whole set" endpoint behind a partial editor silently deletes what the editor
    never showed.
13. **A link to another surface is gated on what that surface admits, not on what this one
    knows.** When one app offers a way into another, the visibility rule must be a copy of the
    *destination's* own entry condition, kept next to a comment saying so — otherwise the two
    drift and you ship a link that dead-ends in the other app's "you can't sign in" screen.
    Gate on the destination's admission list, hide the link when the destination URL isn't
    configured for the environment, and make it look like it leaves: an anchor with the
    external-link affordance, visually separated from in-app navigation. Note that the entry
    condition is usually a *role* question, not a permission one — so this is the rare case
    where principle 5's "gate on the permission set" does not apply. (Ally case: the consumer
    app's "Ally Admin" link mirrors the admin console's login `allowedRoles` —
    `SUPER_ADMIN`/`SUPER_DUPER_ADMIN`/`MULTI_TENANT_ADMIN` — and excludes tenant `ADMIN`, which
    that login refuses. Holding a super admin's *permissions* is not the test; admission is by
    role name.)
14. **Derive role checks from the full role set, never the collapsed one.** `GET /users/me`
    reports both `roles[]` and a single `role` chosen by a backend priority list. That list
    can't express a multi-role account and omits some roles entirely, so the collapsed value
    silently misreports exactly the people a cross-surface feature is for — an account holding
    `[LEARNER, MULTI_TENANT_ADMIN]` arrives reporting `role: "LEARNER"`. Read `roles`, keep
    `role` only as a fallback for payloads that predate it. This is the concrete form of the
    "role-string gating" anti-pattern below.

15. **A truncated list needs a control, not just a count.** When a list is paged server-side,
    the count is what makes the truncation visible — and without a pager beside it, that count
    is just a notice that the rest is unreachable ("50 of 507" and nothing to click). Ship the
    two together: the *visible range* rather than the page size (`Showing 51–100 of 507`), the
    position in the set, and prev/next. Two rules follow from the offset being meaningful only
    against the result set it was taken from: every search, filter and sort change returns to
    the first page (reset it in the same update that changes the filter, or the first request
    goes out at the stale offset), and any page-scoped selection is dropped with it. And keep
    the control reachable when the current page is *empty* — a list that shrinks underneath a
    high offset must still offer the way back, or the only escape is a reload. (Ally case: the
    admin Product Roadmap board rendered page 1 of 507 opportunities and reported "50 of 507"
    with no pager, so 457 rows — and every action attached to them — existed only in the API.)

## Checklist

- [ ] All six states specified and implemented (empty / loading / slow / partial / error / denied).
- [ ] Exactly one primary action; destructive actions confirmed.
- [ ] Behaviour verified with a permission set that *lacks* the feature, not just an admin.
- [ ] Longest realistic string tested in each shipped language; layout doesn't break.
- [ ] Keyboard-only pass; focus visible; contrast checked.
- [ ] Works at the narrowest supported width, and with a realistically large dataset.
- [ ] Reuses shared components/tokens; no new hardcoded colours or spacing.
- [ ] Nothing PHI-bearing rendered where the persona shouldn't see it.
- [ ] Every record a list hides is still reachable and editable somewhere in the product.
- [ ] Any partial editor of a record names what it doesn't own — and preserves it on save.
- [ ] Any link into another surface is gated on that surface's own entry condition, hidden when
      its URL is unconfigured, and verified with a multi-role account whose collapsed `role`
      disagrees with its `roles[]`.
- [ ] Any server-truncated list ships its pager in the same change, shows the visible range,
      returns to the first page on every search/filter/sort change, and stays escapable when the
      current page comes back empty.

## Anti-patterns

- **The demo-data screen.** Designed against three tidy rows; ships to a tenant with 400.
- **Spinner-as-a-spec.** Every async path resolving into the same anonymous spinner, so users
  can't tell "working" from "stuck".
- **Role-string gating.** `if (user.role === 'ADMIN')` collapses multi-role users and silently
  breaks the counsellor-who-is-also-a-learner case.
- **Silent permission failures.** Rendering a button that returns 403 on click.
- **The invisible record.** An exclusion filter that quietly becomes the reason a whole class of
  account can never be edited again — the list is the only door, and it was locked.
- **The count-only footer.** Reporting "50 of 507" with no pager beside it. The footer names the
  truncation and then strands the reader on page one; the rows past the first page are visible
  only to whoever writes the API call.
- **Toast-only errors** for failures the user must act on — they vanish before they're read.
- **English-shaped layouts.** Fixed-width labels and truncation that make other languages
  unreadable.
- **The shrink-to-fit dialog.** A modal or panel whose width is left to the content
  (`w-auto`, `min-w-…` with no definite width) grows sideways as content is added — a
  multi-select of roles or tags becomes one endless row, wrapping never engages, and the
  dialog reflows every time the user picks something. Containers get a definite width;
  content wraps and the container grows *down*.
- **A new drawer for every feature** until nobody can find anything.

## Ally-specific notes

- Web apps and the shared library live in [ally-web](../repos/ally-web.md); the admin and
  helpline dashboards are separate apps with a shared `libs/ui-shared/`.
- The mobile app ([ally-mobile](../repos/ally-mobile.md)) mirrors many of the same concepts —
  reviews, simulations, achievements, leaderboards — and should mirror the naming too.
- Real-time surfaces (voice sessions, live feedback) are driven by Socket.IO and LiveKit; the
  UI must tolerate reconnects and out-of-order events, not assume a clean stream.
- Multi-language support currently spans English, Hindi, Kannada, Marathi and Tamil; see the
  language-quality work in
  [Language-Quality Evaluation & RCA](../platform/language-quality-eval.md) for how much
  linguistic nuance the product actually carries.

## Open questions

- Do we have one design-token source of truth across web + admin + mobile, or three?
- What is the agreed slow-path threshold before we switch from skeleton to progress narrative?
- Which accessibility conformance level are we actually committing to, and who verifies it?
