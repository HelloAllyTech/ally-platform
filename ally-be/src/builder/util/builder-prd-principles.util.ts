import {
  BuilderPrdDocument,
  BuilderPrdPrincipleMark,
  BuilderPrdPrinciplesSummary,
  BuilderPrdReadinessSection,
  BuilderReadinessSignals,
} from '../type/builder-prd.type';
import {
  PRD_ANSWER_SECTIONS,
  prdSectionText,
} from './builder-prd-coverage.util';

/**
 * Principle marks: the trace a Context Library principle leaves on the PRD.
 *
 * Before these, a session's guiding brief retrieved its principles and nothing recorded what
 * became of any of them — the session panel's status only moves when the PRD cites a code, and no
 * PRD did. A mark closes that loop: applied, in a section that cites `[CODE]` (so the existing
 * citation check records the use and verifies it), or not relevant, with the reason.
 */

/** `FP-0142`: two capitals, a dash, four or more digits — the citation format. */
const CODE = /^[A-Z]{2}-\d{4,}$/;

/** A not-relevant reason shorter than this is a shrug, not a reason. */
export const PRINCIPLE_REASON_MIN_CHARS = 10;

const text = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

export const normaliseCode = (value: unknown): string =>
  text(value)
    .replace(/^\[|\]$/g, '')
    .toUpperCase();

/** The stored marks made safe: valid codes, known marks, the last mark per code wins. */
export function normalisePrincipleMarks(
  raw: unknown,
): BuilderPrdPrincipleMark[] {
  if (!Array.isArray(raw)) return [];
  const byCode = new Map<string, BuilderPrdPrincipleMark>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const source = entry as Record<string, unknown>;
    const code = normaliseCode(source.code);
    const mark = text(source.mark);
    if (!CODE.test(code)) continue;
    if (mark !== 'applied' && mark !== 'not_relevant') continue;
    byCode.set(code, {
      code,
      mark,
      ...(text(source.section) ? { section: text(source.section) } : {}),
      ...(text(source.reason) ? { reason: text(source.reason) } : {}),
      ...(text(source.at) ? { at: text(source.at) } : {}),
    });
  }
  return [...byCode.values()];
}

/** Whether `section` of the PRD cites `[code]`, alone or in a list (`[FP-1, FP-2]`). */
export function sectionCites(
  draft: BuilderPrdDocument,
  section: string,
  code: string,
): boolean {
  const body = prdSectionText(draft, section);
  for (const match of body.matchAll(
    /\[([A-Z]{2}-\d{4,}(?:\s*,\s*[A-Z]{2}-\d{4,})*)\]/g,
  )) {
    if (match[1].split(/\s*,\s*/).includes(code)) return true;
  }
  return false;
}

/** Why a mark does not count, or null when it does. */
export function markProblem(
  mark: BuilderPrdPrincipleMark | undefined,
  draft: BuilderPrdDocument,
): string | null {
  if (!mark) return 'not marked';
  if (mark.mark === 'not_relevant') {
    return (mark.reason ?? '').length >= PRINCIPLE_REASON_MIN_CHARS
      ? null
      : 'marked not relevant without a reason';
  }
  if (!mark.section || !PRD_ANSWER_SECTIONS.includes(mark.section)) {
    return 'marked applied without naming a PRD section';
  }
  return sectionCites(draft, mark.section, mark.code)
    ? null
    : `marked applied in ${mark.section}, which does not cite [${mark.code}]`;
}

/** What the PRD panel shows about the session's principles. */
export function principlesSummary(
  draft: BuilderPrdDocument,
  signal: NonNullable<BuilderReadinessSignals['principles']>,
): BuilderPrdPrinciplesSummary {
  const marks = normalisePrincipleMarks(draft.principleMarks);
  const inBrief = [...new Set(signal.inBrief.map(normaliseCode))].filter(
    (code) => CODE.test(code),
  );
  return {
    enabled: signal.enabled,
    inBrief,
    retrieved: signal.retrieved,
    unmarked: inBrief.filter(
      (code) =>
        markProblem(
          marks.find((mark) => mark.code === code),
          draft,
        ) !== null,
    ),
  };
}

/**
 * The readiness row: every principle in the guiding brief marked. Passes while the session has
 * no brief (nothing to mark) and when principles are off for the session. A session that
 * retrieved none is warned about in the panel, not blocked — the library being quiet on a topic
 * is not the plan's fault.
 */
export function principleMarksRow(
  draft: BuilderPrdDocument,
  signal: NonNullable<BuilderReadinessSignals['principles']>,
): BuilderPrdReadinessSection {
  const summary = principlesSummary(draft, signal);
  const marks = normalisePrincipleMarks(draft.principleMarks);
  const open = summary.enabled ? summary.unmarked : [];
  const ok = open.length === 0;
  const list = (codes: string[]) =>
    codes.length > 6
      ? `${codes.slice(0, 6).join(', ')} and ${codes.length - 6} more`
      : codes.join(', ');
  return {
    key: 'principleMarks',
    label: 'Principles marked',
    ok,
    hint: ok
      ? ''
      : `${open.length} principle(s) from the brief not marked: ${list(open)}.`,
    detail: ok
      ? ''
      : 'Mark each principle in the guiding brief with mark_principle: "applied" with the PRD ' +
        'section where it changed a decision — that section must cite it as [CODE] — or ' +
        '"not_relevant" with the reason it does not bear on this plan. Open: ' +
        open
          .map((code) => {
            const problem = markProblem(
              marks.find((mark) => mark.code === code),
              draft,
            );
            return `${code} (${problem})`;
          })
          .join(', ') +
        '.',
  };
}
