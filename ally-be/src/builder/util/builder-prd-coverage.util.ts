import {
  BUILDER_PRD_COVERAGE,
  BUILDER_PRD_COVERAGE_KEYS,
  COVERAGE_REASON_MIN_CHARS,
} from '../constants/builder-prd-coverage.constants';
import {
  BuilderPrdCoverageItem,
  BuilderPrdCoverageKey,
  BuilderPrdCoverageStatus,
  BuilderPrdDocument,
  BuilderPrdReadinessSection,
} from '../type/builder-prd.type';

/**
 * The coverage pass's pure half: reading the stored list, saying what a section of the PRD
 * holds, and the readiness row. Pure so each rule is pinned by a unit test.
 */

/**
 * Sections an answer may point at: every prose section bar the title (as `PRD_SECTION_KEYS`
 * names them), and the structured ones. Listed here rather than imported: the normaliser imports
 * this file, and the edits util imports the normaliser.
 */
export const PRD_ANSWER_SECTIONS: string[] = [
  'summary',
  'problem',
  'usersAndContext',
  'existingBehaviour',
  'whereChangesBelong',
  'goals',
  'nonGoals',
  'testPlanMd',
  'e2ePlanMd',
  'dataModelMd',
  'apiMd',
  'requirements',
  'assumptions',
  'technicalPlan',
];

const STATUSES: BuilderPrdCoverageStatus[] = [
  'answered',
  'not_applicable',
  'asked',
];

const text = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

/** Whitespace-flattened, lowercased: how a question is compared against `openQuestions`. */
const comparable = (value: unknown): string =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/**
 * Everything one section of the PRD says, as text: a prose section as written, requirements and
 * assumptions with their fields, the technical plan with every repo's changes. What a coverage
 * answer and a principle mark are checked against.
 */
export function prdSectionText(
  draft: BuilderPrdDocument | null | undefined,
  section: string,
): string {
  const doc = (draft ?? {}) as unknown as Record<string, any>;
  switch (section) {
    case 'requirements':
      return (Array.isArray(doc.requirements) ? doc.requirements : [])
        .map((row: any) =>
          [
            row?.id,
            row?.title,
            row?.description,
            ...(Array.isArray(row?.acceptanceCriteria)
              ? row.acceptanceCriteria
              : []),
          ]
            .map((part) => (typeof part === 'string' ? part : ''))
            .join('\n'),
        )
        .join('\n');
    case 'assumptions':
      return (Array.isArray(doc.assumptions) ? doc.assumptions : [])
        .map((row: any) => text(row?.text))
        .join('\n');
    case 'technicalPlan': {
      const plan = doc.technicalPlan ?? {};
      return [
        ...(Array.isArray(plan.repos) ? plan.repos : []).map(
          (repo: any) => `${text(repo?.repo)}\n${text(repo?.changesMd)}`,
        ),
        text(plan.dataModelMd),
        text(plan.apiMd),
      ].join('\n');
    }
    case 'dataModelMd':
    case 'apiMd':
      return text(doc.technicalPlan?.[section]);
    case 'openQuestions':
      return (Array.isArray(doc.openQuestions) ? doc.openQuestions : [])
        .map(text)
        .join('\n');
    default:
      return text(doc[section]);
  }
}

/**
 * The stored list made safe: known keys only, one entry per key (the last write wins), known
 * statuses only. An entry that fails these is dropped rather than coerced — it was never a
 * valid answer, and the row then says the item is open.
 */
export function normaliseCoverage(raw: unknown): BuilderPrdCoverageItem[] {
  if (!Array.isArray(raw)) return [];
  const byKey = new Map<BuilderPrdCoverageKey, BuilderPrdCoverageItem>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const source = entry as Record<string, unknown>;
    const key = text(source.key) as BuilderPrdCoverageKey;
    const status = text(source.status) as BuilderPrdCoverageStatus;
    if (!BUILDER_PRD_COVERAGE_KEYS.includes(key)) continue;
    if (!STATUSES.includes(status)) continue;
    byKey.set(key, {
      key,
      status,
      note: text(source.note),
      ...(text(source.section) ? { section: text(source.section) } : {}),
      ...(text(source.question) ? { question: text(source.question) } : {}),
      ...(text(source.at) ? { at: text(source.at) } : {}),
    });
  }
  // Stored in the list's own order, so every reader shows the same sequence.
  return BUILDER_PRD_COVERAGE_KEYS.filter((key) => byKey.has(key)).map(
    (key) => byKey.get(key)!,
  );
}

/** Why one entry does not count yet, or null when it does. */
export function coverageProblem(
  item: BuilderPrdCoverageItem | undefined,
  draft: BuilderPrdDocument,
): string | null {
  if (!item) return 'not covered';
  switch (item.status) {
    case 'answered':
      if (!item.note) return 'answered with no answer';
      if (!item.section || !PRD_ANSWER_SECTIONS.includes(item.section)) {
        return 'answered without naming the PRD section that holds it';
      }
      if (!prdSectionText(draft, item.section).trim()) {
        return `answered in ${item.section}, which is empty`;
      }
      return null;
    case 'not_applicable':
      return item.note.length >= COVERAGE_REASON_MIN_CHARS
        ? null
        : 'marked not applicable without a reason';
    case 'asked': {
      const question = comparable(item.question || item.note);
      if (!question) return 'asked, but the question is not recorded';
      const open = (draft.openQuestions ?? []).map(comparable);
      // An asked item stays covered while its question is open; the open question itself blocks
      // readiness. Once the question leaves the list, the answer has to be recorded.
      return open.some(
        (entry) => entry === question || entry.includes(question),
      )
        ? null
        : 'asked, and the question is no longer open — record the answer';
    }
    default:
      return 'not covered';
  }
}

/** The coverage entry for one key, if the PRD has one. */
export function coverageOf(
  draft: BuilderPrdDocument | null | undefined,
  key: BuilderPrdCoverageKey,
): BuilderPrdCoverageItem | undefined {
  return normaliseCoverage(draft?.coverage).find((item) => item.key === key);
}

/**
 * Whether the PRD has settled the mobile app: answered or ruled out with a reason. Replaces
 * reading the word "mobile" in Non-goals, which passed a PRD that only mentioned it.
 */
export function mobileSettled(draft: BuilderPrdDocument): boolean {
  const item = coverageOf(draft, 'mobile_app');
  return (
    !!item && item.status !== 'asked' && coverageProblem(item, draft) === null
  );
}

/**
 * The readiness row. Blocks until every item has an answer, a reason or an open question —
 * including on a blank PRD, because "nobody has thought about this yet" is exactly the state it
 * exists to show.
 */
export function coverageRow(
  draft: BuilderPrdDocument,
): BuilderPrdReadinessSection {
  const stored = normaliseCoverage(draft.coverage);
  const gaps = BUILDER_PRD_COVERAGE.map((definition) => ({
    definition,
    problem: coverageProblem(
      stored.find((item) => item.key === definition.key),
      draft,
    ),
  })).filter((entry) => entry.problem);
  const ok = gaps.length === 0;
  const labels = gaps.map((gap) => gap.definition.label);
  return {
    key: 'coverage',
    label: 'Coverage pass',
    ok,
    hint: ok
      ? ''
      : `${gaps.length} of ${BUILDER_PRD_COVERAGE.length} coverage items open: ${
          labels.length > 4
            ? `${labels.slice(0, 4).join(', ')} and ${labels.length - 4} more`
            : labels.join(', ')
        }.`,
    detail: ok
      ? ''
      : 'Record each with record_coverage: status "answered" with the answer and the PRD ' +
        'section that holds it, "not_applicable" with the reason, or "asked" with the question ' +
        'you put to the admin (it joins the open questions). Open: ' +
        gaps
          .map(
            (gap) =>
              `${gap.definition.key} (${gap.problem}) — ${gap.definition.ask}`,
          )
          .join(' | ') +
        '.',
  };
}
