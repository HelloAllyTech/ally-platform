# Chunk A1: notes

Owners only, login only, assistants out of Ally admin. Built 16 Nov 2026 on `feat/agents-v2-sprint-1`, first chunk of `EPIC-A1-SP1.md`. Commits are tagged `[A1]`.

Two decisions changed the plan during planning (Shehbaz):
- **Chatbots-only logins** are "custom logins" built from what already exists. There's no new table, no `access_scope`, no new guard and no change to the feature toggles. See §4.
- **`@RequireFeatureToggle(WHATSAPP_BOT)`** stays on every assistant route, and `canCreate` means the caller holds WHATSAPP_BOT.

## 1. Every assistant has owners; only its people see it

**ally-be**

- **`ChatbotAccessService`** (`chatbot/service/chatbot-access.service.ts`) no longer treats a platform admin as the owner of every bot.
  - `assert`, `rolesFor` and `accessibleChatbotIds` look only at `chatbot_members`. `accessibleChatbotIds` now returns `string[]`, never `null` ("every bot").
  - A non-member gets **404**, platform admins included. A member below the needed role gets 403.
  - `canCreate()` and `assertCanCreate()` mean "holds WHATSAPP_BOT". `isPlatformAdmin()` / `assertPlatformAdmin()` stay, but only for things that belong to no bot (below).
- **Direct bypasses removed:**
  - the bot list and the archived list (`chatbot.service.ts`);
  - a draft opened by someone other than its starter (`bot-draft.service.ts`);
  - the Inbox scope, counts and live events (`inbox.service.ts`, `inbox.controller.ts`, which used to listen to every bot);
  - the WhatsApp conversation, contact and list scope (`whatsapp-conversation.service.ts`);
  - connectors bound to a bot (`connector.service.ts`).
- **Still platform-admin only, because they belong to no bot:**
  - connectors and numbers with no bot;
  - the WhatsApp templates and replies defaults (no `chatbotId`);
  - the platform settings `botPagePublicAllowed` and `dashboardReadsFrom`.
- **Per-route roles:** `@ChatbotRole(role, param)` plus `ChatbotMemberGuard` (`chatbot/access/`) on every route that names a bot: 107 routes.
  - The guard runs after the route's feature-toggle guard and calls `assert` with the route's role.
  - Every other assistant route (64) is marked `@AssistantScope('list' | 'create' | 'service' | 'platform')`.
  - Services keep their own `assert` calls. The decorator is the floor every route declares.
  - Roles were set from the route's toggle permission (VIEW = viewer, EDIT = editor), with these exceptions:
    - Try it (`:id/test`, `:id/test/stream`) and `:id/restore` are viewer, as their services allow (restore checks owner inside);
    - `:id/archive`, `PUT :id/members` and `:id/checkup/suites` are owner.
- **Create:** anyone with WHATSAPP_BOT; the creator becomes owner. That was already true on both paths, onboarding and plain create.
- **Last owner:** `setMembers` refuses a team with no owner. The home team list (add, edit role, remove) goes through it, so both paths are covered.
- **Team add-by-email is unchanged:** an owner adds someone in their own organisation; a platform admin can add any Ally user by email. That limits who can be added, not who can see a bot.
- **Links:** the lead-alert email and the builder's capability routes point at `/assistants`.

**Backfill:** `npm run backfill:chatbot-owners -- --dry-run`, then `npm run backfill:chatbot-owners` (`database/scripts/backfill-chatbot-owners.ts`, logic in `chatbot/access/backfill-owners.ts`).
- It gives each bot with no owner its `created_by` as owner, upserting so an existing viewer or editor row becomes owner.
- It lists bots whose creator is missing or no longer a user, and exits 2 while any remain.
- Locally: the dry run and the real run both found 0 to change. All 117 local bots already have an owner.

## 2. Settings only platform admins could change, moved to owners

| Setting | Before | Now |
|---|---|---|
| `showTyping` (bot settings) | platform admin | **owner** (`PUT :id/settings`) |
| `abilities`, incl. `hand_over` (bot settings) | platform admin | **owner**. In the web: a switch in **Tools → Hand over** (`HandOverAbility.tsx`), read-only for editors and viewers |
| Checkup suites (`:id/checkup/suites`) | platform admin + editor | **owner** |
| Eval and multi-attempt checkup runs | platform admin | **owner** |
| Engine and Settings panels in the ··· menu (web) | platform admins (`canCreate`) | **owners** |
| `knowledgeSource = ORGANISATION` | platform admin | **unchanged**: platform admin, and now a member too. It reaches every organisation's targeted documents, so it can't move safely to an owner. Open question 1 |

## 3. Not logged in: login, never sign-up

- **Sending people to login:** `PrivateLayout`, `DefaultRedirect` and the 401 logout (`baseApi`) send someone who isn't logged in to `/login?next=<path+query>`.
- **Coming back:** Login (OTP and Google), the magic link and `PublicRoute` go back to `next`, if it's safe (`utils/loginRedirect.ts`): it must start with `/`, not `//` or `/\`, have no control characters, and not be login itself. Anything else goes through `/` as before.
- **No sign-up:** there's no sign-up link. `/signup` and `/sign-up` redirect to `/login`. ally-be has no register route (a test walks every controller for one), and OTP login refuses an unknown email.
- **Fixed on the way:** after logging in, Login navigated from an already-unmounted page and sent people back to `/` from wherever `PublicRoute` had taken them. That is likely the "white page at `/` after login" in `DefaultRedirect`'s comment (reported 10 Nov). Login now navigates only while it's on screen.
- **No access:** a 404 or 403 on an assistant shows "You don't have access to this assistant. Ask its owner to add you." with "Go to your assistants" (`pages/AssistantHome/NoAccess.tsx`).
- **Unchanged:** the bot page and the bubble (their own access).

## 4. Assistants out of Ally admin; custom logins

**The assistants area is `/assistants`** (`ROUTES.WHATSAPP_BOT`, `CHATBOT_DETAIL`, `CHATBOT_NEW*`).
- It sits in the normal admin layout, with the Sidebar. (A1 first gave it a slim `AssistantsHeader` and no navigation; that was dropped after A1.) The assistant switcher stays in each assistant's own header, beside its name.
- `/chatbots`, `/chatbots/*`, `/whatsapp-bot` and `/inbox` redirect, keeping the sub-path, query and hash.
- Internal links moved: MemoryPanel, StepFrame and the email link in ally-be. Others use the route constants.

**Assistants is a Sidebar item** for anyone with Chatbots. A login whose only feature is Chatbots (`isChatbotsOnly` in `utils/navigation.ts`) sees just that one item.

**Custom logins** (Ally admin → Users → Ally admins):
- **Create a custom login:** name, email, organisation, and "What can they use?", every toggle in the registry with Chatbots first and ticked. Saving runs the existing routes in order:
  1. `POST /v1/users`, role `EVALUATOR`, the least the route accepts (one permission);
  2. `POST /v1/platform-admins`;
  3. `PATCH /v1/users/:id/feature-toggles`, with **every** key set to exactly what was ticked. Default-on keys such as Users are switched off explicitly.

  A failed step says which step failed and what's left to do.
- **Edit what they can use:** on every row of Ally admins, the same checklist, prefilled.
- **Who can do it:** the screen is inside Ally admins, which needs `admin_user_management`. On the server, `POST /v1/users` needs the USERS toggle, and `PATCH …/feature-toggles` and `/v1/platform-admins` need `admin_user_management`. None of them has an organisation-wide or org-admin way in, and toggle rows are only ever given to platform admins. A test checks this.
- **Landing:** `DefaultRedirect` sends a login whose only feature is Chatbots, or whose nav is empty but who holds Chatbots, to `/assistants`.

**⚠ Open item: custom logins are platform admins.** Give them only to trusted people until these routes are closed; that is needed before self-serve customers. The walk (`chatbot/access/test/custom-login.spec.ts`) runs every controller through the real `FeatureToggleGuard` as a Chatbots-only custom login. It reaches all 171 assistant routes, and every other toggle-gated route refuses it. It can still reach:
- **12 Ally-wide WhatsApp routes** (snapshotted):
  - `GET v1/connectors/types`;
  - `GET/PUT v1/whatsapp/settings`, `…/provider-health`, `…/provider-check`, `…/provider-register` and `…/provider-subscribe`;
  - the five `v1/whatsapp/phone-mappings` routes.

  These check only the toggle. Most of the settings, and the provider registration, are Ally-wide.
- **11 routes an organisation preference opens:** `v1/scenario-characters/*`, if its organisation has the Character Library switched on.
- **585 routes with no feature toggle**, gated only by role permissions, which the platform-admin role holds almost all of. It's an upper bound: some also check roles. The biggest areas:
  - `v1/learn` (88), `v1/bug-hunter` (44), `v1/chats` (33), `learn/scenarios` (33), `v1/guide` (26);
  - `v1/users` (16), `v1/settings` (13), `v1/debriefs` (11), `v1/super-duper-admins` (8), `v1/analytics` (7).

  Closing these needs a scoped role or an allowlist on these routes: Shehbaz's call.

The screens follow the toggles, so the UI shows only Chatbots. A custom login with Ally admin pages ticked sees the Sidebar with those pages.

**Existing users keep their access.** Nothing changes for anyone until an admin edits them.

## 5. The WhatsApp number system

`WA-NUMBERS-REPORT.md` covers what it stores, who reads it (every inbound message), what breaks without it, the production SQL to run, and a three-step deprecation plan. Nothing is hidden or removed.

## Code map

- **ally-be:**
  - `chatbot/access/`: `chatbot-role.decorator.ts`, `chatbot-member.guard.ts`, `backfill-owners.ts`, and tests `assistant-route-walk.spec.ts`, `custom-login.spec.ts`, `backfill-owners.spec.ts`;
  - `chatbot/service/chatbot-access.service.ts`;
  - `database/scripts/backfill-chatbot-owners.ts`;
  - `chatbot/service/test/settings-moved-to-owners.spec.ts`.
- **ally-web** (`apps/ally-admin-dashboard/src`):
  - `routes/{PrivateLayout,PublicRoute,DefaultRedirect,RouteLayout}.tsx`;
  - `utils/loginRedirect.ts`;
  - `pages/AssistantHome/{NoAccess.tsx,userLists/HandOverAbility.tsx}`;
  - `pages/SuperAdmins/CustomLoginPanel.tsx`;
  - `e2e/assistantsAccess.e2e.ts`.

## How to test

- **ally-be:** `npx jest src/chatbot src/bot-draft src/whatsapp`. Full suite: 1,146 suites and 17,019 tests passed. `npm run typecheck`. `npm run lint` shows 2 Prettier errors in debrief files, already on master and not touched here.
- **ally-web, under Node 22** (`.nvmrc`): `npx nx test ally-admin-dashboard`, 615 files and 10,406 tests.
  - Under Node 24, 8 API test files (106 tests) fail on master too. Under Node 22 they pass.
  - `npx tsc --noEmit -p apps/ally-admin-dashboard/tsconfig.app.json`.
- **Playwright at 1440:** `E2E_BASE_URL=http://localhost:8091 npx playwright test -c apps/ally-admin-dashboard/playwright.config.ts assistantsAccess --project=desktop`, with `npx vite --port 8091` running. 5 passed:
  - logged out → login → back to the deep link;
  - `/signup` → login;
  - a Chatbots-only login lands on `/assistants` with Assistants as its one Sidebar item, and Users refuses it;
  - an old `/chatbots/:id?section=` link redirects;
  - no access.
- **Gotcha:** that Vite server also opens its HMR socket on `[::1]:8081`, which hides the Docker admin on `localhost:8081` ("Upgrade Required"). Stop it after the run.
- **By hand:**
  - Log in as a platform admin who isn't on an assistant, and open `/assistants/<its id>`: no access.
  - Add them as viewer: read only.
  - As owner: Tools → Hand over switch.
  - Ally admin → Users → Ally admins → Create a custom login with only Chatbots, then log in as it.

## Open questions

1. **`knowledgeSource = ORGANISATION`** stays "platform admin and member". Should it become an Ally-wide decision per organisation instead?
2. **Custom logins are platform admins** (§4). The routes listed there need a scoped role or an allowlist before self-serve customers get logins.
3. **Platform admins now see only their own assistants.** Support can't open a customer's assistant unless its owner adds them. That's by design, and on the launch checklist.
4. **The Ally-wide WhatsApp settings routes** (`GET/PUT v1/whatsapp/settings`, provider checks) check only the toggle, not platform-admin scope. Splitting per-bot settings from Ally-wide ones, and checking scope on the Ally-wide ones, is a later chunk.

## Mismatches found (code vs brief)

- **There was no sign-up anywhere**, in ally-be or ally-web. Only an unused `signup` mutation and an unused `RegisterDto` exist. The brief's "sign-up route redirects to login" is met with redirects for `/signup` and `/sign-up`.
- **"Platform admins" in the brief is "Ally admins" in the UI.** The WhatsApp Numbers tab sits beside it, not under it.
- **There was no `hand_over` control in the web.** It could only be set through the settings API. It now has one, for owners.
