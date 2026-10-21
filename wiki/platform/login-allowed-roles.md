---
title: Login allowedRoles — Client-Supplied Filter, and the Role-Retirement Test Case
tags: [platform, auth, roles, deployment, sdlc, testing]
summary: Why every auth call carries a client-supplied allowedRoles list, how retiring a role from the backend enum once locked every consumer-app user out of login, and the regression test case that now guards it.
last_reconciled: 2026-08-06
---

# Login `allowedRoles` — Client-Supplied Filter, and the Role-Retirement Test Case

Every client-facing auth call in ally-be — OTP generation, OTP verification,
magic-link verification, Google sign-in, Apple sign-in — carries an
`allowedRoles` array supplied by the client. Each surface hardcodes its own list:
the consumer app sends its five consumer roles, the admin console sends the
platform ones.

The list answers one question: *which roles may sign in **here**?* The server
intersects it with the roles the account actually holds and admits on a match.

```ts
const hasAllowedRoles = allowedRoles.some(role => userGroups.includes(role));
```

That is the whole mechanism. Two consequences follow, and missing either one is
what caused the outage below.

## `allowedRoles` is a filter, not a claim

A client cannot escalate with it. Sending `SUPER_ADMIN` from the consumer app
grants nothing — the intersection is against the account's real group
memberships, which only the backend can change. This is why the list can safely
live in client code.

The mirror of that: **a role name the backend does not recognise matches nothing
and admits nobody.** It is inert. It cannot widen access, and it cannot narrow
it either.

## The failure class: retiring a role breaks every stale client

On 2026-08-06 a role was removed from ally-be's `UserRole` enum. The auth DTOs
validated `allowedRoles` strictly against that enum (`@IsEnum(UserRole, { each:
true })`), so the moment the backend rolled out, every client still sending the
retired name got:

```
400 — each value in allowedRoles must be one of the following values: ...
```

The consumer app's live bundle still listed the retired role. The request failed
validation *before* the handler ever looked up the account, so the 400 hit **every
user of that surface**, not just holders of the retired role — nobody could log
in at all. The role in question had never been assigned to anyone in production.

The shape of this is worth naming, because it is not specific to one role:

| | |
|---|---|
| **Trigger** | Any value removed from a server-side enum that clients send verbatim |
| **Blast radius** | Every user of every client not yet redeployed — not the users of the removed value |
| **Symptom** | 400 at the first step of login, with a validation message naming the valid values |
| **Why it surprises** | Backend and frontend changes shipped in the same PR pair; only the deploys were ordered |

A released **mobile** build makes it worse: it cannot be redeployed at all, so
the same skew strands those users until they update from the store.

## The contract now

`IsAllowedRoles()` (`ally-be/src/common/decorator/allowed-roles.decorator.ts`) replaced
the strict enum check on all five entry points:

- **Unrecognised names are dropped** before validation; the recognised ones decide the request.
- **A list with nothing recognisable left is still a 400** (`ArrayNotEmpty`) — such a client can admit nobody, and saying so plainly beats the 403 an empty intersection would produce.
- **Who gets in is unchanged.** The intersection still decides admission, and a dropped name could never have matched a group.

This decouples a client's login from the backend's deploy order in one
direction only — it does *not* make the reverse safe. Adding a role that a
client must send still requires the backend first.

## The test case

Two layers, because they catch different things. The unit test protects the
decorator; the probe protects the deployed system.

### Automated (ally-be)

`ally-be/src/common/decorator/test/allowed-roles.decorator.spec.ts` drives the decorator
through `plainToInstance` + `validateSync` — the same pair the global
`ValidationPipe({ transform: true })` applies — and asserts:

| Input `allowedRoles` | Expected |
|---|---|
| Known roles only | Valid, unchanged |
| Known roles **+ a retired/unknown name** | Valid; unknown name dropped, the rest survive |
| Non-string entries (number, `null`, object) | Valid; entries dropped |
| Only unknown names | `400` — `arrayNotEmpty` |
| `[]` | `400` — `arrayNotEmpty` |
| Missing, or not an array | `400` — `isArray` |

Row 2 is the regression: it reproduces the exact payload the stale bundle was
sending.

### Post-deploy probe (any environment)

Run against the API host after any release that changes the role enum. Use an
address that belongs to **no account** — this exercises validation without
sending an OTP to a real person.

```bash
curl -s -w '\nHTTP %{http_code}\n' -X POST https://<api-host>/api/v2/auth/generate-otp \
  -H 'Content-Type: application/json' \
  -d '{"email":"nobody@example.invalid","allowedRoles":["COUNSELOR","ADMIN","LEARNER","RETIRED_ROLE"],"appType":"APP"}'
```

**Pass:** `404 — No account found associated with this email`. The 404 is the
point: validation passed and the request reached the account lookup, which is
exactly where a real user's request would then succeed.

**Fail:** `400 — each value in allowedRoles must be one of ...`. Login is broken
for every client sending that list.

Then confirm the guard did not become a rubber stamp:

```bash
curl -s -w '\nHTTP %{http_code}\n' -X POST https://<api-host>/api/v2/auth/generate-otp \
  -H 'Content-Type: application/json' \
  -d '{"email":"nobody@example.invalid","allowedRoles":["RETIRED_ROLE","NOT_A_ROLE"],"appType":"APP"}'
```

**Pass:** `400 — allowedRoles should not be empty`.

## Retiring a role: the checklist

1. **Remove it from every client's list first**, and let those builds reach production. The backend tolerating the stale name buys the time; it does not remove the step.
2. **Check the released mobile build.** If a shipped version sends the name, it must stay tolerated until that version is out of use — the enum entry can go, the tolerance cannot.
3. **Grant holders a replacement role before dropping the group.** A migration that deletes `user_groups` rows revokes access; it does not migrate anyone.
4. **Flush the Redis role caches** (`user:roles:<id>`, `user:groups:<id>`, `group:permissions:<groupId>`, 30-min TTL) — a raw SQL migration cannot bust them.
5. **Run the probe above** against the environment after the release.

## See also

- [ally-be](../repos/ally-be.md) — the role model: groups, `user_groups`, and the `roles`-vs-`role` caveat
- [Scribe Summary Writes](scribe-summary-writes.md) — the other page in this shape: a client/server contract whose rules imply a deploy order
- [Memory](../memory.md) — the durable lessons behind both
