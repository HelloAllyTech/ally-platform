# The WhatsApp number system: what it does, and a plan to retire it

Written for Shehbaz, as part of A1 (16 Nov 2026). **Nothing has been hidden or removed.** This report is for deciding what to do with the system.

## In short

- **What it is.** Ally admin → Users → **WhatsApp Numbers** is a list of phone numbers, each linked to an organisation (and sometimes a user). In the code it's the `wa_phone_mappings` table. The tab sits beside "Ally admins" rather than inside it, and appears only for people with the Chatbots feature.
- **What it's for.** It lets WhatsApp recognise someone who messages from a number **that isn't on any Ally user's profile**, usually a frontline worker with no Ally account. With a mapping, the bot knows which organisation they're from.
- **What reads it.** Every inbound WhatsApp message. If it were removed:
  - unmapped workers become "unrecognised" on bots that are limited to recognised people or to an organisation;
  - they also become unrecognised on bots that answer from organisation knowledge, the platform number included.

  Nothing in ally-ai and nothing in the v2 agent reads it directly.
- **Recommendation.** Count its use in production first (SQL below). If no organisation relies on it, hide it and stop writes, then drop it. If some do, it needs a replacement before it can go: workers added as contacts of that organisation (an "organisation people" list).

## What it stores

`wa_phone_mappings` (entity `ally-be/src/whatsapp/entity/wa-phone-mapping.entity.ts`, created by migration `1969200000000-CreateWaPhoneMappings.ts`):

| Column | What it is |
|---|---|
| `id` | uuid |
| `phone_e164` | the number, digits only (varchar 32) |
| `phone_key` | the last 10 digits; unique among rows that aren't deleted. This is what lookups use |
| `tenant_id` | the organisation the number belongs to |
| `label` | optional note ("Ward 3 ASHA") |
| `user_id` | optional; a snapshot for attribution, with no foreign key |
| `created_by`, `updated_by`, `createdAt`, `updatedAt`, `deletedAt` | rows are soft-deleted |

Related: migration `1969100000000-AddWaContactIdentity.ts` added `wa_contacts.user_id`, `tenant_id`, `identified_at` and `identity_source`. These record who a WhatsApp contact was recognised as, and whether that came from a **mapping** (`identity_source = 'mapping'`) or from a user profile's phone number (`'phone'`).

## Where it's used

**ally-be routes.** All of them are in `whatsapp/controller/whatsapp-phone-mapping.controller.ts`, under `v1/whatsapp/phone-mappings`. They need the Chatbots feature (WHATSAPP_BOT) plus the view or edit WhatsApp-bot permission, and are limited to the caller's organisations.

| Route | Does |
|---|---|
| `GET /` | List. It also reads `users` by phone, to flag where a mapping disagrees with someone's profile |
| `POST /` | Add one. A number already mapped elsewhere is **moved** to the new organisation, not rejected |
| `POST /bulk` | Upload many, with an outcome for each row |
| `PATCH /:id` | Change the organisation or label |
| `DELETE /:id` | Soft-delete |

**ally-web.** `apps/ally-admin-dashboard/src/pages/UserManagement/PhoneMappings/` holds the tab, the add/edit panel and the bulk upload. The API hooks are in `src/api/whatsappBot.ts`.

**At runtime**, in this order:

1. **Inbound WhatsApp messages.** `whatsapp-inbound.service.ts` calls `WhatsAppIdentityService.identify()` on **every** message.
   - It checks `wa_phone_mappings` first (`WhatsAppPhoneMappingService.resolve`, a keyed lookup on `phone_key`), and only then `users.phone`. **A mapping wins over a profile.**
   - The result is written to `wa_contacts` and passed on as the sender's `userId` and `tenantId`.
2. **Who the bot will talk to.** These all decide from the sender's organisation, which came from step 1:
   - **"Recognised people"** access: allows a sender only if they have a user or an organisation (`chatbot-audience.service.ts`).
   - **An organisation on a bot's access list:** matches on the sender's `tenantId`.
   - **Bots that answer from their organisation's knowledge,** the platform number included: refuse a sender with no organisation, with `unrecognisedNumberText` (`chatbot-engine.service.ts`).
   - **The knowledge request's audience:** `tenant_id` is the sender's organisation, so which targeted documents they see depends on it.
3. **The admin health check** counts mappings as `mappedNumbers` (`whatsapp-admin.service.ts`).

**Doesn't read it:**
- **Consent and STOP/START** run before identity and don't use it.
- **ally-ai** never references it.
- **The v2 agent and its gateway** never read it. They get the organisation only through the same request builder as v1.
- **Assistants built through onboarding** with "Anyone" or listed access don't depend on it.

## What would break without it

1. **Workers with no Ally account become unrecognised.** That is the group the table exists for. On bots limited to recognised people or to an organisation, and on bots that answer from organisation knowledge (the platform number included), they would get the "unrecognised number" reply instead of an answer.
2. **Numbers where a mapping overrides a stale profile** would fall back to the profile's organisation without anyone noticing, and could see another organisation's targeted documents. Smaller, but worth checking in the counts below.
3. **Code to remove:**
   - the module wiring in `whatsapp.module.ts`;
   - the identity service's dependency on the mapping service;
   - the admin count;
   - `WaIdentitySource.MAPPING`;
   - the specs (`whatsapp-identity.service.spec.ts`, the phone-mapping specs);
   - the web tab and its API hooks.

## Counting its use in production (for Shehbaz to run; not run here)

Read-only. Run against the production ally-be database.

```sql
-- 1. How many live mappings, and how many organisations rely on them
SELECT count(*)                  AS live_mappings,
       count(DISTINCT tenant_id) AS organisations,
       count(*) FILTER (WHERE user_id IS NULL) AS without_ally_user,
       max("updatedAt")          AS last_changed
  FROM wa_phone_mappings
 WHERE "deletedAt" IS NULL;

-- 2. Per organisation
SELECT m.tenant_id, t.name, count(*) AS numbers, max(m."updatedAt") AS last_changed
  FROM wa_phone_mappings m
  LEFT JOIN tenants t ON t.id::text = m.tenant_id::text
 WHERE m."deletedAt" IS NULL
 GROUP BY m.tenant_id, t.name
 ORDER BY numbers DESC;

-- 3. Recent use: contacts recognised THROUGH a mapping who messaged lately
SELECT count(*) FILTER (WHERE c.last_seen_at > now() - interval '30 days') AS active_30d,
       count(*) FILTER (WHERE c.last_seen_at > now() - interval '90 days') AS active_90d,
       count(*)                                                            AS ever
  FROM wa_contacts c
 WHERE c.identity_source = 'mapping';

-- 4. The ones that would lose recognition: recognised through a mapping, and no Ally user has
--    that number on their profile (last 10 digits, as the resolver matches)
SELECT count(*) AS would_become_unrecognised
  FROM wa_contacts c
 WHERE c.identity_source = 'mapping'
   AND c.last_seen_at > now() - interval '90 days'
   AND NOT EXISTS (
         SELECT 1 FROM users u
          WHERE right(regexp_replace(coalesce(u.phone, ''), '\D', '', 'g'), 10)
              = right(regexp_replace(c.phone_e164, '\D', '', 'g'), 10));

-- 5. Mappings that override a different organisation on the user's profile (problem 2 above)
SELECT count(*) AS overrides_profile_org
  FROM wa_phone_mappings m
  JOIN users u
    ON right(regexp_replace(coalesce(u.phone, ''), '\D', '', 'g'), 10) = m.phone_key
 WHERE m."deletedAt" IS NULL
   AND u.tenant_id::text <> m.tenant_id::text;
```

(If `tenants` or `users.phone` / `users.tenant_id` have different names in production, adjust them; they match the local schema as of today.)

## Deprecation plan

**Step 0: decide from the numbers.** If query 3 shows no recent use and query 4 is 0, go straight to step 1 and then step 3. Otherwise do all three steps.

**Step 1: hide it and stop writes.**
- Remove the WhatsApp Numbers tab.
- Make `POST`, `POST /bulk` and `PATCH` return 410 with a message pointing at the replacement. Keep `GET` and `DELETE` so support can still see and clean up rows.
- Keep `resolve()` running, so nobody loses recognition.
- Add a log line or counter each time a message is recognised through a mapping, to watch it fall to zero.

**Step 2: replace what still reads it** (only if step 0 shows real use).
- The owner-led way to say "these numbers are my organisation's people" is an assistant's own **People / audience list**. An assistant's "who can message on WhatsApp" list (chunk 20d-2) already holds numbers per bot.
- For organisation-knowledge bots and the platform number, move the remaining organisations' numbers into that list, or onto their users' profiles where the people have Ally accounts.
- Then change `identify()` to stop consulting mappings, behind a platform setting, so it can be rolled back without a deploy.

**Step 3: drop it.**
- Remove the mapping service, controller, specs and web tab.
- Add a migration that drops `wa_phone_mappings`, with a down that recreates it empty.
- Leave `wa_contacts.identity_source = 'mapping'` as a historical value, or backfill those rows to `NULL`.

**Not in A1:** any of these steps. Hiding the system comes after this report, once Shehbaz decides (`EPIC-A1-SP1.md`).
