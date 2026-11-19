import { Injectable, Optional } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import {
  BUILDER_PRD_COVERAGE,
  BUILDER_PRD_COVERAGE_KEYS,
  COVERAGE_REASON_MIN_CHARS,
} from '../constants/builder-prd-coverage.constants';
import { BuilderPrdVersionAuthor } from '../enum/builder.enum';
import {
  BuilderPrdCoverageItem,
  BuilderPrdCoverageKey,
  BuilderPrdDocument,
  BuilderPrdPrincipleMark,
} from '../type/builder-prd.type';
import { BuilderToolExecutionOutcome } from '../type/builder-sse.type';
import {
  normaliseCoverage,
  PRD_ANSWER_SECTIONS,
} from '../util/builder-prd-coverage.util';
import {
  markProblem,
  normaliseCode,
  normalisePrincipleMarks,
  PRINCIPLE_REASON_MIN_CHARS,
} from '../util/builder-prd-principles.util';
import { BuilderPrdService } from './builder-prd.service';
import { BuilderPrinciplesService } from './builder-principles.service';
import { BuilderReadinessService } from './builder-readiness.service';
import type { BuilderToolExecutionContext } from './builder-interview-tools.service';

export const RECORD_COVERAGE_TOOL = 'record_coverage';
export const MARK_PRINCIPLE_TOOL = 'mark_principle';
export const BUILDER_PRD_CHECKLIST_TOOL_NAMES = new Set([
  RECORD_COVERAGE_TOOL,
  MARK_PRINCIPLE_TOOL,
]);

const CHANGE_SUMMARY = {
  type: 'string',
  description: 'One line on what moved, for the version history',
};

/** The two tools, as the model sees them. */
export const BUILDER_PRD_CHECKLIST_TOOLS = [
  {
    name: RECORD_COVERAGE_TOOL,
    description:
      'Record the coverage pass: for each item, the answer the PRD holds, why it does not apply, ' +
      'or the question you asked. Every item must be recorded before the PRD reads ready, and ' +
      '"not applicable" is a fine answer when it says why. Items: ' +
      BUILDER_PRD_COVERAGE.map((item) => `${item.key} — ${item.ask}`).join(
        ' | ',
      ) +
      '. "answered" names the PRD section that holds the answer (write it there first). ' +
      '"asked" records the question you put to the admin; it joins the open questions, and ' +
      'once it is settled, record the answer.',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string', enum: BUILDER_PRD_COVERAGE_KEYS },
              status: {
                type: 'string',
                enum: ['answered', 'not_applicable', 'asked'],
              },
              note: {
                type: 'string',
                description:
                  'answered: the answer in one line. not_applicable: why. asked: the question.',
              },
              section: {
                type: 'string',
                enum: PRD_ANSWER_SECTIONS,
                description: 'answered: the PRD section that holds the answer',
              },
            },
            required: ['key', 'status', 'note'],
          },
        },
        changeSummary: CHANGE_SUMMARY,
      },
      required: ['items'],
    },
  },
  {
    name: MARK_PRINCIPLE_TOOL,
    description:
      'Mark what became of a principle from your guiding brief. "applied": it changed a ' +
      'decision, and the section you name cites it as [CODE] — write the citation into that ' +
      'section first. "not_relevant": it does not bear on this plan, and the reason says why. ' +
      'Every principle in the brief needs a mark before the plan can close.',
    input_schema: {
      type: 'object',
      properties: {
        marks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              code: { type: 'string', description: 'e.g. FP-0142' },
              mark: { type: 'string', enum: ['applied', 'not_relevant'] },
              section: {
                type: 'string',
                enum: PRD_ANSWER_SECTIONS,
                description: 'applied: the PRD section that cites it',
              },
              reason: {
                type: 'string',
                description: 'not_relevant: why it does not bear on this plan',
              },
            },
            required: ['code', 'mark'],
          },
        },
        changeSummary: CHANGE_SUMMARY,
      },
      required: ['marks'],
    },
  },
];

const text = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

/**
 * The interview's tools for the two checklists that sit on the PRD: the coverage pass and the
 * principle marks. Each write goes through `BuilderPrdService.applyMutation`, so it is versioned
 * like any edit, and returns the readiness it leaves — the same read-back the edit tools give.
 *
 * Each entry is checked before anything is written and refused with the reason, so a bad entry
 * never lands as a tick: an answer must point at a section that says something, a not-applicable
 * needs a reason, and an applied principle must be cited where it says.
 */
@Injectable()
export class BuilderPrdChecklistToolsService {
  private readonly logger = LoggerService.getInstance(
    BuilderPrdChecklistToolsService.name,
  );

  constructor(
    private readonly prdService: BuilderPrdService,
    private readonly readiness: BuilderReadinessService,
    @Optional() private readonly principles?: BuilderPrinciplesService,
  ) {}

  async execute(
    name: string,
    input: Record<string, any>,
    context: BuilderToolExecutionContext,
  ): Promise<BuilderToolExecutionOutcome> {
    return name === MARK_PRINCIPLE_TOOL
      ? this.markPrinciples(input, context)
      : this.recordCoverage(input, context);
  }

  private async recordCoverage(
    input: Record<string, any>,
    context: BuilderToolExecutionContext,
  ): Promise<BuilderToolExecutionOutcome> {
    const raw = Array.isArray(input?.items) ? input.items : [];
    const accepted: BuilderPrdCoverageItem[] = [];
    const refused: string[] = [];
    const now = new Date().toISOString();
    for (const entry of raw) {
      const key = text(entry?.key) as BuilderPrdCoverageKey;
      const status = text(entry?.status);
      const note = text(entry?.note);
      const section = text(entry?.section);
      if (!BUILDER_PRD_COVERAGE_KEYS.includes(key)) {
        refused.push(
          `"${key}" is not a coverage item (${BUILDER_PRD_COVERAGE_KEYS.join(', ')})`,
        );
        continue;
      }
      if (status === 'answered') {
        if (!note || !PRD_ANSWER_SECTIONS.includes(section)) {
          refused.push(
            `${key}: an answer needs the answer and the PRD section that holds it`,
          );
          continue;
        }
        accepted.push({ key, status, note, section, at: now });
      } else if (status === 'not_applicable') {
        if (note.length < COVERAGE_REASON_MIN_CHARS) {
          refused.push(`${key}: say why it does not apply`);
          continue;
        }
        accepted.push({ key, status, note, at: now });
      } else if (status === 'asked') {
        if (!note) {
          refused.push(`${key}: record the question you asked`);
          continue;
        }
        accepted.push({ key, status, note, question: note, at: now });
      } else {
        refused.push(
          `${key}: status must be answered, not_applicable or asked`,
        );
      }
    }
    if (!accepted.length) {
      return {
        modelResult: {
          ok: false,
          error: 'nothing_recorded',
          message: refused.length
            ? refused.join('; ')
            : 'record_coverage needs at least one item.',
        },
        summary: 'Coverage not recorded',
      };
    }

    const mutate = (current: BuilderPrdDocument): BuilderPrdDocument => {
      const merged = [
        ...normaliseCoverage(current.coverage).filter(
          (item) => !accepted.some((entry) => entry.key === item.key),
        ),
        ...accepted,
      ];
      const openQuestions = [...(current.openQuestions ?? [])];
      for (const item of accepted) {
        if (item.status === 'asked' && !openQuestions.includes(item.note)) {
          openQuestions.push(item.note);
        }
      }
      return {
        ...current,
        coverage: normaliseCoverage(merged),
        openQuestions,
      };
    };
    return this.persist(
      context,
      mutate,
      text(input?.changeSummary) ||
        `Coverage: ${accepted.map((item) => `${item.key} ${item.status}`).join(', ')}`,
      refused,
    );
  }

  private async markPrinciples(
    input: Record<string, any>,
    context: BuilderToolExecutionContext,
  ): Promise<BuilderToolExecutionOutcome> {
    const raw = Array.isArray(input?.marks) ? input.marks : [];
    const shown = this.principles
      ? await this.principles
          .shownCodes(context.session.id)
          .catch(() => new Set<string>())
      : new Set<string>();
    const draft = context.doc.draft;
    const accepted: BuilderPrdPrincipleMark[] = [];
    const refused: string[] = [];
    const now = new Date().toISOString();
    for (const entry of raw) {
      const code = normaliseCode(entry?.code);
      const mark = text(entry?.mark);
      if (!shown.has(code)) {
        refused.push(`${code || '?'}: not a principle this session was shown`);
        continue;
      }
      if (mark !== 'applied' && mark !== 'not_relevant') {
        refused.push(`${code}: mark must be applied or not_relevant`);
        continue;
      }
      const candidate: BuilderPrdPrincipleMark =
        mark === 'applied'
          ? { code, mark, section: text(entry?.section), at: now }
          : { code, mark, reason: text(entry?.reason), at: now };
      const problem = markProblem(candidate, draft);
      if (problem) {
        refused.push(
          `${code}: ${problem}${
            mark === 'applied'
              ? ' — cite it as [CODE] in that section first'
              : ` (at least ${PRINCIPLE_REASON_MIN_CHARS} characters)`
          }`,
        );
        continue;
      }
      accepted.push(candidate);
    }
    if (!accepted.length) {
      return {
        modelResult: {
          ok: false,
          error: 'nothing_marked',
          message: refused.length
            ? refused.join('; ')
            : 'mark_principle needs at least one mark.',
        },
        summary: 'Principles not marked',
      };
    }
    const mutate = (current: BuilderPrdDocument): BuilderPrdDocument => ({
      ...current,
      principleMarks: normalisePrincipleMarks([
        ...normalisePrincipleMarks(current.principleMarks),
        ...accepted,
      ]),
    });
    return this.persist(
      context,
      mutate,
      text(input?.changeSummary) ||
        `Principles: ${accepted.map((mark) => `${mark.code} ${mark.mark}`).join(', ')}`,
      refused,
    );
  }

  /** Write, then read back readiness the way the edit tools do. */
  private async persist(
    context: BuilderToolExecutionContext,
    mutate: (current: BuilderPrdDocument) => BuilderPrdDocument,
    changeSummary: string,
    refused: string[],
  ): Promise<BuilderToolExecutionOutcome> {
    try {
      const { doc } = await this.prdService.applyMutation(
        context.doc,
        mutate,
        context.userId,
        BuilderPrdVersionAuthor.AGENT,
        changeSummary,
      );
      context.doc = doc;
      const readiness = await this.readiness.settle(
        context.session.id,
        doc,
        'edit',
      );
      return {
        modelResult: {
          ok: true,
          versionNumber: doc.versionNumber,
          readinessScore: readiness.score,
          ready: readiness.ready,
          blockers: readiness.blockers,
          ...(refused.length ? { refused } : {}),
        },
        summary: `PRD updated: ${changeSummary}`,
        events: [
          {
            event: 'prd_draft',
            data: { draft: doc.draft, versionNumber: doc.versionNumber },
          },
          {
            event: 'readiness',
            data: readiness as unknown as Record<string, any>,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Checklist write failed for session ${context.session.id}: ${message}`,
      );
      return {
        modelResult: { ok: false, error: 'edit_failed', message },
        summary: `PRD edit rejected: ${message}`,
      };
    }
  }
}
