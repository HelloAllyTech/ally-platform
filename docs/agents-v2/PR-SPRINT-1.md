# Sprint 1: A1 (owners only, login only) and SP1 (clean declines)

Branch `feat/agents-v2-sprint-1` → `master`. Briefs: `EPIC-A1-SP1.md`, `chunk-a1.md`, `chunk-sp1.md`. Full notes: `CHUNK-A1-NOTES.md`, `CHUNK-SP1-NOTES.md`. No database migrations. Repos: ally-be, ally-web, ally-ai.

## A1: assistants belong to their team

### What changed
- **Member-only access (ally-be).** An assistant is reached only by the people on its team (`chatbot_members`: owner, editor, viewer). The platform-admin bypass is gone: a platform admin who isn't on the team gets 404, like anyone else.
  - Every per-assistant route carries `@ChatbotRole(VIEWER|EDITOR|OWNER)` with `ChatbotMemberGuard`. Routes without an assistant id carry `@AssistantScope`.
  - A test built from the controllers walks every route as a non-member, viewer, editor, owner and non-member platform admin (`test/assistant-route-walk.spec.ts`).
- **Settings moved to owners:** Show typing, abilities (hand-over included, now a switch in Tools → Hand over), checkup suites and eval runs. "Answer from the organisation's knowledge" stays platform-admin only, because it reads a whole organisation's library.
- **Creating an assistant** needs the Chatbots feature (`WHATSAPP_BOT`). The creator becomes its owner.
- **Login only (ally-web).**
  - Logged out, any page goes to `/login?next=<the page>`, then back there after login. This covers the admin shell, `PrivateLayout`, the 401 logout, OTP, Google and the magic link.
  - There's no sign-up: `/signup` and `/sign-up` go to login.
  - Someone without access sees "You don't have access to this assistant. Ask its owner to add you."
- **Assistants live at `/assistants`,** as a Sidebar item for anyone with Chatbots. Old `/chatbots`, `/chatbots/*`, `/whatsapp-bot` and `/inbox` links redirect, keeping the path, query and hash. (A1 first gave assistants a slim header with no Sidebar; that was dropped later on this branch, in `62ae62167`.)
- **Custom logins** (Ally admin → Users → Ally admins, super admins only): name, email and "What can they use?". Saving creates the user, makes them a platform admin, and sets every feature toggle to exactly what was ticked. A Chatbots-only login sees only Assistants and lands there.
- **The WhatsApp number system** is documented, not changed: `WA-NUMBERS-REPORT.md` covers what's stored, who reads it, production SQL to size it, and a three-step retirement plan.

### Migrations and scripts
- **No migrations.**
- **New script:** `npm run backfill:chatbot-owners` (with `--dry-run`). It gives every assistant without an owner its creator as owner, and lists any with no creator. It exits 2 while some still need an owner assigned by hand. Locally it had nothing to change (all 117 already had owners).

### What users will notice
- Platform admins only see the assistants they're members of. Support needs the owner to add them first.
- Owners now control typing, abilities, hand-over and checkup suites.
- Deep links survive logging in; there's no sign-up page.
- Assistants is its own Sidebar item; old `/chatbots` links still work.

## SP1: safety packs decline cleanly

### What changed
- **Pack lines (ally-be, `safety-packs.ts`).**
  - Medical and pharmacy: a short decline that names their doctor or pharmacist, gives one urgent line, and adds nothing else in any language. The bot's helpline and a booking offer are added only when the bot has them.
  - Minors: no details taken and no sign-up continued; a parent or guardian contacts the team, and the young person's name or contact is never used.
  - Mental health: no joking about anyone's therapist, care or feelings.
  - These four packs go from version 1 to 2. Standard, legal and financial, and bots with no pack are byte-identical (tested).
- **No prompt, judge or ally-ai code changed for SP1.**

### Results
- All 11 safety questions on the four assistants held at publish pass first time.
- Probes, 2 per pack with one in Hinglish:
  - pharmacy, mental health and medical: all pass;
  - minors: 8 of 10 attempts. The slip is using a name from an email and offering batch information to the parent.
- **The onboarding eval is 8 of 13, so "13 of 13" is not met.** Every remaining fail is outside the packs (out-of-scope declines judged as invented facts, pharmacy's prices question, a builder error, the live site). The launch-checklist line holding these businesses at publish stays.

### What users will notice
Clinic, pharmacy and coaching assistants turn down medical, dose and under-18 questions in one or two plain sentences, instead of a symptom list or a list of services.

## Also on this branch
- **How it works no longer shows Ally's own instructions.** Ally's layers are plain summaries; the owner's own parts keep "Show exact text". The text stays on the server. The page now lists what the assistant can do with each list ("Leads: look up, add and change entries.").
- **Lists fixes:** a choice typed but not added is kept on Next or Save. Make it yours keeps your choices after Back.
- **Bot page code screen** says who gets a code without revealing whether this email does.
- **One line in `ally_ai_agent_lists`** (version 4): offer to take details when a price or detail isn't known. It helps only sometimes; the real fix is chunk 6b items 29 and 30.
- **ally-be ESLint** parses `scripts/**/*.ts` without type information, so the pre-commit hook passes on scripts.

**Merging master** (`5fb03fe82`): master's AdminShell (#275) now wraps every route. Under it, A1's deep-link login, `/chatbots` redirects, sign-up redirects and the "Assistants" name are kept; details are in the merge commit.

## After merge
1. **Owner backfill**, in each environment:
   ```
   npm run backfill:chatbot-owners -- --dry-run   # read the list; writes nothing
   npm run backfill:chatbot-owners                # assign
   ```
   If it exits 2, give the listed assistants an owner by hand before telling people.
2. **Tell the team:**
   - Platform admins now only see assistants they're members of. To help with one, ask its owner to add you.
   - **Custom logins are platform admins: give them only to trusted people until these routes are closed (needed before self-serve customers).** A Chatbots-only login can still reach the 12 Ally-wide WhatsApp routes, 11 routes an organisation preference opens, and 586 routes gated only by role permissions (one more than at A1, from master) (`CHUNK-A1-NOTES.md` §4).
3. **Still due for SP1:**
   - the second onboarding eval run;
   - five probes per pack.

   The publish hold on medical, pharmacy and minors stays in `LAUNCH-CHECKLIST.md` until they pass.
4. **Skills Store:** publish `ally_ai_agent_lists` version 4's text in production (`prompts push`, then publish).
