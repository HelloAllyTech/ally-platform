/**
 * The build brief (plans/roadmap-builder-merge D18, §4.5b): the markdown an
 * idea's lead hands to Claude Code. Deterministic, no model call.
 *
 * ally-platform and its pull requests are PUBLIC, and this text is meant to
 * end up in a prompt, a downloaded file and very likely a PR body. So the
 * brief is built from an ALLOWLIST: `pickBriefInput` copies the named fields
 * out of whatever it is given and nothing else, and `renderBuildBrief` reads
 * only that picked object. Adding a field means adding it to
 * `BUILD_BRIEF_FIELDS`, where the spec pins the list and checks every
 * forbidden one stays out: strategy text, ranking rationale, spend, the
 * transcript, votes and decline reasons.
 */

/** Characters a `claude://code/new?q=` deep link carries comfortably (§4.5b). */
export const BRIEF_DEEP_LINK_LIMIT = 14_000;

/** Every top-level field the brief may carry. Nothing else reaches the markdown. */
export const BUILD_BRIEF_FIELDS = [
  'code',
  'title',
  'problem',
  'outcome',
  'requirements',
  'design',
  'touched',
  'repoRules',
  'branch',
  'prTitle',
  'closedNotReady',
] as const;

/**
 * Field names that must never appear in a brief's input, at any depth. The
 * spec walks the picked object for these, so a future "just add the whole
 * PRD" fails loudly.
 */
export const BUILD_BRIEF_FORBIDDEN = [
  'strategy',
  'strategyText',
  'strategyContext',
  'whyRanks',
  'queueRank',
  'compositeScore',
  'rankWeights',
  'assessment',
  'spend',
  'spentUsd',
  'ceilingUsd',
  'costUsd',
  'totalCostUsd',
  'budgetUsd',
  'messages',
  'transcript',
  'votes',
  'voters',
  'declineReason',
  'evidence',
] as const;

export interface BriefRequirement {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
}

export interface BriefDesign {
  designMd: string;
  contracts: { name: string; change: string }[];
  compatibilityMd: string;
  tests: {
    requirementId: string;
    repo: string;
    file: string;
    asserts: string;
  }[];
}

export interface BriefTouched {
  /** The app folder in ally-platform (`ally-be`, `ally-web`, …). */
  repo: string;
  /** Repo-relative paths or globs the approved design scoped; empty when only the app is known. */
  paths: string[];
}

/** The picked input. Its keys are exactly BUILD_BRIEF_FIELDS. */
export interface BuildBriefInput {
  code: string;
  title: string;
  problem: string | null;
  outcome: string | null;
  requirements: BriefRequirement[];
  /** Null unless the technical design is approved and not stale. */
  design: BriefDesign | null;
  touched: BriefTouched[];
  repoRules: string[];
  branch: string;
  prTitle: string;
  /**
   * The Owner closed the plan with blockers still open: their reason and the
   * blockers as they stood (audit 2026-11-19, rec 2). Printed first, so the
   * builder reads what was knowingly left open before anything else.
   */
  closedNotReady: { reason: string; blockers: string[] } | null;
}

/** The rules every change to ally-platform follows, as the repo states them. */
export const REPO_RULES: readonly string[] = [
  'ally-platform is a public repository. Never put secrets, credentials, production data, internal hostnames or anyone’s email address in code, tests, commit messages or the pull request.',
  'Branch from the latest origin/master. Make the whole change one pull request, even when it spans several apps.',
  'No git hooks run in this monorepo: run the lint, type check and tests of every app you touch before you push (each app’s CLAUDE.md lists them).',
  'Release order: ally-be (and the other backends) before any frontend that reads a field they add. Say so in the pull request if the change spans both.',
  'Every model call you add, remove or re-point (completion, embedding, transcription, speech or image) needs its row in ally-be/src/llm/constants/ai-task-registry.constants.ts in the same pull request.',
  'Database migrations are additive and never edited once merged. Keep helper functions out of migration files (src/database/migration-helpers/).',
];

// ── Picking: the allowlist ───────────────────────────────────────────────────

const str = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

/** Agent-written lists are not always lists (Builder's PRD panel crashed on that). */
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** `opp-0388-short-title`: lower case, the code first so the PR linker finds it. */
export function briefBranch(code: string, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return [code.toLowerCase(), slug].filter(Boolean).join('-');
}

/** What the sources may look like. Loose on purpose: only the named paths are read. */
export interface BriefSources {
  code: string;
  title: string;
  /** The idea's own problem text (the opportunity's body). */
  ideaProblem?: string | null;
  /** The copilot brief's success metric, when there is no frozen measure. */
  ideaOutcome?: string | null;
  /** plan.successMeasure: metric and target only are read. */
  successMeasure?: unknown;
  /** The PRD document: problem, requirements and technicalPlan.repos[].repo only are read. */
  prd?: unknown;
  /** Whether the technical design is approved and current (status approved, not stale). */
  designApproved?: boolean;
  /** plan.planClosed: `notReady.reason` and `notReady.blockers` only are read. */
  planClosed?: unknown;
}

/**
 * Copy the allowlisted fields out of the sources. The only function that
 * reads a source; everything downstream reads the result.
 */
export function pickBriefInput(sources: BriefSources): BuildBriefInput {
  const prd = obj(sources.prd);
  const measure = obj(sources.successMeasure);
  const metric = str(measure.metric);
  const target = str(measure.target);

  const requirements: BriefRequirement[] = arr(prd.requirements)
    .map((raw) => {
      const r = obj(raw);
      const title = str(r.title);
      if (!title) return null;
      return {
        id: str(r.id) ?? '',
        title,
        description: str(r.description) ?? '',
        acceptanceCriteria: arr(r.acceptanceCriteria)
          .map(str)
          .filter((c): c is string => !!c),
      };
    })
    .filter((r): r is BriefRequirement => r !== null);

  const rawDesign = obj(prd.technicalDesign);
  const design: BriefDesign | null =
    sources.designApproved && str(rawDesign.designMd)
      ? {
          designMd: str(rawDesign.designMd) as string,
          contracts: arr(rawDesign.contracts)
            .map((raw) => {
              const c = obj(raw);
              const name = str(c.name);
              return name ? { name, change: str(c.change) ?? '' } : null;
            })
            .filter((c): c is { name: string; change: string } => !!c),
          compatibilityMd: str(rawDesign.compatibilityMd) ?? '',
          tests: arr(rawDesign.testMap)
            .map((raw) => {
              const t = obj(raw);
              const file = str(t.file);
              return file
                ? {
                    requirementId: str(t.requirementId) ?? '',
                    repo: str(t.repo) ?? '',
                    file,
                    asserts: str(t.asserts) ?? '',
                  }
                : null;
            })
            .filter(
              (
                t,
              ): t is {
                requirementId: string;
                repo: string;
                file: string;
                asserts: string;
              } => !!t,
            ),
        }
      : null;

  // Touched apps and paths: the approved design's scope; the PRD's planned
  // repos when there is no approved design.
  const touched = new Map<string, Set<string>>();
  const touch = (repo: unknown, paths: unknown[] = []) => {
    const name = str(repo);
    if (!name) return;
    const set = touched.get(name) ?? new Set<string>();
    for (const p of paths.map(str)) if (p) set.add(p);
    touched.set(name, set);
  };
  if (design) {
    for (const raw of arr(rawDesign.scope)) {
      const s = obj(raw);
      touch(s.repo, arr(s.files));
    }
  }
  if (!touched.size) {
    for (const raw of arr(obj(prd.technicalPlan).repos)) touch(obj(raw).repo);
  }

  const notReady = obj(obj(sources.planClosed).notReady);
  const notReadyReason = str(notReady.reason);
  const closedNotReady = notReadyReason
    ? {
        reason: notReadyReason,
        blockers: arr(notReady.blockers)
          .map(str)
          .filter((b): b is string => !!b),
      }
    : null;

  const title = str(sources.title) ?? sources.code;
  return {
    code: sources.code,
    title,
    problem: str(prd.problem) ?? str(sources.ideaProblem),
    outcome:
      metric && target
        ? `${metric}: ${target}`
        : (metric ?? str(sources.ideaOutcome)),
    requirements,
    design,
    touched: [...touched.entries()].map(([repo, paths]) => ({
      repo,
      paths: [...paths],
    })),
    repoRules: [...REPO_RULES],
    branch: briefBranch(sources.code, title),
    prTitle: `${sources.code}: ${title}`,
    closedNotReady,
  };
}

// ── Rendering ────────────────────────────────────────────────────────────────

/** The brief as markdown. Reads only the picked input. */
export function renderBuildBrief(input: BuildBriefInput): string {
  const out: string[] = [
    `# ${input.code}: ${input.title}`,
    '',
    `Build this change in the ally-platform monorepo. It comes from the Ally Roadmap idea ${input.code}.`,
    '',
    ...(input.closedNotReady
      ? [
          '## Closed before the plan was ready',
          'The plan was closed with these still open. Read them before you start, and ask where one leaves you guessing.',
          '',
          `Why it was closed anyway: ${input.closedNotReady.reason}`,
          '',
          ...(input.closedNotReady.blockers.length
            ? input.closedNotReady.blockers.map((b) => `- ${b}`)
            : ['- (none listed)']),
          '',
        ]
      : []),
    '## Branch and pull request',
    `- Work on a branch named \`${input.branch}\`.`,
    `- Put \`${input.code}\` in the pull request title, for example: \`${input.prTitle}\`. The Roadmap links the pull request to the idea by that code, and tracks its release from there.`,
    '- Open the pull request when it is ready for review. Do not merge it.',
    '',
    '## Problem',
    input.problem ?? '_Not written down. Ask before you assume._',
    '',
    '## Outcome',
    input.outcome ?? '_No success measure yet._',
    '',
    '## Requirements',
  ];
  if (input.requirements.length) {
    for (const r of input.requirements) {
      out.push(`### ${r.id ? `${r.id}. ` : ''}${r.title}`);
      if (r.description) out.push(r.description);
      if (r.acceptanceCriteria.length) {
        out.push('', 'Acceptance criteria:');
        for (const c of r.acceptanceCriteria) out.push(`- [ ] ${c}`);
      }
      out.push('');
    }
  } else {
    out.push('_No requirements in the PRD yet._', '');
  }

  out.push('## Technical design');
  if (input.design) {
    out.push('Approved. Build to it.', '', input.design.designMd, '');
    if (input.design.contracts.length) {
      out.push('### Fields, APIs and tables it changes');
      for (const c of input.design.contracts) {
        out.push(`- \`${c.name}\`${c.change ? `: ${c.change}` : ''}`);
      }
      out.push('');
    }
    if (input.design.compatibilityMd) {
      out.push('### Compatibility', input.design.compatibilityMd, '');
    }
    if (input.design.tests.length) {
      out.push('### Tests');
      for (const t of input.design.tests) {
        out.push(
          `- ${t.requirementId ? `${t.requirementId}: ` : ''}\`${t.repo ? `${t.repo}/` : ''}${t.file}\`${t.asserts ? `: ${t.asserts}` : ''}`,
        );
      }
      out.push('');
    }
  } else {
    out.push(
      '_No approved design. Plan the change and confirm it before building._',
      '',
    );
  }

  out.push('## Apps and paths it touches');
  if (input.touched.length) {
    for (const t of input.touched) {
      out.push(
        t.paths.length
          ? `- \`${t.repo}/\`: ${t.paths.map((p) => `\`${p}\``).join(', ')}`
          : `- \`${t.repo}/\``,
      );
    }
  } else {
    out.push('_Not decided yet._');
  }
  out.push('', '## Repo rules');
  for (const rule of input.repoRules) out.push(`- ${rule}`);
  out.push('');
  return out.join('\n');
}
