import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Logs the PARENT_COURSE batch of product-roadmap opportunities: what Ally needs to build so a
 * partner organisation can run a public caregiver-support course campaign on the platform.
 *
 * Every description starts with the code `PARENT_COURSE` so the batch can be found with one
 * search in the Product Roadmap. Every opportunity is a configurable platform capability — a
 * global master switch, a per-tenant override (inherit / on / off) and typed sub-configuration —
 * so other organisations and use cases can adopt or ignore each one. That contract is written
 * into each PRD (see `configSection`).
 *
 * Rows are filed as the admin user `sandeep.malhotra@helloally.ai` (createdBy / updatedBy), at
 * stage `new`. The migration is idempotent: a row is inserted only when no live row already has
 * the same description. The repo is public, so the text is partner-neutral by design.
 *
 * Soft-fails on a database without that user (fresh local / CI provisioning runs migrations
 * before seeding users): it logs and does nothing, rather than aborting the whole run.
 *
 * `code` (OPP-nnnn) and `embeddingStatus` come from column defaults; the Weaviate reindex picks
 * the rows up. Hand-written, never `migration:generate`.
 */
export const PARENT_COURSE_CODE = 'PARENT_COURSE';
export const PARENT_COURSE_ADMIN_EMAIL = 'sandeep.malhotra@helloally.ai';
const FALLBACK_GOAL = 'Foundation & Experiments';

type Effort = 's' | 'm' | 'l' | 'xl' | 'xxl';

export type ParentCourseOpportunity = {
  ref: string;
  title: string;
  summary: string;
  goal: string;
  effort: Effort;
  configKey: string;
  subConfig: string[];
  exists: string;
  build: string;
  dependsOn?: string;
};

const configSection = (o: ParentCourseOpportunity): string =>
  [
    '## Configuration',
    'Every setting resolves global default, then tenant override, then (where a tenant runs several campaigns) campaign override. Later wins. With the feature off, behaviour is exactly what it is today.',
    '- Global switch: `' +
      o.configKey +
      '.enabled` — platform-wide master switch; off by default; also acts as the kill switch.',
    '- Tenant override: `inherit | on | off`, set by a platform admin (tenant admins only where the registry marks the feature tenant-adjustable).',
    '- Sub-configuration (typed, validated, each with a default):',
    ...o.subConfig.map((s) => '  - ' + s),
  ].join('\n');

const prdOf = (o: ParentCourseOpportunity): string =>
  [
    '# ' + o.ref + ' · ' + o.title,
    '',
    '## Summary',
    o.summary,
    '',
    configSection(o),
    '',
    '## Exists today',
    o.exists,
    '',
    '## To build',
    o.build,
    ...(o.dependsOn ? ['', '## Depends on', o.dependsOn] : []),
    '',
    '## Acceptance',
    '- The feature can be switched on or off globally and per tenant without a deploy, and every sub-setting above is editable from the admin console.',
    '- A tenant with the feature off sees no change in behaviour or UI.',
    '- Setting changes are audited (who, what, when).',
  ].join('\n');

export const descriptionOf = (o: ParentCourseOpportunity): string =>
  PARENT_COURSE_CODE + ' · ' + o.ref + ' ' + o.title + ' — ' + o.summary;

export const PARENT_COURSE_OPPORTUNITIES: ParentCourseOpportunity[] = [
  {
    ref: 'X1',
    title: 'Layered feature configuration (global, tenant, campaign)',
    summary:
      'A typed settings registry with defaults, validation, per-tenant and per-campaign overrides, an audit trail and an admin screen that renders its own controls, so every feature in this batch is switchable globally and per organisation.',
    goal: 'Foundation & Experiments',
    effort: 'l',
    configKey: 'config',
    subConfig: [
      '`audit.enabled` — record who changed which setting and when',
      '`campaignOverrides.enabled` — allow a third, campaign-level layer',
      '`tenantAdminEditable[]` — which keys a tenant admin may change themselves',
    ],
    exists:
      'Boolean org preferences, tenant settings jsonb, global settings rows and per-admin feature toggles.',
    build:
      'One typed registry that the others register into; override resolution; audit log; admin UI generated from the registry.',
  },
  {
    ref: 'X2',
    title: 'Campaign entity',
    summary:
      'A tenant-scoped campaign that groups a landing page, account cap, credit grant, pricing, tracked links, consent text and dashboard under one id with dates and a status (draft, live, paused, ended).',
    goal: 'Foundation & Experiments',
    effort: 'm',
    configKey: 'campaign',
    subConfig: [
      '`maxConcurrentPerTenant` — how many live campaigns a tenant may run',
      '`autoPauseAtEnd` — pause sign-ups automatically on the end date',
      '`defaultTemplate` — starting configuration copied into a new campaign',
    ],
    exists: 'Nothing; there is no campaign entity.',
    build:
      'Entity, lifecycle and status transitions, binding to the capabilities below, admin UI.',
    dependsOn: 'X1',
  },
  {
    ref: 'A1',
    title: 'Self-serve phone-OTP sign-up and sign-in',
    summary:
      'Let a visitor create and verify an account with a phone number and an SMS code, with no admin provisioning. One verified phone, one account.',
    goal: 'Engagement & Usability',
    effort: 'xl',
    configKey: 'auth.phoneOtp',
    subConfig: [
      '`signupMode` (`closed | allowlist | open`)',
      '`allowedCountryCodes[]`',
      '`otpLength`, `otpTtlSeconds`',
      '`smsProvider`, `smsTemplateByLanguage`',
      '`maxCodesPerWindow`, `maxGuessesPerCode`, `ipRateLimit`',
      '`fallbackChannel` (`none | whatsapp | email`)',
    ],
    exists:
      'Email OTP login with rate limits, Google and Apple sign-in, and a unique but unverified phone column. Auth explicitly has no sign-up endpoint today, and login is gated by an organisation allowlist.',
    build:
      'SMS provider integration, phone verification, a self-serve sign-up route, allowlist bypass for open campaigns, OTP limits keyed by phone.',
    dependsOn: 'X1',
  },
  {
    ref: 'A2',
    title: 'Admission control: account cap, pause switch and waitlist',
    summary:
      'A cap on accounts per tenant or campaign, an instant pause for new sign-ups, and a waitlist that notifies people when capacity is raised.',
    goal: 'Reliability & Trust',
    effort: 'm',
    configKey: 'admission',
    subConfig: [
      '`maxAccounts` (empty means unlimited)',
      '`paused`, `pausedMessageByLanguage`',
      '`waitlist.enabled`, `waitlist.notifyChannel`',
      '`showRemainingPublicly`, `lowCapacityThresholdPct`',
    ],
    exists:
      'Tenant status (active, inactive, suspended) and per-user suspend only.',
    build:
      'Account counters, cap check inside sign-up, pause switch, waitlist and notification on release.',
    dependsOn: 'A1, X2',
  },
  {
    ref: 'B1',
    title: 'Credit wallet and ledger',
    summary:
      'Turn the per-user credit limit and consumed counter into a ledger of grants, purchases, spend, expiry and refunds, with a balance per user and a cost weight per resource.',
    goal: 'Reliability & Trust',
    effort: 'l',
    configKey: 'credits',
    subConfig: [
      '`freeGrantPerAccount`, `grantExpiryDays`',
      '`costWeights` (voice role play per minute, text role play per minute, course module, debrief)',
      '`lowBalanceWarnAt`',
      '`onExhausted` (`block | prompt_topup | allow_overdraft`), `overdraftLimit`',
      '`rolloverPolicy`',
    ],
    exists:
      'A per-user credit limit and consumed counter with atomic consume and admin set and get.',
    build:
      'Ledger table, per-resource weights, expiry, balance UI, migration of existing counters.',
    dependsOn: 'X1',
  },
  {
    ref: 'B2',
    title: 'Payments and top-up packs',
    summary:
      'Buy credit packs by UPI or card, with receipts, failure handling and refunds.',
    goal: 'Reliability & Trust',
    effort: 'xl',
    configKey: 'payments',
    subConfig: [
      '`provider`, `testMode`',
      '`packs[]` (id, price, credits, label), `currency`',
      '`paymentMethods[]`',
      '`refundPolicy` (`none | window_days | manual`)',
      '`receiptTemplate`, `taxMode`',
    ],
    exists: 'Nothing payment-related in the backend, web or mobile.',
    build:
      'Gateway integration, orders, webhooks, receipts, refunds, reconciliation, support tooling for receipts and refunds.',
    dependsOn: 'B1',
  },
  {
    ref: 'B3',
    title: 'Partner revenue routing and settlement',
    summary:
      'Route pack revenue to a partner organisation and produce settlement statements.',
    goal: 'Foundation & Experiments',
    effort: 'l',
    configKey: 'settlement',
    subConfig: [
      '`partnerSharePct`, `platformFeePct`',
      '`payoutAccountRef`',
      '`reportCadence`, `reportRecipients[]`',
    ],
    exists: 'Nothing.',
    build: 'Split rules, a payables ledger, exportable statements.',
    dependsOn: 'B2',
  },
  {
    ref: 'B4',
    title: 'AI spend guardrails and kill switch',
    summary:
      'A per-tenant and per-campaign AI budget with warning thresholds, a hard stop and a global kill switch, fed by the existing cost data.',
    goal: 'Reliability & Trust',
    effort: 'm',
    configKey: 'aiSpend',
    subConfig: [
      '`budgetUsd`, `period` (`campaign | month`)',
      '`warnAtPct[]`, `hardStopAtPct`',
      '`onHardStop` (`block_new_sessions | text_only | read_only`)',
      '`globalKillSwitch`',
      '`alertRecipients[]`',
    ],
    exists:
      'Per-session cost, LLM usage and pricing tables, and feature-specific budgets for debrief and bug hunter only.',
    build:
      'A unified spend meter and enforcement at session start and mid-session.',
    dependsOn: 'X1',
  },
  {
    ref: 'C1',
    title: 'Learner-chosen role-play parameters',
    summary:
      'Before a session the learner picks values such as age band, gender, trigger situation, their own role, setting, language and region, and the scenario adapts through the existing templating and per-language prompt variants.',
    goal: 'Roleplay Actor Realism',
    effort: 'l',
    configKey: 'roleplayParams',
    subConfig: [
      'per scenario `params[]` (key, label, type, options, required, default)',
      '`allowFreeText`, `mapToPromptVars`, `rememberLastChoice`',
      '`modeChoice` (`voice | text | both`)',
      'tenant `allowedParamKeys[]`',
    ],
    exists:
      'Author-side templating and scenario metadata, voice or text per session. The start request carries only the interaction mode.',
    build:
      'Learner-facing picker, start-request fields, pass-through to the voice agent and prompts, authoring UI for params.',
    dependsOn: 'X1',
  },
  {
    ref: 'C2',
    title: 'No-AI guided activity builder with export',
    summary:
      'A step-by-step form component where answers build a document live, exportable as PDF or image, with an option to store nothing. The first use is a personal safety plan built together by a caregiver and a teen.',
    goal: 'Engagement & Usability',
    effort: 'xl',
    configKey: 'guidedActivity',
    subConfig: [
      'per activity `steps[]`',
      '`storage` (`none | device | account`)',
      '`exports[]` (`pdf | image`)',
      '`requireGuardianPresent`, `minAge`, `consentRequired`',
      '`showCrisisBar`',
      '`costsCredits` (default false)',
    ],
    exists:
      'Component Library, journal items (which are stored), a PDF library in the web app. No questionnaire component and no image export.',
    build:
      'Questionnaire component, live preview, PDF and image export, a no-storage mode, authoring UI.',
    dependsOn: 'X1, D2',
  },
  {
    ref: 'C3',
    title: 'Free and paid access rules on course modules',
    summary:
      'Let a track mark which modules are free, credit-gated or purchase-gated, alongside sequential unlock, with clear locked states.',
    goal: 'Engagement & Usability',
    effort: 'm',
    configKey: 'trackAccess',
    subConfig: [
      'per track `freeItems[]`',
      '`gate` (`none | credits | purchase | invite`)',
      '`creditsPerItem`, `previewOnly`',
      '`lockedCopyByLanguage`',
    ],
    exists:
      'Sequential unlock rules and a public track landing page; no entitlement or payment gating.',
    build:
      'Entitlement check on item start, locked-state UI, admin controls on the track.',
    dependsOn: 'B1',
  },
  {
    ref: 'C4',
    title: 'Debrief style profiles',
    summary:
      'A configurable debrief shape and tone per scenario, tenant or audience, for example one thing that went well and one thing to try next, in non-blaming wording.',
    goal: 'Coaching Effectiveness',
    effort: 'm',
    configKey: 'debriefProfile',
    subConfig: [
      '`profile` (`standard | strengths_first | single_next_step`)',
      '`maxItems`, `toneNotes`, `readingLevel`',
      '`showScore`',
      '`languageOverride`',
    ],
    exists:
      'A full debrief pipeline with versioned prompts and learner feedback; no per-scenario or per-tenant tone setting.',
    build:
      'Profile selector, prompt variants, and an evaluation gate before a profile can be enabled.',
    dependsOn: 'X1',
  },
  {
    ref: 'D1',
    title: 'Crisis detection inside role plays',
    summary:
      'Detect live-risk signals in role-play voice and text, pause the session and show approved crisis resources, reusing the existing Guide sentinel.',
    goal: 'Reliability & Trust',
    effort: 'xl',
    configKey: 'crisis.roleplay',
    subConfig: [
      '`sensitivity` (`low | standard | high`)',
      '`scope` (`learner_only | learner_and_character`)',
      '`onTrigger` (`pause_and_show | show_and_continue | end_session`)',
      '`copyByTenantAndLanguage` (clinically approved wording)',
      '`resourcesSource` (`tenant_list | directory`)',
      '`logEvents` (`none | anonymous | linked`), `reviewQueueRecipients[]`',
    ],
    exists:
      'A crisis sentinel, fixed responses and per-tenant approved copy for the Guide. Nothing inside the role-play agent or text path.',
    build:
      'Hook in the voice agent and the text path, a classifier with an evaluation set, event logging, reviewer queue.',
    dependsOn: 'X1, D5',
  },
  {
    ref: 'D2',
    title: 'Persistent help bar',
    summary:
      'A one-tap helpline bar on every learner screen across web and mobile, driven by the tenant resource list.',
    goal: 'Reliability & Trust',
    effort: 's',
    configKey: 'helpBar',
    subConfig: [
      '`position`, `collapsible`',
      '`resources[]` (reuses the tenant emergency resources)',
      '`showOnPublicPages`',
      '`labelByLanguage`',
    ],
    exists: 'A per-tenant, per-language emergency resources list.',
    build: 'One shared component for web and mobile.',
    dependsOn: 'X1',
  },
  {
    ref: 'D3',
    title: 'Consent and age-aware flows',
    summary:
      'Capture versioned consent at sign-up and before sensitive activities, with an optional second-party agreement for minors.',
    goal: 'Reliability & Trust',
    effort: 'l',
    configKey: 'consent',
    subConfig: [
      '`documents[]` (id, version, text by language, required)',
      '`askAgeBand`',
      '`minorFlow` (`block | guardian_present | separate_agreement`)',
      '`reconsentOnVersionChange`, `recordProof`',
    ],
    exists:
      'A consent screen on the anonymous helpline page and public legal pages only.',
    build:
      'Versioned consent records, gating at sign-up and at activities, a minor flow. Needs legal review against the Digital Personal Data Protection Act.',
    dependsOn: 'X1',
  },
  {
    ref: 'D4',
    title: 'Retention and deletion controls',
    summary:
      'Per-tenant retention for transcripts, recordings and progress, plus a self-service delete-my-data request.',
    goal: 'Reliability & Trust',
    effort: 'l',
    configKey: 'retention',
    subConfig: [
      '`transcriptDays`, `recordingDays`, `progressDays`',
      '`deleteOnRequest`, `requestSlaDays`',
      '`anonymiseInsteadOfDelete`',
      '`legalHold`',
    ],
    exists:
      'Retention sweeps for the helpline and WhatsApp only; no learner-data retention and no user-initiated deletion.',
    build:
      'Learner-data sweeps, a deletion workflow with confirmation, published retention text.',
    dependsOn: 'X1',
  },
  {
    ref: 'D5',
    title: 'Content approval workflow',
    summary:
      'A review and sign-off state for scenarios, tracks, guided activities and crisis copy, with a named approver role and version history.',
    goal: 'Coaching Effectiveness',
    effort: 'l',
    configKey: 'contentApproval',
    subConfig: [
      'per content type `required`',
      '`approverRole`, `reviewersPerItem`',
      '`blockPublishUntilApproved`',
      '`reapprovalOnEdit`',
    ],
    exists:
      'Draft, active and archived statuses, and pinned prompt versions; no review or sign-off state.',
    build:
      'New states, approver permissions, an approval record and audit trail, publish blocking.',
    dependsOn: 'X1',
  },
  {
    ref: 'E1',
    title: 'Public resource directory',
    summary:
      'A no-login searchable directory of helplines, counsellors, organisations and content, with verification dates and a report-a-problem link.',
    goal: 'Engagement & Usability',
    effort: 'l',
    configKey: 'directory',
    subConfig: [
      '`publicAccess`',
      '`categories[]`, `filters[]` (`language | region | cost | specialty`)',
      '`entrySource` (`tenant_curated | shared_global | both`)',
      '`requireVerificationWithinDays`',
      '`showWarmHandoff`, `reportIssueEnabled`',
    ],
    exists:
      'A per-tenant emergency resources list and a public anonymous chat page that could serve as a warm handoff.',
    build:
      'Entities, search, admin curation, verification reminders, public page.',
    dependsOn: 'X1',
  },
  {
    ref: 'F1',
    title: 'Partner landing page builder',
    summary:
      'A tenant-level co-branded landing page assembled from blocks (story, resources, live availability, pricing, helplines, FAQ) with an enforced logo ratio.',
    goal: 'Engagement & Usability',
    effort: 'xl',
    configKey: 'landingPage',
    subConfig: [
      '`blocks[]`, `languages[]`',
      '`attributionLine`, `logoMinRatio` (partner to platform)',
      '`showLiveAvailability`',
      '`customDomain`, `themeFromBranding`',
    ],
    exists:
      'Tenant branding with a public endpoint, and per-track landing pages. No tenant-level page and no custom-domain routing (tenants resolve by organisation code only).',
    build:
      'Tenant page entity, block editor, ratio rule, availability counter, domain routing.',
    dependsOn: 'X1, A2',
  },
  {
    ref: 'F2',
    title: 'Campaign attribution',
    summary:
      'Tracked links and QR codes per source, with the source captured at sign-up and reported back.',
    goal: 'Foundation & Experiments',
    effort: 'm',
    configKey: 'attribution',
    subConfig: [
      '`linkPrefix`, `utmKeys[]`',
      '`qrFormat`',
      '`captureAtSignup`, `retainDays`',
      '`shareWithPartner`',
    ],
    exists:
      'Web analytics events only; no UTM parsing, QR codes, short links or sign-up source.',
    build:
      'Link and QR generator, source capture at sign-up, per-source report.',
    dependsOn: 'X2, A1',
  },
  {
    ref: 'G1',
    title: 'Campaign dashboard and weekly review',
    summary:
      'One view of accounts against cap, credits used, spend against budget, sessions by resource and sign-up pace, with an export for the weekly review.',
    goal: 'Foundation & Experiments',
    effort: 'm',
    configKey: 'campaignDashboard',
    subConfig: [
      '`metrics[]`, `compareToBudget`',
      '`weeklyDigest` (`off | email`), `digestRecipients[]`',
      '`partnerViewEnabled`',
      '`minGroupSize` (privacy floor)',
    ],
    exists:
      'Tenant analytics endpoints, per-session cost data and the admin chart registry.',
    build:
      'A campaign-scoped endpoint and tab that join cap, credits and cost; digest email.',
    dependsOn: 'X2, A2, B1, B4',
  },
  {
    ref: 'G2',
    title: 'Pre and post outcome surveys',
    summary:
      'A self-rated confidence and knowledge survey before first use and after the last session, with a cohort report.',
    goal: 'Coaching Effectiveness',
    effort: 'm',
    configKey: 'outcomeSurvey',
    subConfig: [
      '`instrument[]` (id, items, scale)',
      '`askPre`, `askPostAfterNSessions`',
      '`optional`, `anonymise`',
      '`languageSet[]`',
    ],
    exists:
      'Likert-scale quiz questions; no survey entity or before-and-after pairing.',
    build: 'Survey entity, triggers, pairing of pre and post, cohort report.',
    dependsOn: 'X1',
  },
  {
    ref: 'G3',
    title: 'SMS and re-engagement channel',
    summary:
      'Add SMS to the existing push, email and WhatsApp nudges, with per-tenant templates, quiet hours and opt-out.',
    goal: 'Engagement & Usability',
    effort: 'm',
    configKey: 'reengagement.sms',
    subConfig: [
      '`quietHours`, `maxPerWeek`, `inactiveDays`',
      '`templateByLanguage`',
      '`optOutKeyword`',
      '`fallbackOrder[]`',
    ],
    exists: 'An inactivity nudge over push, email and WhatsApp; no SMS.',
    build: 'SMS channel, template management, opt-out handling.',
    dependsOn: 'A1',
  },
];

export class SeedParentCourseRoadmapOpportunities1980940000000 implements MigrationInterface {
  name = 'SeedParentCourseRoadmapOpportunities1980940000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const users: Array<{ id: number }> = await queryRunner.query(
      `SELECT "id" FROM "users" WHERE lower("email") = lower($1) LIMIT 1`,
      [PARENT_COURSE_ADMIN_EMAIL],
    );
    if (users.length === 0) {
      console.warn(
        `[${this.name}] user ${PARENT_COURSE_ADMIN_EMAIL} not found; ${PARENT_COURSE_CODE} opportunities NOT seeded`,
      );
      return;
    }
    const userId = users[0].id;

    const goalRows: Array<{ name: string }> = await queryRunner.query(
      `SELECT "name" FROM "roadmap_product_goals" ORDER BY "position" ASC`,
    );
    if (goalRows.length === 0) {
      console.warn(
        `[${this.name}] no product goals exist; ${PARENT_COURSE_CODE} opportunities NOT seeded`,
      );
      return;
    }
    const goals = new Set(goalRows.map((g) => g.name));
    // Goals are renameable in the admin UI and the FK is by name, so fall back rather than abort.
    const fallback = goals.has(FALLBACK_GOAL)
      ? FALLBACK_GOAL
      : goalRows[0].name;

    for (const o of PARENT_COURSE_OPPORTUNITIES) {
      const goal = goals.has(o.goal) ? o.goal : fallback;
      await queryRunner.query(
        `INSERT INTO "roadmap_opportunities"
           ("description", "type", "stage", "productGoal", "prd", "effort", "createdBy", "updatedBy")
         SELECT $1, 'idea', 'new', $2, $3, $4, $5, $5
          WHERE NOT EXISTS (
            SELECT 1 FROM "roadmap_opportunities"
             WHERE "description" = $1 AND "deletedAt" IS NULL
          )`,
        [descriptionOf(o), goal, prdOf(o), o.effort, userId],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove only rows still exactly as seeded: no votes, no comments. Anything people have
    // engaged with stays.
    for (const o of PARENT_COURSE_OPPORTUNITIES) {
      await queryRunner.query(
        `DELETE FROM "roadmap_opportunities" r
          WHERE r."description" = $1
            AND r."stage" = 'new'
            AND NOT EXISTS (SELECT 1 FROM "roadmap_allocations" a WHERE a."opportunityId" = r."id")
            AND NOT EXISTS (SELECT 1 FROM "roadmap_opportunity_comments" c WHERE c."opportunityId" = r."id")`,
        [descriptionOf(o)],
      );
    }
  }
}
