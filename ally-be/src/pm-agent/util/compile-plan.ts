import { canonicalJson, sha256 } from './card-hash.util';
import { metricDefinition } from '../impact/metric-catalog';
import { scrubDeep, ScrubOptions } from './scrub.util';

/**
 * Card → plan.md and Builder PRD, by DETERMINISTIC templating (plan §8).
 *
 * "What you read is what is built": the PRD is generated from the exact card version the
 * admin accepted, with no model in the loop, so the same card always compiles to the same
 * text (and the same hash). The download path (plan.md) and the Builder path get the same
 * words.
 *
 * Public-repo rules, enforced here rather than trusted to the card:
 *  - every string passes scrubForPublic (tenant names, contact details, credentials,
 *    internal hosts, long quoted user content);
 *  - evidence SNAPSHOTS are never included — only the number of items, and the aggregate
 *    figure the card's own `whyHeadline` cites;
 *  - nothing about who accepted it or which organisations were involved.
 */

export interface CompilableCard {
  id: string;
  version: number;
  versionHash: string;
  category: string;
  payload: RecommendationPayload;
}

/** The recommendation payload as stored (validated by PmRecommendationPayloadDto). */
export interface RecommendationPayload {
  schemaVersion?: number;
  title: string;
  whyHeadline: string;
  change: string[];
  problem: string;
  plan: {
    steps: string[];
    files: string[];
    acceptanceCriteria: string[];
    testPlan: string[];
    defaultsChosen: string[];
  };
  size: string;
  risk: string;
  riskWhy: string;
  rollbackNote: string;
  impactMetric: { name: string; direction: 'up' | 'down' };
  /** Optional (impact checks): the catalog metric read after release. */
  metricRef?: {
    source: string;
    params?: Record<string, string>;
    betterWhen?: string;
  };
  alternativesDropped: string[];
  repos: string[];
  evidenceIds: string[];
}

/** RFC-6902 `replace` op against the Builder PRD document (BuilderPrdDocument). */
export interface PrdPatchOp {
  op: 'replace';
  path: string;
  value: unknown;
}

export interface CompiledPlan {
  markdown: string;
  prdOps: PrdPatchOp[];
  /** sha256 of the canonical PRD ops; stored on the card as compiledPrdHash. */
  prdHash: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  ui_ux: 'UI/UX',
  product: 'Product',
  architecture: 'Architecture',
  code_health: 'Code health',
  infra: 'Infra',
  cost: 'Cost',
  strategy_content: 'Strategy & content',
};

const list = (items: string[] | undefined, empty = '_None._') =>
  items?.length ? items.map((item) => `- ${item}`).join('\n') : empty;

const numbered = (items: string[] | undefined, empty = '_None._') =>
  items?.length
    ? items.map((item, index) => `${index + 1}. ${item}`).join('\n')
    : empty;

const arr = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((item) => String(item ?? '')) : [];

/** A file path that names its repo (`ally-be/src/…`) belongs to that repo. */
const filesFor = (repo: string, files: string[], repos: string[]) =>
  files.filter(
    (file) =>
      file.startsWith(`${repo}/`) ||
      (repos.length === 1 &&
        !repos.some((other) => file.startsWith(`${other}/`))),
  );

/** The payload with every string scrubbed and every list normalised. */
function normalise(
  payload: RecommendationPayload,
  options: ScrubOptions,
): RecommendationPayload {
  const clean = scrubDeep(payload, options);
  return {
    title: String(clean.title ?? '').trim(),
    whyHeadline: String(clean.whyHeadline ?? '').trim(),
    change: arr(clean.change),
    problem: String(clean.problem ?? '').trim(),
    plan: {
      steps: arr(clean.plan?.steps),
      files: arr(clean.plan?.files),
      acceptanceCriteria: arr(clean.plan?.acceptanceCriteria),
      testPlan: arr(clean.plan?.testPlan),
      defaultsChosen: arr(clean.plan?.defaultsChosen),
    },
    size: String(clean.size ?? ''),
    risk: String(clean.risk ?? ''),
    riskWhy: String(clean.riskWhy ?? '').trim(),
    rollbackNote: String(clean.rollbackNote ?? '').trim(),
    impactMetric: {
      name: String(clean.impactMetric?.name ?? '').trim(),
      direction: clean.impactMetric?.direction === 'down' ? 'down' : 'up',
    },
    alternativesDropped: arr(clean.alternativesDropped),
    // Repos are an enum; never scrubbed into something else.
    repos: arr(payload.repos),
    evidenceIds: arr(payload.evidenceIds),
  };
}

export function compilePlan(
  card: CompilableCard,
  options: ScrubOptions = {},
): CompiledPlan {
  const p = normalise(card.payload, options);
  const category = CATEGORY_LABELS[card.category] ?? card.category;
  const metric = p.impactMetric.name
    ? `${p.impactMetric.name} (${p.impactMetric.direction === 'up' ? 'should go up' : 'should go down'})`
    : 'not named';
  // Catalog wording only (never model text), so nothing here needs scrubbing.
  const measured = metricDefinition(card.payload?.metricRef?.source);
  const measuredLine = measured
    ? `Measured after release: ${measured.label} (\`${measured.key}\`, ${measured.unit}, better ${
        card.payload.metricRef?.betterWhen === 'down' ? 'down' : 'up'
      }), platform-wide over the 14 days before release and again at +14 and +30 days.`
    : 'Not automatically measured (no catalog metric attached).';
  const provenance =
    `Compiled from PM Agent card ${card.id} v${card.version} ` +
    `(hash ${card.versionHash.slice(0, 12)}). ` +
    `Backed by ${p.evidenceIds.length} internal evidence item(s), reviewed by an admin and not reproduced here.`;

  const markdown = [
    `# ${p.title}`,
    '',
    `**Category:** ${category} · **Size:** ${p.size} · **Risk:** ${p.risk}`,
    '',
    `**Why:** ${p.whyHeadline}`,
    '',
    '## Change',
    list(p.change),
    '',
    '## Problem',
    p.problem || '_Not stated._',
    '',
    '## Plan',
    '### Steps',
    numbered(p.plan.steps),
    '',
    '### Files',
    list(p.plan.files.map((file) => `\`${file}\``)),
    '',
    '### Acceptance criteria',
    list(p.plan.acceptanceCriteria),
    '',
    '### Test plan',
    list(p.plan.testPlan),
    '',
    '### Defaults chosen',
    list(p.plan.defaultsChosen),
    '',
    '## Repos',
    list(p.repos),
    '',
    '## Risk and rollback',
    `- Risk: ${p.risk}${p.riskWhy ? ` — ${p.riskWhy}` : ''}`,
    `- Rollback: ${p.rollbackNote || 'Revert the pull request.'}`,
    '',
    '## Impact to watch',
    metric,
    measuredLine,
    '',
    '## Alternatives dropped',
    list(p.alternativesDropped),
    '',
    '---',
    `_${provenance}_`,
    '',
  ].join('\n');

  const repoPlans = p.repos.map((repo) => {
    const files = filesFor(repo, p.plan.files, p.repos);
    return {
      repo,
      changesMd: [
        numbered(p.plan.steps),
        '',
        files.length
          ? `Files:\n${list(files.map((file) => `\`${file}\``))}`
          : 'Files: as found by the designer run.',
      ].join('\n'),
    };
  });

  const ops: PrdPatchOp[] = [
    { op: 'replace', path: '/title', value: p.title },
    {
      op: 'replace',
      path: '/summary',
      value: [
        p.whyHeadline,
        '',
        list(p.change),
        '',
        `Size ${p.size}, risk ${p.risk}${p.riskWhy ? ` (${p.riskWhy})` : ''}.`,
        '',
        provenance,
      ].join('\n'),
    },
    { op: 'replace', path: '/problem', value: p.problem },
    {
      op: 'replace',
      path: '/usersAndContext',
      value:
        `Category: ${category}. Proposed by the PM Agent from platform-wide aggregate ` +
        `analytics and code review, and accepted by an admin. Impact metric: ${metric}.`,
    },
    {
      op: 'replace',
      path: '/existingBehaviour',
      value:
        `${p.problem}\n\nThe designer run must read the files below before changing them ` +
        `and describe what already exists:\n${list(p.plan.files.map((file) => `\`${file}\``))}`,
    },
    {
      op: 'replace',
      path: '/whereChangesBelong',
      value: repoPlans
        .map(
          (plan) =>
            `- **${plan.repo}**: ${filesFor(plan.repo, p.plan.files, p.repos).length ? 'the files listed for it in the technical plan' : 'per the steps'}.`,
        )
        .join('\n'),
    },
    {
      op: 'replace',
      path: '/goals',
      value: [
        `Move ${metric}.`,
        ...p.plan.acceptanceCriteria.map((criterion) => `- ${criterion}`),
      ].join('\n'),
    },
    {
      op: 'replace',
      path: '/nonGoals',
      value: [
        '- Anything outside the steps and files listed in this PRD.',
        ...p.alternativesDropped.map((alt) => `- Not doing: ${alt}`),
      ].join('\n'),
    },
    {
      op: 'replace',
      path: '/requirements',
      value: [
        {
          id: 'R1',
          title: p.title,
          description: [list(p.change), '', numbered(p.plan.steps)].join('\n'),
          acceptanceCriteria: p.plan.acceptanceCriteria,
        },
      ],
    },
    {
      op: 'replace',
      path: '/assumptions',
      value: p.plan.defaultsChosen.map((text, index) => ({
        id: `A${index + 1}`,
        text,
        // Stated on the card the admin accepted: a decision, not an inference.
        status: 'confirmed',
      })),
    },
    {
      op: 'replace',
      path: '/technicalPlan',
      value: {
        repos: repoPlans,
        dataModelMd:
          'Only what the steps name. Any schema change is additive: a new migration, never an edit to a merged one.',
        apiMd:
          'Only what the steps name. Existing response shapes stay backwards compatible.',
      },
    },
    { op: 'replace', path: '/testPlanMd', value: list(p.plan.testPlan) },
    {
      op: 'replace',
      path: '/e2ePlanMd',
      value: `Verify each acceptance criterion:\n${list(p.plan.acceptanceCriteria)}`,
    },
    { op: 'replace', path: '/openQuestions', value: [] },
  ];

  return { markdown, prdOps: ops, prdHash: sha256(canonicalJson(ops)) };
}
