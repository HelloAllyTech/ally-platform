# Chunk A1 — Owners only, login only, and assistants out of Ally admin

> Brief for Claude Code. Read `CONTEXT.md`, `EPIC-A1-SP1.md`, `CHUNK-20D-NOTES.md` (the assistant home), `CHUNK-12B-NOTES.md` (the bot page's own access), `CHUNK-11A-NOTES.md` (Inbox roles), then this file. <!-- docs-path-lint: planned -->
> Branch: `feat/agents-v2-sprint-1`, first chunk, then SP1 in the same session. Tag commits `[A1]`. Repos: ally-be, ally-web.
> **Four items from Sandeep (16 Nov),** decided with Shehbaz. **Fast mode:** finish tonight. Plan briefly in your first message and go on without waiting; no stops in A1. About 6 hours.

## The four items

1. Every assistant has owners; only owners (and the team they invite) can view or manage it.
2. Ally admin → Users → Platform admins → the WhatsApp number system: understand it, and plan its deprecation.
3. Someone not logged in who reaches an assistant sees the login screen, with no sign-up option.
4. Chatbots come out of Ally admin's navigation, and Ally admin can create logins that only have access to chatbots.

## Revised (Shehbaz, 16 Nov 18:20): Custom logins, on the existing toggles

**No new table, no new access field, no new guard.** Who can use assistants stays the existing `WHATSAPP_BOT` feature toggle, and the toggles' logic doesn't change.
- **Custom logins (frontend):** a new screen in Ally admin → Users, **"Create a custom login"**: name, email, and a checklist of features ("What can they use?": Chatbots, and each other feature). Saving creates the user through the existing create-user route and sets the existing per-user toggles to exactly what was ticked. A chatbots-only login is one with only Chatbots ticked.
- **Only super admins** ("superduper" users, the highest existing admin role) see this screen. **The routes it calls must already refuse anyone else on the server;** if they don't, add that check (the one backend change allowed here). A hidden button isn't security.
- **Existing users don't change;** new users made the normal way keep today's defaults.
- **After login,** a user whose only feature is WhatsApp bot lands on Your assistants.
- **If per-user toggles don't exist today,** stop and tell Shehbaz before building anything for this.
- §1 (members only, no platform-admin bypass, 404, last owner, settings to owners), §2, §3 and the navigation in §4 are unchanged.

## 1. Every assistant has owners; only its people see it

**Decided:**
- **Roles stay, invite-only.** Owner, editor and viewer stay, but nobody sees an assistant unless they've been added to it. Only owners manage it and its team.
- **No view of all assistants, anywhere.** Ally's platform admins are like any owner here: they see and create assistants for themselves only.

**Build:**
- **On create** (onboarding and any other path), the creator becomes the owner.
- **Backfill:** existing assistants with no owner get their creator as owner. A script with a dry run; it lists any assistant with no creator for Shehbaz to assign.
- **Every assistant route in ally-be** (list, home, Tools and lists, memory, Inbox, checkups, Try it, bot page settings, share, change by chat, analytics) allows only members, by role:
  - **owner:** everything, including the team and deleting the assistant;
  - **editor:** change content and settings, answer in the Inbox; not the team;
  - **viewer:** read only.
- **Remove any wider rule** that shows an assistant to a whole organisation, a tenant or a platform admin, and any screen or route that lists every assistant. A non-member gets **404**, so an assistant's existence isn't revealed.
- **The last owner** can't be removed or demoted.
- **Settings only platform admins could change** (`hand_over` in a bot's `abilities`, and anything else you find) move to the assistant's owners, in Tools. List each in the notes; one that can't safely move becomes a platform-wide setting instead.
- **Untouched:** the public bot page and the bubble (their own access), WhatsApp, the agent and its gateway.
- **The test that matters most:** walk every assistant route, generated from the controllers so a new route can't be missed, as a non-member (404), a viewer, an editor, an owner, and a platform admin who isn't a member (404).

## 2. The WhatsApp number system under Platform admins

- **Understand it:** what it stores, which screens and routes use it, whether WhatsApp inbound, consent, recognised users, the platform number or the agent reads it, and what would break without it. Include the SQL for Shehbaz to count its rows and recent use in production (don't run it).
- **Write `docs/agents-v2/WA-NUMBERS-REPORT.md`** with the findings and a deprecation plan (hide and stop writes; replace what still reads it; drop it).
- **Don't hide or remove anything in A1.** Shehbaz decides from the report.

## 3. Not logged in: login, never sign-up

- **Anyone not logged in** who opens any assistants link (the list, a deep link like `…/assistants/:id?section=tools`, Try it) lands on the **login screen**, then goes back to that link after logging in.
- **No sign-up:** no "Sign up" link on that screen, and the app's sign-up route redirects to login.
- **Logged in without access:** "You don't have access to this assistant. Ask its owner to add you." with a link to their assistants.
- **The bot page and bubble don't change:** public pages stay public; private ones keep their email code.

## 4. Chatbots out of Ally admin; chatbots-only logins

- **Remove Chatbots from Ally admin's navigation.**
- **Ally admin → Users:** creating or editing a user offers **Access: Chatbots only**. Such a user:
  - lands on their assistants after login, in a space with **no Ally admin navigation**: a slim header with Your assistants, the assistant switcher and an account menu (profile, sign out);
  - is refused, server-side, by every route outside the assistants area and their account (a test walks Ally admin's routes as this user);
  - can create assistants (becoming the owner) and be added to others' teams;
  - is invited the usual way (email, set a password), then logs in on the screen from §3.
- **Users who also have Ally admin access** reach their own assistants from the account menu ("Your assistants"), in the same slim space.
- **The assistants area has its own path** (for example `/assistants`); old chatbot links redirect, deep links and sections included. Check Ally admin's other pages for links into chatbots and point them at the new path.
- **Existing users keep their access** until an admin sets Chatbots only.

## Not in A1

Share by mobile number (dropped for now). Hiding the WhatsApp number system (after the report). An ownership-transfer screen. Playwright at 390 px and axe (R2).

## Tests (fast mode)

- **ally-be:** the route walk in §1; the backfill dry run and real run; the last owner; the settings moved to owners; the sign-up route; Ally admin's routes refused for a chatbots-only user.
- **ally-web:** no Chatbots in Ally admin's nav; the slim assistants space; old links redirect; login without sign-up and back to the deep link; "no access"; the access choice in Users.
- **One Playwright smoke run at 1440:** logged out → login → back to a deep link; a chatbots-only user sees nothing else.
- Lint and typecheck; the suites you touched, with the commit hook (never `--no-verify`).

## Done when

- [ ] Every assistant has an owner; a non-member, platform admins included, gets 404 on every route; no list of all assistants anywhere
- [ ] Admin-only settings moved to owners
- [ ] `WA-NUMBERS-REPORT.md` written
- [ ] Logged out → login (no sign-up) → back where they were
- [ ] No Chatbots in Ally admin's nav; chatbots-only logins with nothing else; old links redirect
- [ ] `CHUNK-A1-NOTES.md`; the Progress row; `LAUNCH-CHECKLIST.md` lines (run the backfill; assign unowned assistants; support needs the owner to add you) <!-- docs-path-lint: planned -->