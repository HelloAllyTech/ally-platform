# Assistants build: notes (stages 1 to 10)

Branch `feat/agents-v2-sb1`, worktree `.wt-sb1-platform`, everything uncommitted. Plan: Assistants Build Plan v5/v6
(scratchpad `assistants-build-plan.html`). Runbook for the real cutover: `ally-be/docs/assistants-cutover-runbook.md`.
Custom domains: `ally-be/docs/custom-domains.md`. Schema: `ally-be/DATA_SCHEMA.md`. Wiki: `helloallytech.github.io/wiki/platform/assistants-*.md`.

Nothing here has run against production or real data. Stage 0 fakes (email, WhatsApp window, DNS, two schedulers) are test doubles only.

## 1. Code map

Paths are under `ally-be/src/` unless prefixed. Migration ids 1986540000000 to 1987600000000 are all additive (expand step).

### Stage 1: foundations (roles, invites, agreement, flags, outbox)
- Migrations: `1986540000000-ChatbotMemberRoleSets` (`chatbot_members.roles text[]`, trigger keeps old `role`), `1986540000100-CreateChatbotInvitesAndAssistantMember` (invites, `ASSISTANT_MEMBER` login role), `1986540000200-CreateResponderAgreements`, `1986600000000-AddCrisisFlagsAndAlertOutbox` (flag columns on `chatbot_conversations`, `alert_outbox`).
- `chatbot/access/chatbot-roles.ts` (role set, dual-write), `chatbot-member.guard.ts`, `chatbot-role.decorator.ts`, `backfill-owners.ts`, `staff-access-matrix.ts`.
- `chatbot/members/`: `chatbot-members.service.ts`, `chatbot-invites.service.ts`, `chatbot-team.controller.ts`, `responder-agreement.service.ts`, `members.copy.ts`.
- `chatbot/entity/`: `chatbot-invite`, `responder-agreement`, `chatbot-access-grant`.
- `auth/guards/staff-only.guard.ts`, `auth/decorators/staff-only.decorator.ts` (staff deny guard, kill switch `STAFF_DENY_GUARD_ENABLED`).
- `notification/type/chatbot-invite.{event,template}.ts` (invite email).
- Crisis flags and outbox: `chatbot/safety/crisis-flag.ts`, `alert-outbox.service.ts`, `crisis-alert.service.ts` (one-minute job), `crisis-backfill.service.ts`, `switches.ts`.

### Stage 2: structure (builder home, six sections)
- ally-web admin `src/pages/BuilderHome/` (Create and Open home, `CreateGate.tsx`, `blank.ts`, `copy.ts`), `src/pages/AssistantHome/` (six sections: `sections/Build`, `HowItsDoing`, `Knowledge*`, `Channels`, `Team`, `Settings`, plus `WhoMayChat`, `StaffAccess`, `LinkQr`, `CustomDomain`, `WidgetSites`, `BudgetLimits`), `copy/{structure,overview,people,channels,safetyPrivacy}.ts`, `access.ts`, `ui/`.
- `src/pages/ChatbotSupport/` is the staff route `/admin/chatbot-support` (Defaults, Library, Connectors moved here behind the staff permission).
- Routes: `src/routes/RouteLayout.tsx`. Old `?section=` links redirect.

### Stage 3: Create and Build screen
- Migration `1986800000000-WorkingCopyBlankChatbotsTemplates` (`bot_drafts` becomes the working copy, `live_at`, untouched flag, template id/version).
- `bot-draft/working-copy/`: `working-copy.service.ts`, `staged-fields.ts`, `safety-apply-check.ts`, `judged-safety-apply-check.ts`, `credits-gate.ts`; controller `bot-draft/controller/working-copy.controller.ts`, `draft-tools.controller.ts`.
- `bot-draft/blank/blank-chatbot.service.ts` (idempotent blank, cap 3, 24h cleanup), `bot-draft/templates/library-template.service.ts` + `library-templates.ts` + `knowledge-base/constants/template-knowledge.ts`, `bot-draft/copilot/copilot.service.ts`, `bot-draft/service/{bot-draft-preview,bot-draft-likely,draft-change,starter-bot}.ts`.
- ally-ai: `app/core/agent_runtime/instructions_judge.py` plus prompt `app/prompts/agent/instructions_judge.txt` (the model judge for the instruction check).
- Web: `src/components/v2/SplitBuild.tsx`, `src/pages/Onboarding/create/` (`BuildScreen`, `ChatbotBuild`, `Copilot`, `DirectForm`, `GoLive`, `PendingBar`, `Sources`, `StartPanel`, `TemplateCatalog`, `fieldQueue.ts`, `useWorkingCopy.ts`), `Onboarding/{DraftTestPane,FixThis,LikelyQuestions,fixPatches,betterItems}`. Deleted: `pages/WhatsAppBot/WhatsAppBot.tsx`, `FirstAssistantOverlay.tsx`. <!-- docs-path-lint: ignore -->

### Stage 4: safety core
- Migration `1987000000000-CreateChatbotSafetyState`.
- `chatbot/safety/`: `go-live-gate.{ts,service.ts}`, `go-live.controller.ts`, `go-live-backfill.service.ts` (D10), `crisis-copy.ts` (R6 link-only default), `chat-notice.ts`, `off-message.ts`, `safety-settings.ts`, `safety-state.service.ts`, `safety-terms.ts`, `crisis-suite/` (multilingual cases, `crisis-cases.json`), `bot-draft/checkup/crisis-suite.{controller,service}.ts`.
- `chatbot/engine/blocked-notice.ts`, `conflict-reply.ts`; `billing/service/blocked-crisis.service.ts` (R1 keyword check ahead of the gate).
- Web: `pages/AssistantHome/safety/`, `agreement/ResponderAgreement.tsx`.

### Stage 5: customer data, knowledge, sharing
- Migration `1986900000000-AssistantsCustomerDataKnowledgeSharing`.
- `chatbot/privacy/`: `assistant-retention.service.ts`, `customer-erasure.service.ts`, `chat-privacy.service.ts`, `memory-consent.service.ts`, `erase-intent.ts`, `erase-copy.ts`, `memory-consent-copy.ts`, `stage5-migration.ts`.
- `knowledge-base/privacy/{knowledge-review.service.ts,pii-scan.ts}`, `chatbot/knowledge/{answer-conflict,knowledge-freshness,no-answer-reply}`, `chatbot/languages/`, `chatbot/quick-replies/quick-reply-copy.service.ts`, `chatbot/sharing/` (copy, curated pool, `staff-assistants.controller.ts`), `chatbot/dto/customer-data.dto.ts`.
- Scripts: `database/scripts/assistants-stage5-migrate.ts`, `assistants-retention-report.ts`.
- Web: `api/knowledgePrivacy.ts`, `sections/KnowledgeTools.tsx`, `pages/WhatsAppBot/AssistantDefaults.tsx`.

### Stage 6: credits and access
- Migration `1986700000000-CreateCreditsLedger` (`billing_accounts`, `credit_grants`, `chatbot_budgets`, `credit_reservations`, `credit_warnings`, `end_persons`, `end_person_spend`, five nullable columns on `usage_events`).
- `billing/`: `constants/credits.constants.ts`, `service/{ledger,credits-state,credits-cutover,credit-warning,end-person,limits}.service.ts`, `util/credit-periods.ts`, controllers `my-credits`, `credits-admin`, `dto/credits.dto.ts`.
- Engine enforcement: `chatbot/engine/*`. Access list and sign-in: `chatbot/entity/chatbot-access-grant.entity.ts`, bot-page OTP in `chatbot/bot-page/bot-page-otp.service.ts`.
- Web: `pages/Credits/` (`MyCredits`, `StaffCredits`), `sections/BudgetLimits.tsx`, `sections/WhoMayChat.tsx`, `api/credits.ts`, `api/accessList.ts`, `botPage/blocked.ts`.

### Stage 7: channels and analytics
- Migrations `1987200000000-AddOverviewDailyStats`, `1987600000000-BotPageChannelsStage7` (`chatbot_pages.public_id`, `widget_sites`, `chatbot_domains`).
- `chatbot/bot-page/`: `bot-page-domain.{controller,service}.ts`, `widget-sites.service.ts`, `widget-host.ts`; `bot-draft/scorecard/overview-suppression.ts` (groups under five hidden, D8).
- Web: `sections/{Channels,LinkQr,CustomDomain,WidgetSites}.tsx`, `botPage/route.ts`, `api/channels.ts`. Doc: `ally-be/docs/custom-domains.md`.

### Stage 8: staff read-only view
- Migration `1987100000000-CreateChatbotStaffAccess`.
- `chatbot/staff/chatbot-staff-access.{controller,service}.ts`, `chatbot/entity/chatbot-staff-view.entity.ts`; web `pages/ChatbotSupport/`, `sections/StaffAccess.tsx`.

### Stage 9: safety pack releases
- Migration `1987500000000-CreateSafetyPackReleases`.
- `bot-draft/safety-pack/{live-packs.ts,safety-packs.ts}`, `safety-pack/releases/{release-content.ts,safety-pack-release.service.ts,safety-pack-release.controller.ts}`; web `pages/SafetyPacks/`; permission `manage:safety-packs`.

### Stage 10: cutover
- `ally-be/docs/assistants-cutover-runbook.md`, `database/scripts/assistants-cutover-dry-run.{ts,lib.ts}`, `chatbot/safety/assistants-monitoring.service.ts`, `billing/service/credits-cutover.service.ts`.

## 2. Decisions (summary)

D1 credits: builders start at $0, staff grant, all AI spend under the builder comes out of it; budgets per chatbot set aside from free balance; per-user day/week/month limits. D2 seats retired. D3 blocked means no model call (amended by R1, R2). D4 invite-only access by phone or email; everyone signs in; unlisted people see the crisis notice plus "by invitation" without leaking the list. D5 curated crisis text for a short language list. D6 quick replies copied per chatbot, crisis/STOP/START locked, staff push. D7 existing memory deleted at cutover. D8 groups under five hidden in breakdowns. D9 one invitee role, in the inviter's tenant, platform admins not invitable. D10 go-live gate on every path; live chatbots unpublished until completed. D11 retention 90 days, snapshot before first sweep. D12 one-minute scheduler tick. D13 safety-pack releases last. D14 crisis flag fields first.

R1 free keyword crisis check stays ahead of the credit and access gate, classifier does not run on blocked turns. R2 building and testing never touch set-aside budgets. R3 after go-live, edits reach customers only on Apply (staged: answer-shaping fields; immediate: access list, people, budgets, status). R4 Ally pays to index template knowledge. R5 erase in chat removes conversations, memory, contact data; person stays on the list. R6 default crisis info is the findahelpline.com link only, builder numbers first, no India-only defaults. R7 every access list starts empty at cutover. R8 fixed holding message at crisis flag time, in the person's language, inside the WhatsApp window.

Section 3 design rules (short): working copy plus live config (test never writes the live row); one version per field with conflicts keeping typed text; ledger = reservation before each call, atomic conditional update, nightly rebuild, pessimistic price for unpriced models, feed outage blocks spend; payer is an account row, missing payer counts as blocked; one end-person record links phone and email, periods in the chatbot time zone (default Asia/Kolkata); three separately named blocked states, STOP wins, one fixed notice per 24h per number; unlisted web visitors see crisis info before any code and enumeration is blocked; E.164 numbers, under ten digits rejected; sign-in code caps; alerts through an outbox with retry, staff Slack as second channel; roles dual-write until a contract release; expand-contract releases, backend before dashboard, kill switch per risky feature; background AI jobs pause at zero credits and resume on grant.

## 3. How to test locally

1. Stack: `bash ./start-local.sh` from the workspace root (do not run `infra/dev_env.sh`, never stop Colima, never `docker system prune`). Ports: ally-be 8001 (`/api/health`), ally-ai 3001, ally-ai-learn 8002, admin 8081, helpline 8080, postgres 5477, redis 6379, localstack 4566. ally-be takes ~150s to healthy.
2. Test account: `org-admin@example.com`, OTP `1234`. Enable the `whatsapp_bot` row in `admin_feature_toggles` for that user, then delete the cached Redis key `<prefix>:admin:feature-toggles:v2:<userId>` (the older `...:<userId>` pattern misses it).
3. KB ingest queues (localstack has none by default): `docker exec localstack awslocal sqs create-queue --queue-name sqs-kb-ingest-queue` and `... sqs-kb-ingest-dlq`, then set `SQS_KB_INGEST_QUEUE_URL` for the backend you run. Without it crawled pages save but never index.
4. Run this worktree's backend natively (the main checkout and docker app belong to others): copy `ally-be/.env`, `npm run build`, then `PORT=8023 AI_SERVICE_API_URL=http://localhost:3001 AI_LEARN_SERVICE_API_URL=http://localhost:8002 node dist/main` with every `SQS_*_URL` overridden (five core queues must point at a nonexistent localstack queue URL, Joi refuses blank) so it cannot steal the docker app's messages. It runs `PromptsSyncService` at boot against the shared DB and overwrites default prompts: diff `ally-be/src/prompts` first. Stop it with `lsof -tiTCP:8023 -sTCP:LISTEN | xargs kill`, never `pkill -f "node dist/main"`.
5. Migrations: `npm run migration:run` from `ally-be` against local postgres :5477 only. The docker app builds from `dist`; see memory note `ally-be-local-verify-workflow` for the build/restart gotcha. Check `ls src/database/migrations | grep -E '^198(65|66|67|68|69|70|71|72|75|76)'`.
6. Frontend: from `ally-web`, `VITE_API_BASE_URL=http://localhost:8023 NX_NO_CLOUD=true NX_DAEMON=false` with vite on :8085 for the admin app. Use `127.0.0.1:8085` if `[::1]:8081` reload loops (memory note on HMR).
7. Demo credits (units are micros, 1 USD = 1,000,000). Credit enforcement defaults on locally, so a new builder at $0 is blocked. Take `<USER_ID>` from `users`:
```sql
INSERT INTO billing_accounts (owner_user_id) VALUES (<USER_ID>) ON CONFLICT (owner_user_id) DO NOTHING;
INSERT INTO credit_grants (account_id, amount_micros, kind, note, idempotency_key)
  SELECT id, 20000000, 'grant', 'local demo', 'demo:<USER_ID>' FROM billing_accounts WHERE owner_user_id = <USER_ID>;
UPDATE billing_accounts SET granted_micros = granted_micros + 20000000 WHERE owner_user_id = <USER_ID>;
```
Prefer the staff endpoint `POST /v1/admin/billing/credits/grants` when a staff token is available (it keeps the invariants).
8. Kill switches (env, accept `false`/`0`/`off`): `ASSISTANT_ALERT_SENDING_ENABLED`, `ASSISTANT_CRISIS_JOB_ENABLED`, `ASSISTANT_CRISIS_BACKFILL_ENABLED`, `ASSISTANT_CRISIS_BACKFILL_DRY_RUN` (true = no writes), `ASSISTANT_RETENTION_SWEEP_ENABLED`, `ASSISTANT_MEMORY_CUTOVER_ENABLED`, `ASSISTANT_UNPUBLISH_BACKFILL_ENABLED`, `ASSISTANT_GO_LIVE_GATE_ENABLED`, `ASSISTANT_KNOWLEDGE_PII_REVIEW_ENABLED`, `ASSISTANT_GLOBAL_QUICK_REPLY_FALLBACK` (true = old global replies), `STAFF_DENY_GUARD_ENABLED`, `RESPONDER_AGREEMENT_ENFORCED`, `ASSISTANT_STAFF_VIEW_ENABLED`, `ASSISTANT_PACK_RELEASES_ENABLED`, `ASSISTANT_MONITOR_ENABLED` and the per-check `ASSISTANT_MONITOR_{LEDGER,OUTBOX,UNTAKEN,COST_RECORDS,UNPRICED,FEED,RETENTION}_ENABLED`. Credits use the `global_settings` row `assistant_credits` (`{"enforcement":true,"warningEmails":true}`), cache 30 seconds. Note: `ASSISTANT_STAFF_VIEW_ENABLED` and `ASSISTANT_PACK_RELEASES_ENABLED` are not yet in the runbook's inventory table (gap, section 5).
9. Smoke path: create a chatbot, pick a template, test, go live (gate), send a keyword crisis message from a blocked chatbot (flag + alert), take over as a responder who accepted the agreement, grant credits, run `assistants-cutover-dry-run.ts` (read only; exit 2 if a step applied something).

Tests: backend `npx jest <path>` from `ally-be` (pg specs need the local DB), frontend `npx vitest run <paths>` from `ally-web`. Docs lint: `python3 scripts/concepts_lint.py`, `node scripts/docs-path-lint.mjs`, `python3 helloallytech.github.io/scripts/wiki_lint.py`, `python3 helloallytech.github.io/scripts/gen-routing.py --check`.

## 4. Open questions and sign-offs (nothing below is decided)

From plan section 7:
- Before stage 4 ships: named approver for crisis copy, personas and all new wording; wording of the R8 holding message (it promises a reply that may not come); minors' sign-in, invitation and consent wording.
- R6: the link-only default has no line telling a person in immediate danger to call local emergency services and depends on an outside site being reachable. The plan recommended adding that line; the build leaves it link-only. Decide.
- Before stage 5: the 12-month keep for flagged conversations, lifetime of the pre-sweep snapshot (runbook placeholder `<DELETE-BY-DATE>`), memory and erase consent wording, legal review for collecting emails and phones of people who may be under 18.
- Before stage 1b ships: the responder agreement text.
- Before stage 6: the reserve number and starting amounts. Placeholders in `billing/constants/credits.constants.ts`: free-balance reserve warning $5.00, starting credits per existing builder $20.00, starting budget per existing live chatbot $2.00.

Additional:
- R8 holding message wording and its per-language translations.
- WhatsApp authentication template per language: needs Meta approval before phone sign-in can ship; not audited.
- SMS provider: none chosen (SMS is outside this plan; phone sign-in needs the chatbot's own WhatsApp number).
- Custom domain TLS and routing: infrastructure outside this repository (Caddy on-demand TLS with `GET /api/v1/public/bot-domains/check`, or CloudFront). Verification alone serves nothing. Also the `/chat/*` proxy rule and a real HTTP 301 for `/b/*`.
- ally-ai language field for replies: how ally-ai receives and honours the enabled-languages / reply-language field is not confirmed end to end.
- Responder agreement release order: `RESPONDER_AGREEMENT_ENFORCED` defaults on; release backend with it off, release the dashboard, verify, then remove the override (runbook section 2).
- Frontend release tag name: the runbook says `frontend-v<x.y.z>` (workflow `production-release-frontends.yaml`); workspace CLAUDE.md still says `admin-v*`/`helpline-v*`. Check the workflow file on the day.
- Owners to name in the runbook: `<OWNER-RELEASE>`, `-COMMS`, `-DB`, `-BILLING`, `-DATA`, `-QA`, `-ONCALL`, and `<DATE>`, `<N>` weeks before contract steps.
- Copy marked `COPY: needs approval` (grep `COPY: needs approval`; every line below needs a named approver):
  - ally-be: `billing/service/{credit-warning,ledger,limits}.service.ts`; `bot-draft/copilot/copilot.service.ts`, `bot-draft/home/home-fields.ts`, `bot-draft/safety-pack/{releases/release-content.ts,safety-packs.ts}`, `bot-draft/service/bot-draft-preview.service.ts`, `bot-draft/templates/{library-template.service.ts,library-templates.ts}`, `bot-draft/working-copy/{credits-gate.ts,judged-safety-apply-check.ts}`; `chatbot/engine/{blocked-notice,conflict-reply}.ts`, `chatbot/knowledge/{answer-conflict.service.ts,no-answer-reply.ts}`, `chatbot/members/{members.copy.ts,responder-agreement.service.ts}`, `chatbot/privacy/{chat-privacy.service.ts,erase-copy.ts,memory-consent-copy.ts}`, `chatbot/quick-replies/quick-reply-copy.service.ts`, `chatbot/safety/{chat-notice,crisis-copy,go-live-gate,go-live.controller,off-message,safety-terms}.ts`, `chatbot/safety/crisis-suite/crisis-cases.json`, `chatbot/service/chatbot.service.ts`, `chatbot/staff/chatbot-staff-access.service.ts`; `knowledge-base/privacy/knowledge-review.service.ts`, `knowledge-base/service/kb-ingest.service.ts`; `notification/type/chatbot-invite.template.ts`.
  - ally-web admin: `botPage/copy/{en,hi}.ts`, `constants/en.ts`, `pages/AssistantHome/copy/{channels,overview,people,safetyPrivacy,structure}.ts`, `pages/AssistantHome/sections/QuickReplies.tsx`, `pages/BuilderHome/copy.ts`, `pages/ChatbotSupport/copy.ts`, `pages/Credits/{MyCredits.tsx,copy.ts}`, `pages/Onboarding/{create/copy.ts,personaScripts.ts}`, `pages/SafetyPacks/copy.ts`.

## 5. Known gaps

- Not run for real: the cutover runbook (rehearse on a copy of real data), the full backend/frontend/Playwright/accessibility suites as one run, screenshots at 1440x900, 1280x720 and phone width.
- Runbook kill-switch table omits `ASSISTANT_STAFF_VIEW_ENABLED` and `ASSISTANT_PACK_RELEASES_ENABLED`.
- The local stack cannot run onboarding end to end by default (no KB ingest queue; ally-ai image built 2026-10-06 returns 404 on `api/v1/agent/run`). Rebuilding ally-ai needs a decision.
- Voice agent cost reporting and per-language WhatsApp authentication templates were flagged "not audited" in the plan.
- Public access mode (anonymous per-user limits) is not designed; self sign-up, SMS/voice, buying credits are out of scope.
- Hiding groups under five still allows differencing against the overall total (accepted).
- Contract steps (drop `chatbot_members.role`, seat/plan tables, old limit replies, `safety_at`) wait for a later release; no migration here drops anything.
- Mobile app has no assistants code and is untouched.
- Nothing committed; the main checkout was never touched. Docs lint runs are listed in the wiki log entry for this build.
